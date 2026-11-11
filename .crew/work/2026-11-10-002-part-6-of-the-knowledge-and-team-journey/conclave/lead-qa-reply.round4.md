# qa lead's validation of 2026-11-10-002-part-6-of-the-knowledge-and-team-journey: spec
verdict: validated
## Returns
none
## Notes
- AC-39 (spec.md:182) is testable as written.
  - The unbind reconcile runs files first, then the rows in one transaction, before the next pull's first page.
  - A crash between the two is covered. Plan task 13 (plan.md:95) names the case: "a crash between the files and the rows, the rows dropped at the sync's start".
  - A failed or refused-folder reconcile holds the page and is retried at the next pull (plan.md:95; spec.md:123).
  - The re-bind restores the rows through the group's snapshot from 0.
  - The task text is at plan.md:94-95. The AC-39 case line is in the edge-case section.
  - The 50 ms lock bound is still measured on wall time (plan.md:3; spec.md:198 now names AC-39's test).
- AC-40 (spec.md:181) is testable as written. Plan task 11 and the case line at plan.md:124 add the new case: "a row whose proposal is accepted, rejected or gone closed at the sync's start". Accept and reject closing the row are also on that line.
- AC-41 (spec.md:184) is testable as written.
  - A restore whose owed carry fails fails with nothing changed.
  - A finished carry writes `sharing.carry_done` (spec.md:146; plan.md:50, 105).
  - `doctor` warns only for a `<db>.replaced-*` file newer than the done mark's that no owed mark names, and stays quiet after an ordinary restore or with no done mark.
  - All of these are in the case line at plan.md:127.
  - The fault in the carry's transaction is injectable, as in the earlier carry case.
- Preserve and observed criteria are unchanged from round 4.
  - AC-34 now ends with a full stop.
  - AC-33 and AC-27 have their `crew tdd observed` runs at the plan's phase I.
  - AC-34's `crew tdd before` and `after` runs are at the same place.
- The other criteria (AC-15, AC-17, AC-18, AC-23, AC-24, AC-25, AC-31, AC-35) have no change to their text or cases in this revision. They stay as I validated them.
