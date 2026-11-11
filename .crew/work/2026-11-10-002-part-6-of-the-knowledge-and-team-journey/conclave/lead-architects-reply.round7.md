# architects lead's validation of 2026-11-10-002-part-6-of-the-knowledge-and-team-journey: spec
verdict: returned
## Returns
- R-1 · .crew/work/2026-11-10-002-part-6-of-the-knowledge-and-team-journey/spec.md:134 (and spec.md:146, plan.md:96) · After the restore, a server's received copies that the live list did not hold stay readable by the agents until the sync's next start.
  - Revision 8 moved their deletion to `deleteServerReceived` at the sync's start (spec.md:146, plan.md:107). The sync is spawned by a hook only when a confirmed server is listed (spec.md:111). When the live list is empty, nothing starts it. The spec accepts that and says "the restore says so when the live list is empty".
  - Meanwhile `searchEntries`, `browseEntries` and the prompt floor read `knowledge_received` excluding only muted servers and members (spec.md:134, plan.md:96). Nothing excludes a server that has no `sharing_servers` row.
  - So a team's received text, from a server this machine does not have, keeps reaching the agents' notes. D-6 says received items are "erasable", and the spec's risk section relies on "apart, marked, never pinned, capped, mutable".
  - What must change:
    - spec.md:134 and plan.md:96 say that the received reads (search, browse, the floor, `knowledge_get`, and the retrieval's received-memory read) take only rows whose server has a `sharing_servers` row, by the module's own SQL over that table, the one it already reads for the mutes.
    - AC-45 (the criteria that supersede AC-42 at spec.md:182) or the restore case in plan task 17 (plan.md:107) gets the case that an orphan server's copies are not returned before the sync's start.
## Notes
- My round-6 returns and notes are answered.
  - **R-1 (the delete lists).**
    - `share server remove` now lists the unbound rows (spec.md:97, AC-44 at spec.md:187, plan task 15 at plan.md:99).
    - The restore's deletion for an unlisted server is table by table: ledger rows, sent hashes, refusals, conflicts, pending rows, unbound rows and mutes (spec.md:146, AC-46 at spec.md:184, plan.md:107).
  - **R-2 (one owner).**
    - `deleteServerReceived(serverId)` in `src/sync/received.ts` is the one owner of the received deletion (files, rows, search rows, received memories with the `superseded_by` rule). `remove`, the sync's start and the per-alias unbind all use it (spec.md:146, plan.md:99 and :103).
    - `src/backup/carry.ts` touches sharing tables only and never the received copies, so no import goes in the forbidden direction (`src/backup/` into `src/sync/`) and the `superseded_by` rule is written once.
    - The ordering at the start is stated the same way in the spec and in plan task 16: `completeOwedCarry`, then `deleteServerReceived` for every server id with rows but no `sharing_servers` row, then `reindexReceived`. It runs under `sync --once` too, with no server listed (spec.md:109, plan.md:103).
  - **My two notes.** `resetSharingInCopy` stays in `backup.ts` (plan.md:107). The `reconcileLevels` `system` removal writes no unbound row, and its copies stay until the server is removed (spec.md:103, plan.md:87).
- The ETL rule is stated the same way in spec.md:103, plan task 9 (plan.md:87) and plan tasks 12 and 13. `setLevel` writes the unbound row only when no other enabled project is still bound to the server under that alias, which matters because two clones of one repository share an alias and a pull names aliases. `reconcileReceived` re-checks the row before deleting.
- The imports and the module ownership agree across the spec, the plan and the criteria.
  - `src/sync/run.ts` imports `src/backup/carry.ts`, the one import in that direction, and the backup never imports the sync.
  - `src/modules/knowledge/` imports nothing of `src/sharing/` or `src/sync/`.
  - `indexReceivedRow` and `dropReceivedRow` are the one writer of the received search rows (spec.md:82, plan.md:96).
- The criteria numbering is consistent: AC-44 supersedes AC-25, AC-45 supersedes AC-42, AC-46 supersedes AC-43. The plan's phase headers use AC-44, AC-45 and AC-46 at plan.md:94 and :105, and the plan's case lines at plan.md:127, :129 and :132 match them.
- The schema is unchanged: sharing v2, knowledge v8, `user_version` 7, and the eight tables in the carry match the table list.
