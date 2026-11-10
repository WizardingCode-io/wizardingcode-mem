# data findings for 2026-11-09-002-sharing-policy-per-project-local-only-kn
reviewer: review-data
read: 12 files (the item's own patch `probes/round-one-change.patch`, src/sharing/migrations.ts, src/sharing/migrations/0001_sharing_policy.sql, src/sharing/store.ts, src/sharing/report.ts, src/store/db.ts, src/backup/backup.ts, src/engine/module-schemas.ts, docs/adr/0025-sharing-policy.md, tests/unit/module-migrations.test.ts, src/core/git.ts `normalizeRemote`, and the core and knowledge migrations for their indexes), the schema and migrations read, risk areas: data-migration

## Findings
- F-1 · advisory · src/sharing/report.ts:422 · `ledgerRecords` filters `item_kind = ? AND (destination = ? OR direction = 'received')`. The `OR` on `direction`, and `item_kind` sitting second in the key `(destination, item_kind, item_uid, direction)`, make this a full scan of `sharing_ledger`, which will grow by one row per item sent. ADR 0025 chooses one scan grouped in memory over a list of parameters, and with one destination the scan is about the size of what is needed, so this is a slower query by design, not a missing index (questions 2 and 6). Parts 5 and 6 should check its plan once the ledger fills.
- F-2 · advisory · src/sharing/store.ts:198 · `projectState` reads `project_aliases WHERE project_id = ?`, and `project_aliases` is keyed only by `alias`, with no index on `project_id`. Each call scans the table, and `reconcileLevels` (store.ts:369-371) calls it once per stored level. `entryAliases` (report.ts:171) scans it again with `LIKE 'remote:%'`. The table is small (a few aliases per project), so this costs little today, but it is a new per-row scan of a table that grows with projects (question 2).
- F-3 · advisory · src/sharing/migrations/0001_sharing_policy.sql:51 · No code in the change reads the `sharing_changes_at` index: `recentChanges` orders by `id`, and nothing prunes by `at`. It costs a write on every change with no reader, and `sharing_changes` has no stated retention. It holds no personal data (project ids, levels, list ids), so this is a naming of intent, not a retention defect (question 5).
- F-4 · advisory · src/sharing/store.ts:546 · `resetLevels` leaves the restored copy's `sharing_ledger` as it is. After the generation is renewed, the copy's `memory` rows (`<old generation>:<id>`) can never match an item again. The replaced store's ledger, meaning what was sent after the backup was taken, survives only in the `.replaced-<time>` file. Nothing in this part writes ledger rows, so no data is lost today, and ADR 0025 §Restore states that reconciling the ledger is part 6's job. That hand-off is the one place where items still on the server could go unwithdrawn (question 1, what a restore does).

Checked and found sound:
- The migration is forward-only like the core's, and the reason is stated (ADR 0025 Rollback: 0.6.0 ignores the `sharing_*` tables).
- Its only step on a core table is `INSERT OR IGNORE` into `meta`, so a generation already set by a restore is kept.
- It creates three empty tables under the upgrade's single `BEGIN IMMEDIATE`, so no lock is held across a long step.
- No foreign key or trigger touches a core table.
- The per-schema backup decision (db.ts:305-308) still takes a backup whenever a schema with a recorded version has pending migrations. That includes knowledge on a store left by the withdrawn module (recorded 1-5), and tests/unit/module-migrations.test.ts:112 and :154 pin both cases.
- `resetLevels` runs in one transaction on the unpacked copy before any rename. It writes only `meta` (a v1 core table) on a copy that predates the sharing schema, and sets the counter to `max(floor, copy) + 1`.
- `memoryItems` filters on `memories.project_id`, which the `memories_rank` index leads with.
- `withHashes` and `titlesOf` bind one JSON parameter through `json_each`, never an `IN` list, and the hashes are read in chunks of 500.
- `bound_alias` comes from `normalizeRemote`, which strips `user@` credentials from the remote URL.

## Outside the change
- src/store/migrations/0001_init.sql:14 · `project_aliases` has no index on `project_id`, so every lookup by project scans it. This is old debt that F-2's new queries inherit.

## Not answerable
- Question 6 (availability), measured: the 60 ms figure for 90,000 memories covers `wouldLeave` with an empty ledger. No figure exists for `ledgerRecords` over a full ledger, because this part writes no ledger rows.
