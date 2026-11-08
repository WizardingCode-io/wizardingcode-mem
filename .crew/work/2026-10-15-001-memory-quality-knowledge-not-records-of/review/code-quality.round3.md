# code-quality findings for 2026-10-15-001-memory-quality-knowledge-not-records-of
reviewer: review-code-quality
read: 4 files, 34 hunks

## Findings
- F-1 · advisory · /Users/andreagroferreira/AIProjects/ai-mem/src/distill/noise.ts:73 · `noiseOf` is exported, but only `dropNoise` in the same file calls it, and nothing in src, scripts or tests imports it (question 8, unused export); `NoisePattern` at line 10 is the same case: it is only used to type `NOISE_PATTERNS`.
- F-2 · advisory · /Users/andreagroferreira/AIProjects/ai-mem/src/judge/rejudge.ts:39 · `IMPORT_WORDING` and `IMPORT_JUDGE_VERSION` (line 40) are exported, but only rejudge.ts uses them; no test or other module imports them (question 8, unused export).
- F-3 · advisory · /Users/andreagroferreira/AIProjects/ai-mem/src/judge/questions.ts:197 · The `perSentence` guard (used at lines 199 and 202) covers wording 1 with candidates, and no caller reaches that case: the only wording-1 caller is the import rejudge, and its `asInput` sends `candidates: []`. The comment says why the guard is there and it hides no failure, so it is advisory, not a question-9 defect.

## Outside the change
- none

## Not answerable
- Question 6, behaviour of `readingOf`'s failure test (`result.verdict?.source !== judge.name`, /Users/andreagroferreira/AIProjects/ai-mem/scripts/proof/quality.ts) · I did not read how `TypeSafeJudge` sets `source` when it fails or falls back. I could not confirm that a fallback verdict is the only way that test is true, rather than a heuristic verdict being counted as a failure.
- Question 11, the plan and spec documents (docs/superpowers/plans/2026-10-15-memory-quality.md, docs/superpowers/specs/2026-10-14-memory-quality-design.md) · I did not read these hunks line by line (about 5,400 lines of diff), so I cannot say whether a rewrite in them dropped or changed an earlier fact. The CLAUDE.md hunk only adds text and the ADR is a new file; I read both and found nothing under question 11.

Other notes, none of them a finding:
- The `generator` and `sample` helpers moved out of scripts/proof/moments.ts into /Users/andreagroferreira/AIProjects/ai-mem/scripts/proof/random.ts, which removes duplication rather than adding it.
- `prepareTurn` and `draftTurn` in /Users/andreagroferreira/AIProjects/ai-mem/src/distill/pipeline.ts are shared by the drain and the proof, so the proof does not copy the pipeline.
- The `verdict === null ||` check at pipeline.ts:319 is needed: it narrows the type for `verdict.source` at line 348.
- The endpoint override in quality.ts (`WIZARDINGCODE_MEM_TYPESAFE_URL`) is reached when quality.ts is run directly, as /Users/andreagroferreira/AIProjects/ai-mem/tests/integration/quality-proof.test.ts does, so it is not a dead path.
