# qa lead's validation of 2026-11-08-001-record-why-the-drain-skips-a-turn-saved: spec
verdict: validated
## Returns
none
## Notes
- AC-1 to AC-3 are observable and each can be proven by a test. I checked each against the code.
  - AC-1: the four skip paths are real. `src/distill/pipeline.ts:313` is the saved path. `:319` covers no candidates, a null verdict and a null draft. `:123` is the not-worth rule (`SAVE_THRESHOLD` or kind `none`). `:134` is the no-title rule (`KNOWLEDGE_THRESHOLD`). The only write that sets `skipped` is `finish` at `:307-311`, and it already sets `last_error = NULL` in the same UPDATE. Writing the reason there matches the conclave's "same UPDATE" practice.
  - "A done turn has none" is testable. `finish("done")` clears `last_error`.
  - AC-2: `DrainReport` at `src/distill/queue.ts:21` and the initial report at `:108` hold a single `skipped` count. The `skippedBy` keys can be asserted on the report.
  - AC-3: `src/status/report.ts:20` and `:125` count `skipped` per project with `count("turns WHERE project_id = ? AND state = 'skipped'")`. `unknown` for a NULL `last_error` can be tested by inserting such a row.
- The decision D-1 is on record. The author answered "in `turns.last_error`, no migration" (`skip-status.json`, `decisions[0]`). The spec follows it at `spec.md:15`. `releaseTurn` at `queue.ts:89` writes `last_error` only for `pending` and `failed` turns, so the column does not collide with the skip reasons.
- Gap to settle in the plan, not a return. `distillTurn` returns `"done" | "skipped"` (`pipeline.ts:293`), and `drainQueue` does `report[await distillTurn(...)]++` (`queue.ts:121`).
  - To fill `skippedBy`, the reason must reach `drainQueue`. The spec does not say how: a changed return type, or a read of `last_error` after the call.
  - The plan should name the choice and keep the existing `distillTurn` tests passing, as the conclave requires.
- Test-first records for AC-1 to AC-3 are "missing" in the engine (`skip-status.json`). That is expected before the plan and build, and it is not a spec defect. The plan must have the tests written and seen failing first.
- Objection O-1 (`last_error` is a misleading name) is advisory. The spec handles it with a comment at the write site and the status line (`spec.md:15`).
- "Out of scope" is explicit: no backfill, no viewer, `doctor` or `history status` changes, no schema change. That keeps the criteria bounded.
