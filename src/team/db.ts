// The team server's own database, `team.db`: its own migration list and `user_version`, over
// the core runner (`openFile`, `openExistingFile`), never a client's store. The one file of
// the folder that imports the core store; the rest import `Db` from here.
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { type Backups, type Db, type Migration, openExistingFile, openFile } from "../store/db.ts";
import { NotATeamDatabaseError, SchemaBehindError } from "./errors.ts";
import teamInit from "./migrations/0001_team_init.sql" with { type: "text" };
import { leaseActive } from "./store.ts";

export type { Db, Migration };

export const TEAM_DB_FILE = "team.db";
export const TEAM_LATEST = 1;

/** A fresh random id of 16 hex characters: the server's id and its instance. */
function hex16(): string {
  return randomBytes(8).toString("hex");
}

/** Migration 1 also mints what names this server: `team.schema`, `server.id`, `server.instance`, `server.created_at`. */
function mintIdentity(lock: Db): void {
  const rows: [string, string][] = [
    ["team.schema", "team"],
    ["server.id", hex16()],
    ["server.instance", hex16()],
    ["server.created_at", String(Date.now())],
  ];
  for (const [key, value] of rows) {
    lock.run("INSERT INTO meta (key, value) VALUES (?, ?)", [key, value]);
  }
}

/** Forward-only, like the client store's list. */
export const TEAM_MIGRATIONS: readonly Migration[] = [
  { version: 1, name: "team_init", sql: teamInit, run: mintIdentity },
];

/** Where `team.db`'s upgrade copies go: the team's own `backups/`, prefixed `team-`. */
export function teamBackups(dir: string): Backups {
  return { folder: join(dir, "backups"), prefix: "team" };
}

export function teamPaths(dir: string): {
  db: string;
  repos: string;
  feedFile: string;
  backups: string;
} {
  return {
    db: join(dir, TEAM_DB_FILE),
    repos: join(dir, "repos"),
    feedFile: join(dir, "feed.seq"),
    backups: join(dir, "backups"),
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

/** Opens or creates the team database and brings it to this binary's version. */
export function openTeamDb(dir: string, busyTimeoutMs = 5000): Db {
  return openFile({
    dir,
    file: TEAM_DB_FILE,
    backups: teamBackups(dir),
    migrations: TEAM_MIGRATIONS,
    busyTimeoutMs,
    before: requireTeamSchema,
  });
}

/** Read-only, for the subcommands that inspect; null without the file. */
export function openTeamExisting(dir: string): Db | null {
  return openExistingFile(dir, TEAM_DB_FILE, { before: requireTeamSchema, latest: TEAM_LATEST });
}

/**
 * For a CLI writer beside a possibly running server: a database behind this binary's list
 * is never migrated under a live server (its lease fresh), since the server would then run
 * on a schema it does not know. `latest` and `migrations` are for tests of that rule.
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
  return openFile({
    dir,
    file: TEAM_DB_FILE,
    backups: teamBackups(dir),
    migrations: options.migrations ?? TEAM_MIGRATIONS,
    busyTimeoutMs: options.busyTimeoutMs ?? 5000,
    before: requireTeamSchema,
  });
}
