# code-quality findings for 2026-10-15-001-memory-quality-knowledge-not-records-of
reviewer: review-code-quality
read: 14 files, 38 hunks

## Findings
- F-1 · advisory · /Users/andreagroferreira/AIProjects/ai-mem/src/judge/questions.ts:197 · The `perSentence` guard (lines 197-202) covers wording 1 with candidates, but the only wording-1 caller, `asInput` in /Users/andreagroferreira/AIProjects/ai-mem/src/judge/rejudge.ts:85-93, always sends `candidates: []`, so only a unit test reaches the `: 0` arm (questions 4/9). It keeps the public `DistillInput.wording` contract consistent, so this is advisory and not a dead path.
- F-2 · advisory · /Users/andreagroferreira/AIProjects/ai-mem/scripts/proof/quality.ts:286 · `result.verdict?.source !== judge.name` can never be true here: `readingOf` has already returned "emptied" when there are no candidates (line 279), TypeSafeJudge always stamps `source: "typesafe"`, and the heuristic always stamps `"heuristic"`. It is a guard for an unreachable case (question 9). AC-11's "TypeSafe verdicts only" justifies keeping it as a safeguard, so it is advisory.
- F-3 · advisory · /Users/andreagroferreira/AIProjects/ai-mem/src/distill/pipeline.ts:133 · `buildDraft` sorts `known` with `surestFirst` twice, once to pick the fallback title (line 133) and again for the facts (line 138). One sorted array would serve both (question 2, boilerplate-sized).
- F-4 · advisory · /Users/andreagroferreira/AIProjects/ai-mem/src/distill/pipeline.ts:189 · `PreparedTexts` and `TurnTexts` (line 254) are exported, but nothing outside pipeline.ts imports them by name (question 8, unused export).
- F-5 · advisory · /Users/andreagroferreira/AIProjects/ai-mem/scripts/proof/quality.sh:27 · In the header comment, the line "The labeller the author chose reads the samples. Distillation, …" runs far past the wrapping of the lines around it. Style only (question 6).

## Outside the change
- /Users/andreagroferreira/AIProjects/ai-mem/src/judge/heuristic.ts:148 · `hasDurable` still uses a hard-coded 0.5, while the draft now keeps sentences from `KNOWLEDGE_THRESHOLD` 0.45 up. A heuristic sentence scoring 0.45 to 0.5 can count as knowledge in `buildDraft` while the turn's worth is capped at 0.3 because no sentence reached 0.5. The diff did not write this line.

## Not answerable
- Question 11 (prose fact-preservation) for /Users/andreagroferreira/AIProjects/ai-mem/docs/superpowers/plans/2026-10-15-memory-quality.md and /Users/andreagroferreira/AIProjects/ai-mem/docs/superpowers/specs/2026-10-14-memory-quality-design.md · The plan alone is about 4,900 lines of the diff. I read only its code excerpts, not all of its prose against `references/writing.md`. The ADR and the CLAUDE.md lines were read in full: the rejudge line only gains a sentence, and nothing was dropped.
