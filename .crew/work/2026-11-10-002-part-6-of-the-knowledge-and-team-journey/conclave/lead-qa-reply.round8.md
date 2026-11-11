# qa lead's validation of 2026-11-10-002-part-6-of-the-knowledge-and-team-journey: spec
verdict: validated
## Returns
none
## Notes
- Every criterion in spec.md:229-242 is testable as written and has a test file in plan.md. Every criterion in the Acceptance criteria section has a case line (plan.md:124-134) or a named run. The tasks use the new ids and no stale id (AC-17, AC-18, AC-27, AC-31, AC-34, AC-40, AC-44 or AC-47) survives in plan.md.
- AC-49 (spec.md:230): task 14 (plan.md:100) covers it, with cases on plan.md:125. It covers the stop-flag removal and the restart by the next spawn, the retried `stale` withdraw, the refusal naming the count, the unbound rows, the crashed `remove`'s folder, and `resume` with its preview and yes (nothing cleared without the yes).
- AC-50 (spec.md:232): task 16 (plan.md:105) and its cases (plan.md:127) cover it. All of these are in-process under the fake clock:
  - the take-over's missing write
  - the pid alive across a 90 s sleep
  - an idle sync with no sweep between the marks
  - the one-statement spawn
  - the failed-start backoff
- AC-51 (spec.md:233) is covered by plan.md:128 (task 10 and `sync-outbound`). The 413 split, the `too-large` refusal, the memory `stale`, the outside edit sent at the sixty-second mark and the serialized-body cuts are all deterministic against the in-process server.
- AC-52 (spec.md:234) and AC-53 (spec.md:235) have cases at plan.md:129-130. The 50 ms bound is still measured on wall time (plan.md:3).
- AC-54 (spec.md:236) is covered by plan.md:131. That covers the scopes cursor, the breaker's interval doubling and its reset.
- AC-55 (spec.md:237) is covered by task 17 (plan.md:109) and its cases (plan.md:132). The hold per server is released only by `resume`, with `setLevel` clearing nothing.
- AC-15, AC-35, AC-23 and AC-24 are covered at plan.md:124, 126, 133 and 134. Task 18 (plan.md:110) and task 19 (plan.md:114) carry AC-23 and AC-24.
- The observed and preserve criteria can be proven.
  - AC-33 (spec.md:240) is proven by `crew tdd observed` with the files named (plan.md:118).
  - AC-56 (spec.md:241) is proven by `scripts/proof/upgrade-copy.ts`, a 50 MB v1 store timed with `performance.now()` against the 10 s bar, recorded in the evidence, then `crew tdd observed` (plan.md:119).
  - AC-57 (spec.md:242) is proven by `crew tdd before` at the base and `after` on the final tree (plan.md:119).
  - Every named exception has its edit scheduled: `sharing-contract`, `sharing-settings`, `sharing-store`, `knowledge-migration-7` and `module-migrations` at plan.md:75, and `ui-sharing-copy` at plan.md:114. This resolves my round-3 issue.
- The `sync-boundary` test is task 15 (plan.md:104). It is the red of task 16 and covers the module-isolation rules.
