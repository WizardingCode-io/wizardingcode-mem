# data findings for 2026-11-11-005-share-a-project-without-a-git-remote-tod
reviewer: review-data
read: 14 files, the schema and migrations read (src/store/migrations/0008_shared_names.sql with src/store/db.ts; src/sharing/migrations/0003_sharing_names.sql with src/sharing/migrations.ts; src/team/migrations/0002_team_names.sql with src/team/db.ts; src/modules/knowledge/migrations/0008_knowledge_received.sql), risk areas: data-migration, personal-data

## Findings
- F-1 · advisory · src/sharing/report.ts:681 · Carried from round 1 and unchanged. `importedStayCounts` filters `memories` on `status = 'active' AND origin = 'imported'` (line 688), and no index covers `origin`. Each `wouldLeave` (each dock preview, `share project`, `status`) therefore makes one full pass over the memories table, which keeps growing. The result is correct; only the cost grows (rubric Q2).
- F-2 · advisory · src/team/routes.ts:73 · Carried from round 1 and unchanged. `nameItemOf` calls `nameCountsOf` (two queries) and `memberById` for each row, so `GET /v1/names` makes up to 3×200 queries per page. Each query uses an index (`entries_project`, `memories_project`, the primary key), and ADR 0028's "What building changed from the plan" now states this choice, so it stays an advisory (rubric Q2, per-row reads in a list path).
- F-3 · advisory · src/sync/ledger.ts:2208 (diff line; `receivedNameCounts`) · Carried from round 1 and unchanged. It filters `knowledge_received` by `server_id` and `remote_alias`. The only indexes are `(project_id, server_id)`, `id`, `fts_rowid` and the `(server_id, uid)` primary key, so each bound name walks all of that server's received entries twice: once for the count, once for `DISTINCT member_id`. This runs on every `status`, `doctor` and Servers read (rubric Q2).

The round-1 points are now closed, and I checked each against the code:
- `clearServerLedger` (src/sync/ledger.ts:841-845) now deletes the three `names.<state>:<serverId>:` flags by an exact `substr` prefix, inside the removal's transaction. The prefix ends in a colon, so a server id that is a prefix of another server id cannot match its keys.
- The restore (src/backup/backup.ts:238) now also clears `names.%` in the copy. No other `meta` key in `src/` starts with `names.`, so the case-folding `LIKE` matches only these flags.
- ADR 0028 "The erasure of a name, and its limit" now names the creating member and device kept in the purged `names` row, and ties how long they are kept to ADR 0026 D-19. That settles the retention question for the new personal-data columns (rubric Q5).

Checked again and still sound:
- Team migration 2 renames four columns. `RENAME COLUMN` carries `changes_scope` with it, and no data is dropped. The step is forward-only, and the reason is stated beside it in ADR 0026 "Rollback" and ADR 0028 "The schemas and the rollbacks" (the upgrade copy, and a 0.7.0 image exits 3).
- `names.id` is `UNIQUE`, which gives `nameIdInUse` its index. The two partial indexes match the `nameCountsOf` predicates.
- Client migration 8's partial unique index cannot fail on existing data, because no earlier code writes a `name:` alias.
- Sharing 3 adds a nullable column, and `nameIdColumn` reads `NULL` on an older namespace.
- `setLevel` writes the alias row before the level row, in one `withWrite`. The `dryRun` path is a deferred transaction that writes nothing.
- `forgetName` is one write transaction.
- `POST /v1/names` and `serve purge name` each run in one transaction with no network call inside it.
- `foreign_keys` covers the creator references, and no code path deletes members or devices.

## Outside the change
none

## Not answerable
none
