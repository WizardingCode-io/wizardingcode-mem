# risk findings for 2026-11-09-002-sharing-policy-per-project-local-only-kn
reviewer: review-risk
read: spec, plan, 14 files

## Findings
- F-1 · advisory · .crew/work/2026-11-09-002-sharing-policy-per-project-local-only-kn/spec.md:359 · The rollback text (also docs/adr/0025-sharing-policy.md:56) says that after a 0.6.0 interlude the levels "are Nothing" if a copy was restored. That does not hold for the most likely copy. Once upgraded, the scheduled backups are v7 files that carry `sharing_levels`, `sharing.counter` and `sharing.generation`. 0.6.0's `restoreBackup` accepts such a file and has no `resetLevels`. So on re-upgrade the copy's old levels take force with no `restore` row, its lower counter can repeat an earlier epoch, and its generation is not renewed, which gives reused memory ids the uids they had before. Nothing leaves in this part, so no data is exposed today. But the spec promises a reset that does not happen on this path, and the ADR should name it before parts 5 and 6 rely on the epoch and the generation.

## Outside the change
- src/store/db.ts:177 · After any restore the store stays in rollback-journal mode, because `openDb` turns WAL on only for a new database. The probe (probes/restore-journal-mode.md) shows this predates this item: the `PRAGMA journal_mode = DELETE` at src/backup/backup.ts:122 changes nothing about it. The first round's judge already made it its own item. Debt.
- src/store/db.ts:323 · Part 1's module runner (item 2026-11-08-003, not this one) applies every module schema in one transaction on every `openDb`, hooks included, and the `sharing` namespace now rides in it. If any pending module migration fails, `openDb` throws for every caller. The hooks fail open with code 0 and empty stdout, so memory stops with nothing to see in the first hour except `doctor`. This item makes it only slightly more likely (three `CREATE TABLE`s on new names and one `INSERT OR IGNORE` into `meta`). Debt.

## Not answerable
none

Notes for the judge, not findings:
- Q2 (rollback): the `sharing` migration has no down path. The spec states why, at spec.md:360: 0.6.0 opens the store at `user_version` 7 and ignores the tables, and the env keys are kept.
- Q3 (irreversible writes): `restoreBackup` writes to the unpacked copy before the swap. A reset that throws makes the outcome `failed` with nothing renamed. The levels it drops are reported by the CLI and in the viewer's toast.
- Q4 (third parties): this part opens no network.
- Q5/Q6 (deploy dependencies and steps): every default is local and there is no manual step.
- The newline defect from round one is closed: `validatePatch` refuses `\r` and `\n` under every key (src/settings/settings.ts:403).
- `PUT /api/settings` sends any sharing key through `applySettingsPatch` under the write lock with the request's own `confirm` (src/ui/server.ts:432-444).
