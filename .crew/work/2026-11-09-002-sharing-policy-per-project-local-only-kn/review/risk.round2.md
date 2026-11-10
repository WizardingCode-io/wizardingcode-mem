# risk findings for 2026-11-09-002-sharing-policy-per-project-local-only-kn
reviewer: review-risk
read: spec, plan, 8 files

## Findings
- F-1 · advisory · .crew/work/2026-11-09-002-sharing-policy-per-project-local-only-kn/spec.md:359 · The rollback text says that after a re-upgrade "the levels, if a v7 copy was restored, are Nothing", but that is only true for a copy taken before this release. If the person rolls back to 0.6.0 and restores a backup taken under this release, 0.6.0's `restoreBackup` has no `resetLevels`. So the copy's `sharing_levels` rows, its counter and its unrenewed `sharing.generation` come back with no `restore` row in `sharing_changes`. On re-upgrade those levels are in force again, and memory uids from the two lives of a row id collide. That collision is the case the generation exists to prevent. The ADR's Rollback paragraph (docs/adr/0025-sharing-policy.md:56) does not mention this either. It stays advisory because nothing leaves in this part and the levels can be seen and lowered in the viewer and in `share status`. Parts 5 and 6 should not treat a stored generation as proof that no restore happened.

## Outside the change
- src/store/db.ts:177 · `openDb` turns WAL on only when it creates a database, and a `VACUUM INTO` copy is written in rollback-journal mode. So every restored store, with or without this item, stays in DELETE journal mode, and the hooks then compete for one lock. The item's own `PRAGMA journal_mode = DELETE` at src/backup/backup.ts:122 changes nothing here (probes/restore-journal-mode.md shows this). This is debt the repository already had, and the first round's judge moved it to its own item.
- src/store/db.ts:12659 (diff line; `migrateModules`, part 1's runner, item 2026-11-08-003) · Module migrations now run on every `openDb`, hooks included. The sharing migration's plain `CREATE TABLE` (no `IF NOT EXISTS`) would fail on a store that holds the tables but not the module row. A failure there makes every hook fail open, so memory is silently not injected. Only `doctor` and the log would show it. No state the product writes leads there today, so this is noted only as what the runner carries.

## Not answerable
- Question 1, the loader's 20 ms target over about ninety projects · The spec says the gate measures it and no test pins it. No gate report with that figure was among the review inputs, so I cannot confirm that the first `GET /api/overview` (which now loads the policy) or `GET /api/sharing` (which also runs the git refreshes) stays within the viewer's budget on the person's store.

Notes for the judge. Every risk-bearing path this item adds has a stated rollback or limit:
- **Restore.** Levels are reset before the swap. A reset that throws fails the restore with nothing renamed. The counter never goes back, and the baseline is set to the env file's current lists.
- **Settings write.** It is in one transaction with the file written last. A crash between the file write and the commit is recorded later with source `file`; the spec states this.
- **Hand edits and downgrades.** Both are logged, and `doctor` warns while either is pending.
- **No third party and no hands at deploy.** No network call is made, every default is `local`, and nothing needs to be done at deploy.
- **Migration down path.** There is none. The stated reason is that 0.6.0 ignores the tables and `user_version` stays 7.

None of the findings fall in the sibling item's paths (2026-11-09-001).
