-- Knowledge's index (K2): the entries read from each project's .wizardingcode/knowledge
-- folder. The files are the truth; everything here can be deleted and rebuilt from them.

CREATE TABLE knowledge_entries (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  path TEXT NOT NULL,
  title TEXT NOT NULL,
  kind TEXT NOT NULL,
  essential INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  updated TEXT,
  source TEXT,
  body TEXT NOT NULL,
  problem TEXT,
  hash TEXT NOT NULL,
  PRIMARY KEY (project_id, slug)
);

-- Holds its own copy of the text: the entries' rowids are not stable across VACUUM (no
-- INTEGER PRIMARY KEY), so an external-content index could point at the wrong rows. The
-- project id is a searchable column, so a search is confined to one project in the index.
CREATE VIRTUAL TABLE knowledge_fts USING fts5(
  title, tags, body, project_id, slug UNINDEXED,
  tokenize = "unicode61 remove_diacritics 2"
);
CREATE TRIGGER knowledge_entries_ai AFTER INSERT ON knowledge_entries BEGIN
  INSERT INTO knowledge_fts(title, tags, body, project_id, slug)
    VALUES (new.title, replace(replace(replace(new.tags, '[', ''), ']', ''), '"', ''), new.body, new.project_id, new.slug);
END;
CREATE TRIGGER knowledge_entries_ad AFTER DELETE ON knowledge_entries BEGIN
  DELETE FROM knowledge_fts
   WHERE knowledge_fts MATCH 'project_id : "' || old.project_id || '"' AND slug = old.slug;
END;
CREATE TRIGGER knowledge_entries_au AFTER UPDATE ON knowledge_entries BEGIN
  DELETE FROM knowledge_fts
   WHERE knowledge_fts MATCH 'project_id : "' || old.project_id || '"' AND slug = old.slug;
  INSERT INTO knowledge_fts(title, tags, body, project_id, slug)
    VALUES (new.title, replace(replace(replace(new.tags, '[', ''), ']', ''), '"', ''), new.body, new.project_id, new.slug);
END;

-- When each project's index was last brought in line with its folder, and what the folder
-- looked like then (file count, sizes, newest mtime): an unchanged fingerprint means no work.
CREATE TABLE knowledge_state (
  project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  fingerprint TEXT,
  indexed_at INTEGER NOT NULL
);
