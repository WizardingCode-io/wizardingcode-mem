# code-quality findings for 2026-10-15-001-memory-quality-knowledge-not-records-of
reviewer: review-code-quality
read: 3 files, 34 hunks

## Findings
- F-1 · defect · /Users/andreagroferreira/AIProjects/ai-mem/scripts/proof/quality.ts:197 · `unfiltered()` rewrites the first step of `prepareTexts` in /Users/andreagroferreira/AIProjects/ai-mem/src/distill/pipeline.ts:214 instead of calling it: `isFromTheHost(prompt) ? "" : withoutNotes(prompt, told)`, using `told` from `toldInSession`. The labeller's candidate ids, `fullSentence` and `quoteRemoved` depend on this staying the same as the drain, so if the two copies drift the metrics go wrong without any error (question 2, duplicated logic). One fix: export the pre-filter step from pipeline.ts and call it in both places.
- F-2 · advisory · /Users/andreagroferreira/AIProjects/ai-mem/src/distill/noise.ts:73 · `noiseOf` is exported (and `NoisePattern` at line 10), but only noise.ts itself uses them; no test or script imports either (question 8, unused export).
- F-3 · advisory · /Users/andreagroferreira/AIProjects/ai-mem/src/judge/rejudge.ts:39 · `IMPORT_WORDING` and `IMPORT_JUDGE_VERSION` (line 40) are exported, but only rejudge.ts uses them (question 8, unused export).
- F-4 · advisory · /Users/andreagroferreira/AIProjects/ai-mem/src/judge/heuristic.ts:103 · `VERDICT` is the only one of the five `REPORT` patterns without the `/i` flag. So "Verdict:" with a capital V, or a lowercase "approved", never counts as a report signal, while `STATUS_VERB` and `TEST_COUNT` next to it match any case. If the uppercase-only match is meant for APPROVED/REJECTED, a comment should say so (question 6, a difference from its neighbours).

## Outside the change
- /Users/andreagroferreira/AIProjects/ai-mem/src/judge/heuristic.ts:148 · `hasDurable` still uses the literal 0.5. The pipeline's per-sentence knowledge threshold is now `KNOWLEDGE_THRESHOLD` 0.45 (/Users/andreagroferreira/AIProjects/ai-mem/src/distill/policy.ts:11), so the heuristic's "no sentence to keep" cap disagrees with the policy for sentences between 0.45 and 0.5. The diff did not write this line.

## Not answerable
- Question 11 (prose rewrites), for /Users/andreagroferreira/AIProjects/ai-mem/docs/superpowers/specs/2026-10-14-memory-quality-design.md and /Users/andreagroferreira/AIProjects/ai-mem/docs/superpowers/plans/2026-10-15-memory-quality.md · The spec rewrite removes several things: the "Before" column of its metrics table (9%, 62%, 16%), the "≈ 1,200–1,450 tokens (ADR 0005)" baseline, the README line under Documents, and the out-of-scope note about the history import going through the same pipeline. The new text says the author's decisions D-1 to D-11 changed the design, but the diff does not show whether these particular facts were dropped on purpose or lost by accident. The plan's 4,900-line rewrite was not read line by line against its old text.
