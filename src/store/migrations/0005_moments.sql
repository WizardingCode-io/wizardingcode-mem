-- Notes can now also be given when a file is read and when a command fails. SQLite cannot
-- change a CHECK in place, so the table is rebuilt with the longer list and its rows kept.
CREATE TABLE injections_new (
  id INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  context_epoch INTEGER NOT NULL,
  memory_id INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  event TEXT NOT NULL CHECK (event IN ('session-start','prompt','mcp','file-read','tool-failed')),
  score REAL,
  tokens INTEGER NOT NULL,
  at INTEGER NOT NULL
);
INSERT INTO injections_new (id, session_id, context_epoch, memory_id, event, score, tokens, at)
  SELECT id, session_id, context_epoch, memory_id, event, score, tokens, at FROM injections;
DROP TABLE injections;
ALTER TABLE injections_new RENAME TO injections;
CREATE UNIQUE INDEX injections_once ON injections(session_id, context_epoch, memory_id, event) WHERE event <> 'mcp';
