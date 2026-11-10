# etl lead's validation of 2026-11-10-001-team-server-wizardingcode-mem-serve-one: delivery
verdict: validated
## Returns
none
## Notes
- The schema is new, so there is no data to reverse. `src/team/migrations/0001_team_init.sql:1-70` creates `team.db` and touches no client store. The plan's indexes are all there: `entries_pending` (:31), `entry_revisions_hash` (:43), `entry_revisions_seq` (:44), `changes_key` (:63) and `changes_scope` (:64). `changes.seq` (:54) and `audit.id` (:67) are `AUTOINCREMENT`. `entry_revisions` and `memories` are ordinary rowid tables, as I asked at the spec.
- The upgrade copies are split by prefix. `src/store/db.ts:75-87` names them `<prefix>-<ms>-v<n>-<pid>.db` and prunes each prefix on its own. `src/team/db.ts:37-39` sends the team's copies to its own `backups/` with the `team` prefix. This closes round 1's F-11. `tests/unit/team-db.test.ts:79` and `:316` pin the name.
- Restore detection is in one transaction and heals itself. `src/team/instance.ts:60-64` sets the instance, advances the sequence by 1,000,000 and writes the audit row in a single `transaction` (round 1 F-13). It then rewrites `feed.seq` with the database's marks. `checkRestore` (:74-91) compares both marks. `advanceSequence` inserts the `sqlite_sequence` row when there is none (`src/team/store.ts:71-80`). Two tests prove this: `tests/unit/team-db.test.ts:334` and `tests/integration/team-pull.test.ts:456`.
- The feed's cost per page is proven:
  - `feedSql` (`src/team/store.ts:849-867`) reads one bounded `changes_scope` range per scope.
  - `hasChanges` (:877) reuses it with limit 1.
  - `markPurged` (:896-903) now uses a key range that `changes_key` can serve (round 1 F-4).
  - `tests/integration/team-pull.test.ts:301-320` runs `EXPLAIN QUERY PLAN` on the pull, the snapshot and the wait's check, and runs the pull against a 100,000-row feed.
  - The pending query's partial index is asserted at `tests/integration/team-mirror.test.ts:580`.
- Move tombstones can no longer collide with other keys. `MEMORY_UID` is `^[0-9a-f]{8}:\d{1,18}$` (`src/team/ids.ts:56`, enforced at `src/team/validate.ts:183`). A memory uid therefore cannot hold `@`, and `<key>@<revision>` (`src/team/push.ts:271`, `:372`) cannot be another memory's key (round 1 F-5).
- The data gate's two defects are fixed:
  - Round 1 F-1, the lease order: `purgeItem` (`src/team/mirror.ts:669-719`) takes the mirror lease before anything is erased.
  - Round 3 F-1, a second purge overwriting the owed-replay note: `noteOwed` (`src/team/mirror.ts:397-408`) adds this purge's folders to the existing note inside the erasure's transaction. An unreadable note becomes the rebuild mark. `runMirror` replays any owed folders before it exports (:465-474), and the note is cleared only after a replay with no failure (:588).
  - The `purged` audit row is now written inside the same transaction (:688-694, round 1 F-3).
  - `wal` reports `truncated` when either checkpoint cut the log (:717, round 3 F-3).
- Retention of the personal data is now stated. ADR 0026 line 94 says the audit table keeps the address of every join and refused join for the life of the database. Erasure is the operator's job with a shell, and pruning is a D-25 follow-up (round 1 F-2). Line 78 states what a purge does not reach: the upgrade copies and the clones of the volume. With `secure_delete` on (`src/team/db.ts:75`) and the two truncating checkpoints, the erased rows' bytes do not survive in the live file.
- The rollback is in compose form (ADR 0026 line 98). It copies a `team-…` backup, removes the `-wal` and `-shm` files, sets the previous tag and lets `feed.seq` force a renewal. This matches what I asked for in R-2 at the spec.
- The gates on the merged tree are recorded as passed in `report.md:51-60` (build, the full `bun run test`, typecheck) and `report.md:71` (the data judgement gate proven in round 5).
- One advisory remains, and I keep it as a note, not a return. `tests/unit/team-db.test.ts:202` exercises `checkpointWal` only with no reader holding the log. It does not test a held reader, or a throw restoring the busy timeout in the `finally`. The code at `src/team/store.ts:637-648` handles both, and the server's tick is wrapped in a try/catch. A follow-up test of the held-reader path is worth adding.
- Not answerable at this stage: whether a later team migration holds the write lock too long. Only migration 1 exists, and it creates a new file.

Files read (all under /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/):
- src/team/migrations/0001_team_init.sql
- src/team/store.ts
- src/team/instance.ts
- src/team/mirror.ts
- src/team/db.ts
- src/store/db.ts
- docs/adr/0026-team-server.md
- .crew/work/2026-11-10-001-team-server-wizardingcode-mem-serve-one/report.md
- .crew/work/2026-11-10-001-team-server-wizardingcode-mem-serve-one/review/data.round1.md
- .crew/work/2026-11-10-001-team-server-wizardingcode-mem-serve-one/review/data.round3.md
- .crew/work/2026-11-10-001-team-server-wizardingcode-mem-serve-one/review/data.findings.md
- .crew/work/2026-11-10-001-team-server-wizardingcode-mem-serve-one/review/ruling.json
