# qa lead's validation of 2026-11-10-002-part-6-of-the-knowledge-and-team-journey: spec
verdict: validated
## Returns
none
## Notes
- Round-3 R-1 is answered.
  - AC-34 (spec.md:190) names `tests/unit/sharing-settings.test.ts`'s levels-and-labels case as the second exception and keeps its `widens` case.
  - AC-34 adds `tests/unit/ui-sharing-copy.test.ts` to the preserved list.
  - Plan task 1 (plan.md:70) edits that case.
  - Plan task 9 (plan.md:84) runs `sharing-settings` green.
  - Plan task 19 (plan.md:109) states why `ui-sharing-copy` stays unchanged.
- Round-3 R-2 is answered. AC-34 now says "which AC-33 changes" (spec.md:190).
- Cosmetic: the AC-34 line at spec.md:190 ends with `ui-sharing-copy.test.ts` and no full stop. This is not a return.
- AC-15, AC-17, AC-18, AC-23, AC-24, AC-25 and AC-31 are unchanged from round 3 and still testable as written. Each has its own test file and cases in plan.md.
- AC-35 (spec.md:178) is testable.
  - The viewer, status, doctor and preview reads follow the bound server's level, else Nothing.
  - Plan task 9 (plan.md:84) and the AC-35 case line (plan.md:120) cover it.
  - With no server listed the old `team` behavior is unchanged, so the preserved suites hold.
- AC-36 (spec.md:182) is testable.
  - The unbind deletion and the re-bind snapshot have plan tasks 12 and 13 and a case line (plan.md:124).
  - The 50 ms lock bound is measured on wall time (plan.md:3).
- AC-37 (spec.md:181) is testable. Accept and reject closing the row, and the orphan closed at the sync's start, are in the case line at plan.md:123.
- AC-38 (spec.md:184) is testable. Carrying seven tables, restoring while a carry is owed, and the `doctor` warning for an unnamed replaced file are in the case line at plan.md:126.
- The observed and preserve criteria can be proven.
  - AC-33 (spec.md:188) is a file and diff check, with `crew tdd observed` at plan.md:113.
  - AC-27 (spec.md:189) is run against the base's whole-suite run (plan.md:113).
  - AC-34 is proven by `crew tdd before` at the base and `after` on the final tree (plan.md:114).
