# test-quality findings for 2026-11-09-002-sharing-policy-per-project-local-only-kn
reviewer: review-test-quality
read: 14 test files (read whole or in the parts a criterion needs; the rest by test name and targeted search), 17 criteria in force

## Findings
- F-1 · advisory · tests/unit/sharing-policy.test.ts:750 · AC-5 (Q1): the recorded text in criteria-round-three.md still says "a sent record of another version, send". The test asserts the opposite: same hash, any version, gives keep/already-sent. The test matches the spec line in force (spec.md:333), and spec.md:346 records that the author's decision is still pending. Read AC-5 through the spec line. Carried over unchanged from the last round.
- F-2 · advisory · .crew/work/2026-11-09-002-sharing-policy-per-project-local-only-kn/probes/check-preserve.ts:19 · AC-24 (Q4): the reason "a preservation, so no run can fail first" holds for the snapshots and the budgets. But nothing checks the clause "its other assertions unchanged" for tests/unit/module-migrations.test.ts against part 1's version. The new sharing-row case (module-migrations.test.ts:92, 112-121) has its red run under AC-1.
- F-3 · advisory · tests/unit/sharing-report.test.ts:814 · AC-21 (Q1): "the hash only for candidates with a ledger record" is proven only on the helpers `memoryItems`/`withHashes`, with a set the test picks (the criterion allows this). No `wouldLeave` test fails if `leavingMemories` (src/sharing/report.ts:480-481) hashed every candidate. The criterion's "and for listed items" has no assertion.
- F-4 · advisory · tests/unit/ui-sharing-copy.test.ts:138 · AC-23 (Q5): "never the error's message" is checked only as the absence of the literal `error.message`. `err.message` or `String(error)` in a catch would pass. The present sentences are pinned, so reverting the change still fails the test.
- F-5 · advisory · tests/unit/share-confirm.test.ts:68 · AC-8: "install's legacy prompt behaves as before through the shared helper" is covered only by unit tests of `askYesNo(…, true)`. Nothing goes through install.ts's `confirm`.
- F-6 · advisory · tests/unit/doctor-sharing.test.ts:141 · AC-12 (Q6): "warn naming an emptied key" asserts "token 1" and that the value is absent, but not that the detail names `WIZARDINGCODE_MEM_SHARE_AREAS`.
- F-7 · advisory · tests/integration/backup.test.ts:387 · AC-12: in "a failing reset leaves the store untouched", the `memories(...) === 4` assertion cannot tell the store from the copy, since both hold 4 memories. Only the no-`.replaced-` check at line 386 guards "nothing renamed". The criterion is still pinned by that line.

## Outside the change
none

## Not answerable
- Q7 mutation · no mutation report was named for this item.
- Sibling item 2026-11-09-001 (src/modules/knowledge/, src/judge/, src/mcp/, tests/unit/knowledge-*, judge-*, agent-id, tests/helpers/mcp.ts, tests/fixtures/knowledge-probe.ts) · its tests were not reviewed here, and no finding above falls in its paths. The 2 snapshots that check-preserve counts as added in mcp-tools-list.test.ts.snap are the sibling's, and the script allows them.

Checked with nothing to report:
- **Last round's two upheld defects are now pinned by tests.**
  - The `remote` field derived through `isHostLedAlias`: tests/integration/ui-sharing.test.ts:295 (a path remote gives `remote: false`). It fails if `alias LIKE 'remote:%'` came back.
  - The epoch decoded in one place: `counterOfEpoch` in tests/unit/sharing-levels.test.ts:71. `withChange`'s epoch is asserted in tests/unit/sharing-report.test.ts:560-566.
- **AC-18's reason now holds.** The evidence reason (evidence.json:1442) cites a red run of probes/check-docs.ts against base 62780aa (exit 1, naming each missing part) and a green run on the tree, both in probes/check-docs-at-base.md. Last round's F-1 is resolved.
- **Every behavior criterion has a test that fails on reversion, and none is true by construction:** AC-1, 2, 3, 4, 9, 10, 11, 19, 20 (including the host-led binding at sharing-store-writes.test.ts:422-441), 21 (including knowledge behind or ahead at sharing-report.test.ts:286 and the 90,000 bound at :868), 22 (ui-sharing.test.ts:614) and 23.
- **Fixtures use neutral names** (acme/site, widgets, gears, plain, other).

Key files:
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/integration/ui-sharing.test.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/unit/sharing-levels.test.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/unit/sharing-report.test.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/unit/sharing-policy.test.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/integration/backup.test.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.crew/work/2026-11-09-002-sharing-policy-per-project-local-only-kn/probes/check-preserve.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.crew/work/2026-11-09-002-sharing-policy-per-project-local-only-kn/probes/check-docs-at-base.md
