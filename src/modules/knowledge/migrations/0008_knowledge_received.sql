-- Entries received from a team server (ADR 0027): one row per received entry, a copy of the
-- server's current revision kept apart from the person's repositories. Searchable through
-- knowledge_fts under the reserved repo id 0, with entry_id '<serverId>|<uid>'.
CREATE TABLE knowledge_received (
  server_id TEXT NOT NULL, uid TEXT NOT NULL, scope TEXT NOT NULL, remote_alias TEXT,
  project_id INTEGER NOT NULL DEFAULT 0, member_id TEXT NOT NULL, member_name TEXT NOT NULL,
  id TEXT NOT NULL, slug TEXT NOT NULL, path TEXT NOT NULL, title TEXT NOT NULL, kind TEXT NOT NULL,
  area TEXT NOT NULL, context TEXT NOT NULL DEFAULT '', subject TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL, author TEXT NOT NULL, version INTEGER NOT NULL, body TEXT NOT NULL,
  hash TEXT NOT NULL, revision INTEGER NOT NULL, received_at INTEGER NOT NULL, fts_rowid INTEGER,
  PRIMARY KEY (server_id, uid)) WITHOUT ROWID;
CREATE INDEX knowledge_received_project ON knowledge_received(project_id, server_id);
CREATE INDEX knowledge_received_entry ON knowledge_received(id);
-- The received reads: a search row joins its received row by fts_rowid, and an own entry with
-- the same id hides a received copy (knowledge_entries is keyed by repository, so its id alone
-- gets an index here).
CREATE INDEX knowledge_received_fts ON knowledge_received(fts_rowid);
CREATE INDEX knowledge_entries_id ON knowledge_entries(id);
