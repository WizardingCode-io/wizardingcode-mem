# test-quality findings for 2026-10-15-001-memory-quality-knowledge-not-records-of
reviewer: review-test-quality
read: 11 test files, 8 criteria

## Findings
- F-1 · advisory · tests/unit/heuristic-judge.test.ts:398 · AC-5, rubric question 1 (a mutant I reasoned about but did not run). The "mostly-report" discount is only proven on answers where every final sentence is a report (3 of 3 in both tests). Raising `REPORT_SHARE` (src/judge/heuristic.ts:110) from 0.6 to 1.0 would survive. One answer with 3 of 5 report sentences, asserted under `SAVE_THRESHOLD`, would pin the "mostly" boundary the criterion names.
- F-2 · advisory · tests/unit/heuristic-judge.test.ts:406 · AC-5, rubric question 6. "an answer that is mostly a report is not worth saving, even after edits" still passed when `REPORT_DISCOUNT` was removed (probes/report-discount-removed.txt: only the test at line 398 failed). Its result comes from the `!hasDurable` cap (src/judge/heuristic.ts:167), not from the discount its name claims. Only line 398 proves the discount.
- F-3 · advisory · tests/integration/quality-proof.test.ts:231 · AC-1/AC-11, rubric question 1. The fixture's "Status: looked into it." is dropped by `status-label`, but the report's per-pattern drop line ("Sentences dropped per pattern: …; quoted as knowledge: …", scripts/proof/quality.ts:530 and :577) and its "Quoted candidates the filter dropped" section (:607-609) are never asserted. Mutating that count would survive. Each drop is named at the filter level (tests/unit/noise.test.ts:93-103, :172-186), so this is the report only.
- F-4 · advisory · tests/golden/judges.test.ts:21 · AC-4, rubric question 2 (partial). The replaying judge looks up answers by turn id and ignores the request. The `knowledge_<i>` keys in tests/golden/typesafe-answers.json catch a rename of a question, but a change to the version 2 instructions or criteria would replay the old answers and keep the floors green without a re-recording. The contrastive wording is pinned separately in tests/unit/questions.test.ts:32-40, so this is about how fresh the recording is, not about the criterion.

Criteria with a test that fails on reversion, as read:
- AC-1: tests/unit/noise.test.ts:12-69 and :131-156; tests/integration/distill.test.ts:816 and :837 (host blocks and noise sentences are absent from both the candidates and the prompt/final texts the judge gets).
- AC-2: tests/integration/distill.test.ts:866 (the judge throws if it is asked).
- AC-3: tests/unit/draft.test.ts:53-75 (the 0.45/0.449 boundary) and :101-107 (4 vs 5 words); tests/integration/distill.test.ts:935-951.
- AC-4: tests/unit/questions.test.ts:12-74; tests/unit/typesafe-judge.test.ts (the version-2 stamp, which killed the version "1" mutant; `knowledge_<i>` keys); golden floors in tests/golden/judges.test.ts:77-90.
- AC-5: tests/unit/heuristic-judge.test.ts:361-404 (the penalty is pinned against the version 1 value 0.6 at :427).
- AC-9: tests/unit/noise.test.ts:105-129.
- AC-10 (preserve): tests/integration/rejudge.test.ts:274-296 uses the real TypeSafeJudge and asserts the exact version 1 wording, no `reader`, and judge_version '1'.
- AC-11: tests/integration/quality-proof.test.ts:206-290 (the live database's sha256 and mtime are unchanged; only TypeSafe verdicts count, and a failing TypeSafe yields n/a with no heuristic stand-in; the metric cells are asserted, and every probed predicate mutant was killed by round 3). Bounding injections to the turn's end comes from the shared `toldInSession`/`prepareTurn` (scripts/proof/quality.ts:179, :197), which tests/integration/distill.test.ts:973-1025 covers.

Fixtures: the names are neutral (shop, crm, storefront-style); no client name was found.

## Outside the change
- tests/unit/typesafe-judge.test.ts:390-405 · The `withFallback` stubs still declare `versions: { typesafe: "1" }` while the real judge is now version 2. The assertion at :418 checks the stub's own version, not the shipped one. This is debt, harmless to this item.

## Not answerable
- Mutation (rubric question 7) for src/distill/noise.ts, src/distill/pipeline.ts (`buildDraft`, `toldInSession`, `prepareTexts`) and src/judge/questions.ts · No mutation report covers these files; only the heuristic discount, the proof predicates and the TypeSafe version were probed.
