// The team server's own database, `team.db`: its own migration list and `user_version`, over
// the core runner (`openFile`, `openExistingFile`), never a client's store. The one file of
// the folder that imports the core store; the rest import `Db` from here. It holds the
// schema, the six ways to open a file, and the statements an open runs before the store can
// be asked: the version read, the schema check, `secure_delete`, and migration 1's identity
// write. The opens:
//   openTeamDb        creates or migrates, with no look for a server (tests, tools);
//   openTeamForWrite  creates or migrates beside a possibly running server;
//   openTeamExisting  read-only, refusing a schema above the binary's;
//   openTeamCopy      read-only, any file by its path and at any schema (an upgrade copy);
//   openTeamPresent   read-write and never migrating: the schema must be the binary's;
//   openTeamStaging   read-write, a file by its path, never migrating (the restore's staging file).
import { basename, dirname, join } from "node:path";
import {
  type Backups,
  type Db,
  type Migration,
  openExistingFile,
  openFile,
  openForWrite,
} from "../store/db.ts";
import { NotATeamDatabaseError, SchemaBehindError, SchemaMismatchError } from "./errors.ts";
import { newHexId } from "./ids.ts";
import teamInit from "./migrations/0001_team_init.sql" with { type: "text" };
import teamNames from "./migrations/0002_team_names.sql" with { type: "text" };
import { leaseActive } from "./store.ts";

export { enableWal, restrict, SchemaTooNewError } from "../store/db.ts";
export type { Db, Migration };

export const TEAM_DB_FILE = "team.db";
export const TEAM_LATEST = 2;

/** Migration 1 also mints what names this server: `team.schema`, `server.id`, `server.instance`, `server.created_at`. */
function mintIdentity(lock: Db): void {
  const rows: [string, string][] = [
    ["team.schema", "team"],
    ["server.id", newHexId()],
    ["server.instance", newHexId()],
    ["server.created_at", String(Date.now())],
  ];
  for (const [key, value] of rows) {
    lock.run("INSERT INTO meta (key, value) VALUES (?, ?)", [key, value]);
  }
}

/** Forward-only, like the client store's list. */
export const TEAM_MIGRATIONS: readonly Migration[] = [
  { version: 1, name: "team_init", sql: teamInit, run: mintIdentity },
  { version: 2, name: "team_names", sql: teamNames },
];

/** Where `team.db`'s upgrade copies go: the team's own `backups/`, prefixed `team-`. */
export function teamBackups(dir: string): Backups {
  return { folder: join(dir, "backups"), prefix: "team" };
}

export function teamPaths(dir: string): { db: string; repos: string; feedFile: string } {
  return {
    db: join(dir, TEAM_DB_FILE),
    repos: join(dir, "repos"),
    feedFile: join(dir, "feed.seq"),
  };
}

function userVersion(db: Db): number {
  return db.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version ?? 0;
}

/**
 * A file at version 0 is new and passes. Any other file must be a team database: a `meta`
 * table with `team.schema = 'team'`. Read by hand, before any version check or migration, so
 * a client store copied to `team.db` is named for what it is instead of as a newer schema.
 */
export function requireTeamSchema(db: Db): void {
  if (userVersion(db) === 0) return;
  const meta = db
    .query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'meta'",
    )
    .get();
  if (meta === null) throw new NotATeamDatabaseError();
  const schema = db
    .query<{ value: string }, []>("SELECT value FROM meta WHERE key = 'team.schema'")
    .get();
  if (schema?.value !== "team") throw new NotATeamDatabaseError();
}

/** What a writer's connection sets before anything else: deleted rows are overwritten (a purge erases). */
function prepareWriter(db: Db): void {
  db.run("PRAGMA secure_delete = ON");
  requireTeamSchema(db);
}

/** The writer's open: creates the file or brings it to the list's version, a copy taken before a migration. */
function openWriter(dir: string, busyTimeoutMs: number, migrations: readonly Migration[]): Db {
  return openFile({
    dir,
    file: TEAM_DB_FILE,
    backups: teamBackups(dir),
    migrations,
    busyTimeoutMs,
    before: prepareWriter,
  });
}

/** Opens or creates the team database and brings it to this binary's version, with no look for a server: tests, and tools that know none runs. */
export function openTeamDb(dir: string, busyTimeoutMs = 5000): Db {
  return openWriter(dir, busyTimeoutMs, TEAM_MIGRATIONS);
}

/** Read-only, for the subcommands that inspect; null without the file. `latest` is for tests. */
export function openTeamExisting(dir: string, latest = TEAM_LATEST): Db | null {
  return openExistingFile(dir, TEAM_DB_FILE, { before: requireTeamSchema, latest });
}

/** Read-only, a team database by its path, whatever its schema: an upgrade copy, or the file a restore just put in place. */
export function openTeamCopy(file: string): Db {
  const db = openExistingFile(dirname(file), basename(file), { before: requireTeamSchema });
  if (db === null) throw new Error("no such file");
  return db;
}

/**
 * Read-write over the present file and never migrating: for the restore, which must write a
 * lease into a database it is about to move aside. A file at another schema than `latest` is
 * refused with `SchemaMismatchError`. `latest` is for tests.
 */
export function openTeamPresent(dir: string, latest = TEAM_LATEST): Db {
  const db = openForWrite(dir, TEAM_DB_FILE, { before: prepareWriter });
  const found = userVersion(db);
  if (found !== latest) {
    db.close();
    throw new SchemaMismatchError(found, latest);
  }
  return db;
}

/** Read-write, a team database by its path, never migrating: the restore's staging file. */
export function openTeamStaging(file: string): Db {
  return openForWrite(dirname(file), basename(file), { before: requireTeamSchema });
}

/**
 * For a writer beside a possibly running server, the server's own start included: a database
 * behind this binary's list is never migrated under a live server (its lease fresh), since
 * that server would then run on a schema it does not know. `latest` and `migrations` are for
 * tests of that rule.
 */
export function openTeamForWrite(
  dir: string,
  now: number,
  options: { latest?: number; migrations?: readonly Migration[]; busyTimeoutMs?: number } = {},
): Db {
  const latest = options.latest ?? TEAM_LATEST;
  const probe = openExistingFile(dir, TEAM_DB_FILE, { before: requireTeamSchema });
  if (probe !== null) {
    try {
      if (userVersion(probe) < latest && leaseActive(probe, "serve.lease", now)) {
        throw new SchemaBehindError();
      }
    } finally {
      probe.close();
    }
  }
  return openWriter(dir, options.busyTimeoutMs ?? 5000, options.migrations ?? TEAM_MIGRATIONS);
}
