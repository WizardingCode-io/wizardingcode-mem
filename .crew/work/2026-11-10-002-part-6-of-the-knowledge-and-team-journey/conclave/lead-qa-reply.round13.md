# qa lead's validation of 2026-11-10-002-part-6-of-the-knowledge-and-team-journey: spec
verdict: returned
## Returns
- R-1 · .crew/work/2026-11-10-002-part-6-of-the-knowledge-and-team-journey/plan.md:96 · The `sync-outbound.test.ts` case "25 entries deleted from a present repository held under `bulk`, released by `resume` and withdrawn by the next sweep with no new hold" sits in a task that cannot run it. `share server resume` is a `TODO` throw until task 16 (plan.md:88, 104). The task 16 test is the only place where `resume` exists. Task 11 can only prove the hold, and the withdrawal with the guard suspended once the authorisation key is present. Change task 11's case to this: the sweep holds the 25 under `bulk`; the test writes `sharing.resume_authorised:<serverId>` with those uids directly (the key `outbound.ts` reads); the next sweep withdraws them, clears the key and writes no new hold. Keep the `resume` command's own authorisation write in task 16's case (plan.md:104). That case already ends with "the sweep withdrawing after it". Add there that `resume` writes the authorised set it printed. Then the task 11 case no longer depends on a later task, and AC-72's "a `resume` authorising the set it showed" is proven end to end in task 16.
## Notes
- My round-13 returns are answered.
  - The pending-row case that proves "a sync spawned by a prompt hook sends nothing" is now in task 11 (plan.md:96): the real sweep against a pending row with a `send`-eligible entry, and the in-process server receiving nothing.
  - The stale task numbers in tasks 3 and 9 are corrected (plan.md:78-79, 88).
- Cases that sit in tasks that have what they need:
  - AC-76 (the change from a quiet state swept at the next tick, a burst coalesced to one sweep per five seconds): task 4 (plan.md:80), where the tick and the counted sweep hook exist.
  - AC-75 (importance 3.5, 0.2 and 9 mapped to 4, 1 and 5; the sticky main set; a level raised within the set; an unbind promoting the first extra alias by its bytes): task 14 (plan.md:102), where the pull and the reads exist.
  - AC-69 (the held pin and the `revised by` marker derived from the `applied` ledger row, tested in task 13, surviving `knowledge rebuild`): task 13 (plan.md:101). It needs task 12's `applied` row, which comes earlier. The marker is read by `index-store.ts` over the `applied` rows, not a stored flag.
  - AC-74 (a WAL-mode copy keeping the carried rows, a `-wal` file beside the copy refusing the restore): task 19 (plan.md:113).
  - The 25-item narrowing by the person withdrawn at once with no hold (plan.md:96): it relies on `setLevel` from task 10, which exists.
- The remaining criteria and the observed and preserve criteria (AC-62, AC-56, AC-57) are unchanged since round 13. They stand as validated.
