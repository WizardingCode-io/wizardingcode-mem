# data findings for 2026-11-10-002-part-6-of-the-knowledge-and-team-journey
reviewer: review-data
read: 9 files: the rubric; round 2's findings and ruling; src/sync/inbound.ts (applyRow, applyPage, pullOnce's hourly re-apply, lines 100-550); src/sync/ledger.ts (the pending-row writers, 400-460); src/sync/received.ts and src/sync/conflicts.ts (checked for any revision guard); tests/integration/sync-inbound.test.ts (the pending-row tests, 356-383, 762-809, 877-937); the table sharing_pending_rows in src/sharing/migrations/0002_sharing_servers.sql. Schema and migrations read: sharing 0002's pending-rows table. The migrations were not re-read in full this round, and round 2's findings on them stand as ruled. Risk areas: data-migration, personal-data.

## Findings
- F-1 · defect · src/sync/inbound.ts:497 · The round-2 fix fails in the opposite order. The hourly re-apply now drops only the row it just applied, by its seq, and nothing in applyRow, writeReceived or applyOwnRevision checks that a payload is newer than what is stored (they compare only the hash). So when an older pending row of a uid fails for a passing reason (say a busy database or a git lock) and a newer pending row of the same uid applies, the older row stays set aside. When it applies at a later hour it overwrites the teammate's newer revision. If the newer row was a tombstone or a purge, it brings back the received copy of an entry or memory the server deleted or erased. The cursor is already past both seqs, so nothing corrects this until the item changes again. Round 2's delete by uid prevented this case, and the main path (applyPage, line 372) still drops every pending row of the uid. The new test (sync-inbound.test.ts:762) covers only "older applies, newer fails". The fix is to delete the uid's pending rows with seq at or below the applied row's seq (`uid = ? AND seq <= ?`), not the one seq (Q1 data loss, Q5 erasure).

## Outside the change
none

## Not answerable
- Availability on a large store (Q6) · as in round 2, there is no figure for a server removal with many received memories, a first full sweep over many entries, or a restore of an old backup under the live write lock. scripts/proof/upgrade-copy.ts measures only the first open on its fixture.
