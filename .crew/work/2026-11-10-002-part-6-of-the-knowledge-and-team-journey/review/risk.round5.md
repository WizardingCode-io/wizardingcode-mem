# risk findings for 2026-11-10-002-part-6-of-the-knowledge-and-team-journey
reviewer: review-risk
read: spec, plan, 7 files

## Findings
- F-1 · advisory · src/sync/inbound.ts:628 · Carried from rounds 2 to 4. The code has not changed (it moved from :627). The "held pull answered at once" rule still measures `ctx.clock.now - server.lastPullAt`, which is the time since the last answer, not how long this request was held. The success that `recordAnswer` writes at :528 has already reset the failure count, so when the server holds its cap of pulls for this device, the interval stays near the first back-off step instead of doubling as spec.md:187 says. The server's own hold limits the loop, and `status`'s last error shows it. (Q1/Q4)
- F-2 · advisory · src/sharing/report.ts:402 · Carried from rounds 1 to 4. The code has not changed. The tick's memory read still forces `INDEXED BY sharing_memories_updated` on the core `memories` table, so on a store without that index every tick sweep fails with "no such index" instead of running slowly. Only `last_error` and the log show the failure. docs/adr/0027-sync-client.md:87 limits this to unreleased development stores, and nothing in the code checks for the index or recovers when it is missing. (Q1)

Round 4's F-3 is closed. When the re-index (src/sync/received.ts:307-314) passes by a project folder that has no manifest alias, it now logs it once per folder ("no manifest alias; its files are not indexed"). The file a later tombstone leaves on disk is therefore visible in the log.

What changed since round 4 adds no risk:
- **Pending rows on the feed path.** `applyPage` (src/sync/inbound.ts:374) now drops a uid's pending rows only up to the applied row's seq, the same rule as the hourly re-apply (:494). An older row that is still set aside can no longer come back over a newer revision. A newer row that still fails stays pending and is retried. A new instance deletes all pending rows (:534), as before. This matches spec.md:185.
- **The strict uid parser.** The client now uses the server's strict parser (`parseEntryUid`, src/team/contract.ts:36-49). Only a uid with a non-host-led alias reads as null, and the server never accepted one, so no stored sent or received row changes meaning. On the client, a null upsert is skipped (inbound.ts:166-167), a null range counts as not read (:316-318), and a tombstone deletes by its row without parsing (:205).
- **The received reads.** `RECEIVED_VISIBLE` (src/modules/knowledge/index-store.ts:949-961) now joins on `l.bound_alias = x.remote_alias`, keyed by the project id. That is a read-only change. Copies under an unbound alias are hidden, not deleted, and a re-bind's snapshot refreshes them. spec.md:193 still says "the callers pass the project and its alias", a stale wording of the same rule, with no production effect.

## Outside the change
- src/store/db.ts:284 · Unchanged since round 2. The one-time module upgrade (a `VACUUM INTO` copy, then `BEGIN IMMEDIATE`) is paid by whichever process opens the store first, often a session-start hook, and it takes longer as the store grows. This part adds one more run of it. The remedy is in ADR 0027's Known limits (docs/adr/0027-sync-client.md:101).

## Not answerable
- none
