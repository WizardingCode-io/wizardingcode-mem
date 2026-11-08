# architects lead's validation of 2026-10-15-001-memory-quality-knowledge-not-records-of: delivery
verdict: validated
## Returns
none
## Notes
- I re-read the evidence after commit 8a1c2f7, T-7 and judgement round 5.
- **Gates on the merged tree:** all pass: secrets, prose, build, test, lint and typecheck (.crew/work/2026-10-15-001-memory-quality-knowledge-not-records-of/report.md:36-41).
- **Judgement gates:** all six are `proven`. The architecture gate has 4 advisories and no defects (report.md:51, 74-77; review/architecture.findings.md:6-11).
- **The design follows the project's base:**
  - `noise.ts` is pure and sits in `src/distill/`.
  - The proof reaches TypeSafe only through `TypeSafeJudge`, and the copy only through `openDb`.
  - `DistillInput.wording` is the one new optional field, as the design spec's section 7 says.
  - Rejudge stamps its version from the same constant as its wording (D-2).
  - `judge_version` is still stamped through `versions[verdict.source]` (src/distill/pipeline.ts:349).
  - No schema change and no migration, as spec.md:33 says (review/architecture.findings.md:16).
- **Commit 8a1c2f7 closes last round's advisories in the files:**
  - docs/adr/0023-memory-quality.md:21 now says the labeller reads the samples and the work dir is deleted by hand.
  - ADR 0023:22 ties D-1 to compact's 90-day window.
  - scripts/proof/quality.sh:22-25 says the same in the script's header.
- **AC-4 (D-13):** the red and green were recorded again.
  - logs/tdd-AC-4-red-1794154132551.txt:14 fails on the version 1 state (no `reader`).
  - logs/tdd-AC-4-green-1794154132943.txt:4-8 passes 51 of 51 tests. The golden floors are 100/100/83 for the heuristic and 85/94/88 for TypeSafe.
  - tasks/T-6.brief.md:20 now records red then green.
- **Briefs:** each of T-2 through T-7 names what changed, what was proven and what is left. T-7 covers the proof files with AC-11 red then green (tasks/T-7.brief.md:4-16). The "Left" entries in T-6.brief.md:26-27 and T-7.brief.md:22-23 are the qa and security leads' open returns, not this team's.
- **Advisory, threshold:** src/judge/heuristic.ts:148 hard-codes `p >= 0.5`, while `KNOWLEDGE_THRESHOLD` is 0.45 (src/distill/policy.ts:12).
  - The calibration opened this gap. It cuts against the contract's own statement that thresholds live in policy.ts (src/judge/types.ts:4-7).
  - The gap has no effect in practice. A heuristic sentence between 0.45 and 0.5 caps worth at 0.3, so nothing is stored. The D-6 and D-8 numbers (ADR 0023:64-65) were measured on this code.
  - Changing it now would move measured results, so it is not a return. Advised: name the constant and re-measure in D-1.
- **Advisory, rule placement:** the title rule sits in `buildDraft` (src/distill/pipeline.ts:117-134), while design spec:208 puts the rules in policy.ts.
  - `buildDraft` was already there before this change, so no boundary is crossed.
  - Advised: move it, or reword design spec:208.
- **Advisory, stale comments:** src/judge/types.ts:40-43 still gives the version 1 meanings of `durable` and `titleIdx`. The design spec:194 and ADR 0023 declare that the field names are kept. Advised: reword the two comments.
- **Advisory, stale value:** .crew/work/2026-10-15-001-memory-quality-knowledge-not-records-of/spec.md:14 still gives the starting value 0.5. The code (policy.ts:12), the design spec:203 and ADR 0023:17 all say 0.45. AC-3 names the constant, not the number, so nothing is unproven.
