-- The sync client (ADR 0027): the servers this machine joined, what it set aside, and what
-- the ledger needs per server. Add-only: no core table is changed, but the core `memories`
-- table gets two indexes of this namespace (at the end of this file), and `user_version` stays.
-- The unique partial index over sharing_levels is created by the migration's run, after it
-- resolves a project with more than one row above Nothing; it is not in this file.

CREATE TABLE sharing_servers (
  server_id TEXT PRIMARY KEY, url TEXT NOT NULL, name TEXT NOT NULL,
  device_id TEXT NOT NULL, device_alias TEXT NOT NULL, member_id TEXT NOT NULL,
  member_name TEXT NOT NULL, role TEXT NOT NULL, contract INTEGER NOT NULL,
  instance TEXT NOT NULL, confirmed_at INTEGER, cursors TEXT NOT NULL DEFAULT '{}',
  roots TEXT NOT NULL DEFAULT '', areas TEXT NOT NULL DEFAULT '',
  muted INTEGER NOT NULL DEFAULT 0, stopped TEXT, snapshot_due INTEGER NOT NULL DEFAULT 1,
  last_sweep_at INTEGER, last_sweep_max_id INTEGER NOT NULL DEFAULT 0,
  last_sweep_epoch INTEGER, last_sweep_generation TEXT,
  added_at INTEGER NOT NULL, last_push_at INTEGER, last_push_ok_at INTEGER,
  last_pull_at INTEGER, last_pull_ok_at INTEGER, backlog INTEGER NOT NULL DEFAULT 0,
  retry_at INTEGER, failures INTEGER NOT NULL DEFAULT 0,
  last_error TEXT, last_error_at INTEGER, last_request_id TEXT
) WITHOUT ROWID;

CREATE TABLE sharing_muted_members (server_id TEXT NOT NULL, member_id TEXT NOT NULL,
  PRIMARY KEY (server_id, member_id)) WITHOUT ROWID;

-- A feed row set aside after ten failed applies, with its payload, so a retry needs no server.
CREATE TABLE sharing_pending_rows (server_id TEXT NOT NULL, seq INTEGER NOT NULL,
  uid TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL, reason TEXT NOT NULL,
  tries INTEGER NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (server_id, seq)) WITHOUT ROWID;

-- The local fingerprint when the row was written (an entry's index hash; a memory's hash at
-- the last send or stale), the server instance, and why the row is what it is.
ALTER TABLE sharing_ledger ADD COLUMN local_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE sharing_ledger ADD COLUMN instance TEXT NOT NULL DEFAULT '';
ALTER TABLE sharing_ledger ADD COLUMN reason TEXT NOT NULL DEFAULT '';

CREATE TABLE sharing_sent_hashes (destination TEXT NOT NULL, item_kind TEXT NOT NULL,
  item_uid TEXT NOT NULL, hash TEXT NOT NULL, revision INTEGER NOT NULL, at INTEGER NOT NULL,
  PRIMARY KEY (destination, item_kind, item_uid, hash)) WITHOUT ROWID;

-- A refusal is never re-sent for its hash; a purged key is reason 'purged' with hash '*'.
CREATE TABLE sharing_refusals (destination TEXT NOT NULL, item_kind TEXT NOT NULL,
  item_uid TEXT NOT NULL, hash TEXT NOT NULL, reason TEXT NOT NULL, rule TEXT, at INTEGER NOT NULL,
  PRIMARY KEY (destination, item_kind, item_uid, hash)) WITHOUT ROWID;

-- The aliases the person unbound, waiting for the reconcile before a pull's first page.
CREATE TABLE sharing_unbound (server_id TEXT NOT NULL, alias TEXT NOT NULL, at INTEGER NOT NULL,
  PRIMARY KEY (server_id, alias)) WITHOUT ROWID;

-- The person's text when a teammate's revision was applied over it, whatever happens to the
-- proposal that carries it.
CREATE TABLE sharing_conflicts (destination TEXT NOT NULL, item_uid TEXT NOT NULL, at INTEGER NOT NULL,
  local_text TEXT NOT NULL, local_version INTEGER NOT NULL, local_hash TEXT NOT NULL,
  server_revision INTEGER NOT NULL, server_hash TEXT NOT NULL, proposal_id TEXT,
  resolved_at INTEGER, PRIMARY KEY (destination, item_uid, at)) WITHOUT ROWID;

-- The provenance of a received memory, with the kind, importance and status as sent.
CREATE TABLE sharing_received_memories (memory_id INTEGER PRIMARY KEY, server_id TEXT NOT NULL,
  remote_uid TEXT NOT NULL, member_id TEXT NOT NULL, member_name TEXT NOT NULL,
  revision INTEGER NOT NULL, hash TEXT NOT NULL,
  remote_kind TEXT NOT NULL, remote_importance REAL NOT NULL, remote_status TEXT NOT NULL);
CREATE UNIQUE INDEX sharing_received_memories_uid ON sharing_received_memories(server_id, remote_uid);

-- The sweep's tick reads the memories changed since its last read through this index, and the
-- rows inserted since through the rowid, so a quiet tick reads no memory row.
CREATE INDEX sharing_memories_updated ON memories(updated_at, id);
-- A received memory is deleted (a tombstone, a removal, a snapshot's comparison) with every
-- superseded_by that pointed at it set back: that read gets its index, instead of a scan of
-- the memories per deletion inside the write transaction.
CREATE INDEX sharing_memories_superseded ON memories(superseded_by);
-- The held-pin and the revised-by reads of the knowledge module look an own entry's applied row
-- up by its local hash; the ledger's key leads with the destination.
CREATE INDEX sharing_ledger_applied ON sharing_ledger(direction, item_kind, local_hash);
