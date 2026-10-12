-- In how many contexts a memory was shown, read by the promotion pass for a batch of
-- memories: without this index the count scans every injection record. It is an index on a
-- core table, kept with knowledge because only knowledge reads by it. Like knowledge's own
-- tables it does not move the core schema version (ruling K8): an older binary simply keeps
-- it up to date. A core migration that rebuilds `injections` (as 0005 did) drops it; such a
-- migration must create it again, which IF NOT EXISTS here keeps harmless.
CREATE INDEX IF NOT EXISTS injections_memory_contexts
  ON injections(memory_id, session_id, context_epoch);
