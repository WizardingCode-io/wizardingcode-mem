# code-quality findings for 2026-10-15-001-memory-quality-knowledge-not-records-of
reviewer: review-code-quality
read: 14 files, 29 hunks

## Findings
- F-1 · defect · src/judge/questions.ts:197 · `perSentence` and its guard at line 202 cover only one case: `wording: 1` together with candidates. No caller passes that combination. The only `wording: 1` caller is the import rejudge, and its `asInput` (src/judge/rejudge.ts:84-93) always sends `candidates: []`, so the `: 0` branch and the `perSentence &&` guard never run. This fails Q4 (dead path) and Q9 (a guard for a case the code cannot reach).
- F-2 · advisory · src/judge/questions.ts:43 · `distillQuestionsV1` is named as the version 1 questions, but it drops the per-candidate `durable_<i>` and `title` questions that version 1 asked. It equals version 1 only when there are no candidates, so the name says more than the function does (Q3).
- F-3 · advisory · src/distill/noise.ts:112 · `withoutSentences` builds its RegExp without the `g` flag, so it removes only the first place a dropped sentence appears. `segment()` dedups sentences case-insensitively (src/distill/segment.ts:113-115), so a noise sentence written twice gives one candidate, and its second copy stays in `finalText` and reaches the judge as `assistant_final_message`. This is a correctness gap against AC-1 rather than one of the rubric's questions, and noise.test.ts has no repeated-sentence case.
- F-4 · advisory · scripts/proof/quality.ts:452 · `unfiltered({ ...item, ...row })` runs `toldInSession` and `unfilteredTexts` again for a turn that `prepared()` (line 165, through `prepareTurn`) has just prepared. That is the same query and step written twice where one call's result would do (Q2, boilerplate-level).
- F-5 · advisory · scripts/proof/quality.ts:283 · `readingOf` has a bare `catch {}` that turns any thrown error, including a coding bug in `draftTurn`, into `outcome: "failed"` and keeps no reason. The report then counts it as a TypeSafe failure (Q9; it is a proof script, not the hook path).
- F-6 · advisory · src/distill/policy.ts:14 · The doc comment on `CONTEXT_MIN_WORDS` is one line past 100 characters. Its neighbours in the same file wrap their comments, so this is a style difference from the file (Q6).

## Outside the change
- src/judge/heuristic.ts:148 · `hasDurable` still compares against a hard-coded `0.5`, while the pipeline now keeps a sentence at `KNOWLEDGE_THRESHOLD` 0.45. The heuristic's worth cap and the draft's title rule use different thresholds. This line is not in the diff.

## Not answerable
- Q11 (prose against references/writing.md) for the plan and the spec · I did not read the 4,900 lines of `docs/superpowers/plans/2026-10-15-memory-quality.md` or the spec hunk line by line for dropped facts or hedges. I read the CLAUDE.md and ADR 0023 hunks and found no dropped fact.
- Q7 (dependencies) · `review/inputs.json` was not named in the prompt and I did not read it. No `package.json` is in files.txt.
