# data findings for 2026-11-11-005-share-a-project-without-a-git-remote-tod
reviewer: review-data
read: 3 files (round-3 findings, src/ui/api.ts around the `setProjectSharing` change). I did not re-read the migrations, since you stated no SQL, migration or query changed since round 3, and round 3 read them. Risk areas: data-migration, personal-data

## Findings
- F-1 · advisory · src/report.ts:681 (src/sharing/report.ts:681) · Carried from round 3, unchanged. `importedStayCounts` filters `memories` on `status = 'active' AND origin = 'imported'`, and no index covers `origin`, so each `wouldLeave` call reads the whole table. The result is correct; only the cost is affected (Q2).
- F-2 · advisory · src/team/routes.ts:73 · Carried, unchanged. `nameItemOf` runs `nameCountsOf` (two queries) and `memberById` per row, so a page of `GET /v1/names` can make up to 3×200 indexed queries. ADR 0028 records the choice (Q2).
- F-3 · advisory · src/sync/ledger.ts:626 · Carried, unchanged. `receivedNameCounts` filters `knowledge_received` on `remote_alias` with no index, so it reads all of a server's received entries twice per bound name on every `status`, `doctor` and Servers read (Q2).

Checked this round:
- **The new change.** `setProjectSharing` (src/ui/api.ts:1299-1308) now always calls `prepareBinding` then `commitBinding`, with or without `as`. This is the same path the CLI takes, so a bind stores the registry's `name_id` and no longer risks a NULL `name_id` for a carried name. It closes a data-integrity gap and adds no query or schema change. The new case in tests/integration/ui-sharing.test.ts covers it (Q1, Q4).
- **Migrations and personal data.** Nothing changed since round 3, so the round-3 reading of the three migrations, `clearServerLedger`, the restore's clearing of `names.%` and the retention of the creating member and device (tied to ADR 0026 D-19) stands.

## Outside the change
none

## Not answerable
none
