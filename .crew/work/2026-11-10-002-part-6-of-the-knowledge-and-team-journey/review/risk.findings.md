# risk findings for 2026-11-10-002-part-6-of-the-knowledge-and-team-journey
reviewer: review-risk
read: spec, plan, 6 files

## Findings
- F-1 · advisory · src/sync/inbound.ts:628 · Carried from rounds 2 to 5. The code has not changed. The "held pull answered at once" rule still computes `ctx.clock.now - (server.lastPullAt ?? 0)`, which is the time since the last answer, not how long this request was held. When the server holds its cap of pulls for this device, the interval therefore stays near the first back-off step instead of doubling as spec.md:187 says. The server's own hold limits the loop, and `status`'s last error shows it. (Q1/Q4)
- F-2 · advisory · src/sharing/report.ts:402 · Carried from rounds 1 to 5. The code has not changed. The tick's memory read still forces `INDEXED BY sharing_memories_updated` on the core `memories` table. On a store that lacks that index, every tick sweep fails with "no such index" instead of running slowly, and only `last_error` and the log show the failure. docs/adr/0027-sync-client.md:87 limits this to unreleased development stores, and no check in the code detects the missing index or recovers from it. (Q1)

What changed since round 5 adds no risk:
- **Sharing card.** The last-change wording moved to `serverChange` in ui/src/sharing-text.ts, and Sharing.vue:100 calls it. It is display text only.
- **Knowledge tools.** src/modules/knowledge/tools.ts:213 and :284 now build `{ projectId: context.projectId }` inline. That is the same `ReceivedScope` that src/modules/knowledge/contribute.ts:238 builds, so the received reads return the same rows.
- **No runtime change.** Making `ENTRY_UID` private in src/team/contract.ts, putting the server test's import back to the base's, and the sixth-round bullet in docs/adr/0027-sync-client.md change nothing at runtime.
- **spec.md:193.** It now reads "the callers pass the project; the index reads its binding", which matches the code. Round 5's note on the stale wording is closed.

## Outside the change
- src/store/db.ts:284 · Unchanged since round 2. The one-time module upgrade (a `VACUUM INTO` copy, then `BEGIN IMMEDIATE`) is paid by whichever process opens the store first, often a session-start hook, and it takes longer as the store grows. This part adds one more run of it. The remedy is in ADR 0027's Known limits (docs/adr/0027-sync-client.md:101).

## Not answerable
- none
