# test-quality findings for 2026-11-09-001-knowledge-for-the-agent-mcp-tools-search
reviewer: review-test-quality
read: 6 test files, 15 criteria

## Findings
- F-1 · advisory · tests/unit/knowledge-tools.test.ts:579 · Carried from round one, unchanged. AC-29 (operators are text): the assertion accepts either "No knowledge matches." or any result line. A reversion still fails it, because FTS5 would throw a syntax error, but the test does not show that the quoted tokens match as words (Q1, Q6).
- F-2 · advisory · tests/unit/knowledge-migration-7.test.ts:243 · Carried from round one. AC-27 (delete by rowid, never by a scan): EXPLAIN QUERY PLAN runs on the exported constants, not on what the writer executes (Q5).
- F-3 · advisory · tests/unit/knowledge-module.test.ts:373 · Carried from round one. AC-27 (the search confines repositories in SQL): no case fills the candidate limit with higher-ranked hidden entries. That case would fail if the confinement moved to a filter after the LIMIT (Q1).
- F-4 · advisory · tests/integration/compact.test.ts:308 · Carried from round one. AC-25 (the command's report and the viewer's route carry the count): the CLI and route cases assert only `knowledge shown: 0 rows` / `knowledgeShown: 0`. A constant 0 would pass them. Non-zero counts (4, 1) are proven only on `compact()` itself (Q1).
- F-5 · advisory · tests/unit/knowledge-tools.test.ts:868 · Carried from round one. AC-24 (a restated open proposal is a duplicate in the target repository or another visible one, also with TypeSafe configured): only the other-repository case, with the heuristic judge, is tested (Q1).
- F-6 · advisory · tests/unit/knowledge-migration-7.test.ts:403 · Carried from round one. The proposal-format fixture uses the owner's first name ("André") where the rest uses "Zoë". It names no client (Q8).
- F-7 · advisory · tests/integration/compact.test.ts:275 · New in round two. AC-25/AC-27 (compact prunes `knowledge_shown`), the round-one architecture defect: the new test records knowledge version 8 and proves that both the dry run and the real run leave the 5 rows and report 0, while sessions still go. Its recorded red, logs/tdd-AC-27-red-1794255807227.txt (Expected 0, Received 4), shows it fails with the gate removed, so the fix is proven. The "behind" half of `moduleSchemaState(...) === "current"` (src/store/compact.ts:12997 in the diff) has no case of its own. It is reachable only where version 6 alone is recorded and the version-7 tables exist, which `hasShownTables` already covers in practice (Q1).

## Outside the change
- none

## Not answerable
- Q7 (mutation) · no mutation report was named for this item.

Notes for the judge (not findings):
- Round-one code-quality defect on `knowledgeOn`/`knowledgeOff`: both now call the one `moduleEnabled` (src/engine/modules.ts:58). It is pinned by tests/unit/modules-setting.test.ts:71-84, whose red is recorded (logs/tdd-AC-25-red-1794255808157.txt, missing export). Status and doctor still have their own off-line tests (tests/unit/doctor-knowledge.test.ts:72 and :81, knowledge-status).
- `showsPins` is gone from src/modules/knowledge/contribute.ts. Removing it changes no behaviour, and the existing AC-19 session-start tests cover the path.
- AC-26 (observed): check-docs.ts has a recorded red on the base 62780aa and a green on the tree (probes/check-docs-at-base.md), so the record stands on a run, not on prose.
- AC-31 (observed): check-preserve.ts builds the binaries, runs the three files and compares each snapshot from the base, entry by entry, through `git show`. Any change fails it. The perf corpus matches the criterion (tests/perf/budgets.test.ts:62-68: 3×2,000 visible entries with 10 pinned in each, plus 30 hidden repositories of 200 entries).
- Nothing here falls in the sibling item's (2026-11-09-002, sharing) paths.

Relevant paths:
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/integration/compact.test.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/unit/modules-setting.test.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/unit/knowledge-tools.test.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/store/compact.ts
