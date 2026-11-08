# Why the drain skipped a turn

## Problem

After ADR 0023, a queued turn can end `skipped` for four reasons, and `distillTurn` (`src/distill/pipeline.ts`) records none of them:

- the agent saved a memory itself (`detail.savedMemory`);
- the noise filter left no sentence (`draftTurn` with no candidates);
- the judge found it not worth saving (`buildDraft`: `worthSaving < SAVE_THRESHOLD` or `kind = none`);
- no sentence reaches `KNOWLEDGE_THRESHOLD` for the title (`buildDraft`: no title).

`drainQueue` and `status` count all four together, as one number. If version 2 starts losing knowledge after the release, nothing shows it (`docs/real-use/findings.md`, row 11). The cleanup item (D-1) also needs to find the turns the title rule or the judge dropped, to distil them again.

## Design

- The reason is stored in the turn's existing `last_error` column, as `skip:saved`, `skip:empty`, `skip:not-worth` or `skip:no-title`. There is no migration (decision D-1 of this item). The column already exists and is cleared whenever a turn becomes `done` or `skipped`, and it is read only for `failed` and `pending` turns. A comment at the write site, and the status line, say what the column holds for a `skipped` turn.
- `buildDraft` keeps its signature. A new exported `skipReason(verdict, candidates)` in `pipeline.ts` says which of the two `buildDraft` rules refused, using the same constants. `draftTurn` returns it beside the verdict and the draft.
- `distillTurn` returns `"done"` or the skip reason (`SkipReason`: `saved`, `empty`, `not-worth`, `no-title`), in place of `"skipped"`; its one caller, `drainQueue`, counts `skipped` and `skippedBy` from it. That settles the lead QA's note on how the reason reaches the drain.
- `DrainReport` gains `skippedBy: { saved, empty, notWorth, noTitle }`, and the `distill` command prints it after the skipped count.
- `StatusReport.turns` gains `skippedBy` with the same keys plus `unknown`, counted per project from `last_error`. `unknown` covers the turns skipped before this change, whose `last_error` is NULL. `formatStatus` prints the breakdown after the skipped count when it is not zero.

## Acceptance criteria

- AC-1: A turn the drain skips keeps its reason in `last_error`: `skip:saved` when the agent saved a memory, `skip:empty` when no sentence is left after the filter, `skip:not-worth` when the verdict is below `SAVE_THRESHOLD` or its kind is `none`, `skip:no-title` when no sentence reaches `KNOWLEDGE_THRESHOLD`. A done turn has none.
- AC-2: `drainQueue`'s report counts skipped turns per reason (`skippedBy`), and the `distill` command prints them.
- AC-3: `status` shows the project's skipped turns per reason. A skipped turn with no reason, from before this change, counts as `unknown`.

## Out of scope

- Turns skipped before this change are not given a reason.
- The viewer, `doctor` and `history status` do not show the breakdown.
- The cleanup item (D-1).
- No schema change.
