# code-quality findings for 2026-11-09-001-knowledge-for-the-agent-mcp-tools-search
reviewer: review-code-quality
read: 14 files, 46 hunks

## Findings
- F-1 · defect · src/modules/knowledge/contribute.ts:118 · `showsPins` always returns `true` and ignores its parameter, so the `if (!showsPins(input)) return null;` branch at contribute.ts:203 can never be taken. That is a flag that always has one value and a dead branch (Q4). The D-9 "seam" comment explains why it is there but does not make the branch reachable.
- F-2 · defect · src/status/report.ts:216 · `knowledgeOn` repeats the "is knowledge enabled" logic of `knowledgeOff` in src/doctor/checks.ts:595: both call `enabledModules(loadSettings(env, dataDir).modules, BUILT_IN, () => {})` and match `KNOWLEDGE_MODULE`, and doctor's copy goes the long way through `BUILT_IN` minus enabled. One shared predicate would do (Q2).
- F-3 · advisory · src/judge/heuristic.ts:249 · `relate` converts `RelateInput` to `ConsolidateTexts` (index→id, `files: []`) and maps the verdict back (id→index). src/judge/typesafe.ts:77 does the same mapping word for word; one helper beside `ConsolidateTexts` would do (Q2, mapping boilerplate).
- F-4 · advisory · src/retrieve/render.ts:100 · `KNOWLEDGE_LINE` hard-codes the two intros from contribute.ts (`INTRO`, `PROMPT_INTRO`), the `pinnedCountLine` text and the four kinds. If any of those strings is edited, echo stripping stops matching and nothing reports it (Q2).
- F-5 · advisory · src/modules/knowledge/tools.ts:63 · `KINDS` declares the kind list again even though src/modules/knowledge/entry.ts:9 already exports a `KINDS` (as a regex), and src/install/opencode-plugin.ts:92 writes the same list out by hand. That is the same set in three places, under one name with two shapes (Q2/Q3).
- F-6 · advisory · src/modules/knowledge/tools.ts:98 · `QUOTA` writes "20 proposals" as a literal instead of using `PROPOSALS_PER_HOUR`, so changing the constant leaves the refusal text wrong (Q2).
- F-7 · advisory · src/modules/knowledge/tools.ts:478 · `call.agentId ?? "mcp"` repeats the `UNKNOWN = "mcp"` fallback that src/mcp/agent-id.ts:7 already owns (Q2).
- F-8 · advisory · src/judge/questions.ts:231 · `withFiles = wording.noun === "memory"` makes the state's shape (files or no files) depend on a wording label. The name `ConsolidateWording` does not say it also controls the payload (Q3).
- F-9 · advisory · src/modules/knowledge/contribute.ts:237 · Every state other than `current` from `moduleSchemaState`, `behind` included, logs "the knowledge tables are at a version this binary does not support". The wording only fits `too-new` (Q3).
- F-10 · advisory · src/modules/knowledge/contribute.ts:91 · `pinnedLine` only forwards to `entryLine`, a layer that adds nothing (Q5). doctor and a test import it, so it could simply be `entryLine` exported.
- F-11 · advisory · src/modules/knowledge/index-store.ts:757 · Forgetting a repository is written twice: `withWrite(dropRepoRows + DELETE FROM knowledge_repos)` here in `rebuildAll` and again at index-store.ts:806 in `refreshOne`. The head/fingerprint freshness comparison is also repeated, in `ensureFresh` (:780) and `refreshOne` (:812) (Q2).
- F-12 · advisory · src/modules/knowledge/index-store.ts:1045 · `searchEntries` builds its own `repoIds.map(() => "?").join(", ")` although the file already has the `placeholders` helper (:918), which the neighbouring readers use (Q6).
- F-13 · advisory · src/modules/knowledge/index-store.ts:691 · The doc comment for `rebuildAll` is stranded above `requireKnowledgeRoot`'s own doc comment, so `rebuildAll` has none and `requireKnowledgeRoot` has two (Q6/Q10).
- F-14 · advisory · src/modules/knowledge/propose.ts:147 · `scopeOf.get(proposal.item.repoId) ?? "workspace"` guards a case that cannot happen: proposals are read only from `repoIds` taken from the same `repos`. If it ever did happen, it would quietly give a wrong ref (Q9).
- F-15 · advisory · src/modules/knowledge/propose.ts:20 · `rateKey` is exported but nothing outside propose.ts imports it (Q8).
- F-16 · advisory · src/judge/index.ts:28 · `TOOL_USAGE_KEYS` counters (`typesafe.tools.*`) are written, but no reader in `status` or `doctor` shows them, so the "own usage counters" nobody can see (Q4/Q5).
- F-17 · advisory · src/cli/commands/mcp.ts:23 · The catch throws away `checkedAgentId`'s error and prints the same sentence again by hand, so the message lives in two places (Q2).
- F-18 · advisory · src/modules/knowledge/contribute.ts:114 · The comment cites "D-9" without "(part 2)". The ADR (docs/adr/0024-knowledge-module.md:222) says part 2 rulings are written that way because part 1 has its own D-9 (areas). CLAUDE.md:12 has the same issue ("D-9 confirmed") (Q11).

## Outside the change
- src/modules/knowledge/tools.ts:306 · `proposeKnowledge` catches `KnowledgeError` → `refusal`, and its only production caller `runTool` (:483) does the same. The double catch is harmless, but the outer one only covers search and get. (This is the item's own file, noted only as context.)
- None of the findings above fall in the sibling item's (2026-11-09-002, sharing) paths. The sharing parts of the shared files were not reviewed.

## Not answerable
- Q11 (prose rewrite against references/writing.md) for docs/adr/0024-knowledge-module.md · The diff shows the ADR as a new file from this item's base, so there is no earlier text to check part 1's sentences against. Whether part 2's additions changed a fact, hedge or scope limit of part 1 cannot be told from the diff. Only the D-9 numbering (F-18) was checked.
- Q7 (dependencies) · review/inputs.json was not given. The diff touches no package.json, so no new dependency is visible.
