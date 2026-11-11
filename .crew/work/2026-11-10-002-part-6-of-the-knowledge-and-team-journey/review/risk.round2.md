# risk findings for 2026-11-10-002-part-6-of-the-knowledge-and-team-journey
reviewer: review-risk
read: spec, plan, 9 files

## Findings
- F-1 · advisory · src/sync/inbound.ts:621 · The check for an empty held page "answered at once" measures `ctx.clock.now - server.lastPullAt`, which is the time since the previous answer, not how long this request was held, and the success recorded at :521 resets `failures` to 0 before the failure is recorded. So when the server already holds its cap of held pulls for this device (for example a hold from a connection that just dropped), the rule fires only on every other pull, and the interval stays at `backoffMs(1)` (about 2 s) instead of doubling to 10 min as spec.md:187 says ("backs off the same way"). The breaker never opens either. The loop is bounded by how long the server keeps that hold and it shows in `status`'s last error, so it is advisory. (Q1/Q4)
- F-2 · advisory · src/sharing/report.ts:402 · Carried from round 1, unchanged: the tick's memory read still names `INDEXED BY sharing_memories_updated`, an index the sharing namespace puts on the core `memories` table. If that index is missing while the module reads v2 (a development store, or a later core rebuild of `memories`), every tick sweep fails with "no such index" instead of running slowly. The only traces are `last_error` and the log. (Q1)

Round 1's two upheld defects are fixed as the code now stands. `compareSnapshot` (inbound.ts:674) gets a `seen`/`tombstoned` set built over every page of a cursor (:566-584) and runs once after the last page (:585), and it also covers received memories (:701-707). The pull loops are kept by server id, and `ensureLoops` runs at every tick that sees a `data_version` change and at every full sweep (run.ts:284, :290, :336-346). Round 1's advisories are also addressed. An apply error other than dirty or locked is now set aside at once as a pending row (inbound.ts:347-351), and `status` counts those rows (report.ts:23). The downgrade limits (knowledge v8 read as too new; `sync stop` before rolling back) are now stated in docs/adr/0027-sync-client.md:98.

## Outside the change
- src/store/db.ts:284 · The one-time module upgrade (a `VACUUM INTO` copy, then `BEGIN IMMEDIATE`) is paid by whichever process opens the store first, often a session-start hook, and its cost grows with the store's size. The repository already carried this; this part adds one more run of it (the remedy is noted in ADR 0027's Known limits).

## Not answerable
- none
