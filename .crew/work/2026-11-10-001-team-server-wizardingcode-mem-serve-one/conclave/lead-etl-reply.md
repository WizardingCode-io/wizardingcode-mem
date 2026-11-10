# etl lead's validation of 2026-11-10-001-team-server-wizardingcode-mem-serve-one: spec
verdict: validated
## Returns
none
## Notes
- R-1 holds. The plan names the pull as a `UNION ALL` of one `changes_scope` range per scope. It names `hasChanges` for the wait's emptiness check (plan.md:51, :59), and the `EXPLAIN QUERY PLAN` test (spec.md:138, :267; plan.md:171) covers the pull, the single-alias snapshot and `hasChanges`. That test also seeds a 100,000-row feed and pins the time. The O(page) claim is now provable.
- R-2 holds. spec.md:288 gives the compose-form rollback: copy `/data/backups/team-<time>-v<n>.db` to `team.db` and `rm -f` the `-wal` and `-shm` files, with the reason. It then sets the previous image tag, and the renewal comes from `feed.seq` staying ahead. AC-16 and task 7 walk that path in `tests/unit/team-db.test.ts`.
- R-3 holds. spec.md:192 stores `{ changes, audit }` in `feed.seq`, written after every feed or audit write. `checkRestore` compares both numbers and logs and audits the four numbers. The test restores a copy taken before a revoke with no push in between.
- R-4 holds. plan.md:50 runs `requireTeamSchema` before the version check in every opener. spec.md:129 says the same, and task 7 adds the `openTeamExisting` case on a copied client store.
- R-5 holds. plan.md:105 creates the partial index `entries_pending`. Task 13 asserts its use with `EXPLAIN QUERY PLAN` (plan.md:175).
- My two minor notes were taken as well: `entry_revisions` and `memories` are ordinary rowid tables, and `purgeItem` deletes the revisions before the entry.
- Unchanged and still fine: `team.db` is new, so no client store is copied or dropped. The runner's split in `src/store/db.ts` keeps the order of the pragmas, the migration and `restrict`, and the pinned tests guard it (AC-16, AC-27). Backups go to the team's own folder under the `team` prefix. Revision lookups by `(uuid, hash)` use `entry_revisions_hash`.
- Residual, not blocking: the restore detection still cannot see a restore whose copy was taken after the last feed and audit write. That case loses nothing the database holds, so it needs no detection.
