# etl lead's validation of 2026-10-15-001-memory-quality-knowledge-not-records-of: delivery
verdict: validated
## Returns
none
## Notes
- No data migration is in the delivery. src/store/migrations/ still ends at 0007_links.sql. AC-6 and AC-7 (migration 8, `rejudge distilled`) were removed and moved to their own item (report.md:112, report.md:213-214, spec.md:18 and spec.md:33). The data reviewer confirms there is no schema, constraint or index change (review/data.findings.md:10).
- The write path can be undone by a release and stays traceable. Distilled rows are stamped by the judge that produced them, `judgeVersion: deps.judge.versions[verdict.source]` (src/distill/pipeline.ts:349). The import rejudge stamps '1' from the same constant as its wording (src/judge/rejudge.ts:39-40, per review/data.findings.md:10), so D-2 and AC-10 hold. Version 2 rows stay valid rows if the code is rolled back (spec.md:33).
- The read changed here only narrows an existing filter. `toldInSession` adds `i.at <= ended_at` and `source_turn_id <> turnId` to the same `injections` filter (src/distill/pipeline.ts:180-185). It is a parameterised read, and no transaction is held across the judge call (review/data.findings.md:10).
- The live store is never written by the proof. The script takes a `sqlite3 -readonly` `.backup` (scripts/proof/quality.sh:75) under `umask 077` (scripts/proof/quality.sh:28), and `openDb` runs only on the copy (scripts/proof/quality.ts:114). AC-11 has a red then green record (report.md:27).
- The gates passed on the merged tree. build, test, lint and typecheck all pass (report.md:38-41), and the test log ends with 2015 pass and 0 fail (logs/test-_-1794153924033.txt:68-70). The data judgement gate is proven with 4 findings, all advisory (report.md:52, report.md:74-77).
- The one irreversible window is documented. A turn that version 2 skips keeps its text only until `compact` deletes it after 90 days, and a rollback does not distil it again (docs/superpowers/specs/2026-10-14-memory-quality-design.md:292; report.md:67). This is a stated limit, not a missing rollback. Advice: the D-1 cleanup item should be scheduled inside that 90-day window from the merge. Advice: ADR 0023 should say so too, since it currently has no rollback or retention line.
- Advice only, not returns:
  - The proof's work directory holds a full copy of the store plus the samples, and nothing says when to erase it. A one-line "delete <work dir> once the report is taken" in the quality.sh header would close it (review/data.findings.md:6).
  - The `SKIPPED_ROWS` NOT EXISTS subquery has no covering index. It runs offline and read-only (scripts/proof/quality.ts:162).
  - The `injections` scan in `toldInSession` was already there before this item: the partial index `injections_once` does not serve it (src/store/migrations/0005_moments.sql:17).
- Outside my team's gates: the T-6 brief still records "AC-4: missing" with "Left: none" (tasks/T-6.brief.md:20 and :26). The item-level record shows AC-4 red then green, reproduced under D-13 (report.md:22, report.md:124). That is the QA lead's call; it has no effect on data.

Files read (all under /Users/andreagroferreira/AIProjects/ai-mem/):
- .crew/work/2026-10-15-001-memory-quality-knowledge-not-records-of/spec.md, report.md and review/data.findings.md
- .crew/work/2026-10-15-001-memory-quality-knowledge-not-records-of/tasks/T-2.brief.md to T-6.brief.md
- src/distill/pipeline.ts, scripts/proof/quality.sh and scripts/proof/quality.ts
- docs/superpowers/specs/2026-10-14-memory-quality-design.md and docs/adr/0023-memory-quality.md
