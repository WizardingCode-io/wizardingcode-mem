# test-quality findings for 2026-10-15-001-memory-quality-knowledge-not-records-of
reviewer: review-test-quality
read: 13 test files, 8 criteria

## Findings
- F-1 · defect · /Users/andreagroferreira/AIProjects/ai-mem/tests/unit/heuristic-judge.test.ts:406 · AC-5 (rubric Q1): no test fails if the worth discount for a mostly-report answer is reverted (src/judge/heuristic.ts:161-165). In both "report" tests (lines 398 and 406), every answer sentence carries a report signal. The per-sentence penalty alone takes each one below 0.5 (for example "Wave 4 closed in `909ce45cf`…" scores 0.6-0.25=0.35, "PR #88 merged…" 0.25, "All 120/120 tests pass on src/app/index.ts." 0.35). So `hasDurable` is false and worth is already capped at 0.3 by line 167, and deleting REPORT_DISCOUNT leaves both tests green. A test needs an answer with at least 60% report sentences plus one durable non-report sentence, and its worth must be checked against SAVE_THRESHOLD.
- F-2 · defect · /Users/andreagroferreira/AIProjects/ai-mem/tests/integration/quality-proof.test.ts:231 · AC-11 (rubric Q1): the success test only checks the "Memories stored" cell and the failure test only checks "n/a" cells. No test checks a computed value of the spec's metrics ("Title is knowledge", "Lost, of knowledge and mixed turns", "Stored from record or fragment", "Title-only", or the v1 and heuristic columns). The predicates `titleIsKnowledge`, `lost` and `records` (scripts/proof/quality.ts:318-325, 517-519) could be inverted or broken without any test failing. The stand-in answers 0.9 to everything and the labels quote fixed candidates, so these values are deterministic and could be asserted.
- F-3 · advisory · /Users/andreagroferreira/AIProjects/ai-mem/tests/integration/quality-proof.test.ts:43 · AC-11 (and AC-1, "each drop is named", in the proof): the fixture writes no injections. So the proof test never shows that the told notes are bounded to the turn's end. That bound is only covered through the shared `toldInSession`, by tests/integration/distill.test.ts:973-991. The fixture's "Status: looked into it." is dropped as `status-label`, but the report line "Sentences dropped per pattern" (quality.ts:577) is never checked either.
- F-4 · advisory · /Users/andreagroferreira/AIProjects/ai-mem/tests/golden/judges.test.ts:21 · AC-4 (rubric Q1/Q5): the replaying stand-in returns the recorded answers whatever the request says. A change to the wording or criteria of the version 2 questions therefore leaves the golden floors unchanged. Renaming `knowledge_<i>` would still be caught (the durability checks at lines 110-118 would read missing answers), but nothing ties the recording to the questions it was recorded against, for example a hash of `distillQuestions`. The contrastive wording is covered only by spot checks with `toContain` in tests/unit/questions.test.ts:34-40.

## Outside the change
none

## Not answerable
- Mutation (Q7) · no mutation report was named in the prompt.
- F-1's scores · worked out by hand from src/judge/heuristic.ts:119-130 and not checked by a run (this reviewer runs nothing).
