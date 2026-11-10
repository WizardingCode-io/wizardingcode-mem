# qa lead's validation of 2026-11-10-001-team-server-wizardingcode-mem-serve-one: spec
verdict: validated
## Returns
none
## Notes
- R-1 is closed. The phrase "just under 100 MiB" is now in plan.md (task 17) and in spec.md (AC-17). The health 503 case is provable with the injected `freeBytes`.
- R-2 is closed. plan.md task 11 names the `disable` with `withdraw: true` case: one tombstone feed row per workspace entry and per memory, devices revoked, and the shared entry left current and pullable by another member. The `team-push` test-cases line (plan.md:208) says "disable with withdraw".
- My AC-26 note is closed. `--read-only --tmpfs` is now in the CI step, in both spec.md and plan.md (task 19), so the read-only root filesystem is observed in the run. My AC-28 note is closed. The ADR list now names the step that makes the package public.
- I confirmed the new phrases by search. I did not re-read every changed paragraph line by line. The other leads' additions (typed payload validation, the `EXPLAIN QUERY PLAN` test, the rollback walked in `team-db.test.ts`, hostile member names in the mirror test) are tied to named test files in plan.md. They add no unprovable criterion that I found.
- AC-27 (preserve) still has its baseline run (task 1) and its closing run (task 21). AC-26 and AC-28 stay `observed`.
