# qa lead's validation of 2026-11-10-002-part-6-of-the-knowledge-and-team-journey: spec
verdict: validated
## Returns
none
## Notes
- AC-42 (spec.md:182) is testable as written.
  - The `sharing_unbound` table is in the schema (plan.md:37).
  - `setLevel` writes and removes its rows (plan.md:87, task 9).
  - `reconcileReceived(serverId)` runs files first, then the rows, memories, provenance and the `sharing_unbound` row in one transaction (plan.md:96, task 12).
  - Task 13 (plan.md:97) holds the page and retries a failed reconcile.
  - The cases are on plan.md:127:
    - unbind then re-bind;
    - a crash between the files and the rows;
    - a failed reconcile retried;
    - a re-bind before the reconcile;
    - a received shared entry surviving the sync's start;
    - a restore keeping the project copies.
  - The 50 ms lock bound is still measured on wall time (plan.md:3).
  - Small gap, not a return: the case line does not name the members-entry survival of the sync's start that the spec's `reindexReceived` coverage states. Add it when writing `sync-received.test.ts`.
- AC-43 (spec.md:184) is testable as written.
  - `completeOwedCarry` in `src/backup/carry.ts` is the one carry function, called by the restore and by the sync's start (plan.md:107, task 17).
  - The carry is eight tables, with the unbound list added.
  - The copy's stale owed and done marks are cleared in the raw copy before the rename.
  - The cases on plan.md:129 cover the stale mark cleared before the rename, the unbound list carried, a restore while a carry is owed or one whose owed carry fails, and `doctor` quiet or warning by the done mark.
- AC-40 (spec.md:181) stands. The CLI-only close is a scoping detail in plan task 11, and the case line at plan.md:124 is unchanged.
- The `indexReceivedRow` and `dropReceivedRow` writer is internal to plan task 12 and is covered by AC-42's search-row cases.
- The preserve and observed criteria (AC-27, AC-33, AC-34) are unchanged from round 5. Their `crew tdd` runs are at the plan's phase I.
- The other criteria (AC-15, AC-17, AC-18, AC-23, AC-24, AC-25, AC-31, AC-35) have no change to their text or cases that touches my standard. They stay as I validated them.
