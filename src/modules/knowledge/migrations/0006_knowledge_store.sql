-- The knowledge store's index (ADR 0024). The files in the repositories are the truth;
-- every row here is rebuilt from them.

-- What the withdrawn module (ADR 0020, versions 1 to 5 of this module id) created, on a
-- store that ran it. Its index of knowledge kept inside project folders is dropped, with
-- the three triggers and the two indexes on its own tables, which go with their tables.
DROP TABLE IF EXISTS knowledge_fts;
DROP TABLE IF EXISTS knowledge_entries;
DROP TABLE IF EXISTS knowledge_state;
DROP TABLE IF EXISTS knowledge_shown;
DROP TABLE IF EXISTS knowledge_proposals;
DROP TABLE IF EXISTS promoted_memories;
-- Two indexes that module added to the core table `injections`, for its own promotion
-- pass. No core query uses them: memory reads `injections` as it did before that module.
DROP INDEX IF EXISTS injections_memory_shown;
DROP INDEX IF EXISTS injections_memory_contexts;
-- Three rows its promotion pass kept in the core table `meta`: a cursor, a list and a
-- lease. Nothing reads them now, and the new leases are named `knowledge.lease:<path>`.
DELETE FROM meta
 WHERE key IN ('knowledge.promote.cursor', 'knowledge.not-standing', 'knowledge.promote.lease');

-- One row per repository. `path` is relative to the data directory. `project_id` is 0 for
-- the workspace and the shared repositories, and a plain integer for a project: no foreign
-- key, so a core migration that rebuilds `projects` never cascades here.
CREATE TABLE knowledge_repos (
  id INTEGER PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('workspace','project','shared')),
  project_id INTEGER NOT NULL DEFAULT 0,
  path TEXT NOT NULL UNIQUE,
  head TEXT,
  fingerprint TEXT,
  -- Files left out of the index by the folder caps.
  over_cap INTEGER NOT NULL DEFAULT 0,
  -- 0 when the last rebuild skipped the dirty check for want of git.
  dirty_checked INTEGER NOT NULL DEFAULT 1,
  indexed_at INTEGER NOT NULL,
  UNIQUE (scope, project_id)
);

CREATE TABLE knowledge_entries (
  repo_id INTEGER NOT NULL REFERENCES knowledge_repos(id) ON DELETE CASCADE,
  -- The entry's UUID; 'file:<slug>' or 'dup:<slug>' for a file with no usable id.
  id TEXT NOT NULL,
  slug TEXT NOT NULL,
  path TEXT NOT NULL,
  title TEXT NOT NULL,
  kind TEXT NOT NULL,
  area TEXT NOT NULL,
  context TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  author TEXT NOT NULL,
  version INTEGER NOT NULL,
  created TEXT,
  updated TEXT,
  supersedes TEXT,
  body TEXT NOT NULL,
  problem TEXT,
  hash TEXT NOT NULL,
  PRIMARY KEY (repo_id, id),
  UNIQUE (repo_id, slug)
);

-- A decided proposal is indexed without its body: the file keeps it.
CREATE TABLE knowledge_proposals (
  repo_id INTEGER NOT NULL REFERENCES knowledge_repos(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  path TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('open','accepted','rejected')),
  entry_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  base_version INTEGER NOT NULL,
  base_hash TEXT NOT NULL DEFAULT '',
  proposed_by TEXT NOT NULL,
  proposed_at TEXT,
  decided_by TEXT,
  decided_at TEXT,
  decided_version INTEGER,
  title TEXT NOT NULL,
  kind TEXT NOT NULL,
  area TEXT NOT NULL,
  context TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  problem TEXT,
  hash TEXT NOT NULL,
  PRIMARY KEY (repo_id, id)
);
-- The quota of open proposals per target: by entry for a change, by slug for a new entry.
CREATE INDEX knowledge_proposals_entry ON knowledge_proposals(repo_id, state, entry_id);
CREATE INDEX knowledge_proposals_slug ON knowledge_proposals(repo_id, state, slug);
