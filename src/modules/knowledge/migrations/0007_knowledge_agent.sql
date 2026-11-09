-- What the agent is shown and what it proposes (ADR 0024, part 2). Migrations 6 and 7
-- ship together and apply on an empty index: nothing here is filled from existing rows.

-- An entry shown at every session start: set by a person only.
ALTER TABLE knowledge_entries ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
-- The rowid of the entry's search row; null for an entry that is not searchable. A write
-- and a rebuild delete search rows by it, so neither scans the search table.
ALTER TABLE knowledge_entries ADD COLUMN fts_rowid INTEGER;

-- What the judge found, and for whom the agent proposed: the entries contradicted, as a
-- JSON list of ids.
ALTER TABLE knowledge_proposals ADD COLUMN contradicts TEXT NOT NULL DEFAULT '[]';
ALTER TABLE knowledge_proposals ADD COLUMN on_behalf_of TEXT;
ALTER TABLE knowledge_proposals ADD COLUMN judged_by TEXT;
ALTER TABLE knowledge_proposals ADD COLUMN judge_version TEXT;

-- One row per active, problem-free entry, kept by the index writer. It holds its own copy
-- of the text because (repo_id, id) has no stable rowid. The two ids are stored for the
-- join and never matched: a query term cannot reach them.
CREATE VIRTUAL TABLE knowledge_fts USING fts5(
  title,
  area,
  context,
  subject,
  body,
  repo_id UNINDEXED,
  entry_id UNINDEXED,
  tokenize = 'unicode61 remove_diacritics 2'
);

-- One row per entry shown in a context: the key is what showing an entry once per context
-- needs; the event, the rule and the time are the record of how often each rule fires.
CREATE TABLE knowledge_shown (
  session_id INTEGER NOT NULL,
  context_epoch INTEGER NOT NULL,
  repo_id INTEGER NOT NULL,
  entry_id TEXT NOT NULL,
  -- 'session-start' or 'prompt'.
  event TEXT NOT NULL,
  -- 'code', 'title' or 'words' on a prompt; null at session start.
  rule TEXT,
  at INTEGER NOT NULL,
  PRIMARY KEY (session_id, context_epoch, repo_id, entry_id)
);
CREATE INDEX knowledge_shown_entry ON knowledge_shown(repo_id, entry_id);
CREATE INDEX knowledge_shown_at ON knowledge_shown(at);
