CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
CREATE TABLE members (
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','member')),
  created_at INTEGER NOT NULL, disabled_at INTEGER
);
CREATE TABLE devices (
  id TEXT PRIMARY KEY, alias TEXT NOT NULL UNIQUE,
  member_id TEXT NOT NULL REFERENCES members(id),
  token_hash TEXT NOT NULL UNIQUE, label TEXT NOT NULL,
  created_at INTEGER NOT NULL, last_seen_at INTEGER, revoked_at INTEGER
);
CREATE TABLE invitations (
  id TEXT PRIMARY KEY, code_hash TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('admin','member')),
  name TEXT, for_member TEXT REFERENCES members(id),
  created_by_device TEXT REFERENCES devices(id),
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
  used_at INTEGER, used_by_device TEXT REFERENCES devices(id), revoked_at INTEGER
);
CREATE TABLE entries (
  uuid TEXT PRIMARY KEY, scope TEXT NOT NULL, remote_alias TEXT, slug TEXT NOT NULL,
  created_by_member TEXT NOT NULL REFERENCES members(id),
  revision INTEGER NOT NULL, hash TEXT NOT NULL, size INTEGER NOT NULL,
  writer_member TEXT NOT NULL REFERENCES members(id),
  writer_device TEXT NOT NULL REFERENCES devices(id),
  updated_at INTEGER NOT NULL, withdrawn_at INTEGER,
  locked_by_admin INTEGER NOT NULL DEFAULT 0,
  mirror_revision INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX entries_pending ON entries(uuid) WHERE mirror_revision < revision;
CREATE TABLE entry_revisions (
  uuid TEXT NOT NULL REFERENCES entries(uuid), revision INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  op TEXT NOT NULL CHECK (op IN ('send','withdraw')),
  scope TEXT NOT NULL, remote_alias TEXT, slug TEXT NOT NULL,
  frontmatter TEXT NOT NULL, body TEXT NOT NULL, hash TEXT NOT NULL,
  writer_member TEXT NOT NULL, writer_device TEXT NOT NULL,
  client_epoch INTEGER, at INTEGER NOT NULL,
  PRIMARY KEY (uuid, revision)
);
CREATE INDEX entry_revisions_hash ON entry_revisions(uuid, hash, writer_device);
CREATE TABLE memories (
  device_id TEXT NOT NULL REFERENCES devices(id), uid TEXT NOT NULL,
  remote_alias TEXT NOT NULL, payload TEXT NOT NULL, hash TEXT NOT NULL,
  size INTEGER NOT NULL, revision INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  member_id TEXT NOT NULL REFERENCES members(id), received_at INTEGER NOT NULL,
  withdrawn_at INTEGER, locked_by_admin INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (device_id, uid)
);
CREATE TABLE changes (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('entry','memory')),
  uid TEXT NOT NULL, key TEXT NOT NULL,
  op TEXT NOT NULL CHECK (op IN ('upsert','tombstone','purge')),
  scope TEXT NOT NULL, remote_alias TEXT, revision INTEGER NOT NULL, hash TEXT NOT NULL,
  moved_to TEXT,
  member_id TEXT NOT NULL, device_id TEXT NOT NULL, client_epoch INTEGER,
  at INTEGER NOT NULL, current INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX changes_key ON changes(key, seq);
CREATE INDEX changes_scope ON changes(scope, remote_alias, current, seq);
CREATE TABLE purged (key TEXT PRIMARY KEY, at INTEGER NOT NULL) WITHOUT ROWID;
CREATE TABLE audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL,
  source TEXT NOT NULL, device_id TEXT, address TEXT,
  action TEXT NOT NULL, target TEXT, detail TEXT NOT NULL DEFAULT ''
);
