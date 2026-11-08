# data findings for 2026-10-15-001-memory-quality-knowledge-not-records-of
reviewer: review-data
read: 11 files, the schema and migrations read (src/store/migrations/0001_init.sql, 0005_moments.sql, 0007_links.sql; src/store/memories.ts, src/store/turns.ts), risk areas: data-migration, personal-data

## Findings
- F-1 · advisory · /Users/andreagroferreira/AIProjects/ai-mem/scripts/proof/quality.sh:73 · Personal data, rubric question 5: the full copy of the user's store (`<work dir>/home/mem/wizardingcode-mem.db`, so every memory, turn prompt and final text) is kept on purpose and reused across runs. So are the samples, `verdicts.json` and `full.md`, which hold turn text. The header (lines 22-24), `umask 077` (line 28) and "never commit" protect them, but neither the script nor the spec section 11 (/Users/andreagroferreira/AIProjects/ai-mem/docs/superpowers/specs/2026-10-14-memory-quality-design.md:237) says how long they are kept or how to erase them. Memories the user later forgets or archives in the live store stay in this copy until the author deletes the directory by hand. This is not a column, so it is advisory, but the erasure step should be stated.
- F-2 · advisory · /Users/andreagroferreira/AIProjects/ai-mem/src/distill/pipeline.ts:181 · Queries, rubric question 2: the changed `toldInSession` query filters `injections` on `session_id` and the new `i.at <= ?`. The only index on `injections` is the partial `injections_once (session_id, …) WHERE event <> 'mcp'` (/Users/andreagroferreira/AIProjects/ai-mem/src/store/migrations/0005_moments.sql:17), and the query has no `event` predicate, so SQLite cannot use that index. Every distilled turn scans the whole table, which grows. The scan was already there before the change (the old `WHERE i.session_id = ?`), and the new predicates do not make it worse, so this is debt carried forward, not a new cost. The proof now runs it twice per labelled turn (/Users/andreagroferreira/AIProjects/ai-mem/scripts/proof/quality.ts:197 and through `prepareTurn`).
- F-3 · advisory · /Users/andreagroferreira/AIProjects/ai-mem/scripts/proof/quality.ts:162 · Queries, rubric question 2: in `SKIPPED_ROWS`, the correlated `NOT EXISTS` on `memories` (`origin = 'manual' AND judge = 'agent' AND created_at BETWEEN …`) has no index on those columns (`memories_rank` leads with `project_id`). The `sample` mode therefore runs one scan of `memories` per skipped turn. It runs once, on the copy, off any hook path, so this is a slower query, not a defect.

What I checked and found clean:
- The diff has no migration and no schema change: nothing under `src/store/` changed, so there is no step to make reversible or to order (rubric question 1).
- `judge_version` (`TEXT NOT NULL`, 0001_init.sql:81) is written as strings. Distilled memories now get `'2'` through `versions[verdict.source]` (pipeline.ts:349).
- The import rejudge writes `IMPORT_JUDGE_VERSION = '1'` from the same constant as its wording (rejudge.ts:39-40, 170), so AC-10 holds.
- `pending` and `remaining` in rejudge select on `judge = 'claude-mem'`, not on the version, so resuming a run is unaffected.
- The proof's sample (`m.judge = 'typesafe' AND m.judge_version = '1' AND m.origin = 'distilled'`, quality.ts:153-154) cannot pick up rejudged imports, because of the origin filter.
- `i.at` and `t.ended_at` are both written from the same `now` clock (turns.ts:129/141, injection writers).
- The rejudge update happens in `withWrite` after the network calls, never across them.
- The proof writes only to the copy: `sqlite3 -readonly … .backup` at quality.sh:75, `assertNotLive` checks by real path at quality.ts:99-113, and the only writes are the migration on first open plus no consolidate or insert.

## Outside the change
- /Users/andreagroferreira/AIProjects/ai-mem/src/store/migrations/0005_moments.sql:17 · `injections` has no plain index on `session_id`; the only index is partial on `event <> 'mcp'`, so any per-session read with no `event` predicate scans the table. This is existing debt.

## Not answerable
- none
