# architects lead's validation of 2026-11-10-002-part-6-of-the-knowledge-and-team-journey: spec
verdict: returned
## Returns
- R-1 · .crew/work/2026-11-10-002-part-6-of-the-knowledge-and-team-journey/plan.md:97 (also spec.md:86, spec.md:182, plan.md:73, plan.md:101) · The held pin and the "revised by" marker on an own entry have no stated source, and the code that renders them is planned after the task that tests it.
  - spec.md:182 and plan.md:97 (task 12) say the marker lasts "until the person edits the entry again" and that a held pin is "the index row's `pinned` read as held, a marker the floor renders and the brief's pinned block skips".
    - Knowledge v8 adds only `knowledge_received` (plan.md:60-71), and `pinned` is a stored 0 or 1 in the index. No column or table holds "held" or "revised".
    - The only derivable source is the ledger's `applied` row whose `local_hash` equals the entry's current index hash. The knowledge module's reads are limited to `sharing_servers`, `sharing_muted_members`, `sharing_levels` and `sharing_conflicts` (spec.md:86), so `sharing_ledger` is not among them.
    - The five tables the schema test pins (plan.md:73) leave out `sharing_ledger` too.
    - Even if the state were an index flag, a `knowledge rebuild` from the files would lose it.
  - Task 12 (phase D, plan.md:97) tests "the pin held with the brief and the floor as stated". The brief's pinned-block skip and the floor's marker are written in task 13 (phase E, plan.md:101, `contribute.ts` and `tools.ts`). That breaks the plan's own rule that "a test case sits in or after the task that provides what it needs" (plan.md:3).
  - What must change:
    - Name the source in spec.md:182 and spec.md:86: for example, `sharing_ledger` rows of direction `applied`, read by `index-store.ts` and `contribute.ts`. Add `sharing_ledger` to that reading list, to the five pinned tables (plan.md:73) and to the boundary test's reader list for it (plan.md:108).
    - Or store the state in the knowledge module's own index.
    - Move the held-pin and marker assertions of task 12 to task 13.
- R-2 · .crew/work/2026-11-10-002-part-6-of-the-knowledge-and-team-journey/plan.md:79 (and plan.md:88) · Several cross-references to tasks are stale after the reorder. A reader following them builds out of order.
  - Task 3 (plan.md:79): "the open conflicts and the pending rows read through `ledger.ts` from task 9 on". `ledger.ts` is task 11 (plan.md:96).
  - Task 9 (plan.md:88): "`outbound.ts` (task 13)", "`received.ts` (task 15)", "`ledger.ts` (task 12)" and "the sweep hook of task 13". `outbound.ts` and `ledger.ts` are task 11, and `received.ts` is task 13.
  - What must change: correct those references.
- R-3 · .crew/work/2026-11-10-002-part-6-of-the-knowledge-and-team-journey/plan.md:113 (and spec.md:216-217) · The restore says the raw copy is opened "through `openDb`" with an `{ upgradeBackup: false }` option. `openDb` cannot open it as it stands.
  - `openDb` takes a directory and always opens the fixed file `wizardingcode-mem.db` (`src/store/db.ts:376-388`; `file: DB_FILE`). The copy is `.restore-<now>.db` in the work folder (`src/backup/backup.ts:148-151`).
  - The code that exists today deliberately uses a raw connection with `journal_mode = DELETE` "so no side file is left beside it" (`backup.ts:109-126`). Opening the copy through the migration path reverses that, and the spec says nothing about the WAL side files before the rename.
  - What must change: state how the copy is opened. Either `openFile` is used (it takes a `file`) with the module list and `upgradeBackup: false`, or the copy is placed under the standard name in a scratch folder. Say that the copy is left in journal mode DELETE, with no `-wal` or `-shm`, before the rename, and add a restore test for that.
- R-4 · .crew/work/2026-11-10-002-part-6-of-the-knowledge-and-team-journey/spec.md:145 (also spec.md:265, spec.md:283) · The 5 s promise conflicts with the throttle on the tick's sweep.
  - spec.md:145 says a change by another connection runs a sweep "at most once per five seconds". A write 0.1 s after a sweep started waits for the next 2 s tick, and then for the 5 s throttle, so its sweep runs about 5 s after the previous one. The push, the server's wake, the pull and the apply come after that.
  - So a change can take over 5 s on the writing machine alone. The goals (spec.md:29), the NFR (spec.md:265) and AC-65 (spec.md:283) promise "within 5 s".
  - What must change: either throttle by the time since the last sweep ended, so that a write after a quiet period leaves at the next tick, and say that the 5 s holds from a quiet state. Or relax the promise to a bound that includes the throttle, for example under 10 s with the push at most 5 s after the write.
## Notes
- The boundaries, the ownership matrix and the schema versions agree across the spec, the plan and the criteria.
  - The matrix at plan.md:108 equals spec.md:85-89 table by table and file by file: the seven ledger tables, `sharing_servers` and `sharing_muted_members`, `sharing_levels` and `sharing_changes`, the four reading files, `carryIntoCopy` and `resetSharingInCopy`, `deleteReceivedMemory`, and the negative list with each file's route. The one open item there is the `sharing_ledger` read in R-1.
  - Sharing v2, knowledge v8 and `user_version` 7 agree (spec.md:66 and :92; plan.md:56, :73 and :77).
  - Criteria numbering AC-63 to AC-70 is consistent with the plan's phase headers.
- The restore redesign holds against the code, apart from R-3. The existing restore already freezes the live store with `BEGIN IMMEDIATE` before touching the copy (`backup.ts:159-172`) and renames only afterwards (`backup.ts:179-185`). Carrying into the copy under that freeze makes the rename the one commit point, as spec.md:212 and :247 claim, and removes the owed and done marks, `carry.ts` and the `src/sync/` to `src/backup/` import.
- The pull follows the server's real API. `src/team/feed.ts:75-82` caps aliases per pull and accepts `scope` `all` or `project`, where `project` needs exactly one alias. So the main pull with up to 100 aliases and one-alias pulls for the rest (spec.md:165-170) is what the server supports.
- The new shared helpers exist where the spec moves them from.
  - `Timers` is in `src/team/signal.ts:4`, and `Clock` and `fakeTimers` are in `tests/helpers/team.ts:27` and `:41`.
  - `isLoopback` is in `src/team/ids.ts:74`, and `repoFolder` and `fileNameFor` are in `src/team/mirror.ts:77` and `:93`.
  - `openExisting` is in `src/store/db.ts:427`.
  - `spawnCli` is in `tests/helpers/cli.ts:52`.
- One thing to record in ADR 0027, not a return. `repoFolder` in `mirror.ts` depends on `slugify` (`src/modules/knowledge/entry.ts`) and `projectFolderName` (`src/modules/knowledge/repo.ts`). Moving it into `src/team/contract.ts` gives the contract module a dependency on the knowledge module. The contract already imports `src/sharing/types.ts`, so it was never a pure leaf, but the client's `src/sync/` imports of `contract.ts` now reach those files. The boundary test is not affected: it checks imports of `src/team/` from `src/sync/`, and `contract.ts` is allowed.
