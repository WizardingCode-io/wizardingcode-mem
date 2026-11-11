# architects lead's validation of 2026-11-10-002-part-6-of-the-knowledge-and-team-journey: spec
verdict: returned
## Returns
- R-1 · .crew/work/2026-11-10-002-part-6-of-the-knowledge-and-team-journey/spec.md:83 (and plan.md:104, spec.md:82, plan.md:110) · The ownership list is nearly complete, but it misses where `sharing_levels` and `sharing_changes` are written for the new server operations, and it states the `src/sharing/` and `ledger.ts` entries too narrowly. A test written from the list as it stands cannot say which file may name those two tables.
  - The two tables are in neither of the ledger's seven nor the two server tables. The spec makes the client write them.
    - `share server remove` deletes "its levels" and writes the `sharing_changes` row `server:<id>` (spec.md:105).
    - `mute` and `unmute` write `sharing_changes` rows `server:<id>` (spec.md:105).
    - `join.ts` and `servers.ts` are the client files that run these (spec.md:82, plan.md:84 and :100).
    - The list at spec.md:83 allows `src/sharing/` only "own writes" named as `confirmServer`, `setLevel`'s unbound row, `setServerLists` and `resetLevels`. None of these is the removal's level deletion or the mute's change row.
  - What must change:
    - Name the `src/sharing/store.ts` functions that `join.ts` calls for them, for example `removeServerLevels(db, serverId, now)` and `logServerChange(db, what, old, new, now)`, in plan task 8 (plan.md:88) and in spec.md:83.
    - Or say that `join.ts` may name `sharing_levels` and `sharing_changes` and add it to the boundary test's list at plan.md:104. The first is the cleaner option, since the policy module stays the one writer of its own tables.
  - `src/sharing/` also reads `sharing_servers` (`destinationsOf`, `boundServerOf`, `loadPolicy`) and the ledger (`ledgerRecords` in `report.ts`). spec.md:83 says only "the policy module's own writes in `src/sharing/`". Make it "its own reads and writes".
  - spec.md:82 still describes `ledger.ts` as "the sync client's statements over the sharing tables". It should say "over the ledger's seven tables", to agree with spec.md:83.
## Notes
- The rest of the list is complete against the spec's file plan and the code, and a test written from it would pass on the planned tree.
  - The code today names none of `sharing_levels`, `sharing_ledger`, `sharing_changes` or `sharing_servers` in SQL outside `src/sharing/` (my grep over `src/` excluding `src/sharing/`, run last round, found no match). `src/status/report.ts` and `src/doctor/checks.ts` read levels through `levelOf`. `src/ui/api.ts` goes through the policy functions. So the "name no sharing table themselves" clause for `status`, `doctor` and the viewer's routes holds, and the plan can keep it.
  - `src/ui/api.ts` is not in the plan's allowed list but also names no table, so an "only in" check passes. The plan names `src/ui/server.ts` in the negative list (plan.md:104, :114) and does not name `api.ts`. Add `api.ts` to that list for the same reason.
  - The reading files (four in total: `index-store.ts`, `contribute.ts`, `brief.ts`, `notes.ts`) are listed the same way in spec.md:84-85 and plan.md:104. The count is fixed.
  - `src/sync/spawn.ts`, `servers.ts` and `state.ts` for `sharing_servers` and `sharing_muted_members` (spec.md:83, plan.md:104) agree with the file plan (plan.md:77, :105).
  - `completeOwedCarry`, `resetSharingInCopy` and `deleteReceivedMemory` are named with their files in both places (spec.md:86-88, plan.md:104).
  - Tasks 18 and 19 route `status`, `doctor` and `src/ui/server.ts` through `src/sync/state.ts` (plan.md:110 and :114).
- Two points to settle in the implementation, not returns.
  - `knowledge_get` resolves a server name to its id (spec.md:170). That lookup, and the server name shown on a hit, read `sharing_servers` and must live in `index-store.ts` (or `contribute.ts`), not in `tools.ts`. Otherwise the boundary test would find a fifth reading file.
  - `src/sync/state.ts` reads open conflicts and pending rows for the status report (plan.md:110). It must call `ledger.ts` for them, since the conflicts and pending-rows tables are named only in `ledger.ts`. Task 3 creates `state.ts` before task 9 creates `ledger.ts` (plan.md:77 and :92), so the status-report reads belong in task 18, where the plan already puts them.
- Everything else I checked last round is unchanged: the schema versions (sharing v2, knowledge v8, `user_version` 7), the import boundaries (spec.md:89, plan.md:104) and the criteria numbering (AC-58 to AC-62).
