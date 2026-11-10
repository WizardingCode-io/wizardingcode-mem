# test-quality findings for 2026-11-09-002-sharing-policy-per-project-local-only-kn
reviewer: review-test-quality
read: 18 test files, 17 criteria

## Findings
- F-1 · defect · .crew/work/2026-11-09-002-sharing-policy-per-project-local-only-kn/evidence.json:1288 · AC-18 (observed): the reason given, "prose with no behaviour a test could fail on before they exist", does not hold (rubric Q4). The same record says `probes/check-docs.ts` "fails when any part named by the criterion is missing". So a red run was possible: running the script on the tree before the round-two text was written (the "loses its bound alias" and "from the ledger's uids" sentences, `LEDGER_RECORD_KEYS` / `DECISION_KEYS`, CLAUDE.md's settings-line exception) exits 1. Only the green run (exit 0) was recorded.
- F-2 · advisory · tests/unit/sharing-policy.test.ts:750 · AC-5: the text recorded in criteria-round-two.md says "with a sent record of another version, send". The test asserts the opposite ("whatever the versions": entry version 9 against record version 1 with the same hash is keep, already-sent). The test matches the spec's line in force (spec.md:333, by hash alone), and spec.md:346 says this is waiting for the author's decision. The judge should read AC-5 through the spec line, not the recorded text.
- F-3 · advisory · .crew/work/2026-11-09-002-sharing-policy-per-project-local-only-kn/probes/check-preserve.ts:19 · AC-24 (observed): the script runs the four files and compares the base's snapshots. Nothing in it checks the clause "its other assertions unchanged" for tests/unit/module-migrations.test.ts. That file is new in the diff, since the base predates part 1, and nothing compares it with part 1's version. The reason given holds for the snapshots and the budgets. The new sharing-row case does have a red run, under AC-1.
- F-4 · advisory · tests/unit/sharing-report.test.ts:814 · AC-21: "the hash is computed only for candidates with a ledger record" is proven only on the helpers `memoryItems` and `withHashes`, with a set the test picks itself, as the criterion allows. No test of `wouldLeave` fails if `leavingMemories` (src/sharing/report.ts:481) hashed every candidate: the counts stay the same, and the 90,000-memory bound of 5,000 ms likely still holds. The criterion's "and for listed items" is untested, and the code does not hash listed items.
- F-5 · advisory · tests/unit/ui-sharing-copy.test.ts:138 · AC-23 (rubric Q5): the "never the error's message" guard is a check for the literal text `error.message`. A `catch (err)` that shows `err.message` or `String(error)` would pass it. Asserting that every `catch` in Sharing.vue and in the dock's sharing script is a bare `catch {` would pin the behaviour. Reverting the code that was actually changed still fails the test.
- F-6 · advisory · tests/unit/share-confirm.test.ts:68 · AC-8: "install's legacy prompt behaves as before through the shared helper" is covered only by unit tests of `askYesNo(…, true)`. No test goes through install.ts's `confirm` (src/cli/commands/install.ts:110). A wrong default there would go unnoticed.
- F-7 · advisory · tests/unit/doctor-sharing.test.ts:136 · AC-12 (rubric Q6): "warn naming an emptied key" asserts "token 1" and the value's absence, but not that the detail names `WIZARDINGCODE_MEM_SHARE_AREAS`.

## Outside the change
none

## Not answerable
- Q7 mutation · no mutation report was named for this item, so no surviving mutant could be checked.
- Sibling item 2026-11-09-001 · its tests (tests/unit/knowledge-*, judge-*, agent-id, tests/helpers/mcp.ts and others) were not reviewed here. None of the findings above falls in its paths. The 2 snapshots check-preserve reports as added to mcp-tools-list.test.ts.snap are the sibling's, and the script allows them.

Checked with nothing to report: the behaviour criteria AC-1, 2, 3, 4, 9, 10, 11, 19, 20, 21, 22 each have a test that fails when the behaviour is reverted, and none is true by construction. The contract test's "nothing else" relies on `keysOf<T>` being exhaustive at compile time, so `bun run check`'s typecheck carries that guard, not `bun test`. Fixtures use neutral names (acme/widgets, gears, site).

Key files:
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.crew/work/2026-11-09-002-sharing-policy-per-project-local-only-kn/evidence.json
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.crew/work/2026-11-09-002-sharing-policy-per-project-local-only-kn/probes/check-docs.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.crew/work/2026-11-09-002-sharing-policy-per-project-local-only-kn/probes/check-preserve.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/unit/sharing-policy.test.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/unit/sharing-report.test.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/unit/ui-sharing-copy.test.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/unit/share-confirm.test.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/unit/doctor-sharing.test.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/sharing/report.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/cli/commands/install.ts
