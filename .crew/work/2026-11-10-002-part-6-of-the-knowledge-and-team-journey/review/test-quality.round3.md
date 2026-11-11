# test-quality findings for 2026-11-10-002-part-6-of-the-knowledge-and-team-journey
reviewer: review-test-quality
read: 4 test files (where round 2's defects were, read again: tests/integration/sync-received.test.ts, tests/integration/sync-inbound.test.ts, tests/integration/sync-outbound.test.ts, tests/unit/sync-retrieval.test.ts; tests/unit/ui-sharing-copy.test.ts only against AC-85's live text in work.json), 15 criteria

## Findings
- F-1 · defect · tests/unit/ui-sharing-copy.test.ts:100 · AC-85 (preserve) is still live in work.json:828, and its text is unchanged: it lets only "the two configured-server sentences" of this file change. The diff still changes the saveSettings call, the two signature regexes and the added Servers and dock cases. AC-92 names these changes and AC-85 does not, so AC-85's "passes unchanged" still does not hold for this file. The person has to retire or restate AC-85 (Q3).
- F-2 · advisory · tests/integration/sync-received.test.ts:1046 · AC-87 says "names cut at 80 characters". The floor test checks that 81 B's are absent and 40 are present, so a cut at 50 or 60 would also pass. Asserting `"B".repeat(80)` present would pin the bound (Q1, partial).
- F-3 · advisory · tests/integration/sync-outbound.test.ts:506 · The new 900 KiB test fails if the byte condition is removed: one batch of 12 items would fail `batches.length >= 2`. But it still checks the bound against the imported `BATCH_BYTES`, and 12 × 100 KB keeps two batches for any cap up to about 1.2 MB. A cap raised to 1 MB would pass. Checking against the literal 921600 would close this (Q1, partial).

The other nine defects round 2 upheld were read again and each now has a test that fails on reversion:
- rebuild with a received row: sync-received.test.ts:994.
- knowledge take through the CLI, including the not-found reference: sync-received.test.ts:1001-1025.
- control characters and a long name on the floor: sync-received.test.ts:1028.
- a received memory in a linked project, muted and unbound: sync-retrieval.test.ts:133.
- the importance clamp at 0.2 and 9: sync-inbound.test.ts:740.
- the alias's own row pushed during its one-alias snapshot: sync-inbound.test.ts:1063-1080.
- own sent rows present with their sent hash (`ownFour`) and with another hash (`ownThree`): sync-inbound.test.ts:725-730.
- the byte cap: sync-outbound.test.ts:489.
- the linked received/ root: sync-received.test.ts:1051.

Round 2's three advisories still stand as filed (sync-received.test.ts:953, :470; sync-inbound.test.ts:475) and are not repeated.

## Outside the change
none

## Not answerable
- Q1 for AC-90's screen states (/settings#servers, #sharing, /projects at 360/768/1280, light and dark, motion none) · these are visual captures, and no capture was given to this reviewer.
- Q4 for AC-91's measurement of the sharing v1→v2 copy on the 50 MB fixture · the delivery's evidence was not among the files given.
- Q7 (mutation) · no mutation report was named.
