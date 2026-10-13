-- Memories proposed as knowledge, and those made knowledge. A memory is proposed at most
-- once (memory_id is unique): accepted or rejected, it is never proposed again.

CREATE TABLE knowledge_proposals (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  memory_id INTEGER NOT NULL UNIQUE REFERENCES memories(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('proposed', 'accepted', 'rejected')),
  created_at INTEGER NOT NULL,
  decided_at INTEGER
);
CREATE INDEX knowledge_proposals_open ON knowledge_proposals(status, project_id);

-- A memory whose knowledge entry now says it: memory leaves its notes out while the entry
-- is in the project's index (looked up by project on every hook, so indexed by project).
CREATE TABLE promoted_memories (
  memory_id INTEGER PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  promoted_at INTEGER NOT NULL
);
CREATE INDEX promoted_memories_project ON promoted_memories(project_id, slug);
