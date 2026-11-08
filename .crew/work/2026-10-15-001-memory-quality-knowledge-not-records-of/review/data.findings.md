# data findings for 2026-10-15-001-memory-quality-knowledge-not-records-of
reviewer: review-data
read: 8 files (the rubric, files.txt, diff.patch's data hunks, src/distill/pipeline.ts, src/judge/rejudge.ts hunks, scripts/proof/quality.sh, scripts/proof/quality.ts, docs/adr/0023-memory-quality.md), the schema and migrations read (src/store/migrations/0001_init.sql, 0005_moments.sql, the index list of 0001–0007), risk areas: data-migration, personal-data

## Findings
- F-1 · advisory · /Users/andreagroferreira/AIProjects/ai-mem/scripts/proof/quality.ts:158 · `SKIPPED_ROWS` runs a correlated `NOT EXISTS` over `memories` on `origin`, `judge` and `created_at` for every skipped turn. No index covers those columns (only `memories_rank`, the FTS table and the `(source_turn_id, source_ordinal)` unique key exist), so the sample step scans the whole table once per skipped turn, about 4,389 × 3,780 rows on the author's store (rubric Q2). It is an offline query on a copy, never on a hook or drain path, so the cost is time only.
- F-2 · advisory · /Users/andreagroferreira/AIProjects/ai-mem/scripts/proof/quality.ts:114 · `openDb` on the copy runs the migrations (the header at line 8 says so), so a copy taken from an older store is changed in the work dir. The live store is still only read: `sqlite3 -readonly .backup` at /Users/andreagroferreira/AIProjects/ai-mem/scripts/proof/quality.sh:77. Nothing is lost, but "read-only copy" (AC-11) describes the live store, not the copy (rubric Q1).
- F-3 · advisory · /Users/andreagroferreira/AIProjects/ai-mem/scripts/proof/quality.sh:22 · The work dir holds a full copy of the store, plus `sample-*.json`, `full.md` and the labels with the author's turn text, and the labeller reads the samples. Its retention is stated as deletion by hand (quality.sh:22-25, docs/adr/0023-memory-quality.md:21), with `umask 077` and a guard that refuses a work dir inside the repository or the live data. The rubric's personal-data question (Q5) is answered, but erasure depends on the author remembering, and the mem's `forget` and `compact` never reach that copy, as the header says.

Checked, no defect:
- `toldInSession` (/Users/andreagroferreira/AIProjects/ai-mem/src/distill/pipeline.ts:173-187) handles a nullable `ended_at` (`? IS NULL OR i.at <= ?`) and a NULL `source_turn_id`. `injections.at` and `turns.ended_at` are both INTEGER milliseconds from the same `now`. The new predicates add no scan.
- Stamps: distilled memories now get `judge_version` "2" from `versions[verdict.source]` (pipeline.ts:349; TypeSafe "2" at src/judge/typesafe.ts:45-46, heuristic "2" at src/judge/heuristic.ts:246-247). The import rejudge stamps the constant "1", taken from the same constant as its wording (src/judge/rejudge.ts:36-37 and 163-172), which is AC-10. `judge_version` is `TEXT NOT NULL` and only displayed (src/ui/api.ts:227), so no reader depends on its value. Stored rows are not rewritten.
- No migration, no schema change, no index or constraint removed. The proof's `measure` writes nothing to the store; the only TypeSafe calls run outside any transaction.

## Outside the change
- /Users/andreagroferreira/AIProjects/ai-mem/src/store/migrations/0001_init.sql:137 · The only index on `injections` (`injections_once`) is partial (`WHERE event <> 'mcp'`), so `toldInSession`'s filter on `session_id` alone cannot use it and scans `injections` on every distilled turn. The query already filtered this way before the change: this is debt, not a defect.

## Not answerable
- none
