# code-quality findings for 2026-11-09-001-knowledge-for-the-agent-mcp-tools-search
reviewer: review-code-quality
read: 9 files, 46 hunks

## Findings
- F-1 · advisory · src/modules/knowledge/index-store.ts:758 · The step that forgets a repository (`withWrite` → `dropRepoRows` + `DELETE FROM knowledge_repos WHERE id = ?`) appears in `rebuildAll` here and again in `refreshOne` at line 807, and the comment at 807 says it repeats `rebuildAll`'s rule; one `forgetRepo(db, id)` would do it (question 2). It is advisory because `dropRepoRows` already holds the part that matters, so only one statement is repeated.
- F-2 · advisory · src/modules/knowledge/index-store.ts:813 · `refreshOne` repeats the freshness check from `ensureFresh` at line 781 (`head === headOf(path) && fingerprint === fingerprintOf(path)`), and its doc comment says so; the two could call one predicate (question 2).
- F-3 · advisory · src/modules/knowledge/index-store.ts:1050 · `searchEntries` writes `repoIds.map(() => "?").join(", ")` inline, although the `placeholders` helper defined just above does the same thing and the other readers use it (question 2, boilerplate).
- F-4 · advisory · src/judge/typesafe.ts:77 · `TypeSafeJudge.relate` and `heuristic.ts:248` `relate` each convert `RelateInput` to `ConsolidateTexts` and map the verdict back from `id` to `index` in the same way; one shared adapter would do (question 2, shape-mapping boilerplate).
- F-5 · advisory · src/modules/knowledge/tools.ts:71 · `KINDS` restates the kind list that `entry.ts:9` already has (`KINDS` regex), and the list appears again in `retrieve/render.ts:100` and `install/opencode-plugin.ts:92`. Adding a kind means editing four places that nothing ties together (question 2/6).
- F-6 · advisory · src/retrieve/render.ts:100 · `KNOWLEDGE_LINE` repeats the text of `INTRO`, `PROMPT_INTRO` and `pinnedCountLine` from `contribute.ts` as regex literals; the copies are tied only by `tests/unit/knowledge-module.test.ts:782`, so a wording change has to be made in both (question 2).
- F-7 · advisory · src/modules/knowledge/tools.ts:270 · `getKnowledge` calls `freshen` with the scopes of every ref before it checks them against `REF` at line 278, so the in-function check comes after `openRepo` has already been given an unchecked scope. Through the tools the zod schema has rejected such a ref first, so the inner check either never fires or fires too late; it should move before `freshen` or be removed (question 9).
- F-8 · advisory · src/modules/knowledge/propose.ts:150 · `scopeOf.get(proposal.item.repoId) ?? "workspace"` falls back for a repository that cannot be missing (`openProposalTexts` is filtered by those same `repoIds`). If it ever were reached, it would mislabel a project or shared proposal as `workspace/...` without any warning (question 9).
- F-9 · advisory · src/modules/knowledge/tools.ts:321 · `proposeKnowledge` catches `KnowledgeError` and turns it into `refusal(...)`, and its only production caller, `runTool` at line 491, does the same catch around it, so the second catch never fires on the propose path (question 4/5).
- F-10 · advisory · src/cli/commands/mcp.ts:19 · The `catch` drops the error from `checkedAgentId` and writes the same message again by hand (`agent-id.ts:29`); printing `error.message` would keep one copy of the text (question 2/6).
- F-11 · advisory · src/modules/knowledge/contribute.ts:105 · `pinnedLine` only forwards to `entryLine`; it exists so that `doctor` can use the same line format, and exporting `entryLine` under a single name would do that without the extra layer (question 5).
- F-12 · advisory · src/doctor/checks.ts:713 · Three catches (lines 713, 743, 752) treat an error as "the tables do not exist yet" by searching its message for `"no such table: knowledge_"`. `status/report.ts:196` and `store/compact.ts:12978` (`hasShownTables`) already answer the same question by querying `sqlite_master`; there are now two ways of doing it in one change (question 6).
- F-13 · advisory · src/doctor/checks.ts:637 · `knowledgeRepositories` runs to about 250 lines and does several separate jobs in one unit: git version, mapping, schema and FTS figures, per-folder guards, file counts, the pinned-share measure and formatting. It is still one check, but it is hard to change one part alone (question 1).
- F-14 · advisory · src/modules/knowledge/propose.ts:45 · An unreadable `knowledge.rate:<id>` row is silently treated as a new window (the catch is commented but nothing is logged). Only this code writes that row, so a parse failure would mean a bug or a hand edit, and the rate limit would reset without a trace (question 9).

## Outside the change
none

## Not answerable
none
