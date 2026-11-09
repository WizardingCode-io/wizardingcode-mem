# qa lead's validation of 2026-11-09-001-knowledge-for-the-agent-mcp-tools-search: delivery
verdict: validated
## Returns
none
## Notes
- I validated from the report and the review files. I did not re-run the tests or diff the sources.
- Gates owned by QA pass on the merged tree. In report.md:62-70, build, test (`bun run test`, 166 s), typecheck and the plugins/opencode test pass. Lint passes with 1 untouched file with problems, none of the item's. e2e is skipped by a recorded standing decision of the author (report.md:70, :289).
- The test-quality gate is proven. review/ruling.json lists 3 findings, all advisory:
  - tests/integration/compact.test.ts:268: no test pins the "same transaction" clause of AC-27.
  - tests/unit/knowledge-refresh.test.ts:224: no test tells one transaction per repository from one transaction with a catch per repository.
  - tests/unit/knowledge-migration-7.test.ts:243: the "by rowid" check runs on the exported constants, not on the writer.
  - These clauses are covered by their visible outcomes. They stay advisory, not returns.
- Each criterion in force is covered by a test that fails when it is reverted (review/test-quality.findings.md:12-20). The mapping is AC-1 to compose.test, AC-9 to agent-id.test, AC-18 to knowledge-migration-7.test, AC-19 to AC-21 to the module, policy and refresh tests, AC-22/23/28/29 to knowledge-tools.test and mcp-tools-list.test, AC-24 to judge-relate.test, AC-25 to the status, doctor and compact tests, and AC-27 to migration-7, perf/budgets and compact.
- The test-first record in report.md:36-56 shows "red then green" for AC-1, AC-9 and AC-18 to AC-29, with the latest red and green recorded. AC-2 to AC-8, AC-10 to AC-17 and AC-13 are superseded by AC-16 to AC-29, so their missing own records do not count.
- AC-26 and AC-31 are observed criteria and each has an explained reason for no red run (report.md:52, :56):
  - AC-26: probes/check-docs.ts exits 1 against base 62780aa and 0 on the tree. The record is probes/check-docs-at-base.md.
  - AC-31: probes/check-preserve.ts compares the base snapshots by name with the current files.
  - Both probe files exist under probes/.
- The gate-round commits b54a579 and be1f6b7 touch only the sibling item's paths (review/test-quality.findings.md:10). The reviewer took that from the commit list and did not diff them.
- The mutation check (rubric question 7) was not answerable because no mutation report exists. This is noted, not a return.
- Every judgement gate is proven, with the findings advisory. The removed criteria AC-12 and AC-30 were replaced by the observed AC-31, which is recorded in report.md:290-291.
