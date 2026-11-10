# risk findings for 2026-11-09-002-sharing-policy-per-project-local-only-kn
reviewer: review-risk
read: spec, plan, 14 files

## Findings
- F-1 · advisory · .crew/work/2026-11-09-002-sharing-policy-per-project-local-only-kn/spec.md:359 · Neither the spec nor the ADR's rollback paragraph (docs/adr/0025-sharing-policy.md:56) covers this rollback path: after a downgrade to 0.6.0, its restore of a backup taken by this binary does not call `resetLevels`, so the copy's `sharing_levels` rows, its older `sharing.counter` and its old `sharing.generation` all come back. After the next upgrade those levels are in force again with no `restore` row in the log, the counter can drop below epochs already recorded, and memory row ids get a second life under the same generation. Nothing leaves in this part, so this matters only once parts 5 and 6 send; it is advisory, but the spec's sentence "the levels, if a v7 copy was restored, are Nothing" is only true for a copy without levels, and the ADR should name the case.
- F-2 · advisory · src/status/report.ts:247 · `sharingStatus` calls `wouldLeave` with no guard (`loadPolicy` never throws, `wouldLeave` can). A read error in the knowledge index or the ledger would take down the whole `status` command and the viewer's `/api/status`, which worked before this item. The failure would be visible, but the sharing line could fail closed (the default line plus a problem) instead of failing the report.
- F-3 · advisory · src/doctor/checks.ts:962 · The plan (step 18) promises the `sharing` check runs "in its own try", but `sharing(context, db)` sits unguarded in `runChecks`' array. Today the check is safe only because `loadPolicy` never throws and the rest is pure. A later change that throws here would crash the whole `doctor` output instead of giving one `warn` line.

## Outside the change
- src/store/db.ts:177 · `openDb` turns WAL on only when it creates a database. A restored store therefore stays in rollback-journal mode: a `VACUUM INTO` copy is already in DELETE mode, as `probes/restore-journal-mode.md` shows. This predates the item and is tracked as its own item. This item's `PRAGMA journal_mode = DELETE` in `resetSharingInCopy` (src/backup/backup.ts:122) does not change the outcome, but every restore now goes through this path for certain.
- src/settings/env-file.ts:73 · `writeEnvFile` treats any failure to read the file (not only a missing file) as a new file, and replaces the file with just the patch, so the other settings (the TypeSafe key, backup target, modules) are lost. This is old debt; the item adds two callers through `applySettingsPatch` (the `share roots|areas` CLI and `PUT /api/settings` with a sharing key). The sharing lists themselves fail closed: an unreadable file reads as empty lists.

## Not answerable
- none
