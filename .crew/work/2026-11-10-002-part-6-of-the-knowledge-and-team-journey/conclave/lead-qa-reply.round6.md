# qa lead's validation of 2026-11-10-002-part-6-of-the-knowledge-and-team-journey: spec
verdict: validated
## Returns
none
## Notes
- AC-45 (spec.md:182) is testable as written.
  - The two-projects-under-one-alias case is on the case line at plan.md:127 ("two projects under one alias").
  - Plan tasks 9, 12 and 13 carry the re-check in `reconcileReceived` (plan.md:94, 97).
  - The members-entry survival is in the spec text and task 13.
  - The AC-35 case line (plan.md:123) names the "two enabled projects" setLevel case.
- AC-44 (spec.md:187) is testable as written. The unbound rows are deleted by `remove`, in the spec at spec.md:97 and in plan task 15 at plan.md:99. The case line at plan.md:132 lists "the unbound rows deleted", beside the withdraw-with-server-down and removal-during-held-pull cases.
- AC-46 (spec.md:184) is testable as written.
  - The restore deletes an unlisted server's sharing rows table by table, and `deleteServerReceived` runs at the sync's next start (spec.md:146).
  - Plan tasks 16 and 17 carry this (plan.md:103, 107).
  - It also runs under `sync --once` with no server listed. That case sits in the 16 and 17 task text and the AC-46 case line.
  - The case line at plan.md:129 covers an unlisted server's received copies deleted at the sync's start, plus every earlier carry case.
- The remaining criteria are unchanged since round 6.
  - The preserve and observed criteria (AC-27, AC-33, AC-34) still have their `crew tdd` runs at phase I.
  - The 50 ms lock bound is still measured on wall time (plan.md:3).
  - The other criteria stand as validated.
