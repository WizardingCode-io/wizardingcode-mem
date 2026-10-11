import { unlinkSync } from "node:fs";
import { runEmbedBackfill } from "../../embed/backfill.ts";
import { deleteModel, downloadModel } from "../../embed/download.ts";
import { loadModel, modelState } from "../../embed/model.ts";
import { openDb } from "../../store/db.ts";
import { setMeta } from "../../store/meta.ts";
import { resolvePaths } from "../../util/paths.ts";
import { EXIT_USAGE } from "../exit.ts";

const USAGE =
  "Usage: wizardingcode-mem embed <download | status | delete | backfill [--limit n]>\n";
export const PROGRESS_DONE = "embed.download.done";
export const PROGRESS_TOTAL = "embed.download.total";

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
      removed = deleteModel(dataDir, db);
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
  if (sub !== "download") {
    process.stderr.write(USAGE);
    return EXIT_USAGE;
  }
  let db: ReturnType<typeof openDb> | undefined;
  try {
    db = openDb({ dataDir: storeDir, busyTimeoutMs: 250 });
  } catch {
    // Progress is a courtesy; the download does not need the database.
  }
  try {
    db?.run("DELETE FROM meta WHERE key IN (?, ?)", [PROGRESS_DONE, PROGRESS_TOTAL]);
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
