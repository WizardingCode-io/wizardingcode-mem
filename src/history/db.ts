import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { enableWal, restrict } from "../store/db.ts";

export const HISTORY_DB_FILE = "history.db";

export function historyDbPath(storeDir: string): string {
  return join(storeDir, HISTORY_DB_FILE);
}

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
CREATE VIRTUAL TABLE IF NOT EXISTS turns_fts USING fts5(
  prompt, final_text, content='turns', content_rowid='id', tokenize = "unicode61 remove_diacritics 2"
);
CREATE TRIGGER IF NOT EXISTS turns_fts_insert AFTER INSERT ON turns BEGIN
  INSERT INTO turns_fts(rowid, prompt, final_text) VALUES (new.id, new.prompt, new.final_text);
END;
CREATE TRIGGER IF NOT EXISTS turns_fts_delete AFTER DELETE ON turns BEGIN
  INSERT INTO turns_fts(turns_fts, rowid, prompt, final_text) VALUES ('delete', old.id, old.prompt, old.final_text);
END;
`;

/**
 * Opens (creating when asked) the history index: a rebuildable copy of every past turn,
 * redacted, kept apart from the main database so it can be deleted without loss.
 * Null when it does not exist and `create` is false.
 */
export function openHistoryDb(
  storeDir: string,
  options: { create: boolean; busyTimeoutMs?: number },
): Database | null {
  const path = historyDbPath(storeDir);
  if (!options.create && !existsSync(path)) return null;
  const busy = Math.max(0, Math.trunc(options.busyTimeoutMs ?? 5000));
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
