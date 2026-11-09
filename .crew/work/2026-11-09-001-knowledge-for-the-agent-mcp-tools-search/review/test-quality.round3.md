# test-quality findings for 2026-11-09-001-knowledge-for-the-agent-mcp-tools-search
reviewer: review-test-quality
read: 6 test files, 15 criteria

## Findings
- F-1 · advisory · tests/unit/knowledge-status.test.ts:116 · New in round three. This is the fix for round two's architecture defect: `status` now checks the module's schema state before reading the knowledge tables (AC-25). The new case records knowledge version 8 and expects `knowledgeStatus` to be null, `report.knowledge` to be null and no `knowledge` line. Its recorded red (logs/tdd-AC-25-red-1794256735673.txt: 1 fail, on that case) and green (logs/tdd-AC-25-green-1794256767770.txt: 7 pass) show it fails when the gate at src/status/report.ts:195 is removed, so the fix is proven. Two cases have no test of their own: the `behind` half of `!== "current"`, and too-new with the module off (`on: false`). Neither is a criterion's promise (Q1).
- F-2 · advisory · tests/unit/knowledge-tools.test.ts:579 · Carried from rounds one and two, unchanged. AC-29 (operators are text): the assertion accepts either "No knowledge matches." or any result line. Reverting the change still fails the test, because FTS5 would throw a syntax error. But the test does not show that the quoted tokens match as words (Q1, Q6).
- F-3 · advisory · tests/unit/knowledge-migration-7.test.ts:244 · Carried. AC-27 (delete by rowid, never by a scan): `plan()` (line 96) runs EXPLAIN QUERY PLAN on the exported constants `DELETE_SEARCH_ROW` and `DELETE_REPO_SEARCH_ROWS` (also line 338), not on the SQL the writer actually executes (Q5).
- F-4 · advisory · tests/unit/knowledge-module.test.ts:372 · Carried. AC-27 (the search confines repositories in SQL): no case fills the candidate limit with higher-ranked hidden entries. Only such a case would fail if the confinement moved to a filter after the LIMIT (Q1).
- F-5 · advisory · tests/integration/compact.test.ts:309 · Carried. AC-25 (the command's report and the viewer's route carry the count): the CLI cases (lines 309, 325) and the route case assert only a count of 0. A constant 0 would pass them. Non-zero counts are proven only on `compact()` itself (Q1).
- F-6 · advisory · tests/unit/knowledge-tools.test.ts:868 · Carried. AC-24 (restating an open proposal is a duplicate, in the target repository or another visible one, also with TypeSafe configured): the only case is another repository with the heuristic judge. The `open proposals never reach the configured judge` case (line 994) partly covers the TypeSafe half (Q1).
- F-7 · advisory · tests/unit/knowledge-migration-7.test.ts:403 · Carried. The proposal-format fixture uses the owner's first name ("André"); the rest of the suite uses "Zoë". It names no client (Q8).
- F-8 · advisory · tests/integration/compact.test.ts:260 · Carried from round two. The compact schema-state gate is proven by a recorded red, but its `behind` half has no case of its own (Q1).

## Outside the change
- none

## Not answerable
- Q7 (mutation) · no mutation report was named for this item.

Notes for the judge (not findings):
- Round two's code-quality defect (src/modules/knowledge/tools.ts:504 now passes `annotations: META[name].annotations` directly) is a refactor with no change in behaviour. The default-list snapshots in tests/unit/__snapshots__/mcp-tools-list.test.ts.snap carry each tool's annotations. tests/unit/mcp-tools-list.test.ts:212 and :227 also state the names and the global `repo` enum explicitly beside the snapshots, so the new snapshots are not the only expectation.
- AC-22's other promises each have a named case in tests/unit/knowledge-tools.test.ts: the area enum (lines 317-400), a locked database with newer knowledge tables (line 421), a project turned off (line 448) and the bridge with knowledge off (line 1211). The per-agent rate of AC-28 is at lines 1073-1147, the redaction of AC-29 at 1149-1191, and both intros at 1229.
- AC-26 and AC-31 (observed): both have a recorded command and no recorded reason. Round two found check-docs.ts red on the base and green on the tree, and check-preserve.ts comparing the base's snapshots through `git show`. Neither script changed this round. The ADR's D-9 row still names `showsPins`, but that is a docs advisory for another gate, not a test-quality one.
- No finding falls in the sibling item's paths (2026-11-09-002, sharing).

Relevant paths:
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/unit/knowledge-status.test.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/status/report.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/unit/knowledge-tools.test.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/unit/knowledge-migration-7.test.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/unit/knowledge-module.test.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/integration/compact.test.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/unit/mcp-tools-list.test.ts
