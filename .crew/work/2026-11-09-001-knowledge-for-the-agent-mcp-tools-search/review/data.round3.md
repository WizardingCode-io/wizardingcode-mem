# data findings for 2026-11-09-001-knowledge-for-the-agent-mcp-tools-search
reviewer: review-data
read: 13 files, the schema and migrations read (0006_knowledge_store.sql, 0007_knowledge_agent.sql, migrations.ts, module-schemas.ts, the module runner in src/store/db.ts, and the sibling's 0001_sharing_policy.sql for order only), risk areas: data-migration, personal-data

## Findings
- F-1 · advisory · src/modules/knowledge/index-store.ts:958 · `pinnedEntries` runs at every session start. For each visible repository it walks every entry row through the `(repo_id, id)` primary-key prefix and only then filters on `pinned = 1`, because no index covers `pinned`. Its cost grows with the entry count, not the pin count. The perf corpus (3 × 2,000 entries) measured it inside the budget, and an index exists, so this is a slower query and not a defect. A partial index `ON knowledge_entries(repo_id) WHERE pinned = 1` would make the cost follow the pin count (rubric question 2).
- F-2 · advisory · src/modules/knowledge/index-store.ts:1045 · `searchEntries` filters `f.repo_id IN (...)` on an UNINDEXED FTS column. FTS5 therefore reads and bm25-ranks the matching rows of every repository, the non-visible ones included, before the filter and the LIMIT apply. No out-of-scope entry can come back, which is what AC-27 asks. The 30-repository non-visible perf corpus shows the hook budget holds, so this is advisory: the prompt's cost grows with all of the store's knowledge, not with what the project sees (rubric question 2).
- F-3 · advisory · src/modules/knowledge/contribute.ts:162 · `forPrompt` (and `forSessionStart` at :198) takes the write lock (`withWrite`) before the shown-set read, the FTS search with bm25 and the evidence check, and holds it until the `knowledge_shown` insert commits. On the hook path, other writers (the drain, another hook) wait out the search as well as the insert. This is deliberate (once per context) and measured inside the prompt budget, so it is not a defect, but the lock covers more than the write needs (rubric question 6).

## Outside the change
none

## Not answerable
none

Checked and found sound:
- **Migration 7 schema.** Only additive `ADD COLUMN`s with defaults or nullable columns, plus two new tables. It is forward-only and says so. Rollback to 0.6.0 is measured in probes/rollback-to-0-6-0.md. The order 6 then 7 is fixed by version in one upgrade transaction, with a backup decided per schema.
- **Development stores at migration 6 alone.** The ADR states that such a store needs one `knowledge rebuild` and gives the reason: 0.6.0 is still the package version, so no released store is at 6 alone.
- **Who keeps the search rows.** Every path that removes entry rows deletes their search rows by rowid first: `upsertEntry`, `replaceRepoRows`, and `dropRepoRows` from the rebuild, the refresh and `saveRow`. `dropRepoRows` also deletes the `knowledge_shown` rows, through the `(repo_id, entry_id)` index. No path relies on the FK cascade from `knowledge_repos`.
- **compact.** It counts and deletes the orphaned `knowledge_shown` rows in the same `withWrite` as the session delete, using one OR condition, so the dry-run count equals the real delete. It does nothing on a non-current module schema.
- **Rate counter.** The read and the increment are one write transaction. No transaction spans the TypeSafe call: `judgeProposal` reads outside any transaction, and the write comes after it.
- **Personal data and retention.** Retention and erasure are stated in docs/adr/0024-knowledge-module.md:
  - `knowledge_shown`: its rows live as long as their session, and `compact` prunes them (lines 276-280).
  - `on_behalf_of`: follows part 1's rule (line 368).
  - TypeSafe: it receives only redacted, clipped titles and bodies, and no name.

Sibling item 2026-11-09-002: its paths in this diff (src/sharing/ with 0001_sharing_policy.sql, src/ui/, ui/src/, src/backup/backup.ts) raised no finding here. Its migration runs in its own `sharing` namespace and its tables have no FK or trigger on a core table.

Paths:
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/modules/knowledge/index-store.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/modules/knowledge/contribute.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/modules/knowledge/migrations/0007_knowledge_agent.sql
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/store/compact.ts
