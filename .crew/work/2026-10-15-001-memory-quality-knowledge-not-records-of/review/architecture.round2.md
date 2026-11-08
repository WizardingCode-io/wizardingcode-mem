# architecture findings for 2026-10-15-001-memory-quality-knowledge-not-records-of
reviewer: review-architecture
read: the rubric; CLAUDE.md; spec docs/superpowers/specs/2026-10-14-memory-quality-design.md (whole); ADR 0023 (in the diff); src/store/migrations/0001_init.sql and 0005_moments.sql (memories.judge_version, source_turn_id, injections.at); src/judge/typesafe.ts, rejudge.ts, fallback.ts, questions.ts, heuristic.ts; src/store/db.ts (openDb); the neighbouring proofs' openDb use (scripts/proof/moments.ts, links.ts, semantic.ts); src/mcp/tools.ts (memory_save's origin and judge); the diff (32 files; I read the source, script and test-helper hunks closely and skimmed the plan doc and the recorded golden answers)

## Findings
- F-1 · advisory · src/judge/questions.ts:128 · The version 2 importance criterion for stored level 3 reads "a cause, a behaviour or a location that takes real time to find". The Design (spec section 7, importance table) says "a cause, a behaviour or a location they would not find by reading the code around it". This is a wording the Design does not name (rubric question 5) and it crosses no boundary. Fix: use the Design's wording, or record the change in the spec or ADR 0023 the way the `kind` wording change was recorded. If the wording changes, re-record the golden answers.

## Outside the change
- src/judge/heuristic.ts:148 and src/judge/heuristic.ts:188 · The heuristic judge still hard-codes 0.5 as its "durable" cut. `hasDurable` caps `worth` at 0.3, and the title is picked from `eligible`. The policy's `KNOWLEDGE_THRESHOLD` (src/distill/policy.ts) is now 0.45, and questions.ts says thresholds belong in distill/policy.ts. A heuristic sentence rated between 0.45 and 0.5 counts as knowledge for the policy but not for the heuristic's own worth cap. These lines are unchanged context in the diff, so this is debt, not a defect of this change.

## Not answerable
- none

Notes on what I checked and found consistent with the base, for the judge:
- **Layers:** the noise filter sits in src/distill/noise.ts and is pure. The thresholds and `CONTEXT_MIN_WORDS` sit in src/distill/policy.ts. The questions stay in src/judge/questions.ts. There is one path, `prepareTurn` then `draftTurn` in src/distill/pipeline.ts, used by both the live drain and the proof. I found no second segmentation or judging path in src.
- **Data model:** there is no migration, and none is needed. `judge_version` now carries "2" for distillations, as spec sections 7 and 13 say. The rejudge stamps `IMPORT_JUDGE_VERSION` from the same constant it sends as the wording (src/judge/rejudge.ts). The `injections.at` and `memories.source_turn_id` columns used by `toldInSession` exist in migrations 0001 and 0005.
- **Contracts:** `DistillInput.wording?: 1 | 2` (src/judge/types.ts) is the one field the Design names. `DistillVerdict.durable` keeps its name, as the Design says. TypeSafeJudge and the heuristic are version "2". `heuristicJudgeV1` is never used by the drain. The fallback judge's version merge is untouched.
- **Integrations:** the proof reaches TypeSafe only through `TypeSafeJudge` and reads the key with `readTypeSafeKey`. It guards paths with the existing `assertNotLive`. It opens its copy with `openDb({ dataDir })`, like the other proof scripts. The seeded draws were moved into scripts/proof/random.ts and are shared with moments.ts.
- **Unchanged:** the diff touches no retrieval, hook or snapshot file.
