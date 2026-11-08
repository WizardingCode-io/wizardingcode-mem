# architects lead's validation of 2026-10-15-001-memory-quality-knowledge-not-records-of: delivery
verdict: validated
## Returns
none
## Notes
- The gates passed on the merged tree: secrets, prose, build, test, lint and typecheck all show pass (.crew/work/2026-10-15-001-memory-quality-knowledge-not-records-of/report.md:36-41). The architecture gate is `proven` with 2 advisory findings and no defects (report.md:51, 72-73; review/architecture.findings.md:6-7).
- The design follows the project's base:
  - `noise.ts` is a pure step in `src/distill/`, where the design puts the pipeline's steps.
  - Every judgement goes through the `Judge` interface. The proof reaches TypeSafe only through `TypeSafeJudge` and the store only through `openDb`/`resolvePaths` with `assertNotLive` (review/architecture.findings.md:10-16).
  - There is no schema change and no migration, as spec.md:33 says.
  - CLAUDE.md:27 records that the import rejudge stays on version 1 (D-2).
  - ADR 0023 is written and accepted, and records the D-12 losses (docs/adr/0023-memory-quality.md:3, 74-85).
- The threshold value is consistent where it counts. `KNOWLEDGE_THRESHOLD = 0.45` (src/distill/policy.ts:12) matches the calibration in the design spec (docs/superpowers/specs/2026-10-14-memory-quality-design.md:203) and in ADR 0023:54, 72. The engine's summary (.crew/work/2026-10-15-001-memory-quality-knowledge-not-records-of/spec.md:14) still gives the starting value 0.5. AC-3 names the constant, not the number, so nothing is unproven, but a stranger reading spec.md:14 would get the wrong number.
- The title-must-be-knowledge rule lives in `buildDraft` (src/distill/pipeline.ts:117-134). The design says "Everything that turns a probability into an action stays in this file" (design spec:208, meaning policy.ts). The constants are in policy.ts and `buildDraft` was already in pipeline.ts before this diff, so no boundary is crossed. This is debt the change kept, not one it added. Advised, not required: move `buildDraft` to policy.ts, or reword design spec:208.
- The contract comments are stale. src/judge/types.ts:40-43 still gives the version 1 meanings of `durable` ("a durable, self-standing fact") and `titleIdx` ("works best alone as a title"). The new meaning is declared in design spec:194 and ADR 0023:107, and the file was edited in this diff (types.ts:26-31). Rewording those two comments for version 2 is advised.
- T-6 and AC-4 hold. The T-6 brief still says `AC-4: missing` (tasks/T-6.brief.md:20), the child's state after the user forced the merge (report.md:206). D-13 decided to reproduce the red at the parent, and the logs prove it:
  - logs/tdd-AC-4-red-1794153912543.txt:14-60 fails with the version 1 state and the `durable_<i>` keys.
  - logs/tdd-AC-4-green-1794153920802.txt:4-8 passes 51 tests with golden floors of 100%/100%/83% (heuristic) and 85%/94%/88% (TypeSafe).
  - report.md:22 records AC-4 as red then green.
- The other briefs name what changed, what was proven and what is left (none):
  - T-2: AC-9, AC-12, AC-13.
  - T-3: AC-2, AC-3, AC-11, AC-14.
  - T-4: AC-5, merged ef17a98.
  - T-5: AC-10, merged f2a82b2.
- The risk seat's advisories are named in the design and left to later items, so none is a missing rollback (review/risk.findings.md:6-8):
  - The live drain throws the noise filter's drops away instead of logging them (pipeline.ts:318).
  - D-1 has no owner tied to compact's 90-day window.
  - An unclosed block tag can cut the rest of an answer (noise.ts:53).
