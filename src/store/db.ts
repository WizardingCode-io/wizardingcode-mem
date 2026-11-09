import { Database } from "bun:sqlite";
import { chmodSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { MODULE_SCHEMAS } from "../engine/module-schemas.ts";
import { resolvePaths } from "../util/paths.ts";
import type { Migration, ModuleSchema } from "./migration.ts";
import init from "./migrations/0001_init.sql" with { type: "text" };
import ftsProject from "./migrations/0002_fts_project.sql" with { type: "text" };
import { dropHostContext } from "./migrations/0003_host_context.ts";
import history from "./migrations/0004_history.sql" with { type: "text" };
import moments from "./migrations/0005_moments.sql" with { type: "text" };
import vectors from "./migrations/0006_vectors.sql" with { type: "text" };
import links from "./migrations/0007_links.sql" with { type: "text" };

export type Db = Database;

export type { Migration, ModuleSchema };

/** Forward-only. A migration is never edited once released; a change is a new migration. */
export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: "init", sql: init },
  { version: 2, name: "fts_project", sql: ftsProject },
  { version: 3, name: "host_context", run: dropHostContext },
  { version: 4, name: "history", sql: history },
  { version: 5, name: "moments", sql: moments },
  { version: 6, name: "vectors", sql: vectors },
  { version: 7, name: "links", sql: links },
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
  /** For tests: the modules' tables, in place of `MODULE_SCHEMAS`. */
  moduleSchemas?: readonly ModuleSchema[];
}

function userVersion(db: Db): number {
  return db.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version ?? 0;
}

export function restrict(path: string, mode: number): void {
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
export function enableWal(db: Db, busyTimeoutMs: number): void {
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

/** What differs between upgrading the core schema and upgrading the modules' tables. */
interface Upgrade {
  /** How far the database is, read on the given connection. */
  current: (lock: Db) => number;
  latest: number;
  /** Runs first under the lock: what the bookkeeping itself needs before anything is read. */
  prepare?: (lock: Db) => void;
  /** The migrations still to apply, in order. */
  pending: (lock: Db) => Migration[];
  record: (lock: Db, migration: Migration) => void;
  /** The version to name the backup with; null when there is nothing worth copying yet. */
  backupVersion: (lock: Db) => number | null;
}

/**
 * An upgrade is a backup followed by the pending migrations, and several processes may
 * arrive at once: a second connection takes the write lock first and holds it through
 * both, so only one of them upgrades and the rest find the work done. (`VACUUM INTO`
 * cannot run inside a transaction, so it runs on the main connection, as a reader, while
 * the lock is held on the other.) An error rolls the whole upgrade back.
 */
function upgrade(db: Db, path: string, dir: string, plan: Upgrade): void {
  const lock = new Database(path);
  try {
    lock.run(`PRAGMA busy_timeout = ${UPGRADE_WAIT_MS}`);
    lock.run("BEGIN IMMEDIATE");
    try {
      // Read again under the lock: another process may have upgraded while we waited.
      if (plan.current(lock) >= plan.latest) {
        lock.run("ROLLBACK");
        return;
      }
      plan.prepare?.(lock);
      const pending = plan.pending(lock);
      const version = plan.backupVersion(lock);
      if (version !== null) backup(db, dir, version);
      for (const migration of pending) {
        if (migration.sql !== undefined) lock.run(migration.sql);
        migration.run?.(lock);
        plan.record(lock, migration);
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

const byVersion = (a: Migration, b: Migration) => a.version - b.version;

/** Brings the core schema to the latest version. */
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

  upgrade(db, path, dir, {
    current: userVersion,
    latest,
    pending: (lock) => {
      const now = userVersion(lock);
      return [...migrations].sort(byVersion).filter((migration) => migration.version > now);
    },
    record: (lock, migration) => lock.run(`PRAGMA user_version = ${migration.version}`),
    backupVersion: (lock) => {
      const now = userVersion(lock);
      return now > 0 ? now : null;
    },
  });
}

// --- The modules' tables ----------------------------------------------------------
// A module's tables are versioned apart from the core schema, in `module_migrations`, so
// they never move `user_version`: an older binary still opens the database and ignores them.

const MODULE_MIGRATIONS_TABLE = "module_migrations";

/** Each module's newest recorded version; null when no module ever migrated this database. */
function recordedModuleVersions(db: Db): Map<string, number> | null {
  try {
    const rows = db
      .query<{ module: string; version: number }, []>(
        `SELECT module, MAX(version) AS version FROM ${MODULE_MIGRATIONS_TABLE} GROUP BY module`,
      )
      .all();
    return new Map(rows.map((row) => [row.module, row.version]));
  } catch (error) {
    if (String((error as Error).message).includes("no such table")) return null;
    throw error;
  }
}

/** The newest version recorded for a module; 0 when none, or when the table does not exist. */
export function moduleVersion(db: Db, module: string): number {
  return recordedModuleVersions(db)?.get(module) ?? 0;
}

/**
 * Where a module's tables stand against the version a caller supports. `openDb` leaves a
 * newer version alone, so memory keeps working; the module's own code refuses on `too-new`.
 * A database no module ever migrated is `current`: there is nothing to be behind of.
 */
export function moduleSchemaState(
  db: Db,
  module: string,
  latest: number,
): "current" | "behind" | "too-new" {
  const versions = recordedModuleVersions(db);
  if (versions === null) return "current";
  const version = versions.get(module) ?? 0;
  if (version > latest) return "too-new";
  return version < latest ? "behind" : "current";
}

/** The table the withdrawn knowledge module left has two columns; the rest are added. */
function prepareModuleMigrations(lock: Db): void {
  lock.run(
    `CREATE TABLE IF NOT EXISTS ${MODULE_MIGRATIONS_TABLE} (
       module TEXT NOT NULL,
       version INTEGER NOT NULL,
       name TEXT NOT NULL DEFAULT '',
       applied_at INTEGER NOT NULL DEFAULT 0,
       PRIMARY KEY (module, version)
     )`,
  );
  const columns = new Set(
    lock
      .query<{ name: string }, []>(`PRAGMA table_info(${MODULE_MIGRATIONS_TABLE})`)
      .all()
      .map((column) => column.name),
  );
  if (!columns.has("name")) {
    lock.run(`ALTER TABLE ${MODULE_MIGRATIONS_TABLE} ADD COLUMN name TEXT NOT NULL DEFAULT ''`);
  }
  if (!columns.has("applied_at")) {
    lock.run(
      `ALTER TABLE ${MODULE_MIGRATIONS_TABLE} ADD COLUMN applied_at INTEGER NOT NULL DEFAULT 0`,
    );
  }
}

/**
 * Applies every module's pending migrations in one upgrade. Runs on every open, hooks
 * included: with nothing pending it costs one query. A module version newer than this
 * binary's list is left alone.
 */
function migrateModules(db: Db, path: string, dir: string, schemas: readonly ModuleSchema[]): void {
  const total = schemas.reduce((count, schema) => count + schema.migrations.length, 0);
  if (total === 0) return;
  const owner = new Map<Migration, string>();
  for (const schema of schemas) {
    for (const migration of schema.migrations) owner.set(migration, schema.module);
  }
  const pending = (conn: Db): Migration[] => {
    const versions = recordedModuleVersions(conn);
    return schemas.flatMap((schema) =>
      [...schema.migrations]
        .sort(byVersion)
        .filter((migration) => migration.version > (versions?.get(schema.module) ?? 0)),
    );
  };
  // How many of this binary's module migrations the database already has.
  const applied = (conn: Db) => total - pending(conn).length;
  if (applied(db) >= total) return;

  upgrade(db, path, dir, {
    current: applied,
    latest: total,
    prepare: prepareModuleMigrations,
    pending,
    record: (lock, migration) =>
      lock.run(
        `INSERT INTO ${MODULE_MIGRATIONS_TABLE} (module, version, name, applied_at) VALUES (?, ?, ?, ?)`,
        [owner.get(migration) ?? "", migration.version, migration.name, Date.now()],
      ),
    // A first module migration on a store has nothing of a module to lose; a later one does.
    backupVersion: (lock) =>
      lock.query(`SELECT 1 FROM ${MODULE_MIGRATIONS_TABLE} LIMIT 1`).get() === null
        ? null
        : userVersion(lock),
  });
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
    migrateModules(db, path, dir, options.moduleSchemas ?? MODULE_SCHEMAS);
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
export function openExisting(
  dataDir: string = resolvePaths().storeDir,
  options: { allowNewer?: boolean } = {},
): Db | null {
  const path = join(dataDir, DB_FILE);
  if (!existsSync(path)) return null;
  const db = new Database(path, { readonly: true });
  try {
    db.run("PRAGMA busy_timeout = 2000");
    const found = userVersion(db);
    // `allowNewer`: for a caller that reads only the meta table, the same in every version.
    if (found > LATEST_VERSION && options.allowNewer !== true) {
      throw new SchemaTooNewError(found, LATEST_VERSION);
    }
  } catch (error) {
    db.close();
    throw error;
  }
  return db;
}
