-- Links between projects (B1, ADR 0018). 'product' is stored once per unordered pair (smaller id
-- in from_project) and read both ways; 'uses' means from_project uses to_project, one way.
CREATE TABLE project_links (
  id INTEGER PRIMARY KEY,
  from_project INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  to_project INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('product','uses')),
  status TEXT NOT NULL CHECK (status IN ('suggested','confirmed','rejected')),
  origin TEXT NOT NULL CHECK (origin IN ('suggested','manual')),
  signals TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  decided_at INTEGER,
  CHECK (from_project <> to_project)
);
CREATE UNIQUE INDEX project_links_pair ON project_links(from_project, to_project, kind);
CREATE INDEX project_links_to ON project_links(to_project, status);

-- Rules proposed as the author's own (B2).
CREATE TABLE rule_proposals (
  id INTEGER PRIMARY KEY,
  memory_ids TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('repeated','said-always')),
  status TEXT NOT NULL CHECK (status IN ('proposed','accepted','rejected')),
  user_memory_id INTEGER REFERENCES memories(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  decided_at INTEGER
);
-- The sorted memory ids, so the same set is never proposed twice.
CREATE UNIQUE INDEX rule_proposals_set ON rule_proposals(memory_ids);

-- A memory that is one of the author's own rules (Ruling P1: a marker, not a scope value).
CREATE TABLE user_memories (
  memory_id INTEGER PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,
  proposal_id INTEGER REFERENCES rule_proposals(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);
