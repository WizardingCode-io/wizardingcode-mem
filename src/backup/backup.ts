// Backups: a consistent copy of the database (`VACUUM INTO`), gzipped through a stream,
// sent to the target, the oldest pruned; and the way back, checked before it replaces
// anything. One lease keeps two backups apart, and a move away from them.
import { Database, type SQLQueryBindings } from "bun:sqlite";
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
import { counterOf, fileListsOf, hasTable, type Lists, resetLevels } from "../sharing/store.ts";
import { DB_FILE, type Db, LATEST_VERSION, openStoreFile, withWrite } from "../store/db.ts";
import { deleteReceivedMemory } from "../store/memories.ts";
import {
  anyLeaseActive,
  BACKUP_LEASE,
  claimLease,
  clearSyncStop,
  releaseLease,
  restoreHoldKey,
  setMeta,
  stopSync,
} from "../store/meta.ts";
import { type Clock, realClock, realTimers, type Timers } from "../util/clock.ts";
import { logError } from "../util/log.ts";
import { resolvePaths } from "../util/paths.ts";
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
  /** Where the env file is, whose sharing lists become the restored store's baseline. */
  dataDir?: string;
  target: BackupTarget;
  name: string;
  now: number;
  /** The clock and timers the stop of the sync waits on; the real ones unless a test gives its own. */
  clock?: Clock;
  timers?: Timers;
  /** Tests: runs inside the carry's transaction on the copy, before anything is renamed. */
  onCopy?: (copy: Db) => void;
}

export type RestoreOutcome =
  | {
      ok: true;
      replaced: string;
      historyRemoved: boolean;
      sharingReset: number;
      /** The servers whose live rows the copy received, and the copy's servers the live list lacked. */
      servers: { carried: string[]; dropped: string[] };
      /** The dropped servers, whose received copies the sync's next start deletes. */
      pendingDeletion: string[];
    }
  | { ok: false; reason: "unknown" | "unsound" | "busy" | "failed"; detail: string };

/** The eight tables the restore carries from the live store (ADR 0027), in insertion order. */
const CARRIED: readonly string[] = [
  "sharing_servers",
  "sharing_muted_members",
  "sharing_ledger",
  "sharing_sent_hashes",
  "sharing_refusals",
  "sharing_conflicts",
  "sharing_pending_rows",
  "sharing_unbound",
];

interface LiveRows {
  serverIds: string[];
  /** Every row of each carried table as the live store holds them; none on a store at sharing v1. */
  tables: { table: string; columns: string[]; rows: SQLQueryBindings[][] }[];
}

/** The live store's sharing rows, read while it is frozen. */
function readLiveRows(live: Db): LiveRows {
  if (!hasTable(live, "sharing_servers")) {
    return { serverIds: [], tables: CARRIED.map((table) => ({ table, columns: [], rows: [] })) };
  }
  const serverIds = live
    .query<{ server_id: string }, []>("SELECT server_id FROM sharing_servers ORDER BY server_id")
    .all()
    .map((row) => row.server_id);
  const tables = CARRIED.map((table) => {
    const columns = live
      .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
      .all()
      .map((column) => column.name);
    const rows = live
      .query<SQLQueryBindings[], []>(`SELECT ${columns.join(", ")} FROM ${table}`)
      .values();
    return { table, columns, rows };
  });
  return { serverIds, tables };
}

/**
 * The received memories, which no carried table names, squared with the carried ledger for
 * each listed server: a `received` memory row of the live ledger whose memory the copy does
 * not hold (received after the backup) is dropped, so the snapshot receives it again instead
 * of reading it as deduped; a received memory the copy holds whose row the live ledger lost
 * (a tombstone or a purge after the backup) is deleted with its provenance, so nothing erased
 * revives. A dropped server's memories are the start's (`orphanServerIds`).
 */
function reconcileReceivedMemories(copy: Db, serverIds: string[]): void {
  if (!hasTable(copy, "sharing_received_memories")) return;
  for (const serverId of serverIds) {
    const revived = copy
      .query<{ memory_id: number }, [string]>(
        `SELECT r.memory_id FROM sharing_received_memories r
          WHERE r.server_id = ?
            AND NOT EXISTS (SELECT 1 FROM sharing_ledger l
                             WHERE l.destination = r.server_id AND l.item_kind = 'memory'
                               AND l.direction = 'received' AND l.item_uid = r.remote_uid)`,
      )
      .all(serverId);
    for (const row of revived) deleteReceivedMemory(copy, row.memory_id);
    copy.run(
      `DELETE FROM sharing_ledger
        WHERE destination = ? AND item_kind = 'memory' AND direction = 'received'
          AND NOT EXISTS (SELECT 1 FROM sharing_received_memories r
                           WHERE r.server_id = sharing_ledger.destination
                             AND r.remote_uid = sharing_ledger.item_uid)`,
      [serverId],
    );
  }
}

/**
 * In one transaction on the copy: the eight tables replaced by the live rows (a listed
 * server's ledger is the live one, an unlisted server's rows are gone), every level back to
 * Nothing (`resetLevels`), the copy's hold keys, authorised lists and `sync.*` marks cleared,
 * a hold with reason `restore` on every listed server (D-10) and a snapshot due on each.
 * Returns what the report says; throws what any step throws, which fails the restore whole.
 */
function carryIntoCopy(
  copy: Db,
  live: LiveRows,
  now: number,
  counterFloor: number,
  fileLists: Lists,
  onCopy?: (copy: Db) => void,
): { sharingReset: number; dropped: string[] } {
  return withWrite(copy, () => {
    const listed = new Set(live.serverIds);
    const dropped = copy
      .query<{ server_id: string }, []>("SELECT server_id FROM sharing_servers ORDER BY server_id")
      .all()
      .map((row) => row.server_id)
      .filter((id) => !listed.has(id));
    for (const { table, columns, rows } of live.tables) {
      copy.run(`DELETE FROM ${table}`);
      if (rows.length === 0) continue;
      const insert = copy.query(
        `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
      );
      for (const row of rows) insert.run(...row);
    }
    reconcileReceivedMemories(copy, live.serverIds);
    const sharingReset = resetLevels(copy, now, counterFloor, fileLists);
    copy.run(
      `DELETE FROM meta WHERE key LIKE 'sharing.restore_hold:%' OR key LIKE 'sharing.resume_authorised:%'
          OR key LIKE 'sync.%' OR key LIKE 'names.%'`,
    );
    for (const serverId of live.serverIds) {
      setMeta(copy, restoreHoldKey(serverId), JSON.stringify({ reason: "restore", at: now }));
    }
    copy.run("UPDATE sharing_servers SET snapshot_due = 1");
    onCopy?.(copy);
    return { sharingReset, dropped };
  });
}

/**
 * Puts a backup in the database's place. The copy is unpacked and checked first; the sync is
 * asked to leave through its flag (ADR 0027), the other background work refuses; then, with
 * the current store frozen, the copy is brought to this binary's schema with no copy of its
 * own, the live sharing rows are carried into it (`carryIntoCopy`) and its journal mode set to
 * DELETE, so one file holds it all; and only then is the current file renamed `.replaced-<time>`
 * and the copy put in its place. The caller must not hold the database open (the viewer closes
 * its connection and reopens it). A failure before the rename leaves the store unchanged and
 * discards the copy.
 */
export async function restoreBackup(options: RestoreOptions): Promise<RestoreOutcome> {
  const { storeDir, target, name, now } = options;
  const clock = options.clock ?? realClock;
  const timers = options.timers ?? realTimers;
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
  const unpackedName = `.restore-${now}.db`;
  const unpacked = join(work, unpackedName);
  const current = join(storeDir, DB_FILE);
  // A side file beside the copy would hold rows the renamed file lacks: refused, never merged.
  const sideFile = () => ["-wal", "-shm"].find((suffix) => existsSync(unpacked + suffix)) ?? null;
  try {
    mkdirSync(work, { recursive: true, mode: 0o700 });
    const stray = sideFile();
    if (stray !== null) {
      return {
        ok: false,
        reason: "unsound",
        detail: `a ${stray} file is beside the copy's place (${unpacked}${stray}); remove it and try again`,
      };
    }
    await target.get(name, gz);
    await gunzip(gz, unpacked);
    const problem = inspect(unpacked);
    if (problem !== null) return { ok: false, reason: "unsound", detail: problem };

    const lock = new Database(current);
    let frozen = false;
    let flagged = false;
    try {
      lock.run(`PRAGMA busy_timeout = ${FREEZE_WAIT_MS}`);
      // The sync is asked to leave, not refused: its flag, then the wait for its lease.
      flagged = true;
      const left = await stopSync(lock, { who: "restore", clock, timers });
      if (!left) {
        return {
          ok: false,
          reason: "busy",
          detail:
            "the sync is running and did not stop within 30 s; run `wizardingcode-mem sync stop` first",
        };
      }
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
      const live = readLiveRows(lock);
      const counterFloor = counterOf(lock);
      const fileLists = fileListsOf(options.dataDir ?? resolvePaths().dataDir);
      // The copy at this binary's schema, with no copy of its own, then the carry.
      const copy = openStoreFile(work, unpackedName, {
        upgradeBackup: false,
        busyTimeoutMs: FREEZE_WAIT_MS,
      });
      let carried: { sharingReset: number; dropped: string[] };
      try {
        carried = carryIntoCopy(copy, live, now, counterFloor, fileLists, options.onCopy);
        // No side file may hold a carried row: the copy is one file when it is renamed.
        copy.run("PRAGMA journal_mode = DELETE");
      } finally {
        copy.close();
      }
      // Leaving WAL mode drops the -wal file and leaves the -shm, which holds no row: a -wal
      // still beside the copy refuses the restore, an -shm is removed.
      if (existsSync(`${unpacked}-wal`)) {
        return {
          ok: false,
          reason: "unsound",
          detail: "a -wal file is still beside the copy; nothing was restored",
        };
      }
      rmSync(`${unpacked}-shm`, { force: true });
      const replaced = `${current}.replaced-${now}`;
      // The side files go with the file they belong to: the kept database stays whole.
      renameSync(current, replaced);
      for (const suffix of ["-wal", "-shm"]) {
        if (existsSync(current + suffix)) renameSync(current + suffix, replaced + suffix);
      }
      renameSync(unpacked, current);
      return {
        ok: true,
        replaced,
        historyRemoved: removeHistoryIndex(storeDir),
        sharingReset: carried.sharingReset,
        servers: { carried: live.serverIds, dropped: carried.dropped },
        pendingDeletion: carried.dropped,
      };
    } finally {
      if (frozen) {
        try {
          lock.run("ROLLBACK");
        } catch {
          // The lock went with the file.
        }
      }
      if (flagged) {
        try {
          clearSyncStop(lock);
        } catch {
          // The flag went with the file, or the file is gone: nothing to clear.
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
    // The copy and any side file a failed step left beside it.
    for (const suffix of ["", "-wal", "-shm"]) rmSync(unpacked + suffix, { force: true });
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
    // Read and write: a copy whose header says WAL cannot be opened read-only with no side
    // files beside it, and the unpacked copy is this process's own. Closing leaves none.
    probe = new Database(path);
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
