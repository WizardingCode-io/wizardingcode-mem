import { Database } from "bun:sqlite";
import { chmodSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { resolvePaths } from "../util/paths.ts";
import init from "./migrations/0001_init.sql" with { type: "text" };
import ftsProject from "./migrations/0002_fts_project.sql" with { type: "text" };
import { dropHostContext } from "./migrations/0003_host_context.ts";

export type Db = Database;

export interface Migration {
  version: number;
  name: string;
  /** A schema change; a change to the data that needs code goes in `run`. */
  sql?: string;
  run?: (db: Db) => void;
}

/** Forward-only. A migration is never edited once released; a change is a new migration. */
export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: "init", sql: init },
  { version: 2, name: "fts_project", sql: ftsProject },
  { version: 3, name: "host_context", run: dropHostContext },
];
export const LATEST_VERSION = MIGRATIONS.length;

export const DB_FILE = "wizardingcode-mem.db";
const BACKUPS_DIR = "backups";
const BACKUPS_KEPT = 2;

/** The database was written by a newer wizardingcode-mem. Callers must leave it alone. */
export class SchemaTooNewError extends Error {
  constructor(found: number, supported: number) {
    super(
      `database schema version ${found} is newer than this wizardingcode-mem supports (${supported}); upgrade wizardingcode-mem`,
    );
    this.name = "SchemaTooNewError";
  }
}

export interface OpenOptions {
  /** The directory of the database file. Defaults to the store directory (see `resolvePaths`). */
  dataDir?: string;
  /** How long a statement waits for another process's lock. Keep it below the caller's own deadline. */
  busyTimeoutMs: number;
  /** For tests. */
  migrations?: readonly Migration[];
}

function userVersion(db: Db): number {
  return db.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version ?? 0;
}

function restrict(path: string, mode: number): void {
  if (process.platform === "win32" || !existsSync(path)) return;
  try {
    chmodSync(path, mode);
  } catch {
    // A filesystem without permissions (exFAT, vfat on an external disk) cannot be made
    // stricter; the database is still usable there.
  }
}

function backup(db: Db, dir: string, version: number): void {
  const backups = join(dir, BACKUPS_DIR);
  mkdirSync(backups, { recursive: true, mode: 0o700 });
  // Timestamp first, so that sorting by name is sorting by age.
  const target = join(backups, `wizardingcode-mem-${Date.now()}-v${version}-${process.pid}.db`);
  db.run(`VACUUM INTO '${target.replaceAll("'", "''")}'`);
  restrict(target, 0o600);
  const old = readdirSync(backups)
    .filter((name) => name.endsWith(".db"))
    .sort()
    .slice(0, -BACKUPS_KEPT);
  for (const name of old) rmSync(join(backups, name), { force: true });
}

/**
 * WAL persists in the file, so it is set once, when the database is created.
 * Changing the journal mode needs an exclusive lock and, unlike ordinary statements,
 * fails at once instead of waiting for `busy_timeout`. Several processes creating the
 * database together therefore have to retry by hand.
 */
function enableWal(db: Db, busyTimeoutMs: number): void {
  const deadline = Date.now() + Math.max(busyTimeoutMs, 1000);
  for (;;) {
    try {
      db.run("PRAGMA journal_mode = WAL");
      return;
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      const busy = typeof code === "string" && code.startsWith("SQLITE_BUSY");
      if (!busy || Date.now() >= deadline) throw error;
      Bun.sleepSync(15);
    }
  }
}

/** How long a process waits for another one's upgrade. Rare, and worth waiting for. */
const UPGRADE_WAIT_MS = 10_000;

/**
 * Brings the database to the latest schema. An upgrade is a backup followed by the
 * pending migrations, and several processes may arrive at once: a second connection
 * takes the write lock first and holds it through both, so only one of them upgrades
 * and the rest find the work done. (`VACUUM INTO` cannot run inside a transaction, so
 * it runs on the main connection, as a reader, while the lock is held on the other.)
 */
function migrate(
  db: Db,
  path: string,
  dir: string,
  migrations: readonly Migration[],
  busyTimeoutMs: number,
): void {
  const latest = Math.max(0, ...migrations.map((migration) => migration.version));
  const current = userVersion(db);
  if (current > latest) throw new SchemaTooNewError(current, latest);
  if (current === latest) return;
  if (current === 0) enableWal(db, busyTimeoutMs);

  const lock = new Database(path);
  try {
    lock.run(`PRAGMA busy_timeout = ${UPGRADE_WAIT_MS}`);
    lock.run("BEGIN IMMEDIATE");
    try {
      // Read again under the lock: another process may have upgraded while we waited.
      const now = userVersion(lock);
      if (now >= latest) {
        lock.run("ROLLBACK");
        return;
      }
      if (now > 0) backup(db, dir, now);
      for (const migration of [...migrations].sort((a, b) => a.version - b.version)) {
        if (migration.version <= now) continue;
        if (migration.sql !== undefined) lock.run(migration.sql);
        migration.run?.(lock);
        lock.run(`PRAGMA user_version = ${migration.version}`);
      }
      lock.run("COMMIT");
    } catch (error) {
      try {
        lock.run("ROLLBACK");
      } catch {
        // Nothing was open to roll back.
      }
      throw error;
    }
  } finally {
    lock.close();
  }
}

export function openDb(options: OpenOptions): Db {
  const dir = options.dataDir ?? resolvePaths().storeDir;
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, DB_FILE);
  const db = new Database(path, { create: true });
  try {
    // busy_timeout first: every later statement on this connection depends on it.
    db.run(`PRAGMA busy_timeout = ${Math.max(0, Math.trunc(options.busyTimeoutMs))}`);
    db.run("PRAGMA foreign_keys = ON");
    db.run("PRAGMA synchronous = NORMAL");
    migrate(db, path, dir, options.migrations ?? MIGRATIONS, options.busyTimeoutMs);
  } catch (error) {
    db.close();
    throw error;
  }
  for (const suffix of ["", "-wal", "-shm"]) restrict(path + suffix, 0o600);
  return db;
}

/** Runs `fn` in a transaction that takes the write lock up front, so `busy_timeout` applies. */
export function withWrite<T>(db: Db, fn: () => T): T {
  return db.transaction(fn).immediate();
}

/**
 * Opens the database for reading only, without creating or migrating anything.
 * Null when there is no database yet. For commands that inspect: status and doctor.
 */
export function openExisting(dataDir: string = resolvePaths().storeDir): Db | null {
  const path = join(dataDir, DB_FILE);
  if (!existsSync(path)) return null;
  const db = new Database(path, { readonly: true });
  try {
    db.run("PRAGMA busy_timeout = 2000");
    const found = userVersion(db);
    if (found > LATEST_VERSION) throw new SchemaTooNewError(found, LATEST_VERSION);
  } catch (error) {
    db.close();
    throw error;
  }
  return db;
}
