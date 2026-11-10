# Probe: what the withdrawn module's migrations 1 to 5 created

Asked by the data reviewer under "Not answerable": whether the withdrawn knowledge module's migrations created a trigger or a view that references the tables migration 6 drops, especially on a core table such as `memories` or `injections`.

Run on 2026-11-09 in the item's worktree. The withdrawn module's SQL is on the branch `archive/knowledge-module`.

```
$ git grep -n -i -E "CREATE|TRIGGER|VIEW|ALTER|DROP" archive/knowledge-module -- src/modules/knowledge/migrations
0001_knowledge.sql:4:CREATE TABLE knowledge_entries (
0001_knowledge.sql:24:CREATE VIRTUAL TABLE knowledge_fts USING fts5(
0001_knowledge.sql:28:CREATE TRIGGER knowledge_entries_ai AFTER INSERT ON knowledge_entries BEGIN
0001_knowledge.sql:32:CREATE TRIGGER knowledge_entries_ad AFTER DELETE ON knowledge_entries BEGIN
0001_knowledge.sql:36:CREATE TRIGGER knowledge_entries_au AFTER UPDATE ON knowledge_entries BEGIN
0001_knowledge.sql:45:CREATE TABLE knowledge_state (
0002_knowledge_shown.sql:5:CREATE TABLE knowledge_shown (
0003_proposals.sql:4:CREATE TABLE knowledge_proposals (
0003_proposals.sql:13:CREATE INDEX knowledge_proposals_open ON knowledge_proposals(status, project_id);
0003_proposals.sql:17:CREATE TABLE promoted_memories (
0003_proposals.sql:23:CREATE INDEX promoted_memories_project ON promoted_memories(project_id, slug);
0004_injections_shown.sql:7:CREATE INDEX IF NOT EXISTS injections_memory_contexts
0005_injections_shown_by_event.sql:8:CREATE INDEX IF NOT EXISTS injections_memory_shown
0005_injections_shown_by_event.sql:10:DROP INDEX IF EXISTS injections_memory_contexts;
```

(The path prefix `archive/knowledge-module:src/modules/knowledge/migrations/` is cut from each line; three comment lines that only contained the word "drops" or "create" are left out.)

What it shows:

- No view.
- Three triggers, all on the withdrawn module's own table `knowledge_entries`, none on a core table. SQLite drops a table's triggers with the table, so `DROP TABLE IF EXISTS knowledge_entries` in migration 6 removes them.
- Two indexes on the withdrawn module's own tables (`knowledge_proposals_open`, `promoted_memories_project`), dropped with their tables.
- Two indexes on the core table `injections`. Migration 5 already dropped `injections_memory_contexts`; migration 6 drops both names where present.

What it does not show: the test of the withdrawn shape (`tests/unit/module-migrations.test.ts`) creates the tables and the two `injections` indexes, and does not create the three triggers. That the drop works with the triggers present is therefore argued from SQLite's rule, not run.
