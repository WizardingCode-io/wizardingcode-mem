-- What counts as shown for promotion (final review I1): only showings the agent asked for
-- or that matched its work (prompt, mcp, file-read, tool-failed), in distinct sessions, and
-- how far apart in time. This index carries the event and the time beside the memory and
-- the session, so the count stays a covering index search; it replaces migration 4's.
-- Like migration 4 it is an index on a core table that does not move the core schema
-- version (ruling K8). A core migration that rebuilds `injections` drops it; the promotion
-- pass creates it again (IF NOT EXISTS) when it finds it missing, so that heals itself.
CREATE INDEX IF NOT EXISTS injections_memory_shown
  ON injections(memory_id, event, session_id, at);
DROP INDEX IF EXISTS injections_memory_contexts;
