-- Turns read back from an agent's own transcripts, after the fact, are queued beside
-- live ones. They wait behind them, and the memories they make carry their own date.
ALTER TABLE turns ADD COLUMN origin TEXT NOT NULL DEFAULT 'live' CHECK (origin IN ('live','history'));

-- claude-mem imports archived because distilled history replaced them; the undo
-- reactivates exactly these and nothing archived for another reason.
CREATE TABLE history_replacements (
  memory_id INTEGER PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  run_at INTEGER NOT NULL
);
