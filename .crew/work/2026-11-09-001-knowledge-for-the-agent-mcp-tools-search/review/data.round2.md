# data findings for 2026-11-09-001-knowledge-for-the-agent-mcp-tools-search
reviewer: review-data
read: 13 files, the schema and migrations read (0006_knowledge_store.sql, 0007_knowledge_agent.sql, migrations.ts, module-schemas.ts, the module upgrade path in src/store/db.ts), risk areas: data-migration, personal-data

## Findings
- F-1 · advisory · src/modules/knowledge/index-store.ts:1038 · `searchEntries` runs the FTS5 MATCH and bm25 over every repository's search rows and only then filters on `repo_id`. `repo_id` is an UNINDEXED column, so it cannot narrow the match. The prompt hook's cost therefore grows with repositories the project does not see (rubric Q2: a query that scans a table that grows). The budgets hold: the gate's newest log `logs/test-_-1794254786307.txt` shows prompt p50 50.6 ms, against 27.1 ms in `tdd-AC-27-green`. This finding records that the cost grows with non-visible repositories; it is not a breach today.
- F-2 · advisory · src/modules/knowledge/index-store.ts:958 · `pinnedEntries` runs at every session start. It finds `pinned = 1` through the `(repo_id, id)` primary-key prefix, so it reads every entry row of each visible repository to find a handful of pins. Its cost follows the number of entries, not the number of pins. A partial index on `knowledge_entries(repo_id) WHERE pinned = 1` would bound it to the pins (rubric Q2). It is measured inside budget at 3 × 2,000 entries (session-start p50 20.0 ms).
- F-3 · advisory · src/status/report.ts:192 · `knowledgeStatus` reads `knowledge_entries.pinned` and `knowledge_shown` after checking only that the two tables exist. It does not check `moduleSchemaState`, which `contribute` and `compact` both check. On a store whose knowledge tables a newer version changed (`too-new`, which `openDb` lets open), `status` would throw instead of leaving the line out (rubric Q4: the schema read as present).

The migrations and the transactions answer the rubric:
- **Migration 7.** It is forward-only and says so ("Forward-only, like the core's"). It runs inside `upgrade`'s single `BEGIN IMMEDIATE` after the pre-upgrade backup, and its order (6 then 7) is fixed by version. It adds columns and tables only and copies or narrows nothing.
- **Search rows.** Every path that drops entry rows deletes their search rows first, by `fts_rowid`: `upsertEntry`, `replaceRepoRows`, and `dropRepoRows` from `rebuildAll`, `refreshOne` and `saveRow`. `dropRepoRows` also deletes the repository's `knowledge_shown` rows, through the `(repo_id, entry_id)` index.
- **Compact.** Its `knowledge_shown` prune sits in the same `withWrite` as the session delete, behind the schema-state check. Its single OR condition counts a row once, so the dry run reports what the real run deletes.
- **Rate counter.** `allowProposal`'s read-and-increment is one write transaction.
- **Judge.** The judge's network call runs outside every transaction: `propose` in `tools.ts` calls `judgeProposal` between `allowProposal` and `writeEntry`.
- **Personal data.** Retention is stated in ADR 0024:
  - `knowledge_shown`: kept with its session or repository, pruned by `compact` ("`knowledge_shown` and its growth").
  - `on_behalf_of`: part 1's retention and erasure ("Personal data in part 2").
  - What goes to TypeSafe: redacted titles and bodies, no name (`judgeProposal`).

No finding falls in the sibling item 2026-11-09-002's paths (src/sharing/, its migration 0001_sharing_policy.sql, src/ui/, ui/src/, src/backup/backup.ts).

## Outside the change
none

## Not answerable
none
