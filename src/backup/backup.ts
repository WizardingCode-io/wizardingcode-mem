// Backups: a consistent copy of the database (`VACUUM INTO`), gzipped through a stream,
// sent to the target, the oldest pruned; and the way back, checked before it replaces
// anything. One lease keeps two backups apart, and a move away from them.
import { Database } from "bun:sqlite";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip } from "node:zlib";
import { historyDbPath } from "../history/path.ts";
import { DB_FILE, type Db, LATEST_VERSION } from "../store/db.ts";
import { anyLeaseActive, BACKUP_LEASE, claimLease, releaseLease, setMeta } from "../store/meta.ts";
import { logError } from "../util/log.ts";
import { BACKUP_LAST, type LastBackup } from "./schedule.ts";
import { type BackupTarget, backupName, parseBackupName } from "./target.ts";

export { lastBackup } from "./schedule.ts";
export { backupName } from "./target.ts";

const LEASE_MS = 10 * 60_000;
const FREEZE_WAIT_MS = 10_000;
const WORK_DIR = "backups";

export interface BackupOptions {
  db: Db;
  storeDir: string;
  target: BackupTarget;
  keep: number;
  now: number;
  owner: string;
}

export type BackupOutcome =
  | { ok: true; name: string; bytes: number }
  | { ok: false; reason: "busy" | "failed"; detail: string };

const sql = (path: string) => path.replaceAll("'", "''");

// node:zlib streams rather than CompressionStream: the latter hangs on some Bun versions.
async function gzip(from: string, to: string): Promise<void> {
  await pipeline(createReadStream(from), createGzip(), createWriteStream(to, { mode: 0o600 }));
}
async function gunzip(from: string, to: string): Promise<void> {
  await pipeline(createReadStream(from), createGunzip(), createWriteStream(to, { mode: 0o600 }));
}

export async function runBackup(options: BackupOptions): Promise<BackupOutcome> {
  const { db, storeDir, target, keep, now, owner } = options;
  if (!claimLease(db, BACKUP_LEASE, owner, now, LEASE_MS)) {
    return { ok: false, reason: "busy", detail: "another backup is under way" };
  }
  const work = join(storeDir, WORK_DIR);
  const tmp = join(work, `.tmp-${process.pid}.db`);
  const gz = `${tmp}.gz`;
  try {
    mkdirSync(work, { recursive: true, mode: 0o700 });
    rmSync(tmp, { force: true });
    db.run(`VACUUM INTO '${sql(tmp)}'`);
    await gzip(tmp, gz);
    const version =
      db.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version ?? 0;
    const name = backupName(now, version);
    await target.put(name, gz);
    const bytes = statSync(gz).size;
    const entries = await target.list();
    for (const old of entries.slice(keep)) {
      if (old.name !== name) await target.remove(old.name);
    }
    const last: LastBackup = { name, bytes, at: now, label: target.label };
    setMeta(db, BACKUP_LAST, JSON.stringify(last));
    return { ok: true, name, bytes };
  } catch (error) {
    return {
      ok: false,
      reason: "failed",
      detail: error instanceof Error ? error.message : String(error),
    };
  } finally {
    rmSync(tmp, { force: true });
    rmSync(gz, { force: true });
    releaseLease(db, BACKUP_LEASE, owner);
  }
}

export interface RestoreOptions {
  storeDir: string;
  target: BackupTarget;
  name: string;
  now: number;
}

export type RestoreOutcome =
  | { ok: true; replaced: string; historyRemoved: boolean }
  | { ok: false; reason: "unknown" | "unsound" | "busy" | "failed"; detail: string };

/**
 * Puts a backup in the database's place. The copy is unpacked and checked first; the
 * current file is kept, renamed `.replaced-<time>`. The caller must not hold the
 * database open (the viewer closes its connection and reopens it).
 */
export async function restoreBackup(options: RestoreOptions): Promise<RestoreOutcome> {
  const { storeDir, target, name, now } = options;
  const parsed = parseBackupName(name);
  if (parsed === null) return { ok: false, reason: "unknown", detail: "not one of our backups" };
  if (parsed.version > LATEST_VERSION) {
    return {
      ok: false,
      reason: "unsound",
      detail: `this copy was made by a newer wizardingcode-mem (schema ${parsed.version}); upgrade first`,
    };
  }
  const work = join(storeDir, WORK_DIR);
  const gz = join(work, `.restore-${now}.db.gz`);
  const unpacked = join(work, `.restore-${now}.db`);
  const current = join(storeDir, DB_FILE);
  try {
    mkdirSync(work, { recursive: true, mode: 0o700 });
    await target.get(name, gz);
    await gunzip(gz, unpacked);
    const problem = inspect(unpacked);
    if (problem !== null) return { ok: false, reason: "unsound", detail: problem };

    const lock = new Database(current);
    let frozen = false;
    try {
      lock.run(`PRAGMA busy_timeout = ${FREEZE_WAIT_MS}`);
      if (anyLeaseActive(lock, now)) {
        return {
          ok: false,
          reason: "busy",
          detail: "background work holds the database; try again in a minute",
        };
      }
      lock.run("PRAGMA wal_checkpoint(TRUNCATE)");
      lock.run("BEGIN IMMEDIATE");
      frozen = true;
      const replaced = `${current}.replaced-${now}`;
      // The side files go with the file they belong to: the kept database stays whole.
      renameSync(current, replaced);
      for (const suffix of ["-wal", "-shm"]) {
        if (existsSync(current + suffix)) renameSync(current + suffix, replaced + suffix);
      }
      renameSync(unpacked, current);
      return { ok: true, replaced, historyRemoved: removeHistoryIndex(storeDir) };
    } finally {
      if (frozen) {
        try {
          lock.run("ROLLBACK");
        } catch {
          // The lock went with the file.
        }
      }
      lock.close();
    }
  } catch (error) {
    return {
      ok: false,
      reason: "failed",
      detail: error instanceof Error ? error.message : String(error),
    };
  } finally {
    rmSync(gz, { force: true });
    rmSync(unpacked, { force: true });
  }
}

/**
 * The history index names projects by the replaced database's ids, which the copy may give
 * to other projects. It is rebuildable, so it goes; true when there was one to remove.
 */
function removeHistoryIndex(storeDir: string): boolean {
  const path = historyDbPath(storeDir);
  if (!existsSync(path)) return false;
  try {
    for (const suffix of ["", "-wal", "-shm"]) rmSync(path + suffix, { force: true });
    return true;
  } catch (error) {
    logError("backup restore", error);
    return false;
  }
}

/** Null when the unpacked file is a sound database this version can open. */
function inspect(path: string): string | null {
  let probe: Database;
  try {
    probe = new Database(path, { readonly: true });
  } catch (error) {
    return `not a database: ${error instanceof Error ? error.message : String(error)}`;
  }
  try {
    const check = probe.query<{ quick_check: string }, []>("PRAGMA quick_check").get()?.quick_check;
    if (check !== "ok") return `the copy failed its integrity check: ${check ?? "unknown"}`;
    const version =
      probe.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version ?? 0;
    if (version > LATEST_VERSION)
      return `schema version ${version} is newer than this wizardingcode-mem supports`;
    const table = probe
      .query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'memories'")
      .get();
    if (table === null) return "the copy holds no memories table";
    return null;
  } catch (error) {
    return `not a database: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    probe.close();
  }
}
