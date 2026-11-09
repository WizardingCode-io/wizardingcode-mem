# data findings for 2026-11-09-001-knowledge-for-the-agent-mcp-tools-search
reviewer: review-data
read: 14 files, the schema and migrations read (0006_knowledge_store.sql, 0007_knowledge_agent.sql, migrations.ts, module-schemas.ts, the module runner in src/store/db.ts), risk areas: data-migration, personal-data

## Findings
- F-1 · advisory · src/modules/knowledge/index-store.ts:958 · `pinnedEntries` runs at every session start on the hook path inside the write transaction. It filters `pinned = 1` with no index on `pinned`, so it reads every entry row of each visible repository through the `(repo_id, id)` primary-key prefix (up to about 6,000 rows over three repositories of 2,000). The same is true of the `sum(pinned)` count in src/status/report.ts:202. An index on the repository is used and only the search path was measured, so this is a slower query and not a defect (rubric Q2). A partial index `ON knowledge_entries(repo_id) WHERE pinned = 1` would make it a seek.
- F-2 · advisory · docs/adr/0024-knowledge-module.md:268 · The ADR says triggers were rejected because "`upsertEntry` writes with `INSERT OR REPLACE`". The code now deletes the replaced rows by slug or id and then does a plain `INSERT` (index-store.ts:78-79, 116-135). Search rows are kept correctly, but the stated reason no longer matches the code (rubric Q1, a naming or comment drift).
- F-3 · advisory · src/modules/knowledge/propose.ts:20 · Each distinct agent id leaves a `meta` row `knowledge.rate:<agent id>` that nothing ever removes: no path expires it and `compact` does not prune it. Ids from the handshake fall into a fixed list, but `mcp --agent <id>` accepts any id that matches the pattern, so these rows grow with every new id. They are small, hold no personal data, and the window logic ignores a row more than an hour old (rubric Q2, growth).
- F-4 · advisory · src/modules/knowledge/index-store.ts:764 · Every `rebuildAll` ends with `DELETE FROM knowledge_fts WHERE rowid NOT IN (SELECT fts_rowid FROM knowledge_entries …)`, even for a rebuild of one scope. That deletion reads the whole search table and every entry row while holding the write lock. It runs only from the CLI, never on a hook path, and is cheap at the measured sizes, but it is the one write in the change that scans the search table, which the ADR's "neither scans the table" otherwise rules out (rubric Q2/Q6).

Checked and found sound:
- Migration 7 only adds nullable or defaulted columns and new tables. It is forward-only, as migrations.ts:13 states. Versions 6 then 7 run in a fixed order, and both are applied together on an empty index (ADR:272).
- Migration 6's drops of the withdrawn module's tables are of an index that can be rebuilt, and the SQL comments say so.
- Every path that deletes a repository's rows clears its search rows by `fts_rowid` first (`dropRepoRows` in `rebuildAll`, `refreshStale` and `saveRow`'s repoint; `replaceRepoRows`; `upsertEntry`), so the `ON DELETE CASCADE` never leaves a search row behind.
- The judge's network call runs outside any transaction. The rate counter's read and increment are one short `withWrite`.
- `knowledge_shown` lookups use its primary key. `compact`'s deletion of orphaned shown rows runs in the same transaction as its session deletion. The `status` 24-hour count uses `knowledge_shown_at`.
- Personal data has stated retention:
  - `knowledge_shown` goes with its session or its repository (ADR:280), and the rows of sessions `compact` keeps are kept, as stated.
  - `on_behalf_of` follows part 1's retention and erasure (ADR:368).
  - What leaves for TypeSafe is redacted, then clipped, and carries no name (propose.ts:92-122).

## Outside the change
- none (the sibling item 2026-11-09-002's paths, src/sharing/migrations/0001_sharing_policy.sql, src/backup/backup.ts, src/ui/ and ui/src/, were not judged here; they belong to that item's own review)

## Not answerable
- none
