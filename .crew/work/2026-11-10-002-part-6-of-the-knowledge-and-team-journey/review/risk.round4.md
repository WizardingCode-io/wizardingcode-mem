# risk findings for 2026-11-10-002-part-6-of-the-knowledge-and-team-journey
reviewer: review-risk
read: spec, plan, 6 files

## Findings
- F-1 · advisory · src/sync/inbound.ts:627 · Carried from rounds 2 and 3 because the code has not changed (it moved from :631). The "held pull answered at once" rule still measures `ctx.clock.now - server.lastPullAt`, which is the time since the previous answer, not how long this request was held, and the success recorded at :527 resets the failure count first. So when the server already holds its cap of pulls for this device, the rule fires only on every other pull and the interval stays near `backoffMs(1)` instead of doubling as spec.md:187 says. The server's own hold bounds the loop, and the loop shows in `status`'s last error, so this stays advisory. (Q1/Q4)
- F-2 · advisory · src/sharing/report.ts:402 · Carried from rounds 1 to 3 because the code has not changed. The tick's memory read still names `INDEXED BY sharing_memories_updated` on the core `memories` table, so a store without that index fails every tick sweep with "no such index" instead of running slowly, and the only traces are `last_error` and the log. docs/adr/0027-sync-client.md:87 limits this to unreleased development stores, which must create the index by hand. Nothing in the code checks for the index or recovers when it is missing. (Q1)
- F-3 · advisory · src/sync/received.ts:305 · A new pass-by in this round. The re-index now skips the files of a received project folder that has no manifest alias and no index row, so they stay on disk with no `knowledge_received` row. A later tombstone or purge of that uid then reaches `deleteReceived` (:189), finds no row, and leaves the file, which nothing logs or counts. The store writes the manifest before any file (`ensureFolder`, :128-131), so only a manifest removed by hand gets here, and `share server remove` (`deleteServerReceived`) still removes the whole folder. That bounds the risk, but a log line for the skipped folder would make the leftover visible. (Q1/Q3)

The fix for round 3's data defect holds in the current code. The hourly re-apply (src/sync/inbound.ts:486-498) reads the pending rows oldest first. When a row applies, the loop calls `deletePendingRowsUpTo` (src/sync/ledger.ts:439-452), which runs `DELETE … WHERE server_id = ? AND uid = ? AND seq <= ?`. That drops the applied row and every older row of its uid, and it keeps any newer row that still fails. An older row that stayed pending can therefore no longer be applied over a later revision, a tombstone or a purge. A row that answers `retry`, or that throws, stays where it is and is logged. This matches spec.md:185 ("dropped by a later row of the same uid") and the main path at :373.

The narrower `aliasBoundTo` (src/sharing/levels.ts:96-106) now joins on `l.bound_alias`, the same rule as `boundAliasesOf`. On a development store, copies filed under a project's other alias can now be reconciled as unbound and deleted. They are teammates' copies that a re-bind or a snapshot pulls again, so nothing is lost for good.

`failureAnswer` (src/sync/state.ts:202-211) produces the same error, `retryAfterMs` and `requestId` that the copies it replaces wrote, so the back-off does not change.

## Outside the change
- src/store/db.ts:284 · This risk was already in the repository and has not changed since round 2. The one-time module upgrade (a `VACUUM INTO` copy, then `BEGIN IMMEDIATE`) is paid by whichever process opens the store first, often a session-start hook, and it takes longer as the store grows. This part adds one more run of it. ADR 0027's Known limits (docs/adr/0027-sync-client.md:100) gives the remedy.

## Not answerable
- none
