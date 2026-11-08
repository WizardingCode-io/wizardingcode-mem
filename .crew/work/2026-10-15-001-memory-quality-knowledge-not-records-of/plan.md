# Plan: Memory quality, knowledge, not records of a session

Full plan with code and tests: docs/superpowers/plans/2026-10-15-memory-quality.md (revised 2026-11-06 after spec review rounds 1–3 and decisions D-1 to D-11). Each task has its own red and green run on its test file.

1. AC-1: the noise filter (done: cb944a4, 626ed2c; red and green recorded).
2. AC-9, AC-12, AC-13: noise filter: remove protocol-tag and verdict, anchor host-frame, unclosed block tags only at a line start outside a fence (Task 2 of the full plan).
3. AC-2, AC-3, AC-11, AC-14: pipeline: withoutSentences, prepareTexts/prepareTurn/draftTurn/buildDraft, toldInSession bounds, KNOWLEDGE_THRESHOLD, CONTEXT_MIN_WORDS, wordCount (Task 3 of the full plan).
4. AC-5: heuristic judge version 2 (report penalties, worth discount) and heuristicJudgeV1; src/judge/heuristic.ts, tests/unit/heuristic-judge.test.ts, tests/unit/typesafe-judge.test.ts line 412 (Task 4 of docs/superpowers/plans/2026-10-15-memory-quality.md; full code and tests there).
5. AC-10 (preserve): the import rejudge keeps version 1: DistillInput.wording, IMPORT_WORDING and IMPORT_JUDGE_VERSION in src/judge/rejudge.ts, tests/integration/rejudge.test.ts; crew tdd before/after (Task 5 of docs/superpowers/plans/2026-10-15-memory-quality.md; full code and tests there).
6. AC-4: questions version 2, version 1 reduced to three questions, golden input through the filter, eight golden turns, answers re-recorded (Task 6 of the full plan).
7. AC-11: proof scripts quality.sh, quality.ts, quality-brief.md, random.ts (Task 7 of the full plan).
8. Documents: CLAUDE.md, ADR 0023 proposed (Task 8 of the full plan).
9. AC-11: run the proof; ADR; crew gate run; judgement gates (Task 9 of the full plan).
