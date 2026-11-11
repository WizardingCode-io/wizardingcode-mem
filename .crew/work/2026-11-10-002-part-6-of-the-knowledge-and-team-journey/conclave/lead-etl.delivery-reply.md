# etl lead's validation of 2026-11-10-002-part-6-of-the-knowledge-and-team-journey: delivery
verdict: validated
## Returns
none
## Notes
- **R-1 is answered** at docs/adr/0027-sync-client.md:102. "Known limits" now opens with the three write-lock holds that nothing measures on a large store:
  - `share server remove`, which runs as one transaction.
  - A first full sweep over many entries.
  - `backup --restore`, which holds `BEGIN IMMEDIATE` on the live store while the copy is upgraded and the eight tables are carried (src/backup/backup.ts:318-330).
  
  It also says how far the measurements reach: `scripts/proof/upgrade-copy.ts` times only the first open, and the 50 ms bar covers only one pull chunk. It states the effect: a hook fails open, so a session loses context but no data is lost. It names the remedy: run `remove` and `--restore` outside a session. This is the gap the data reviewer marked "not answerable" in all six rounds (review/data.findings.md:12), so the delivery now says what is left.
- **Build note, not a return:** the first full sweep runs on its own, so the remedy cannot cover it. The sentence does not claim that it does. If a sweep is ever measured as slow, a later item can bound it.
- **The contract sentence on the same line is the architects' gap**, recorded for the next contract bump (`accepted` unpinned in `RESULT_SHAPES.refusal`, `retryAfterSec` never sent in a body). It touches no stored data, and I take no position on it for the etl team.
- **Everything else from my earlier delivery validation still holds:**
  - The schema is add-only and `user_version` stays 7. The one-server index is created after the resolve (src/sharing/migrations.ts:43-77).
  - The one-time sharing v1 to v2 copy is measured: evidence.json:1013 gives 124 ms on a 66.8 MB fixture.
  - The fix that drops older pending rows of a uid up to the applied seq is in place (src/sync/ledger.ts:439-452, src/sync/inbound.ts:374 and :494).
  - The restore carries the tables in one transaction on the copy and switches it to `journal_mode = DELETE` before the rename (src/backup/backup.ts:211-352).
  - The data gate is proven with no findings (report.md:160).
- **The report's "not proven" rests on AC-85 alone.** That is a test-quality matter for QA, and decision D-10 retires AC-85 in favour of AC-92. The etl team does not rule on it.
