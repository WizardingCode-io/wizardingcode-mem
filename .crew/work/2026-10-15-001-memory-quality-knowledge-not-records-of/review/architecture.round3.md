# architecture findings for 2026-10-15-001-memory-quality-knowledge-not-records-of
reviewer: review-architecture
read: the rubric; CLAUDE.md; docs/design/2026-10-05-shibaox-mem-design.md (module layout, lines 186-189 and 248-249, withFallback at 390); docs/adr/0023-memory-quality.md; the spec docs/superpowers/specs/2026-10-14-memory-quality-design.md (sections 5-11); src/judge/types.ts, src/judge/rejudge.ts and src/judge/fallback.ts (how versions combine); src/store/migrations (0001_init.sql, 0005_moments.sql: injections.at, memories.source_turn_id, judge_version); the diff for the 21 src, scripts and doc files out of the 32 in files.txt, scripts/proof/quality.ts in full, tests/helpers/judge-input.ts.

## Findings
- F-1 · advisory · src/judge/types.ts:40 · The change gives `DistillVerdict.durable` a new meaning: it is now the chance that a sentence is knowledge on its own, read from `knowledge_<i>` (src/judge/questions.ts:194-200, src/distill/pipeline.ts:125). It also gives `titleIdx` a new meaning: the candidate that best states the turn's knowledge. The spec (section 7, "Versions") and ADR 0023 both say so and keep the field name, so this is not undeclared drift (rubric Q2/Q3). But the doc comments in the contract file still give the version 1 meanings ("a durable, self-standing fact", "works best alone as a title"), even though this diff edits types.ts. Fix: reword the two comments at lines 40-43 to the version 2 meaning, with a pointer to ADR 0023, so the contract states what callers now get.
- F-2 · advisory · src/distill/pipeline.ts:117 · The new rule that the title must be knowledge (the judge's choice only at or above `KNOWLEDGE_THRESHOLD`, otherwise the surest known sentence, otherwise no memory) is written into `buildDraft` in pipeline.ts. Spec section 8 says "Everything that turns a probability into an action stays in this file", meaning `src/distill/policy.ts`. Only the constants went there. This matches where `buildDraft` already lived and crosses no boundary, so it is a Design detail read differently (rubric Q5/Q6). Fix: move `buildDraft` into policy.ts, or reword the spec's sentence to say policy.ts holds the thresholds and `buildDraft` applies them.

No defects. Things checked and found in line with the base:
- `noise.ts` is pure and sits in `src/distill/`, where the design's layout puts the pipeline's steps.
- The live drain and the proof both go through `prepareTurn`/`draftTurn`; `distillTurn` (called from src/distill/queue.ts:121) is the only path to the judge.
- The proof talks to TypeSafe only through the project's `TypeSafeJudge` adapter, and to the store only through `openDb` and `resolvePaths`, with the existing `assertNotLive` guard.
- `DistillInput.wording` is added to the contract file (types.ts:26-31) as the spec's section 7 names it.
- `rejudge` stamps `IMPORT_JUDGE_VERSION` from the same constant as the wording (D-2).
- The drain's stamp still comes from `versions[verdict.source]` (pipeline.ts:349) through `withFallback`'s merged versions.
- The new `toldInSession` bounds use columns the migrations already define. No schema change.

## Outside the change
- src/distill/pipeline.ts:117 · `buildDraft`, which turns judge probabilities into a draft, already lived in pipeline.ts before this diff, apart from the policy module the spec describes. This is debt the change kept, not one it introduced.

## Not answerable
none
