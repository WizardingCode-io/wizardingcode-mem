import { lastBackup, restoreBackup, runBackup } from "../../backup/backup.ts";
import { targetFor } from "../../backup/target.ts";
import { loadSettings } from "../../settings/settings.ts";
import { type Db, openDb } from "../../store/db.ts";
import { logError } from "../../util/log.ts";
import { resolvePaths } from "../../util/paths.ts";
import { EXIT_USAGE } from "../exit.ts";

const USAGE = "Usage: wizardingcode-mem backup [--list | --restore <name>]\n";
const size = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.round(bytes / 1024)} KB`;

/**
 * `wizardingcode-mem backup`: a consistent copy of the database to the configured target
 * (WIZARDINGCODE_MEM_BACKUP_TO: a folder or s3://bucket/prefix). Hooks run it in the
 * background when one is due; `--list` shows what is there; `--restore` brings one back.
 */
export async function run(argv: string[]): Promise<number> {
  const { dataDir, storeDir } = resolvePaths();
  const settings = loadSettings(process.env, dataDir);
  const target = targetFor(settings);
  if (target === null) {
    process.stderr.write(
      "wizardingcode-mem backup: no target configured. Set WIZARDINGCODE_MEM_BACKUP_TO in the viewer's settings (a folder, or s3://bucket/prefix).\n",
    );
    return 1;
  }
  if (argv.includes("--list")) {
    const entries = await target.list();
    process.stdout.write(
      entries.length === 0
        ? `backup: nothing in ${target.label} yet\n`
        : `${entries.map((e) => `${e.name}  ${size(e.bytes)}`).join("\n")}\n`,
    );
    return 0;
  }
  const at = argv.indexOf("--restore");
  if (at !== -1) {
    const name = argv[at + 1];
    if (!name) {
      process.stderr.write(`wizardingcode-mem backup: --restore takes a backup's name\n${USAGE}`);
      return EXIT_USAGE;
    }
    const outcome = await restoreBackup({ storeDir, target, name, now: Date.now() });
    if (outcome.ok) {
      process.stdout.write(
        `backup: restored ${name}; the previous database is ${outcome.replaced}\n`,
      );
      if (outcome.historyRemoved) {
        process.stdout.write(
          "backup: history index removed; run wizardingcode-mem history index to rebuild it\n",
        );
      }
      return 0;
    }
    process.stderr.write(`wizardingcode-mem backup: not restored: ${outcome.detail}\n`);
    return 1;
  }
  let db: Db | undefined;
  try {
    db = openDb({ dataDir: storeDir, busyTimeoutMs: 5000 });
    const outcome = await runBackup({
      db,
      storeDir,
      target,
      keep: settings.backup.keep,
      now: Date.now(),
      owner: `${process.pid}-${crypto.randomUUID()}`,
    });
    if (outcome.ok) {
      process.stdout.write(`backup: ${outcome.name} (${size(outcome.bytes)}) in ${target.label}\n`);
      return 0;
    }
    if (outcome.reason === "busy") {
      process.stdout.write("backup: another one is under way\n");
      return 0;
    }
    process.stderr.write(`wizardingcode-mem backup: ${outcome.detail}\n`);
    return 1;
  } catch (error) {
    logError("backup", error, dataDir);
    process.stderr.write(
      `wizardingcode-mem: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  } finally {
    const last = db === undefined ? null : lastBackup(db);
    if (last !== null && process.env.WIZARDINGCODE_MEM_DEBUG)
      process.stderr.write(`last: ${last.name}\n`);
    db?.close();
  }
}
