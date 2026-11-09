# test-quality findings for 2026-11-09-001-knowledge-for-the-agent-mcp-tools-search
reviewer: review-test-quality
read: 22 test files, 16 criteria

## Findings
- F-1 · advisory · tests/unit/knowledge-tools.test.ts:579 · AC-29 (operators are text): the assertion accepts either "No knowledge matches." or any result line, so it fails only if the query throws. It still catches a reversion, because `searchEntries` (src/modules/knowledge/index-store.ts:1027) has no catch and FTS5 would raise a syntax error. But it does not check what the quoted tokens match. Seeding an entry that holds "title" or "near" and expecting that entry would show the operators are read as words (rubric Q1 and Q6).
- F-2 · advisory · tests/unit/knowledge-migration-7.test.ts:243 · AC-27 (delete by rowid, never by a scan): this test and the one at :337 run EXPLAIN QUERY PLAN on the exported constants `DELETE_SEARCH_ROW` and `DELETE_REPO_SEARCH_ROWS`, not on what the writer runs. If the writer were changed to issue its own scanning DELETE and the constant were left alone, both tests would still pass. The row-count tests would still pass too, since a scan deletes the same rows. This is coupled to the implementation, not to the behaviour (rubric Q5).
- F-3 · advisory · tests/unit/knowledge-module.test.ts:373 · AC-27 ("every search confines the repositories in SQL"): the hidden-project case checks that a hidden entry is never shown. It would still pass if the confinement moved out of SQL into a JavaScript filter after the LIMIT. The perf corpus (30 hidden repositories that share words with the prompts) only checks that the first measured prompt's entry is `candidates[0]`. No test fills the candidate limit with hidden entries that outrank a visible match, which is the case that would fail if the confinement left SQL (rubric Q1).
- F-4 · advisory · tests/integration/compact.test.ts:14682 (diff line) · AC-25 (the command's report and the viewer's route carry the count): the CLI and `/api/compact` cases (also tests/integration/ui-settings.test.ts, the dry run) only check `knowledge shown: 0 rows` and `knowledgeShown: 0`. A command or route that printed a constant 0 would pass. The non-zero counts (4, 1) are proved only on `compact()` itself (rubric Q1).
- F-5 · advisory · tests/unit/knowledge-tools.test.ts:868 · AC-24 (a restated open proposal is a duplicate "in the target repository or in another visible one", and "also when TypeSafe is configured"): only the other-repository case is tested, and only with the heuristic judge. The duplicate-of-proposal refusal is not tested for a proposal in the target repository itself, nor with a stub TypeSafe judge configured. Tests :994 and :1020 do show that proposals never reach the configured judge, which partly covers the second point (rubric Q1).
- F-6 · advisory · tests/unit/knowledge-migration-7.test.ts:403 · rubric Q8: the proposal-format fixture writes `on_behalf_of: "André"`, the repository owner's own first name, while the rest of the item's tests use the neutral "Zoë". It names no client or workspace, so this is advisory only.

## Outside the change
- none

## Not answerable
- Q7 (mutation) · no mutation report was named for this item, so no surviving mutant could be checked against the diff's lines.
