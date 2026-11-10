# test-quality findings for 2026-11-09-002-sharing-policy-per-project-local-only-kn
reviewer: review-test-quality
read: 9 test files (read whole: module-migrations, ui-sharing-copy, share-confirm, mcp-tools-list; read in the parts the criteria need: sharing-report, sharing-policy, doctor-sharing, backup, doctor), plus probes/check-preserve.ts and probes/check-docs-at-base.md; 17 criteria in force. The other sharing suites were not read again this round. The second round's reviewer found a reverting test for each of their criteria, the ruling upheld that, and nothing below says otherwise.

## Findings
- F-1 · advisory · tests/unit/sharing-policy.test.ts:750 · AC-5 (Q1). The recorded text in criteria-round-four.md still says "with a sent record of another version, send". The test asserts that the same hash at any version gives keep/already-sent. It matches the spec line in force (spec.md:333), and spec.md:346 says the author's decision is still pending. Carried over unchanged.
- F-2 · advisory · .crew/work/2026-11-09-002-sharing-policy-per-project-local-only-kn/probes/check-preserve.ts:19 · AC-24 (Q4). The reason holds for the snapshots and the budgets. The script compares the base's snapshots entry by entry and allows the sibling's two additions in mcp-tools-list.test.ts.snap at lines 414 and 794. But nothing checks "its other assertions unchanged" for tests/unit/module-migrations.test.ts. That file now expects three rows (knowledge 6 and 7, sharing 1) at lines 87-93, 116-120, 137-142 and 415-419. The knowledge 7 row is the sibling's, so a reader cannot tell this item's edit from the sibling's by running the script.
- F-3 · advisory · tests/unit/sharing-report.test.ts:814 · AC-21 (Q1). "The hash only for candidates with a ledger record, and for listed items" is proven only on `memoryItems`/`withHashes`, over a set the test picks. No `wouldLeave` test fails if every candidate were hashed. Carried over.
- F-4 · advisory · tests/unit/ui-sharing-copy.test.ts:138 · AC-23 (Q5). "Never the error's message" is checked only as the absence of the literal `error.message` (and at :142 for the dock). `err.message` or `String(error)` in a catch would pass. The pinned sentences at :135-141 still fail on reversion. Carried over.
- F-5 · advisory · tests/unit/share-confirm.test.ts:68 · AC-8. "install's legacy prompt behaves as before through the shared helper" is covered only by unit tests of `askYesNo(…, true)`. No test goes through install.ts's prompt. Carried over.
- F-6 · advisory · tests/unit/doctor-sharing.test.ts:141 · AC-12 (Q6). "warn naming an emptied key" asserts "token 1" and that the value is absent. It does not assert that the detail names `WIZARDINGCODE_MEM_SHARE_AREAS`. Carried over.
- F-7 · advisory · tests/integration/backup.test.ts:387 · AC-12. In "a failing reset leaves the store untouched", `memories(...) === 4` cannot tell the store from the copy, since both hold 4 memories. Only the no-`.replaced-` check at :386 guards "nothing renamed", and it still pins the criterion. Carried over.

## Outside the change
none

## Not answerable
- Q7 mutation · no mutation report was named for this item.
- Sibling item 2026-11-09-001 (src/modules/knowledge/, src/judge/, src/mcp/, tests/unit/knowledge-*, judge-*, agent-id, mcp-tools-list, opencode-plugin, modules-setting, doctor-knowledge, knowledge-status, tests/integration/mcp, compact) · its tests were not reviewed here, and no finding above falls in its paths.

Checked with nothing to report (on the final tree, after the sibling's commits):
- **The sibling's knowledge migration 7 does not hollow out this item's assertions.**
  - module-migrations.test.ts still asserts `('sharing', 1, 'sharing_policy')` after knowledge's rows on:
    - a fresh open
    - a second open
    - a store that holds only knowledge's schema, which takes no backup (:112-123)
    - the store that ran the withdrawn module
    - the concurrent open
  - sharing-report.test.ts:286-302 ("knowledge behind or ahead") moves the knowledge module's highest row to 5 and to 99. With rows 6 and 7 that still gives "behind" and "too-new", so the AC-21 clause is still exercised rather than passing by construction.
- **AC-24's base snapshots are unchanged by construction of the check.** The memory-alone tool lists and the bridge's refusal are entries at the base, and the sibling's default-list snapshots are additions, which the script allows.
- **AC-18's reason holds.** probes/check-docs-at-base.md records a red run against base 62780aa (exit 1, naming each missing part) and a green run on the tree.
- **AC-11's whole-output clause** is in tests/integration/doctor.test.ts:471: the status block gains `sharing   nothing leaves this machine (every default)`.
- **No test is true by construction.**
  - share-confirm.test.ts drives `askYesNo`/`confirmWidening` through a fake terminal, and asserts the answers, the reads and the printed prompt, not the fake's own return.
  - ui-sharing-copy.test.ts reads the real Vue sources and the built page. Built-page cases skip only when the page is absent, and the skip names it.
- **Fixtures use neutral names** (acme/widgets, acme/gears, sales, marketing, finance).

Key files:
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/unit/module-migrations.test.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/unit/sharing-report.test.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/unit/sharing-policy.test.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/unit/ui-sharing-copy.test.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/unit/share-confirm.test.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/unit/doctor-sharing.test.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/integration/backup.test.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.crew/work/2026-11-09-002-sharing-policy-per-project-local-only-kn/probes/check-preserve.ts
