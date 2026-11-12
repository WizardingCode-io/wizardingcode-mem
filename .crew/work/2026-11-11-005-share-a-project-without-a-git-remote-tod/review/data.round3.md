# data findings for 2026-11-11-005-share-a-project-without-a-git-remote-tod
reviewer: review-data
read: 9 files (the rubric, the round-2 findings and ruling, files.txt, the three migrations, src/sync/ledger.ts around the counts and the server removal, plus a grep of the round-2 sites in src/sharing/report.ts, src/team/routes.ts and src/backup/backup.ts), the schema and migrations read (src/store/migrations/0008_shared_names.sql, src/sharing/migrations/0003_sharing_names.sql, src/team/migrations/0002_team_names.sql), risk areas: data-migration, personal-data

## Findings
- F-1 · advisory · src/sharing/report.ts:681 · Carried from rounds 1 and 2 and unchanged. `importedStayCounts` filters `memories` on `status = 'active' AND origin = 'imported'`, and no index covers `origin`. Each `wouldLeave` call (a dock preview, `share project`, `status`) therefore reads the whole memories table, which keeps growing. The result is correct; only the cost is affected (Q2).
- F-2 · advisory · src/team/routes.ts:73 · Carried and unchanged. `nameItemOf` runs `nameCountsOf` (two queries) and `memberById` once per row, so one page of `GET /v1/names` can make up to 3×200 queries. Each query uses an index (`entries_project`, `memories_project`, the primary key), and ADR 0028 records this choice (Q2, per-row reads in a list path).
- F-3 · advisory · src/sync/ledger.ts:626 · Carried and unchanged (round 2 cited it as diff line 2208). `receivedNameCounts` filters `knowledge_received` on `server_id` and `remote_alias`. No index covers `remote_alias`, so each bound name reads all of that server's received entries twice: once for the count (line 630) and once for `DISTINCT member_id` (line 636). This runs on every `status`, `doctor` and Servers read (Q2).

I re-checked each item below against the code for round 3. None of them changed after round 2, so the round-2 statement that no SQL, migration or query changed holds for these sites:
- **Team migration 2.** The file is the same as in round 2: four `RENAME COLUMN` steps and the `names` registry. `id` is `UNIQUE` and the creator columns use `REFERENCES`. It adds two partial indexes that match the `nameCountsOf` predicates. The step is forward-only, and ADR 0026 "Rollback" and ADR 0028 state why. No data is dropped (Q1).
- **Client migration 8.** The partial unique index matches by `substr`, not `LIKE`, so it cannot fail on existing rows: no earlier code writes a `name:` alias (Q1, Q6).
- **Sharing 3.** It adds one nullable `name_id` column, which needs no backfill and holds no lock across a long step (Q4, Q6).
- **`clearServerLedger`** (src/sync/ledger.ts:841-845). It still deletes the three `names.<state>:<serverId>:` flags by an exact `substr` prefix that ends in a colon, inside the removal's transaction.
- **The restore** (src/backup/backup.ts:238). It still clears `names.%` in the copy.
- **Personal data.** The `names` row keeps the creating member and device. ADR 0028 "The erasure of a name, and its limit" still ties how long they are kept to ADR 0026 D-19 (Q5).

## Outside the change
none

## Not answerable
none
