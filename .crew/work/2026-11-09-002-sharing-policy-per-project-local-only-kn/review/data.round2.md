# data findings for 2026-11-09-002-sharing-policy-per-project-local-only-kn
reviewer: review-data
read: 12 files (the rubric, criteria-round-three.md, files.txt, probes/restore-journal-mode.md; the diff's hunks for src/store/db.ts, src/store/migration.ts, src/store/meta.ts, src/backup/backup.ts, src/cli/commands/backup.ts, src/cli/commands/compact.ts and README.md; src/sharing/migrations/0001_sharing_policy.sql, src/sharing/migrations.ts, src/engine/module-schemas.ts, src/sharing/store.ts and src/sharing/report.ts read whole; the queries in src/sharing/policy.ts, src/status/report.ts and the callers in src/ui/api.ts and src/sharing/in-force.ts). Schema and migrations read: src/store/migrations/0001_init.sql (memories_rank, project_aliases, meta) and 0007_links.sql (user_memories). Risk areas: data-migration, personal-data.

## Findings
- F-1 · advisory · src/sharing/report.ts:434 · `ledgerRecords` filters `item_kind = ? AND (destination = ? OR direction = 'received')`. Because of the OR, SQLite cannot use the primary key `(destination, item_kind, item_uid, direction)`, so every `wouldLeave` (status, `share status`, the viewer's Sharing page and its previews) reads the whole `sharing_ledger`, a table that grows by one row per item sent or received (rubric Q2). This is by design: one grouped scan instead of a bound uid list, and the ledger stays empty until part 6 writes it. So this is an advisory for part 6. Either add an index on `(item_kind, direction)`, or split the query into two indexed halves joined with `UNION ALL`, and state why.
- F-2 · advisory · src/sharing/migrations/0001_sharing_policy.sql:22 · Neither the migration nor ADR 0025 states how long `sharing_ledger` and `sharing_changes` are kept, and `compact` prunes neither (rubric Q5). Neither table holds any memory or entry text: the ledger holds uids and the hash of redacted text, and the log holds project ids, levels and root/area lists. `bound_alias` repeats a remote alias that is already in `project_aliases`, and it is deleted with its row when the level goes to Nothing. So no personal data is left without a retention rule. Still, the log grows with every person's change and has no stated limit, and the ledger will grow once part 6 writes it.
- F-3 · advisory · src/sharing/store.ts:373 · `reconcileLevels` runs `projectState` (two queries) for each stored level, and it does so inside a `BEGIN IMMEDIATE` that `policyInForce` takes every time the viewer or `share` reads the policy, even when nothing changes (rubric Q2/Q3). There is at most one row per project, so the cost is small. But it is a per-row lookup plus a write lock on every read, where one join over `sharing_levels`, `projects` and `project_aliases`, with the write taken only when a row has to go, would do.

What I checked and found sound:
- Migration 1 only creates tables and has no destructive step. It is forward-only, which `SHARING_MIGRATIONS` states, like the core migrations.
- `user_version` stays 7.
- `migrateModules` decides the pre-migration backup from each schema's own recorded version. The sharing schema's first migration takes no backup; a later one, or a knowledge migration past version 0, does.
- `mintGeneration` uses INSERT OR IGNORE, so a generation that `resetLevels` already put into an old copy is kept.
- On restore, `resetLevels` runs on the unpacked temporary copy before the swap, as one short transaction. The counter is kept monotonic, and a failed reset renames nothing.
- `memoryItems` pre-filters `project_id IN json_each(?)` on the `memories_rank` prefix and reads no title or body.
- `withHashes` and `titlesOf` read by primary key, in chunks of 500 or fewer.
- `user_memories` is joined on its primary key.
- `applySettingsPatch` holds its write transaction across a local env-file write only, never across a network call.

## Outside the change
- src/store/db.ts:12567 (diff line; the `if (current === 0) enableWal(...)` in `migrate`) · Debt, not this item's: `openDb` turns WAL on only when it creates a database. The session's probe (probes/restore-journal-mode.md) shows that a `VACUUM INTO` backup copy is already in rollback-journal mode, so every restore, with or without this item's `PRAGMA journal_mode = DELETE` in `resetSharingInCopy` (src/backup/backup.ts), leaves the live store out of WAL. The fix is to check the journal mode on every open and turn WAL on when it is off.
- src/sharing/report.ts:176 · Debt, minor: `entryAliases` filters `project_aliases` with a case-insensitive `LIKE 'remote:%'`, which cannot use the `alias` primary key. The table is small (one row per alias).

Sibling item 2026-11-09-001 (src/modules/knowledge/, including 0007_knowledge_agent.sql, src/judge/, src/mcp/): not reviewed here. The two knowledge-table queries in src/sharing/report.ts (`readEntries`, `areaTotals`) are this item's. They join `knowledge_entries` to `knowledge_repos` on `repo_id`; that join's indexes belong to the knowledge migrations, which the sibling's review covers.

## Not answerable
none
