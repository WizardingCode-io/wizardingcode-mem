import { deleteModel, downloadModel } from "../../embed/download.ts";
import { modelState } from "../../embed/model.ts";
import { openDb } from "../../store/db.ts";
import { setMeta } from "../../store/meta.ts";
import { resolvePaths } from "../../util/paths.ts";
import { EXIT_USAGE } from "../exit.ts";

const USAGE = "Usage: wizardingcode-mem embed <download | status | delete>\n";
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
  if (sub === "delete") {
    deleteModel(dataDir);
    process.stdout.write("embed: model removed\n");
    return 0;
  }
  if (sub !== "download") {
    process.stderr.write(USAGE);
    return EXIT_USAGE;
  }
  let db: ReturnType<typeof openDb> | undefined;
  try {
    db = openDb({ dataDir: storeDir, busyTimeoutMs: 5000 });
  } catch {
    // Progress is a courtesy; the download does not need the database.
  }
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
    try {
      db?.run("DELETE FROM meta WHERE key IN (?, ?)", [PROGRESS_DONE, PROGRESS_TOTAL]);
    } catch {}
    db?.close();
  }
}
