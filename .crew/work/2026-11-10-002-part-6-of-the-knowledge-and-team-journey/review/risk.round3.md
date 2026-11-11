# risk findings for 2026-11-10-002-part-6-of-the-knowledge-and-team-journey
reviewer: review-risk
read: spec, plan, 5 files

## Findings
- F-1 · advisory · src/sync/inbound.ts:631 · Carried from round 2 because the code has not changed. The "held pull answered at once" rule still measures `ctx.clock.now - server.lastPullAt`, which is the time since the previous answer and not how long this request was held, and the success recorded at :531 resets the failure count first. So when the server already holds its cap of pulls for this device, the rule fires only on every other pull and the interval stays near `backoffMs(1)` instead of doubling as spec.md:187 says. The loop is bounded by the server's own hold and shows in `status`'s last error, so this stays advisory. (Q1/Q4)
- F-2 · advisory · src/sharing/report.ts:402 · Carried from rounds 1 and 2 because the code has not changed. The tick's memory read still names `INDEXED BY sharing_memories_updated` on the core `memories` table. If that index is missing, every tick sweep fails with "no such index" instead of running slowly, and the only traces are `last_error` and the log. docs/adr/0027-sync-client.md:87 now says the migration is unreleased and that a development store must create the index by hand. That bounds the risk, but nothing in the code checks for the index or recovers from its absence. (Q1)

Round 2's upheld data defect is fixed as the code now stands. The hourly re-apply of pending rows (inbound.ts:490-501) now drops each row by its own seq with `deletePendingRow(ctx, serverId, row.seq)`, and only when the outcome is not `retry`. A thrown error leaves the row in place and logs it. A later pending row of the same uid that still fails is therefore no longer lost while the cursor is past its seq. `setServerLists` (src/sharing/store.ts:519-573) now takes `confirm` and refuses a widening inside its `withWrite`, returning `needs-confirm` with the widening, so the check is no longer made outside the lock. The viewer's servers routes answering expected refusals as 200 with `ok: false` (src/ui/servers-api.ts:36-42) is a presentation change and writes nothing. The Settings layout changes carry no production risk.

## Outside the change
- src/store/db.ts:284 · The repository already carried this, and it is unchanged since round 2. The one-time module upgrade (a `VACUUM INTO` copy, then `BEGIN IMMEDIATE`) is paid by whichever process opens the store first, often a session-start hook, and its cost grows with the store's size. This part adds one more run of it, and ADR 0027's Known limits notes the remedy.

## Not answerable
- none
