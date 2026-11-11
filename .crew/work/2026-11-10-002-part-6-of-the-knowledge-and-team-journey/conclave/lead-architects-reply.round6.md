# architects lead's validation of 2026-11-10-002-part-6-of-the-knowledge-and-team-journey: spec
verdict: returned
## Returns
- R-1 · .crew/work/2026-11-10-002-part-6-of-the-knowledge-and-team-journey/spec.md:97 (also spec.md:146, spec.md:187, plan.md:96 and plan.md:107) · The new table `sharing_unbound` is missing from every list of what a server's removal or a restore deletes. It would leave orphan rows.
  - The table is in the DDL (plan.md:37-38), written and removed by `setLevel` (spec.md:103), consumed by `reconcileReceived` (spec.md:123) and carried by the restore (spec.md:146, AC-43 at spec.md:184).
  - The `share server remove` list at spec.md:97 ends "…mutes, pending rows and its row". AC-25 at spec.md:187 says "…mutes, pending rows, row and token". Neither names `sharing_unbound`.
  - The restore's list for a server the live list no longer held (spec.md:146) reads "received memories …, `knowledge_received` rows, ledger rows, refusals, conflicts, pending rows". It names neither `sharing_unbound`, nor sent hashes, nor mutes.
  - Left as written, a removed server keeps unbound rows for ever.
  - What must change:
    - Add `sharing_unbound` to the deletions at spec.md:97 and in AC-25.
    - At spec.md:146, make the carry's deletion for an unlisted server list the tables one for one: ledger rows, sent hashes, refusals, conflicts, pending rows, unbound rows and mutes, plus the received copies.
    - Plan task 15 (the `remove` task) and task 17 (plan.md:107) test the removal of those rows.
- R-2 · .crew/work/2026-11-10-002-part-6-of-the-knowledge-and-team-journey/plan.md:107 (and spec.md:80, spec.md:146) · The deletion of a server's received copies, with the `superseded_by` rule, is now needed in two places that cannot share code. Neither the spec nor the plan names a single owner.
  - `src/backup/carry.ts` deletes an unlisted server's `knowledge_received` rows and received memories (spec.md:146). `src/sync/received.ts` (`deleteServerReceived`, `reconcileReceived`, plan.md:96) does the same for `remove` and for an unbind.
  - spec.md:80 allows only one import from `src/sync/` into `src/backup/`, and the other direction is not allowed. `carry.ts` therefore cannot call `received.ts`.
  - The `superseded_by` reset is a subtle rule that would be written twice.
  - What must change: plan.md:96 or plan.md:107 names one function that both call, in a module neither imports from the other. The natural home is `src/modules/knowledge/` for the received rows and the file-free row deletion, or `src/store/`. The other option is to state that `carry.ts` carries its own copy, and add a test that pins the two to the same result.
## Notes
- My round-5 returns are answered.
  - **Viewer route.** The spec says the viewer has no knowledge accept or reject route in this part (spec.md:142). `closeConflict` is called by `src/cli/commands/knowledge.ts` only (plan.md:92), and the sync's start closes the rest.
  - **`reindexReceived`.** It covers `shared/`, `members/<id>/` and the project folders alike (spec.md:123, plan.md:96). AC-42 and plan task 13 have the shared-entry and members-entry case (spec.md:182, plan.md:97).
  - **The owed carry.** `completeOwedCarry` is one function in `src/backup/carry.ts`. It writes both marks and is called by `restoreBackup` and by `run.ts` (spec.md:80, :146 and :184; plan.md:107). The `ledger.ts` sentence names the carry as its exception.
  - **The index-store writer.** `indexReceivedRow` and `dropReceivedRow` are the one writer of `knowledge_fts` rows for received entries (spec.md:82, plan.md:96).
- The module ownership is placed correctly.
  - `reconcileReceived` and `reindexReceived` stay in `src/sync/received.ts`.
  - The knowledge module keeps the search-row writers and reads the muted tables by its own SQL (spec.md:82).
  - `setLevel` in `src/sharing/store.ts` writes `sharing_unbound` (spec.md:103, plan.md:87).
  - The carry is the one sync-to-backup import, and the boundary test pins it. The restore's carry is not on a hook path.
- The schema is consistent.
  - `sharing_unbound` is in the sharing v2 DDL with primary key `(server_id, alias)` (plan.md:37-38), with no foreign key or trigger on a core table.
  - The carry's "eight tables" in plan.md:107 and spec.md:146 match the table list: `sharing_servers`, `sharing_muted_members`, the ledger's sent rows, `sharing_sent_hashes`, `sharing_refusals`, `sharing_conflicts`, `sharing_pending_rows` and `sharing_unbound`. `sharing_received_memories` is correctly outside the carry.
  - The schema versions (sharing v2, knowledge v8, `user_version` 7) are unchanged across spec.md:63 and :81 and plan.md:50.
  - The criteria numbering is clean: AC-42 supersedes AC-39 and AC-43 supersedes AC-41 (spec.md:182 and :184). The plan's phases use AC-42 and AC-43 (plan.md:94 and :105).
- `resetSharingInCopy` already exists in `src/backup/backup.ts` (lines 114 and 173). Plan task 17 describes its new clearing of a stale `sharing.carry_owed` or `sharing.carry_done` inside the `carry.ts` bullet. It reads as if the function lives in `carry.ts`, so say that it stays in `backup.ts`.
- A gap in the unbound rule, not blocking. Only a person's `setLevel` to Nothing writes `sharing_unbound` (spec.md:103, :123). `reconcileLevels`' `system` removals do not write it (a project with memory off, or one that lost its alias, spec.md:103). The received copies of such a project then stay until the server is removed. If that is intended, add one sentence to spec.md:123.
