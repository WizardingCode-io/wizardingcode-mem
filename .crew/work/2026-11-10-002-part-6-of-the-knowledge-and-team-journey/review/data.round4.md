# data findings for 2026-11-10-002-part-6-of-the-knowledge-and-team-journey
reviewer: review-data
read: 9 files: the rubric; round 3's findings and ruling; src/sync/inbound.ts (applyPage 330-378, pullOnce's hourly re-apply 482-498, the instance reset 528-538); src/sync/ledger.ts (pendingRows, writePendingRow, deletePendingRowsUpTo, deletePendingRows, 400-470); src/sharing/levels.ts (boundAliasesOf, aliasBoundTo, 79-106); src/sync/received.ts (filesOf and reindexReceived, 225-334); src/sharing/types.ts (entryUid, 345-355); tests/integration/sync-inbound.test.ts (the two hourly re-apply tests, 762-856). Schema and migrations read: sharing 0002 (sharing_pending_rows with its key (server_id, seq), and the indexes it adds). The other migrations were not re-read this round, and earlier rounds' rulings on them stand. Risk areas: data-migration, personal-data.

## Findings
none

## Outside the change
none

## Not answerable
- Availability on a large store (Q6) · as in rounds 2 and 3, nothing measures how long the write lock is held when a server with many received memories is removed, on a first full sweep over many entries, or when an old backup is restored. scripts/proof/upgrade-copy.ts measures only the first open of its fixture.
