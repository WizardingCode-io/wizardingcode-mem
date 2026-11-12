# code-quality findings for 2026-11-12-007-three-tests-fail-intermittently-on-the-m
reviewer: review-code-quality
read: 6 files, 10 hunks

## Findings
- F-1 · defect · tests/integration/team-mirror-maintenance.test.ts:55 · Fails question 2: the parsers for the stub's two record formats are written twice in this diff. The `recordArgsTo` parser `callsIn` is here and again at tests/unit/knowledge-maintenance.test.ts:31. The `GIT_TRACE` parser is inlined at team-mirror-maintenance.test.ts:85 and appears again as `tracedCommands` at knowledge-maintenance.test.ts:38. The commit-then-maintenance alternation check is also duplicated (team-mirror-maintenance.test.ts:93 and knowledge-maintenance.test.ts:375). The diff adds `traceTo` to tests/helpers/stub-git.ts, so stub-git.ts owns both formats and a reader there would replace the four copies with one call.
- F-2 · advisory · src/modules/knowledge/repo.ts:958 · Question 10/11 precision: the `maintain` docstring puts "a lease lost at the call's renewal" in the sentence about errors that are not logged and that the caller meets later. That is true only for the store's `KnowledgeError` `locked`. The mirror's `MirrorLeaseLostError` (src/team/mirror.ts:99, extends `Error`) goes to line 978 and is logged as "an error of another kind", as spec.md:14 says. The comment should name the two cases apart.
- F-3 · advisory · src/modules/knowledge/repo.ts:970 · Question 10: the comment "one call apart, nothing else" does not say why the maintenance call needs the commit's identity (`maintenance run` writes no commit). One clause giving the reason, presumably that `gitEnv` requires an identity, would read better.

## Outside the change
- tests/integration/team-mirror.test.ts:522 · The same record parser (`.split("\t\n")`) is already inlined here and at line 570. This is debt that F-1's single reader in stub-git.ts would also absorb.

## Not answerable
none
