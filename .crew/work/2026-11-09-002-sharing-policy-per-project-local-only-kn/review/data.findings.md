# data findings for 2026-11-09-002-sharing-policy-per-project-local-only-kn
reviewer: review-data
read: 8 files, the schema and migrations read (src/sharing/migrations/0001_sharing_policy.sql, src/sharing/migrations.ts, the round-three data findings and ruling, criteria-round-five.md, src/sharing/policy.ts around levelRefusal, src/sharing/report.ts ledgerRecords, every SQL statement under src/sharing/), risk areas: data-migration, personal-data

## Findings
- F-1 · advisory · src/sharing/report.ts:434 · Carried from round three, unchanged. `ledgerRecords` filters on `item_kind = ? AND (destination = ? OR direction = 'received')`. Because of the OR, the primary key `(destination, item_kind, item_uid, direction)` cannot serve the query, so every `wouldLeave` scans the whole of `sharing_ledger`. The ledger is empty in this item, so this is only a slower query for part 6 to bound, with a second index or two branches over the key (Q2).
- F-2 · advisory · src/sharing/migrations/0001_sharing_policy.sql:51 · Carried, unchanged. No reader in the diff uses `sharing_changes_at`, since `recentChanges` orders by `id`, yet every policy change still pays to write it (Q2).
- F-3 · advisory · src/sharing/migrations/0001_sharing_policy.sql:22 · Carried, unchanged. Neither ADR 0025 nor the migration states a retention or erasure for `sharing_ledger` or `sharing_changes`, and `compact` touches neither table. The ledger will keep uids that carry a project's remote alias, and hashes of redacted memory text. This item writes no ledger row, so no personal data is held without retention yet. Part 6 must state the retention before it writes (Q5).

What changed since round four, and the questions answered with no new finding:
- **The change since round four:** commit b54a579 only touches `levelRefusal` (src/sharing/policy.ts:306-321). A row that reads both `local` and `allowed` now throws instead of mapping to `level-local`. No query, table, write or transaction changed, and the SQL under src/sharing/ is as it was in round three. `decide` stays pure, and the throw can only fire on a pair that `effectiveLevel` never builds, so no stored data is lost, read wrongly or left behind.
- **Migrations (Q1):** the migration is still additive and forward-only, and says why beside it ("Forward-only, like the core's"). The order is fixed by `MODULE_SCHEMAS`. `mintGeneration` is INSERT OR IGNORE, and `user_version` stays 7.
- **Restore:** `resetLevels` runs on the copy before the swap, and it works on a copy that has no sharing tables.
- **Queries, transactions and types (Q2 to Q4):** these are as answered in round three: the memory candidates use `memories_rank`, the hashes are read in chunks of 500 through `json_each`, the knowledge reads sit behind `moduleSchemaState`, and no transaction spans a git refresh.

## Outside the change
- src/store/db.ts:116 · existing debt, advisory. WAL is turned on only when a database is created, so a restored store stays in DELETE journal mode. This was already so before the item (probes/restore-journal-mode.md).
- Sibling item 2026-11-09-001 (src/modules/knowledge/migrations/0007_knowledge_agent.sql, the index writer, src/store/compact.ts) · I read these only for the knowledge indexes that report.ts depends on. No finding of this item falls in the sibling's paths.

## Not answerable
- Q6 availability, the 90,000-memory count with a full ledger · the evidence measures the count with some ledger rows present, but has no figure for a ledger as large as the memory set. F-1's cost at that size is therefore estimated, not measured.
