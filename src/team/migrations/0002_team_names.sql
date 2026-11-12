-- Team schema 2 (ADR 0028): the registry of shared names, and the alias columns renamed for
-- what they now hold, a git remote or a shared name. RENAME COLUMN carries the index
-- changes_scope with it; the wire key stays remoteAlias (a pinned key of the contract).
ALTER TABLE entries RENAME COLUMN remote_alias TO project_alias;
ALTER TABLE entry_revisions RENAME COLUMN remote_alias TO project_alias;
ALTER TABLE memories RENAME COLUMN remote_alias TO project_alias;
ALTER TABLE changes RENAME COLUMN remote_alias TO project_alias;
CREATE TABLE names (
  alias TEXT PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  created_by_member TEXT NOT NULL REFERENCES members(id),
  created_by_device TEXT NOT NULL REFERENCES devices(id),
  created_at INTEGER NOT NULL,
  purged_at INTEGER
) WITHOUT ROWID;
-- The counts under a name: the live entries and memories by alias, newest last.
CREATE INDEX entries_project ON entries(project_alias, updated_at) WHERE withdrawn_at IS NULL;
CREATE INDEX memories_project ON memories(project_alias, updated_at) WHERE withdrawn_at IS NULL;
