# code-quality findings for 2026-11-09-001-knowledge-for-the-agent-mcp-tools-search
reviewer: review-code-quality
read: 7 files, 4 hunks

## Findings
- F-1 · advisory · src/modules/knowledge/index-store.ts:760 · The step that forgets a repository (`dropRepoRows`, then `DELETE FROM knowledge_repos WHERE id = ?`) appears in `rebuildAll` here and again in `refreshOne` at line 809. One `forgetRepo(db, id)` would do it (question 2). It stays advisory because only one statement is repeated.
- F-2 · advisory · src/modules/knowledge/index-store.ts:813 · `refreshOne` repeats the freshness check from `ensureFresh` at line 781 (`head === headOf(path) && fingerprint === fingerprintOf(path)`). One predicate could serve both (question 2).
- F-3 · advisory · src/modules/knowledge/index-store.ts:1050 · `searchEntries` builds `repoIds.map(() => "?").join(", ")` inline, although the file's `placeholders` helper already does this (question 2, boilerplate).
- F-4 · advisory · src/judge/typesafe.ts:77 · `TypeSafeJudge.relate` and `heuristic.ts`'s `relate` both convert `RelateInput` to `ConsolidateTexts` and map the verdict back from id to index in the same way. One shared adapter would do (question 2, shape-mapping boilerplate).
- F-5 · advisory · src/modules/knowledge/tools.ts:71 · `KINDS` repeats the kind list that `entry.ts` already has, and the list appears again in `retrieve/render.ts`'s `KNOWLEDGE_LINE` and in `install/opencode-plugin.ts`. Adding a kind means editing four places that nothing ties together (question 2/6).
- F-6 · advisory · src/retrieve/render.ts:100 · `KNOWLEDGE_LINE` copies the text of `contribute.ts`'s `INTRO`, `PROMPT_INTRO` and `pinnedCountLine` as regex literals. Only a test ties the copies together, so a wording change must be made in both places (question 2).
- F-7 · advisory · src/modules/knowledge/tools.ts:270 · `getKnowledge` passes each ref's unchecked scope to `freshen` (and so to `openRepo`) before it tests the ref against `REF` at line 278. Behind the zod schema the inner check never fires, and without the schema it fires too late. Move it before `freshen` or drop it (question 9).
- F-8 · advisory · src/modules/knowledge/propose.ts:150 · `scopeOf.get(proposal.item.repoId) ?? "workspace"` guards a case that cannot happen, because `openProposalTexts` was filtered by those same `repoIds`. If it were ever reached, it would label a project or shared proposal `workspace/...` and say nothing (question 9).
- F-9 · advisory · src/modules/knowledge/tools.ts:321 · `proposeKnowledge` turns a `KnowledgeError` into `refusal(...)`. Its only production caller, `runTool` at line 491, wraps it in the same catch, so the outer catch never fires on the propose path (question 4/5).
- F-10 · advisory · src/cli/commands/mcp.ts:17 · The bare `catch` throws away the error from `checkedAgentId` and writes its message again by hand. Printing `error.message` would keep a single copy of the text (question 2/6).
- F-11 · advisory · src/modules/knowledge/contribute.ts:105 · `pinnedLine` only calls `entryLine`. Exporting `entryLine` under one name would give `doctor` the same line format without the extra layer (question 5).
- F-12 · advisory · src/doctor/checks.ts:713 · Three catches (lines 713, 743, 752) decide that the knowledge tables do not exist by searching the error message for `"no such table: knowledge_"`. `status/report.ts` and `store/compact.ts`'s `hasShownTables` answer the same question by querying `sqlite_master`, so the change has two ways of doing it (question 6).
- F-13 · advisory · src/doctor/checks.ts:637 · `knowledgeRepositories` is about 250 lines and covers git version, mapping, schema and FTS figures, the per-folder guards, file counts, the pinned-share measure and formatting. It is still one check, but one part is hard to change alone (question 1).
- F-14 · advisory · src/modules/knowledge/propose.ts:44 · A `knowledge.rate:<id>` row that cannot be parsed silently starts a new window, and nothing is logged. Only this code writes the row, so a parse failure means a bug or a hand edit, and the rate limit resets without a trace (question 9).

## Outside the change
none

## Not answerable
none

---
Notes for the caller (not part of the findings):
- Since round four (proven on 93af04f), nothing in this item's paths has changed. I re-read the final tree's `src/modules/knowledge/tools.ts`, `propose.ts`, `contribute.ts`, `src/cli/commands/mcp.ts` and the excerpt of `resolve.ts` at the flagged phrase, and found the fourteen round-four advisories still present at the same or nearby lines. I confirmed the `index-store.ts` and `doctor/checks.ts` ones with a search rather than reading the files whole. No new defect.
- `inputs.json` gives no dependencies, and one phrase, "fall back to" at `src/modules/knowledge/resolve.ts:200`. In context it is a deterministic tie-break on the folder name (newest first, then name), not a fallback that hides a cause, so it is not a finding. That file is part 1's (item 2026-11-08-003), not this item's.
- The three `console.log` lines added in the diff are all in tests (perf/timing output in `tests/perf/budgets.test.ts` and the sharing tests), so question 8 does not apply. The 90,000-memory timing print belongs to the sibling item 2026-11-09-002.
- I did not review the sibling's commits b54a579 and be1f6b7 (`src/sharing/*`, ADR 0025); they were proven under 2026-11-09-002.
- Prior rounds are in /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.crew/work/2026-11-09-001-knowledge-for-the-agent-mcp-tools-search/review/code-quality.round4.md.
