# architects lead's validation of 2026-11-10-002-part-6-of-the-knowledge-and-team-journey: spec
verdict: returned
## Returns
- R-1 · .crew/work/2026-11-10-002-part-6-of-the-knowledge-and-team-journey/spec.md:142 (and plan.md:90) · The spec says the viewer's route closes a conflicts row, and no such route exists or is planned.
  - spec.md:142 says "`knowledge accept` and `knowledge reject` (the CLI and the viewer's route, after the store's write, through `src/sync/conflicts.ts`)". Plan task 11 (plan.md:90) says "`closeConflict(db, proposalId)` called by `src/cli/commands/knowledge.ts` and the viewer's accept and reject routes".
  - The viewer has no knowledge accept or reject route. The only accept and reject handlers in `src/ui/server.ts` (lines 588 and 592) are for rule proposals from `src/links/rules.ts`. The CLI's are at `src/cli/commands/knowledge.ts:198-201`.
  - Spec.md:142 itself says "the viewer later", and the Non-goals exclude a conflict editor and a Team view. Plan task 19 (plan.md:109) and AC-24 (spec.md:186) add no such route.
  - What must change: remove "the viewer's route" and "the viewer's accept and reject routes" from spec.md:142 and plan.md:90, so that `closeConflict` is called by the CLI only and the sync's start closes the rest. Or add the route to plan task 19 and AC-24 with a test. The first is the smaller change and matches D-3.
- R-2 · .crew/work/2026-11-10-002-part-6-of-the-knowledge-and-team-journey/spec.md:123 (and plan.md:94) · `reindexReceived` is described so that it would never index the `shared` and `members/<id>` folders.
  - spec.md:123 says it "indexes only the files of aliases bound to that server". Plan task 12 (plan.md:94) says "over the aliases bound to each server only".
  - The received tree also holds `shared/` and `members/<member id>/` folders (spec.md:125), and those have no alias.
  - Read as written, the sync's start, which spec.md:123 and AC-39 rely on to repair a crash between the files and the rows, would drop or ignore every received shared and workspace entry.
  - What must change: both places say that `reindexReceived` indexes `shared`, `members/<id>` and the project folders of aliases still bound to that server. Only the project folders are filtered by the bound aliases. AC-39 or plan task 13's test gets a case for a received shared entry that survives the re-index.
- R-3 · .crew/work/2026-11-10-002-part-6-of-the-knowledge-and-team-journey/plan.md:105 (and spec.md:80, spec.md:146) · The owed carry is completed by two callers, and no single function or file is named.
  - plan.md:105 puts the carry in `src/backup/backup.ts` (`restoreBackup`). It also says `src/sync/run.ts` completes the owed carry before any sweep or pull. Both are said to write `sharing.carry_done`.
  - The carry writes the seven sharing tables, deletes `knowledge_received` rows, and deletes received memories under the `superseded_by` rule. Two copies of that would drift.
  - spec.md:80 says `ledger.ts` holds "every statement of this part that writes a sharing table". The restore's carry in `backup.ts` is a second place that does, and the spec does not call it an exception.
  - What must change:
    - Plan task 17 names one exported function, for example `completeOwedCarry(db, dataDir)` in `src/backup/backup.ts` or a new `src/backup/carry.ts`. `restoreBackup` and `src/sync/run.ts` both call it, and it writes `sharing.carry_owed` and `sharing.carry_done`.
    - The direction `src/sync/` to `src/backup/` is stated, and it is not on a hook path.
    - The `ledger.ts` sentence at spec.md:80 names the carry as the exception (it is a restore operation over the same tables).
## Notes
- Both of my round-4 notes are applied. `join.ts` is in the inventory (spec.md:80), and the Sizing line says 12 (spec.md:63). The count of 12 matches: servers, client, outbound, inbound, received, conflicts, run, state, ledger, spawn, naming, join. `levels.ts` gains two database reads, `destinationsOf` and `boundServerOf`, stated at spec.md:81 for ADR 0025's amendment.
- The v1 upgrade's resolve is buildable against `src/store/db.ts`.
  - `upgrade` runs `sql` and then `run` inside one `BEGIN IMMEDIATE` (db.ts:145-161), so creating `sharing_levels_one_server` from `run` is possible.
  - `sharing_levels` is `WITHOUT ROWID` with primary key `(project_id, destination)` (`src/sharing/migrations/0001_sharing_policy.sql:8-19`), so "the lowest `destination`" is a correct replacement for "the lowest rowid". It is stated the same way at spec.md:81 and plan.md:50.
  - The index is moved out of the migration's `sql` at plan.md:45-47.
  - The `sharing_servers` and `sharing_muted_members` column names are pinned as a cross-module contract in `tests/unit/sync-schema.test.ts` (spec.md:81). The knowledge module and the retrieval read them by their own SQL.
- The schema versions, the boundaries and the module ownership still read the same everywhere else.
  - Sharing v2, knowledge v8 and `user_version` 7 are stated at spec.md:63, :81 and :199, and plan.md:50 and :70.
  - The boundary sentence at spec.md:80 is repeated in plan task 5 (plan.md:74).
  - The criteria renumbering is clean. AC-36, AC-37 and AC-38 appear only as the "supersedes" targets (spec.md:181, :182 and :184). The plan's phase headers use AC-40, AC-39 and AC-41 (plan.md:87, :92 and :103), and the test-case lines at plan.md:124-127 match.
- `reconcileReceived` and `reindexReceived` in `src/sync/received.ts`, and `closeConflict` and `closeOrphanConflicts` in `src/sync/conflicts.ts`, sit in the right module. Both files are in the sync client and are never reached from a hook. The close is called from the CLI, which is not a hook path.
- The done-mark rule is coherent. A finished carry writes `sharing.carry_done` (spec.md:146). `doctor` warns for a `<db>.replaced-*` file newer than the done mark's file and not named by the owed mark, and for nothing with no done mark. This matches the naming at `src/backup/backup.ts:179` (`<db>.replaced-<time>`), so earlier restores raise nothing.
- A failed owed carry now fails the restore with nothing changed and keeps the mark (spec.md:146). The restore's fail-closed order is now explicit and agrees with AC-41 (spec.md:184).
- The files-first-then-rows order for an unbind (spec.md:123) is safe against the store's rule that a file is the truth for received entries. A crash leaves rows without files, which the sync's start drops (once R-2 is fixed so that start also covers `shared` and `members`).
- `writeReceived` and `reindexReceived` write `knowledge_fts` rows from `src/sync/`. I take it they go through an index-store function, as CLAUDE.md requires for the index writer (no triggers), but plan.md:94 does not name it. State it at the next edit.
