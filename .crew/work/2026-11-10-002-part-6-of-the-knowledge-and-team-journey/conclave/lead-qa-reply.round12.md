# qa lead's validation of 2026-11-10-002-part-6-of-the-knowledge-and-team-journey: spec
verdict: returned
## Returns
- R-1 · .crew/work/2026-11-10-002-part-6-of-the-knowledge-and-team-journey/plan.md:88 · AC-15's "while the row is pending a sync spawned by a prompt hook sends nothing" is not proven by the case task 9 gives it. The case runs `runSync` "with the sweep hook of task 13 absent", so there is no sweep and the assertion passes vacuously. The sweep only exists from task 11 (`outbound.ts`, plan.md:96), and the hook spawn only from task 18 (plan.md:109). Move this case to a task that has what it needs. Either `sync-outbound.test.ts` (task 11) or the hooks' spawn case of `sync-process.test.ts` (task 18) works. The test must run the real sweep against a pending row, with a `send`-eligible entry in a project bound to that server, and assert the in-process server received nothing. Keep the `plan.md:128` case line for AC-15 pointing at it.
- R-2 · .crew/work/2026-11-10-002-part-6-of-the-knowledge-and-team-journey/plan.md:88 · Task numbers inside task 9 survived the renumbering, so they point at the wrong tasks. The implementer is told to wait on or call things from the wrong places.
  - "`outbound.ts` (task 13)" and "`wouldWithdraw` of `outbound.ts`, task 13": the outbound side is task 11 (plan.md:96).
  - "`received.ts` (task 15)": received.ts is task 13 (plan.md:101).
  - "`ledger.ts` (task 12)": ledger.ts is task 11.
  - "tasks 12 to 15" in the sentence about the `remove` and `resume` stubs: the right range is tasks 11 to 13.
  - plan.md:79, task 3: "the open conflicts and the pending rows read through `ledger.ts` from task 9 on": ledger.ts is task 11.
  - Rewrite each reference to the current task number. The stubs and their cases are in task 16, which is correct.
## Notes
- Everything else in the review's last round holds. Criteria AC-15, AC-63, AC-35, AC-64, AC-65, AC-66, AC-67, AC-68, AC-69, AC-70 and AC-24 each have a named test file and a case line (plan.md:128-138).
- Task order checks, apart from the two returns above.
  - Test helpers are created in task 2, `SyncContext` in task 3, and the process's first cut with its no-op hooks in task 4, so tasks 4 and 18 compile without later code.
  - The policy per server (task 10) comes before the sweep (task 11).
  - The conflict path (task 12) comes before the inbound side (task 14), which calls it.
  - The ledger functions are all in task 11, before their users in tasks 12, 14 and 16.
  - The boundary test (task 17) is red until task 18's `hook.ts` change, then green.
  - The viewer tests (task 21) need the state reads of task 3 and the remove and resume code of task 16, which exist by then.
- The 50 ms bound (AC-67) is measured on wall time with `performance.now()` around `withWrite`, plus a second connection with `busy_timeout` 50 (plan.md:3, 102).
- The restore's failure case is injectable in-process (plan.md:113, 136): a fault in `carryIntoCopy` leaves the live store unchanged.
- AC-24's UI evidence is the session's captures under `review/ui/` with the manifest (plan.md:118). The states, viewports and schemes are declared in the criterion, so this is acceptable as an observed proof.
- Observed and preserve criteria can be proven as stated.
  - AC-62 (spec.md:290) is proven by `crew tdd observed` with the files named (plan.md:122).
  - AC-56 (spec.md:291) is proven by `scripts/proof/upgrade-copy.ts`: a sharing-v1 store of 40,000 memories, 2,000 entries and 500 ledger rows (about 50 MB), timed with `performance.now()` against the 10 s bar (plan.md:123).
  - AC-57 (spec.md:292) is proven by `crew tdd before` and `after`. Every named exception is edited in task 1 (plan.md:77) or task 21 (plan.md:118), and the preserved suites stay unmodified.
