# architects lead's validation of 2026-11-10-002-part-6-of-the-knowledge-and-team-journey: spec
verdict: returned
## Returns
- R-1 · .crew/work/2026-11-10-002-part-6-of-the-knowledge-and-team-journey/plan.md:101 (also spec.md:86) · The held pin cannot be skipped in the brief's pinned block with the code as planned. The plan says `pinnedEntries` is "untouched", and the ledger read is confined to `index-store.ts`.
  - The brief's pinned block gets its entries from `pinnedEntries(db, repoIds)` (`src/modules/knowledge/index-store.ts:963`). `contribute.ts` filters that list at `src/modules/knowledge/contribute.ts:215`.
  - plan.md:101 says `contribute.ts` "skips a held pin" and, in the same task, `pinnedEntries` "untouched". spec.md:86 limits `contribute.ts` to SQL over `sharing_conflicts` only, and puts the `sharing_ledger` read in `index-store.ts`.
  - So nothing tells `contribute.ts` which pinned entry is held. Neither `Hit` nor `pinnedEntries` carries it, and the file may not name `sharing_ledger`. An implementer either breaks the boundary test or leaves the held pin in the brief, which is the risk the spec names.
  - What must change: say how the held state reaches `contribute.ts`.
    - Either `pinnedEntries` excludes held entries, so "untouched" is removed from plan.md:101 and spec.md:197 says so.
    - Or `index-store.ts` exports a helper (for example `heldPinIds(db, ids)`) that `contribute.ts` calls, or a `held` flag on `Hit`.
    - Add a case on `pinnedEntries` or the helper to task 13's tests.
## Notes
- My round-13 returns are answered.
  - **The derived state.** The `revised by` marker and the held pin are derived from an `applied` ledger row whose `local_hash` equals the entry's current index hash, read in `index-store.ts` over `sharing_ledger` (spec.md:86, plan.md:101). The case that a `knowledge rebuild` loses nothing is in task 13's tests (plan.md:101), and the boundary test's seven-table rule already allows the four reading files (plan.md:108).
  - **The stale task numbers.** They are corrected.
  - **The restore's open path.** spec.md:216 and plan.md:113 now say the unpacked copy is opened through `openFile`, which takes a file name. That matches the code: `openFile` takes `dir` and `file` (`src/store/db.ts:332-351`), while `openDb` fixes the name (`db.ts:376-388`). A `-wal` or `-shm` beside the copy refuses the restore before the open and again before the rename. `carryIntoCopy` ends with `journal_mode = DELETE` and the copy's close (spec.md:217). AC-74 and the plan's test carry the WAL-mode copy case (plan.md:113). This keeps the existing property that no side file is left beside the copy (`src/backup/backup.ts:109-126`).
  - **The throttle.** It is measured from the previous tick sweep's end (spec.md:145 and plan.md:80). A change from a quiet state leaves at the next tick, and a burst is coalesced, with a change made during a burst leaving within 10 s (spec.md:30). AC-76 and the plan's test line carry it (plan.md:131).
- Boundaries and schema versions agree across the spec, the plan and the criteria.
  - The sixth read table, `sharing_ledger`, is in the knowledge module's list (spec.md:86), the pinned contract of "six tables" (plan.md:77) and the only-in list for the seven ledger tables.
  - Sharing v2, knowledge v8 and `user_version` 7 are unchanged.
  - The criteria numbering (AC-70 to AC-76) matches the plan's phase headers (plan.md:75, :94, :99, :104, :106, :111).
- A build detail to settle, not a return. `openFile` (`src/store/db.ts:351`) runs the core migrations. The module migrations run only through `openDb`'s `after` hook (`db.ts:385-386`), and `migrateModules` is not exported. The restore therefore needs either that function exported or a small `openStoreFile` wrapper. The plan's phrase "through `openFile` with the module list" (plan.md:113) should name which.
