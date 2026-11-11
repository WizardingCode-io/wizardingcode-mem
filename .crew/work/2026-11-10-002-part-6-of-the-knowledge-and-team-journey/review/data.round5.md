# data findings for 2026-11-10-002-part-6-of-the-knowledge-and-team-journey
reviewer: review-data
read: 8 files: the rubric; round 4's findings and ruling; src/modules/knowledge/index-store.ts (ReceivedScope, RECEIVED_VISIBLE, browseReceived, searchReceived, receivedByFile, 915-1145); src/sharing/levels.ts (boundAliasesOf, aliasBoundTo, 78-98); src/sync/inbound.ts (applyPage 330-379, pullOnce's hourly re-apply and the instance reset 483-539); src/sync/ledger.ts (pendingRows, writePendingRow, deletePendingRowsUpTo, deletePendingRows, 413-459); src/sync/received.ts (the re-index's passed-by log, 299-317); the call sites of aliasBoundTo and ReceivedScope. Schema and migrations read: every CREATE TABLE and index in src/store/migrations, src/sharing/migrations 0001 and 0002, and src/modules/knowledge/migrations 0006 to 0008. RECEIVED_VISIBLE's new EXISTS is served by sharing_levels' key (project_id, destination) and project_aliases' key (alias). deletePendingRowsUpTo and deletePendingRows filter on the leading server_id column of sharing_pending_rows' key (server_id, seq), over a table that holds only the rows set aside. Risk areas: data-migration, personal-data.

## Findings
none

## Outside the change
none

## Not answerable
- Availability on a large store (Q6) · as in rounds 2 to 4, nothing measures how long the write lock is held when a server with many received memories is removed, on a first full sweep over many entries, or when an old backup is restored. scripts/proof/upgrade-copy.ts measures only the first open of its fixture.
