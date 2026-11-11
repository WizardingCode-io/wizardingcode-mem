# qa lead's validation of 2026-11-10-002-part-6-of-the-knowledge-and-team-journey: spec
verdict: returned
## Returns
- R-1 · .crew/work/2026-11-10-002-part-6-of-the-knowledge-and-team-journey/spec.md:190 · AC-28 says every `tests/unit/sharing-*.test.ts` keeps passing unchanged, with only `sharing-contract.test.ts` excepted. The spec's own change to `LEVELS` and `LEVEL_LABELS` (spec.md:103, plan.md:69) breaks `tests/unit/sharing-settings.test.ts:40-45`, which pins `LEVELS` to `["local","knowledge","all"]` and `LEVEL_LABELS` to three entries. That file matches the AC-28 glob. As written, AC-28 can't be satisfied, and the plan never schedules the edit (plan.md:69 names only `sharing-contract.test.ts`). Fix both places:
  - AC-28 (spec.md:190): add `tests/unit/sharing-settings.test.ts` (its levels-and-labels case) to the named exceptions, and say its `widens` case, lines 49-54, stays as is.
  - Plan task 1 (plan.md:69): modify that case to expect `local, receive, knowledge, all` and the "Receive only" label.
  - Plan task 9 (plan.md:83): run `sharing-settings.test.ts` beside `sharing-policy` and `sharing-store-writes`.
  - Plan task 19 (plan.md:108): the UI copy test `tests/unit/ui-sharing-copy.test.ts:147-171` asserts that the dock reads `LEVELS` and `LEVEL_LABELS`. Say whether it stays green unchanged once the dock lists `receive`, or name the edit.
- R-2 · .crew/work/2026-11-10-002-part-6-of-the-knowledge-and-team-journey/spec.md:190 · AC-28 says the contract test is the one "which AC-26 changes". AC-26 was superseded by AC-33 (spec.md:188). After the stale AC-26 reference is replaced with AC-33, the exception list in the same sentence is complete. Change "AC-26" to "AC-33" so the engine's supersede chain and the preserve text agree.
## Notes
- My round-2 return is answered. The 50 ms bound is measured on wall time, not the fake clock.
  - plan.md:3 states "measured on wall time (`performance.now()`), never with the fake clock".
  - plan.md:93 gives the method: `performance.now()` around the largest chunk's `withWrite`, asserted under 50 ms; plus a second connection with `busy_timeout` 50 running `BEGIN IMMEDIATE` that must succeed.
  - spec.md:198 repeats it and spec.md:182 carries the clause in AC-20.
- AC-15, AC-29, AC-17, AC-18, AC-30, AC-20, AC-31, AC-32, AC-23, AC-24 and AC-25 are each testable as written, with a named test file and a red-then-green task.
  - AC-15: plan.md:79 (`sync-join`) and plan.md:118 (edge cases).
  - AC-29: plan.md:83, 119.
  - AC-17: plan.md:99, 120.
  - AC-18: plan.md:87, 121.
  - AC-30: plan.md:88, 122.
  - AC-20: plan.md:92-93, 123.
  - AC-31: plan.md:93, 124.
  - AC-32: plan.md:103, 125.
  - AC-23: plan.md:104, 126.
  - AC-24: plan.md:108, 127.
  - AC-25: plan.md:95, 128.
- The decide-unchanged claim in AC-29 (spec.md:178) is provable. `level-receive` comes from `effectiveLevel` (spec.md:103), so the REASONS block of the contract test changes and the `DECISION_KEYS` block and the `decide` cases do not.
- The observed criteria can be proven as stated.
  - AC-33 (spec.md:188) is a file and diff check, with `crew tdd observed` named at plan.md:112.
  - AC-27 (spec.md:189) is run at plan.md:113 against the base's whole-suite run. Its "read beside the budgets" for the one-time v1-to-v2 copy is a reading, not an assertion. I accept it as an observed criterion, but the session should record the measured copy time at the delivery.
- AC-28 is a preserve criterion proven by `crew tdd before` at the base and `after` on the final tree (plan.md:113). It is valid once R-1 and R-2 are fixed.
- D-9 is recorded as answered (spec.md:45, 59). AC-20's "a project bound to server A is never named in server B's pull" has its test at plan.md:93, 123.
