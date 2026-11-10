# test-quality findings for 2026-11-09-001-knowledge-for-the-agent-mcp-tools-search
reviewer: review-test-quality
read: 24 test files, 20 criteria

## Findings
- F-1 · advisory · tests/integration/compact.test.ts:268 · AC-27 says compact prunes `knowledge_shown` "in the same transaction as the session delete". No test would fail if the prune were moved into a transaction of its own after the session delete. The reused-id test (line 268) checks only the end state, and the code's own comment (src/store/compact.ts:127) is the only thing holding the requirement. This is rubric question 1 on one clause of a criterion that is otherwise covered.
- F-2 · advisory · tests/unit/knowledge-refresh.test.ts:224 · AC-21 says `refreshStale` rebuilds each repository "in its own transaction". The failing-rebuild test shows that the others are still rebuilt, but nothing tells apart one transaction per repository from a single transaction with a catch for each repository. This is rubric question 1 on a structural clause, and the tests do prove the visible outcome.
- F-3 · advisory · tests/unit/knowledge-migration-7.test.ts:243 · AC-27's "deletes by rowid, never by a scan" is checked with `EXPLAIN QUERY PLAN` on the exported `DELETE_SEARCH_ROW` and `DELETE_REPO_SEARCH_ROWS` constants (also at line 337). This is coupled to the implementation (rubric question 5). It fails if those constants turn into a scan, but not if the writer stops using them.

This round's two fixes are proven by the tests:
- **AC-21** (`tests/unit/knowledge-refresh.test.ts:180`): the test was red on the base's behaviour, with the rows forgotten. It now asserts that nothing is forgotten and that exactly one log line is written, both with the root replaced by a file and with `projects/` replaced by a link.
- **AC-19** (`tests/unit/knowledge-module.test.ts:667`): the test was red (the pins were not shown). It now asserts all of these:
  - the pins are shown to the session that reuses the id;
  - `shownOf(id)` is 3, not 6, which would catch a version that only filters in `alreadyShown` and never deletes the stale rows;
  - no row is left older than the session's `started_at`.

Every behaviour criterion in force maps to a test that fails on reversion:
- AC-1: compose.test
- AC-9: agent-id, plus the bridge in knowledge-tools
- AC-18: knowledge-migration-7
- AC-19, AC-20, AC-21: knowledge-module, knowledge-refresh, knowledge-policy
- AC-22, AC-23, AC-28, AC-29: knowledge-tools, mcp-tools-list
- AC-24: judge-relate, plus the knowledge-tools edges at lines 926–931, including 0.7/1, 0.7/0 and 0.69
- AC-25: knowledge-status, doctor-knowledge, compact
- AC-27: migration-7, perf/budgets (the 2,000-entry rebuild and the 50 ms transaction, with the figure printed), compact (the dry run counted once)

On the observed criteria:
- **AC-26**: the check script has a recorded red run on the base and a green run on the tree.
- **AC-31**: `probes/check-preserve.ts` builds, runs the three files and compares every base snapshot by name with the current files. A changed or missing base snapshot exits 1, so it can go red.

The fixtures use neutral names (ledger, site, example.com/team/site, Zoë, and the probe's generic slugs). No finding falls in the sibling item's (2026-11-09-002) paths.

## Outside the change
none

## Not answerable
- Mutation (rubric question 7) · no mutation report was named in the prompt, and the profile names no Stryker or Infection run on these files.

Files referenced:
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/unit/knowledge-refresh.test.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/unit/knowledge-module.test.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/integration/compact.test.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/unit/knowledge-migration-7.test.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/store/compact.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.crew/work/2026-11-09-001-knowledge-for-the-agent-mcp-tools-search/probes/check-preserve.ts
