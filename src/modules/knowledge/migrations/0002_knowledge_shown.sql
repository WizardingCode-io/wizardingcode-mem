-- Which entries each context has already been shown (session, context epoch), so that the
-- same entry is not put in front of the agent twice before its context is wiped. Like
-- memory's injections, it goes with its session.

CREATE TABLE knowledge_shown (
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  context_epoch INTEGER NOT NULL,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  event TEXT NOT NULL CHECK (event IN ('session-start', 'prompt')),
  at INTEGER NOT NULL,
  PRIMARY KEY (session_id, context_epoch, project_id, slug)
) WITHOUT ROWID;
