-- The sharing policy's tables (ADR 0025): what each project may send to a destination, what
-- was sent and received, and every change to the policy. No table has a foreign key or a
-- trigger on a core table: a core migration that rebuilds `projects` never cascades here,
-- and a binary that does not know these tables opens the store and ignores them.

-- One row per project and destination above Nothing: a project with no row shares nothing.
-- `level` is checked in code against the levels this version knows.
CREATE TABLE sharing_levels (
  project_id INTEGER NOT NULL,
  destination TEXT NOT NULL,
  level TEXT NOT NULL,
  -- The project's `remote:` alias the level was set under. A project that loses it reads
  -- as sharing nothing until a person sets the level again.
  bound_alias TEXT NOT NULL,
  set_at INTEGER NOT NULL,
  -- viewer | cli
  source TEXT NOT NULL,
  PRIMARY KEY (project_id, destination)
) WITHOUT ROWID;

-- What was sent to, or received from, a destination, one row per item and direction.
CREATE TABLE sharing_ledger (
  destination TEXT NOT NULL,
  -- entry | memory
  item_kind TEXT NOT NULL,
  -- An entry: its id scoped by its repository. A local memory: '<generation>:<row id>'.
  -- A received memory: 'remote:<the server's uid>'.
  item_uid TEXT NOT NULL,
  -- sent | received
  direction TEXT NOT NULL,
  version INTEGER NOT NULL,
  hash TEXT NOT NULL,
  -- The policy's epoch the ruling was made under.
  policy_epoch INTEGER NOT NULL,
  at INTEGER NOT NULL,
  withdrawn_at INTEGER,
  PRIMARY KEY (destination, item_kind, item_uid, direction)
) WITHOUT ROWID;

-- Every change to the policy, with who made it.
CREATE TABLE sharing_changes (
  id INTEGER PRIMARY KEY,
  at INTEGER NOT NULL,
  -- viewer | cli | restore | file | system
  source TEXT NOT NULL,
  -- project:<id> | roots | areas | levels
  what TEXT NOT NULL,
  old TEXT NOT NULL,
  new TEXT NOT NULL
);
CREATE INDEX sharing_changes_at ON sharing_changes(at);
