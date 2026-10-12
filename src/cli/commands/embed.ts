import { unlinkSync } from "node:fs";
import { runEmbedBackfill } from "../../embed/backfill.ts";
import { deleteModel, downloadModel } from "../../embed/download.ts";
import { loadModel, modelState } from "../../embed/model.ts";
import { DOWNLOAD_ERROR, PROGRESS_DONE, PROGRESS_TOTAL } from "../../embed/status.ts";
import { openDb } from "../../store/db.ts";
import { claimLease, EMBED_DOWNLOAD_LEASE, releaseLease, setMeta } from "../../store/meta.ts";
import { resolvePaths } from "../../util/paths.ts";
import { EXIT_USAGE } from "../exit.ts";

const USAGE =
  "Usage: wizardingcode-mem embed <download [--backfill] | status | delete | backfill [--limit n]>\n";
/** The download renews its lease at most this often, and holds it this long. */
const LEASE_RENEW_MS = 10_000;
// Longer than the download's own 60 s stall timeout, so a slow stretch does not lose it.
const LEASE_MS = 120_000;

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

/**
 * `wizardingcode-mem embed`: the opt-in semantic model. `download` fetches it once (the only
 * network access of the feature), `status` says whether it is there and switched on, `delete`
 * removes it. Progress goes to meta so the viewer can poll it.
 */
export async function run(argv: string[]): Promise<number> {
  const [sub] = argv;
  const { dataDir, storeDir } = resolvePaths();
  if (sub === "status") {
    const s = modelState(dataDir);
    process.stdout.write(
      `present: ${s.present ? "yes" : "no"}\nbytes: ${s.bytes}\nenabled: ${s.enabled ? "yes" : "no"}\n` +
        (s.reason ? `problem: ${s.reason}\n` : ""),
    );
    return 0;
  }
  if (sub === "backfill") return backfill(argv.slice(1), dataDir, storeDir);
  if (sub === "delete") {
    let db: ReturnType<typeof openDb> | undefined;
    try {
      db = openDb({ dataDir: storeDir, busyTimeoutMs: 2000 });
    } catch {
      // No database to clean: removing the file is still worth doing.
    }
    let removed: boolean;
    try {
      removed = deleteModel(dataDir, db, storeDir);
    } finally {
      db?.close();
    }
    if (!removed) {
      process.stderr.write(
        "wizardingcode-mem embed: could not remove the model (is it in use? close the viewer and retry)\n",
      );
      return 1;
    }
    process.stdout.write("embed: model removed\n");
    return 0;
  }
  const rest = argv.slice(1);
  if (sub !== "download" || rest.some((arg) => arg !== "--backfill")) {
    process.stderr.write(USAGE);
    return EXIT_USAGE;
  }
  const code = await download(dataDir, storeDir);
  if (code === null) return 0;
  if (code !== 0) return code;
  // Asked by the viewer and the install: the memories already there get their vectors now.
  if (rest.includes("--backfill")) return backfill([], dataDir, storeDir);
  process.stdout.write(
    "embed: memories saved before now get a vector with: wizardingcode-mem embed backfill\n",
  );
  return 0;
}

/** The exit code, or null when another download holds the lease. */
async function download(dataDir: string, storeDir: string): Promise<number | null> {
  let db: ReturnType<typeof openDb> | undefined;
  try {
    db = openDb({ dataDir: storeDir, busyTimeoutMs: 250 });
  } catch {
    // Progress is a courtesy; the download does not need the database.
  }
  const owner = `${process.pid}-${crypto.randomUUID()}`;
  let renewedAt = Date.now();
  try {
    if (db && !claimLease(db, EMBED_DOWNLOAD_LEASE, owner, renewedAt, LEASE_MS)) {
      process.stdout.write("embed: a download is already running\n");
      db.close();
      return null;
    }
  } catch {
    // A busy database must not stop the download: it only loses the lease and the progress.
  }
  try {
    db?.run("DELETE FROM meta WHERE key IN (?, ?, ?)", [
      PROGRESS_DONE,
      PROGRESS_TOTAL,
      DOWNLOAD_ERROR,
    ]);
  } catch {}
  let partPath: string | null = null;
  const dropPart = () => {
    if (partPath === null) return;
    try {
      unlinkSync(partPath);
    } catch {}
  };
  const onSignal = (code: number) => () => {
    dropPart();
    process.exit(code);
  };
  const sigint = onSignal(130);
  const sigterm = onSignal(143);
  process.on("SIGINT", sigint);
  process.on("SIGTERM", sigterm);
  const progress = (done: number, total: number) => {
    try {
      if (db) {
        setMeta(db, PROGRESS_DONE, String(done));
        setMeta(db, PROGRESS_TOTAL, String(total));
        const at = Date.now();
        if (at - renewedAt >= LEASE_RENEW_MS) {
          renewedAt = at;
          claimLease(db, EMBED_DOWNLOAD_LEASE, owner, at, LEASE_MS);
        }
      }
    } catch {}
  };
  let lastPrinted = 0;
  try {
    process.stdout.write("embed: downloading the semantic model (about 140 MB)\n");
    const out = await downloadModel({
      dataDir,
      onPart: (path) => {
        partPath = path;
      },
      onProgress: (done, total) => {
        const now = Date.now();
        if (now - lastPrinted > 500 || done === total) {
          lastPrinted = now;
          progress(done, total);
          if (process.stdout.isTTY) process.stdout.write(`\r${mb(done)} / ${mb(total)}`);
        }
      },
    });
    if (process.stdout.isTTY) process.stdout.write("\n");
    if (!out.ok) {
      try {
        if (db) setMeta(db, DOWNLOAD_ERROR, out.reason);
      } catch {}
      process.stderr.write(
        `wizardingcode-mem embed: ${out.reason}. Nothing was installed; run it again to retry.\n`,
      );
      return 1;
    }
    process.stdout.write(out.alreadyPresent ? "embed: already present\n" : "embed: model ready\n");
    return 0;
  } finally {
    dropPart();
    process.off("SIGINT", sigint);
    process.off("SIGTERM", sigterm);
    try {
      db?.run("DELETE FROM meta WHERE key IN (?, ?)", [PROGRESS_DONE, PROGRESS_TOTAL]);
      if (db) releaseLease(db, EMBED_DOWNLOAD_LEASE, owner);
    } catch {}
    db?.close();
  }
}

/** `embed backfill [--limit n]`: a vector for every memory that lacks one of the present model. */
async function backfill(args: string[], dataDir: string, storeDir: string): Promise<number> {
  let limit: number | undefined;
  if (args.length > 0) {
    const n = Number(args[1]);
    if (args[0] !== "--limit" || args.length !== 2 || !Number.isInteger(n) || n < 1) {
      process.stderr.write(USAGE);
      return EXIT_USAGE;
    }
    limit = n;
  }
  const model = loadModel({ dataDir });
  if (model === null) {
    process.stderr.write(
      "wizardingcode-mem embed: no semantic model (run `wizardingcode-mem embed download`, and check it is switched on)\n",
    );
    return 1;
  }
  const db = openDb({ dataDir: storeDir, busyTimeoutMs: 2000 });
  try {
    const out = await runEmbedBackfill(db, model, { now: Date.now, ...(limit ? { limit } : {}) });
    process.stdout.write(
      out === null
        ? "embed backfill: already running in another process\n"
        : `embed backfill: ${out.written} written, ${out.remaining} remaining\n`,
    );
    return 0;
  } finally {
    db.close();
  }
}
