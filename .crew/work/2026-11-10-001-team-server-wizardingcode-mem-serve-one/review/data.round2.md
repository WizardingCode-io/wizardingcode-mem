# data findings for 2026-11-10-001-team-server-wizardingcode-mem-serve-one
reviewer: review-data
read: 16 files, the schema and migrations read (src/team/migrations/0001_team_init.sql, src/team/db.ts, the split runner in src/store/db.ts, docs/adr/0026-team-server.md "The data model", "Purge", "The boundary", "Follow-ups"; spec D-19, D-24 to D-26), risk areas: data-migration, personal-data

## Findings
- F-1 · advisory · src/team/mirror.ts:621 · The purge's erasure transaction commits at line 620, and the repositories are removed only at line 485 inside `replayFolders`. If the process dies between the two, the purged text stays in `repos/` history, and nothing durable records that a replay is owed: there is no meta marker like `REBUILD_MARK`, and a second `serve purge` answers 404 `unknown`. A replay that fails part way (a git failure, or a lost lease at line 512) leaves its folders partly rebuilt. Later normal runs never rebuild them, because they export only pending revisions, so the mirror drifts until someone runs `--rebuild`. That failure is recorded only in `mirror.last` and in the command's output. Writing the touched folders to a meta key inside the transaction and clearing it after the replay would make the owed replay durable and let the next run finish it (rubric questions 1 and 5; this is what remains of round 1's F-1).
- F-2 · advisory · src/team/db.ts:74 · `secure_delete` overwrites the erased rows in the pages the delete writes. It does not overwrite older WAL frames that still hold the text from the original write, and the WAL file is never truncated, so those frames can stay on disk past the purge. ADR 0026 line 78 says the rows "are overwritten in the file and the WAL". A `PRAGMA wal_checkpoint(TRUNCATE)` after the purge would make that true; otherwise the ADR should narrow its claim (rubric question 5).
- F-3 · advisory · src/team/store.ts:606 · `forEachRevision` keeps one read statement open across the whole purge replay. The replay walks the full history and makes git calls, which ADR line 74 puts at about 35 minutes at the pilot's size. The connection's read snapshot is pinned for that time, so the server's writes keep landing in a WAL that cannot checkpoint past it, and the WAL grows. Reading in `seq` batches would release the snapshot between them (rubric question 6).
- F-4 · advisory · src/team/mirror.ts:357 · `pendingRevisions` still loads the frontmatter and body of every pending revision into one array before sorting. After `--rebuild` (line 420 resets every mark), that is the whole history in memory. This is the part of round 1's F-9 that the replay's change did not cover. `allRevisions` (store.ts:599) is now unused (rubric question 6).
- F-5 · advisory · src/team/migrations/0001_team_init.sql:3 · `members.name` is personal data, and it is copied into the mirror's commit author lines (mirror.ts:252) and into `members/<id>-<slug of name>/` folder names. D-19 states that attribution is kept when a member is disabled, which gives the column a retention. Neither the spec nor the ADR states how a person's name is erased from the row or from git history, and purge does not reach it. The ADR now names this kind of erasure for audit addresses (the operator with a shell), but not for names (rubric question 5).

## Outside the change
none

## Not answerable
- Availability (rubric question 6): whether an upgrade migration of `team.db` holds the write lock across a long step · only migration 1 exists, and it creates a new file, so there is no later migration of a populated `team.db` to judge.

## Round 1
- Upheld F-1 (src/team/mirror.ts:605, purge before the lease): fixed. `purgeItem` now takes `mirror.lease` through `underMirrorLease` (mirror.ts:550) before the transaction (mirror.ts:553). A mirror run in progress therefore refuses the purge before anything is erased. A run that starts later sees no purged revisions, because `pendingRevisions` is read under the same lease. The `purged` audit row is now written inside the erasure transaction (mirror.ts:611). A failed replay is recorded in `mirror.last` and in the result. The narrower crash-window residual is F-1 above, as an advisory.
- Upheld F-2 (0001_team_init.sql:66, `audit.address` without retention): fixed in the ADR. ADR 0026 "The boundary" (line 94) states that the retention is the life of the database, that nothing prunes or purges the audit in this part, and that a person's request to erase their address is served by the operator with a shell. Pruning of the audit table, source addresses included, is named in Follow-ups (line 114).
- Round 1 advisories:
  - F-3 is fixed: the audit row is in the transaction.
  - F-4 is fixed: `markPurged` now uses a range that `changes_key` serves (store.ts:864).
  - F-5 is fixed: `MEMORY_UID` (ids.ts:56) refuses `@` in a memory uid.
  - F-6 is fixed: `pull` reads in one `readTransaction` (feed.ts:147).
  - F-7 is fixed: the aliases are de-duplicated and capped (feed.ts:74-75).
  - F-8 is fixed: the `entries_creator` index (sql:32).
  - F-9 is partly fixed: the purge replay iterates, but `--rebuild` still loads everything (F-4 above).
  - F-10 is fixed: the `mirror.rebuild` marker (mirror.ts:417-421).
  - F-11 is fixed: pruning is per prefix (src/store/db.ts:86-92).
  - F-12 is mostly fixed: `secure_delete` is on writer connections. The WAL claim is overstated (F-2 above), and the upgrade copies are stated as the operator's step.
  - F-13 is fixed: `renewInstance` is one transaction (instance.ts:54-58).
