# test-quality findings for 2026-10-15-001-memory-quality-knowledge-not-records-of
reviewer: review-test-quality
read: 12 test files, 8 criteria

## Findings
- F-1 · advisory · /Users/andreagroferreira/AIProjects/ai-mem/tests/unit/heuristic-judge.test.ts:406 · AC-5 (Q1/Q6): the test named "mostly a report" uses an answer in which all three sentences are reports, and so does the test at line 398. So the 60% share is never tested below 100% (src/judge/heuristic.ts:163). Changing `>= REPORT_SHARE` to `=== 1` would leave every test green. The discount itself is proven (probes/report-discount-removed.txt), and lowering the share is caught by the test at line 437. One case would close this: three report sentences plus one durable sentence, with v2's worth checked below v1's.
- F-2 · advisory · /Users/andreagroferreira/AIProjects/ai-mem/tests/integration/quality-proof.test.ts:45 · AC-1 "each drop is named", carried into the proof (Q1): the fixture's "Status: looked into it." is dropped as `status-label`. But no test checks the report line "Sentences dropped per pattern" (scripts/proof/quality.ts:577) or `prepareTexts().dropped` (src/distill/pipeline.ts:245). An empty or mislabelled pass-through would survive. The naming itself is pinned only one level down, in `dropNoise` (tests/unit/noise.test.ts, the "re-indexed from 0" test).
- F-3 · advisory · /Users/andreagroferreira/AIProjects/ai-mem/tests/unit/noise.test.ts:76 · AC-1 (Q1): no test has a noise sentence that appears twice in one text. `withoutSentences` replaces without the `g` flag (src/distill/noise.ts:112). The segmenter de-duplicates candidates, so the second copy stays in `finalText` and reaches the judge. A test with a repeated `Status:` line would fail today. This is the same gap code-quality raised, seen from the tests' side.
- F-4 · advisory · /Users/andreagroferreira/AIProjects/ai-mem/tests/golden/judges.test.ts:21 · AC-4 (Q1/Q5), carried over from round 2: the replaying stand-in returns the recorded answers whatever the request asks. A change to the version 2 wording or criteria therefore leaves the golden floors unchanged; only missing `knowledge_<i>` keys would be noticed. The contrastive wording is spot-checked in tests/unit/questions.test.ts. The new version stamp is now pinned by tests/unit/typesafe-judge.test.ts ("is version 2"), and probes/proof-metric-mutations-r3.txt confirms that test fails when the stamp is reverted.
- F-5 · advisory · /Users/andreagroferreira/AIProjects/ai-mem/tests/integration/quality-proof.test.ts:43 · AC-11 (Q1), carried over from round 2: the proof fixture writes no injections, so the proof test never shows that injections are bounded to the turn's end. That bound is covered only through the shared `toldInSession`/`prepareTurn` (scripts/proof/quality.ts:179, 197), by tests/integration/distill.test.ts:973-1020.

Per criterion, the test that fails on reversion:
- AC-1: distill.test.ts:816 and the host-frame-in-prompt test that follows it; noise.test.ts host-frame, status-label and template-label tests; questions.test.ts golden "a host block never reaches the judge".
- AC-2: distill.test.ts:866. The judge throws if it is asked, and the test expects skipped 1 and failed 0.
- AC-3: draft.test.ts covers the boundary (0.45 counts, 0.449 does not), the judge's title giving way when it is not knowledge, a null draft whatever the worth, and Context needing 5 words (3 and 4 words get none, 5 get one).
- AC-4: questions.test.ts covers the keys, `reader`, the criteria and that every path the questions name exists in the state; typesafe-judge.test.ts the version and the `knowledge_<i>` request keys; golden floors for both judges.
- AC-5: probes/report-discount-removed.txt (killed); heuristic-judge.test.ts tests of v2 durability below v1's 0.6.
- AC-9: noise.test.ts "bracketed protocol tags reach the judge" and "verdict lines reach the judge".
- AC-10: rejudge.test.ts. It uses the real TypeSafeJudge (version 2) and checks the exact version 1 instructions, no `reader`, and judge_version "1".
- AC-11: quality-proof.test.ts. It checks the live DB fingerprint is unchanged, the metric rows cell by cell, and that with TypeSafe failing the v2 cells are n/a, so the heuristic never stands in. All round 2 mutants were killed (probes/proof-metric-mutations.txt, probes/proof-metric-mutations-r3.txt).

No test is true by construction: the stand-in judges in distill.test.ts feed the pipeline's own policy (buildDraft, the noise filter), and the tests assert what the store holds. Fixtures use neutral names.

## Outside the change
none

## Not answerable
- Mutation (Q7), beyond the probes named · there is no full mutation report. F-1 to F-3 are worked out from reading the code, not from runs.
