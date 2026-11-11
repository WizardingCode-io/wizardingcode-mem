# architects lead's validation of 2026-11-10-002-part-6-of-the-knowledge-and-team-journey: spec
verdict: validated
## Returns
none
## Notes
- My round-12 return is answered. The negative list in plan task 15 (plan.md:104) now gives each file its own route, and the routes agree with the spec and with the other tasks.
  - `status`, `doctor` and `src/ui/server.ts` read the server rows through `src/sync/state.ts`. That agrees with plan task 18 (plan.md:110) and task 19 (plan.md:114).
  - `src/ui/api.ts` reads levels through the policy functions of `src/sharing/` (plan.md:88).
  - `src/sync/join.ts` goes through `servers.ts`, `ledger.ts` and the two `src/sharing/store.ts` functions, `removeServerLevels` and `logServerChange` (spec.md:83 and :107; plan.md:84 and :88).
  - `src/modules/knowledge/tools.ts` goes through `serverByName` in `index-store.ts` (plan.md:97). So `tools.ts` imports nothing of `src/sync/`, and the knowledge boundary line in the same task holds.
- The list is complete against the spec's file plan.
  - The ledger's seven tables are named in SQL only in `ledger.ts`, `src/sharing/`, `carry.ts`, `resetSharingInCopy`, `deleteReceivedMemory` and the four reading files. `sharing_servers` and `sharing_muted_members` also appear in `servers.ts`, `state.ts` and `spawn.ts`. `sharing_levels` and `sharing_changes` are now in the only-in list as well (`src/sharing/`, plus the knowledge module's `index-store.ts` read for `sharing_levels`).
  - Each file the spec's file plan names (spec.md:82-88) is covered: `outbound.ts`, `inbound.ts`, `received.ts`, `conflicts.ts`, `run.ts`, `client.ts`, `share.ts` and `knowledge.ts` are in neither list, so they must reach the tables through `ledger.ts`, `servers.ts`, `state.ts` or the sharing functions. That is what the spec and the plan give them.
  - The rule agrees with the code as it is. My earlier grep over `src/` excluding `src/sharing/` found none of `sharing_levels`, `sharing_ledger`, `sharing_changes` or `sharing_servers` named in SQL. So the pinned list can be met on the planned tree without moving existing code.
- A test written from the list passes on the planned tree.
  - The import checks are the same set as spec.md:89 (`hook.ts` reaches only `spawn.ts`, `handle.ts` nothing, `spawn.ts` imports nothing else of `src/sync/`, `src/sync/` takes only `contract.ts` from `src/team/`, nothing in `src/team/` imports `src/sync/`, the knowledge module and the retrieval import nothing of `src/sync/` or `src/sharing/`, `run.ts` is the only importer of `src/backup/`, and `src/backup/` imports nothing of `src/sync/`).
  - The reachability check (nothing under `src/sync/` but `spawn.ts`, and not `carry.ts`, is reachable from `hook.ts`) is the same as before.
  - It is red before task 16 and green after.
- One point to settle in the implementation, not a return. spec.md:84 says the knowledge module reads `sharing_levels` in `index-store.ts` and `contribute.ts`, and plan.md:104 allows `sharing_levels` only in `index-store.ts` among the knowledge files. `contribute.ts` gets the bound aliases for the floor by calling the received reads that live in `index-store.ts` (plan.md:97), so it needs no SQL over `sharing_levels` of its own. Keep it that way, or the test will fail on `contribute.ts`.
- The schema versions (sharing v2, knowledge v8, `user_version` 7) and the criteria numbering are unchanged and agree across the spec, the plan and the criteria.
