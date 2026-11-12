-- The shared name's id (ADR 0028): a level bound to a name:<slug> alias keeps the id the
-- server gave that name, so a name purged and made again by someone else is told apart.
-- Null on a level bound to a remote, and on every row written before this version.
ALTER TABLE sharing_levels ADD COLUMN name_id TEXT;
