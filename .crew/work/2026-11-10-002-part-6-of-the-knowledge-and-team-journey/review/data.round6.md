# data findings for 2026-11-10-002-part-6-of-the-knowledge-and-team-journey
reviewer: review-data
read: 6 files: the rubric; round 5's findings; review/files.txt; src/modules/knowledge/tools.ts (searchKnowledge and getKnowledge, 195-294: the received scope now built inline as `{ projectId: context.projectId }`, the same value and the same ReceivedScope shape as before); src/modules/knowledge/index-store.ts (ReceivedScope, RECEIVED_VISIBLE, browseReceived, searchReceived, receivedByFile, 917-1144, unchanged since round 5); src/team/contract.ts (ENTRY_UID made private to its parser, 26-37, with no stored data involved). For the schema and migrations I relied on round 5's reading of src/store/migrations, src/sharing/migrations 0001 and 0002, and src/modules/knowledge/migrations 0006 to 0008, because this round changed no SQL, schema, transaction or index. The viewer leaf for the Sharing card's last-change rule and the server test's import touch no stored data. Risk areas: data-migration, personal-data.

## Findings
none

## Outside the change
none

## Not answerable
- Availability on a large store (Q6) · as in rounds 2 to 5, nothing measures how long the write lock is held in three cases: removing a server that has many received memories, a first full sweep over many entries, and restoring an old backup. scripts/proof/upgrade-copy.ts measures only the first open of its fixture.
