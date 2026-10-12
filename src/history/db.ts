import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { enableWal, restrict } from "../store/db.ts";
import { HISTORY_DB_FILE, historyDbPath } from "./path.ts";

export { HISTORY_DB_FILE, historyDbPath };

/** A vector per turn, of the model named; made with the schema, or later in an older file. */
export const TURN_VECTORS_DDL = `
CREATE TABLE IF NOT EXISTS turn_vectors (
  turn_id INTEGER PRIMARY KEY REFERENCES turns(id) ON DELETE CASCADE,
  model TEXT NOT NULL, scale REAL NOT NULL, vec BLOB NOT NULL
);`;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS files (
  path TEXT PRIMARY KEY, agent TEXT NOT NULL, size INTEGER NOT NULL, mtime INTEGER NOT NULL, indexed_at INTEGER NOT NULL
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS turns (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL REFERENCES files(path) ON DELETE CASCADE,
  agent TEXT NOT NULL, session_id TEXT NOT NULL, turn_id TEXT NOT NULL,
  project_id INTEGER, project_name TEXT NOT NULL, cwd TEXT NOT NULL,
  started_at INTEGER NOT NULL, ended_at INTEGER NOT NULL,
  prompt TEXT NOT NULL, final_text TEXT
);
CREATE INDEX IF NOT EXISTS turns_path ON turns(path);
CREATE INDEX IF NOT EXISTS turns_project_time ON turns(project_id, ended_at DESC);
CREATE INDEX IF NOT EXISTS turns_time ON turns(ended_at DESC, id DESC);
CREATE VIRTUAL TABLE IF NOT EXISTS turns_fts USING fts5(
  prompt, final_text, content='turns', content_rowid='id', tokenize = "unicode61 remove_diacritics 2"
);
CREATE TRIGGER IF NOT EXISTS turns_fts_insert AFTER INSERT ON turns BEGIN
  INSERT INTO turns_fts(rowid, prompt, final_text) VALUES (new.id, new.prompt, new.final_text);
END;
CREATE TRIGGER IF NOT EXISTS turns_fts_delete AFTER DELETE ON turns BEGIN
  INSERT INTO turns_fts(turns_fts, rowid, prompt, final_text) VALUES ('delete', old.id, old.prompt, old.final_text);
END;
${TURN_VECTORS_DDL}
`;

/**
 * Opens (creating when asked) the history index: a rebuildable copy of every past turn,
 * redacted, kept apart from the main database so it can be deleted without loss.
 * Null when it does not exist and `create` is false. Without `create` the connection
 * reads only, unless `write` asks to update an index that already exists.
 */
export function openHistoryDb(
  storeDir: string,
  options: { create: boolean; write?: boolean; busyTimeoutMs?: number },
): Database | null {
  const path = historyDbPath(storeDir);
  const busy = Math.max(0, Math.trunc(options.busyTimeoutMs ?? 5000));
  if (!options.create && options.write === true) {
    if (!existsSync(path)) return null;
    let db: Database;
    try {
      db = new Database(path, { readwrite: true, create: false });
    } catch (error) {
      // Forgotten since the check: never bring it back.
      if ((error as { code?: unknown }).code === "SQLITE_CANTOPEN") return null;
      throw error;
    }
    try {
      db.run(`PRAGMA busy_timeout = ${busy}`);
      db.run("PRAGMA foreign_keys = ON");
      db.run("PRAGMA synchronous = NORMAL");
    } catch (error) {
      db.close();
      throw error;
    }
    return db;
  }
  if (!options.create) {
    if (!existsSync(path)) return null;
    // An index pass made the file (schema, WAL, mode); readers write nothing and take no write lock.
    try {
      return openReader(path, { readonly: true }, busy);
    } catch (error) {
      if ((error as { code?: unknown }).code !== "SQLITE_CANTOPEN") throw error;
      // A read-only connection cannot create the -wal and -shm files of a WAL database, and
      // they are gone whenever no one has it open (Linux, Windows, or after a copy or a move).
      // A read-write connection makes them; it still runs no schema and no writing pragma.
      return openReader(path, { readwrite: true, create: false }, busy);
    }
  }
  mkdirSync(storeDir, { recursive: true, mode: 0o700 });
  const db = new Database(path, { create: true });
  try {
    db.run(`PRAGMA busy_timeout = ${busy}`);
    db.run("PRAGMA foreign_keys = ON");
    db.run("PRAGMA synchronous = NORMAL");
    enableWal(db, busy);
    // IF NOT EXISTS makes concurrent creators harmless once they hold the write lock in turn.
    db.transaction(() => {
      db.run(SCHEMA);
      db.run("PRAGMA user_version = 1");
    }).immediate();
  } catch (error) {
    db.close();
    throw error;
  }
  for (const suffix of ["", "-wal", "-shm"]) restrict(path + suffix, 0o600);
  return db;
}

function openReader(
  path: string,
  mode: { readonly: true } | { readwrite: true; create: false },
  busy: number,
): Database {
  const reader = new Database(path, mode);
  try {
    reader.run(`PRAGMA busy_timeout = ${busy}`);
    // The file opens lazily: a first read surfaces a database that cannot be opened.
    reader.query("PRAGMA user_version").get();
  } catch (error) {
    reader.close();
    throw error;
  }
  return reader;
}
