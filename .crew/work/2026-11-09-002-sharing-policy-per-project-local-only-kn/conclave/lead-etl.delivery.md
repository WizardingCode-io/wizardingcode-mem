# etl lead's validation of 2026-11-09-002-sharing-policy-per-project-local-only-kn: delivery
verdict: validated
## Returns
none
## Notes
- The data change is additive and forward-only. `src/sharing/migrations/0001_sharing_policy.sql:1-51` creates `sharing_levels`, `sharing_ledger` and `sharing_changes`. They have no foreign keys and no triggers on core tables (header, lines 1-4). `src/engine/module-schemas.ts:11-14` registers the `sharing` namespace beside knowledge. `user_version` stays 7, as AC-1 requires, so a 0.6.0 binary still opens the store and ignores these tables.
- Primary keys match the queries. `sharing_levels` is keyed by (project_id, destination), and `sharing_ledger` by (destination, item_kind, item_uid, direction). Both are `WITHOUT ROWID`. Level values are checked in code and noted in the SQL comment (line 7).
- Gates passed on the merged tree (`report.md:59-66`): build, test, lint, typecheck and the plugins test. Lint is a pass with one untouched file with problems, none of the item's. The e2e skip is a standing decision of the author (`report.md:67`, `report.md:254`).
- The data judgement gate is proven (`report.md:79`). `review/data.findings.md:6-8` holds three advisory findings carried from earlier rounds and no defects:
  - `ledgerRecords` has an OR filter, so the primary key cannot serve it and it scans the whole ledger (`src/sharing/report.ts:434`).
  - The `sharing_changes_at` index (`0001_sharing_policy.sql:51`) has no reader.
  - No retention is stated for `sharing_ledger` or `sharing_changes` (`0001_sharing_policy.sql:22`).
  - All three cost nothing today, because this item writes no ledger row. Part 6 must bound the query, drop or use the index, and state the retention before it writes.
- Round four changed only `levelRefusal` (`review/data.findings.md:11`). No table, query or transaction changed, and the data reviewer found no stored data lost or misread.
- Restore: `resetLevels` runs on the copy before the swap and works on a copy with no sharing tables (`review/data.findings.md:13`). AC-12 and AC-20 pin this.
- One measurement is missing, and it does not block. The 90,000-memory count was measured with some ledger rows, not a full ledger (`review/data.findings.md:21`). The cost of F-1 at that size is estimated. Part 6 should measure it when the ledger fills.
- `report.md:135` prints "judgement 4 of 2" for the rounds. That is the engine's count, not a data defect, and I did not treat it as one.
- Outside this item and not blocking: a restored store stays in DELETE journal mode (`src/store/db.ts:116`), which predates the item (probes/restore-journal-mode.md).
