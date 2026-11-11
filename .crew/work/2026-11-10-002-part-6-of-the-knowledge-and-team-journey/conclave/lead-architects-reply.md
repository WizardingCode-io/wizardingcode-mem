# architects lead's validation of 2026-11-10-002-part-6-of-the-knowledge-and-team-journey: spec
verdict: validated
## Returns
none
## Notes
- My round-14 return holds up against the code. `pinnedEntries` is the only source of the brief's pinned block, so changing it is enough.
  - `pinnedEntries` (`src/modules/knowledge/index-store.ts:963-976`) is one query over `knowledge_entries`, filtered on `pinned = 1`, `status = 'active'` and `problem IS NULL`. `contribute.ts` filters its result only by what the session was already shown (`src/modules/knowledge/contribute.ts:215-217`) and has no other source of pins.
  - spec.md:197 and plan.md:101 now say that `pinnedEntries` leaves out an own entry whose pin is held, by the `applied`-row rule read in `index-store.ts`. So `contribute.ts` needs no read of its own, and spec.md:86 can keep it to `sharing_conflicts`.
  - The release rule agrees with the derived state. The held state compares the ledger's `local_hash` with the entry's current index hash. A person's edit, or `write --pinned` which rewrites the file, changes that hash and so releases the pin, as spec.md:182 says.
  - The sharing-schema-absent guard (every reader outside `src/sharing/` and `src/sync/` checks `sqlite_master` once per open, spec.md:92 and plan.md:73) covers this extra ledger read, so the preserved tests that open stores without the sharing tables keep passing.
- My build note is answered. spec.md:216 and plan.md:113 name a new export `openStoreFile(dir, file, { moduleSchemas, upgradeBackup })` in `src/store/db.ts`. It runs `openFile` and then the module migrations, with `migrateModules` staying private.
  - That fits the code. `openFile` takes `dir` and `file` and runs the core migration (`src/store/db.ts:351-374`), and `openDb` adds the module migration through its `after` hook (`db.ts:376-388`).
  - The one `upgrade` function (`db.ts:141-173`) takes the backup in a single call (`db.ts:155`) for both the core and the module upgrade. So `upgradeBackup: false` can reach both by one parameter, as the spec states, and the plan has the case that no backup file is written for the copy (plan.md:113).
  - The WAL checks stay as last round: a `-wal` or `-shm` beside the copy refuses the restore before the open and again before the rename, and `journal_mode = DELETE` ends the carry (spec.md:216-217).
- The criteria, the plan's phase headers and the matrix are consistent.
  - AC-77 to AC-80 supersede AC-72, AC-73, AC-74 and AC-71, and the plan's phases use them (plan.md:75-120; spec.md:279-292).
  - The ownership matrix is unchanged: the knowledge module reads six tables (`sharing_servers`, `sharing_muted_members`, `sharing_levels`, `sharing_ledger`, `sharing_conflicts`, and the received memories via the retrieval), and nothing in `contribute.ts` names the ledger.
  - The schema versions (sharing v2, knowledge v8, `user_version` 7) are unchanged.
- The ETL and QA changes touch only the clearing of the `sharing.resume_authorised:*` keys. plan.md:113 clears them in the carry, together with the hold keys and the `sync.*` marks, and the restore case covers a copy holding both for a server the live list lacks. That is consistent with the meta-key ownership in the plan's schema section.
