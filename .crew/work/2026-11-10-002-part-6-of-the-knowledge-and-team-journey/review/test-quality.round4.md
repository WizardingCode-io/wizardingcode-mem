# test-quality findings for 2026-11-10-002-part-6-of-the-knowledge-and-team-journey
reviewer: review-test-quality
read: 5 test files (round 4's new or changed cases, read from the tree: tests/unit/sharing-per-server.test.ts, tests/integration/sync-received.test.ts, tests/integration/sync-inbound.test.ts, tests/integration/sync-outbound.test.ts; tests/unit/ui-sharing-copy.test.ts only against AC-85's live text), 15 criteria

## Findings
- F-1 · defect · tests/unit/ui-sharing-copy.test.ts:100 · AC-85 (preserve) is still live in probes/criteria.md:13 with its text unchanged. It allows only "the two configured-server sentences" of this file to change, but the diff also changes the saveSettings call, the two signature regexes and the added Servers and dock cases. Those changes are named only by AC-92, so AC-85's "passes unchanged" still does not hold for this file. The person has to retire or restate AC-85 (Q3).

These round 4 cases were read against the code, and each fails if its fix is reverted:
- AC-87, sharing-per-server.test.ts:150-162 (aliasBoundTo with two aliases). The old join on any alias of the project would return true for `other`, and the test expects false at :159. The current query (src/sharing/levels.ts:100-102) ties the alias to `l.bound_alias`, as `boundAliasesOf` does.
- AC-87, sync-received.test.ts:561-580 (the re-index passing by a project folder with no manifest). The old hand-built `project:<uuid>` uid would index the orphan file, giving `indexed: 1` instead of the expected `{ indexed: 0, dropped: 0 }`. The guard is at src/sync/received.ts:305.
- AC-87, sync-inbound.test.ts:811-856 (the hourly re-apply in reverse order). The old per-seq `deletePendingRow` would leave the older failing seq 1 in place, so `pendingRows(...)` would not equal `[]` at :855. The case at :762-809 still pins the other order: a newer row that fails stays set aside. Together they cover `deletePendingRowsUpTo` (src/sync/inbound.ts:493) in both orders.
- Round 3's advisory on the 80-character cut is closed: sync-received.test.ts:1075-1076 now asserts that `"B".repeat(80)` is present and `"B".repeat(81)` is absent.
- Round 3's advisory on the 900 KiB cap is closed: sync-outbound.test.ts:503 now asserts `BATCH_BYTES` equals `900 * 1024`, so a raised cap fails.

Round 2's three advisories (sync-received.test.ts:953, :470; sync-inbound.test.ts:475) still stand as filed and are not repeated.

## Outside the change
none

## Not answerable
- Q1 for AC-90's screen states (/settings#servers, #sharing, /projects at 360/768/1280, light and dark, motion none) · these are visual captures, and none was given to this reviewer.
- Q4 for AC-91's measurement of the sharing v1→v2 copy on the 50 MB fixture · the delivery's evidence was not among the files given.
- Q7 (mutation) · no mutation report was named.
