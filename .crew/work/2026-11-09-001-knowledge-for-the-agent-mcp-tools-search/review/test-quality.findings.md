# test-quality findings for 2026-11-09-001-knowledge-for-the-agent-mcp-tools-search
reviewer: review-test-quality
read: 3 test files re-read this round (checked against round four's review of 24), 15 criteria in force

## Findings
- F-1 · advisory · tests/integration/compact.test.ts:268 · AC-27's clause that compact prunes `knowledge_shown` "in the same transaction as the session delete" has no test that would fail if the prune ran in a transaction of its own after the delete. The reused-id test checks only the end state, so the clause rests on the code comment in src/store/compact.ts (rubric question 1, one clause; the rest of the criterion is covered).
- F-2 · advisory · tests/unit/knowledge-refresh.test.ts:224 · AC-21 says `refreshStale` rebuilds each repository "in its own transaction". The failing-rebuild test shows that the other repositories are still rebuilt (`[true, false, true, true]`, one log line), but it would also pass with a single transaction and a catch per repository (rubric question 1, structural clause; the visible outcome is proven).
- F-3 · advisory · tests/unit/knowledge-migration-7.test.ts:243 · AC-27's "deletes by rowid, never by a scan" is checked by running `EXPLAIN QUERY PLAN` on the exported constants `DELETE_SEARCH_ROW` (line 244) and `DELETE_REPO_SEARCH_ROWS` (line 338). The test fails if a constant becomes a scan, but not if the writer (index-store.ts:131, :616) stops using the constants (rubric question 5).

The three findings are round four's, carried over: those lines are where they were. The 93af04f → HEAD commits (b54a579 and be1f6b7) touch only the sibling item's paths. None of this item's tests, check scripts or covered sources is among them, so nothing in this item's test evidence has changed. I checked that from the commit list in the prompt and from the line positions above; I did not diff the two commits.

How the criteria are covered (each behaviour criterion in force has a test that fails when it is reverted, as in round four):
- AC-1: compose.test
- AC-9: agent-id.test, plus the bridge in knowledge-tools.test
- AC-18: knowledge-migration-7.test
- AC-19 to AC-21: knowledge-module, knowledge-policy and knowledge-refresh tests
- AC-22, AC-23, AC-28, AC-29: knowledge-tools.test and mcp-tools-list.test
- AC-24: judge-relate.test, plus the threshold edges in knowledge-tools.test
- AC-25: knowledge-status, doctor-knowledge and compact tests
- AC-27: knowledge-migration-7.test, perf/budgets.test and compact.test

The observed criteria:
- AC-26: probes/check-docs.ts has a recorded red run on base 62780aa (exit 1, each missing mark named) and a green run on the tree (probes/check-docs-at-base.md). be1f6b7 changes only ADR 0025, which this check does not read.
- AC-31: probes/check-preserve.ts compares the base snapshots by name with the current files, so it can go red.

Fixtures use neutral names. No finding falls in the sibling item's (2026-11-09-002) paths.

## Outside the change
none

## Not answerable
- Mutation (rubric question 7) · the prompt names no mutation report, and none is known to exist for these files.

Files referenced:
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/integration/compact.test.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/unit/knowledge-refresh.test.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/unit/knowledge-migration-7.test.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/modules/knowledge/index-store.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.crew/work/2026-11-09-001-knowledge-for-the-agent-mcp-tools-search/probes/check-docs-at-base.md
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.crew/work/2026-11-09-001-knowledge-for-the-agent-mcp-tools-search/review/test-quality.round4.md
