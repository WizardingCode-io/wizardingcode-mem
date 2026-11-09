# code-quality findings for 2026-11-09-001-knowledge-for-the-agent-mcp-tools-search
reviewer: review-code-quality
read: 12 files, 52 hunks

## Findings
- F-1 · defect · docs/adr/0024-knowledge-module.md:242 · Round 2 asked for the D-9 (part 2) row to drop the `showsPins` reference. The Decision column was fixed and now names `forSessionStart`, but the Cost column still says "The other answer changes the body of `showsPins` and its tests, nothing else". No `showsPins` exists in src/ or tests/, so the ADR still names code that does not exist (Q11).
- F-2 · advisory · src/judge/heuristic.ts:248 · `relate` converts `RelateInput` to `ConsolidateTexts` (index→id, `files: []`) and maps the verdict back (id→index). src/judge/typesafe.ts:77 repeats both mappings line for line; one helper beside `ConsolidateTexts` would do (Q2, adapter boilerplate). Carried from rounds 1 and 2.
- F-3 · advisory · src/modules/knowledge/tools.ts:157 · `freshen` runs `withRepoLeases(… ensureFresh)` and treats a `locked` refusal as "read the index as it is". src/cli/commands/knowledge.ts:304 (`list`) states the same rule in its own try/catch, so the rule lives in two places (Q2).
- F-4 · advisory · src/modules/knowledge/index-store.ts:812 · `refreshOne` repeats `ensureFresh`'s head/fingerprint comparison (:780). Its block that forgets a gone repository (:805–809) repeats `rebuildAll`'s (:757–760) (Q2). Carried from round 2.
- F-5 · advisory · src/modules/knowledge/index-store.ts:615 · `replaceRepoRows` repeats the first three deletes of `dropRepoRows` (resolve.ts:74), leaving out only the shown rows. A table added to a repository's index must be added in both places (Q2).
- F-6 · advisory · src/modules/knowledge/index-store.ts:1045 · `searchEntries` builds its `?` list inline, although the file's `placeholders` helper (:918) is what its neighbours use (Q6). At :1050 it also rebuilds `shownKey`'s `<repo>:<entry>` format in SQL, so the key's format is written twice (Q2). Carried from round 2.
- F-7 · advisory · src/retrieve/render.ts:100 · `KNOWLEDGE_LINE` hard-codes contribute.ts's `INTRO`, `PROMPT_INTRO`, the `pinnedCountLine` text and the four kinds. Editing any of them would silently stop the echo-stripping from matching (Q2). Carried from rounds 1 and 2.
- F-8 · advisory · src/modules/knowledge/tools.ts:65 · `KINDS` restates the list that entry.ts:9 exports as a regex under the same name. `REF` at :102 (`{0,79}`) and `.max(80)` at :438 restate entry.ts's `SLUG` and its private `SLUG_MAX` (Q2/Q3). Carried from round 2.
- F-9 · advisory · src/modules/knowledge/tools.ts:318 · `proposeKnowledge` turns a `KnowledgeError` into `refusal`, and its only production caller `runTool` does the same at :485, so the propose path catches twice (Q2). Carried from round 2.
- F-10 · advisory · src/modules/knowledge/tools.ts:409 · Inside a project, `areaEnum` always returns at least the nine default ids. The `first === undefined` side (`z.string().min(1)`) is therefore taken only in global mode, where `knowledge_propose` is not offered, so the value it builds is never used (Q4 in effect; the branch runs, but nothing reads its result).
- F-11 · advisory · src/modules/knowledge/propose.ts:150 · `scopeOf.get(…) ?? "workspace"` guards a case that cannot happen, because the open proposals come from the same `repoIds`. If it ever did happen, it would name a wrong ref instead of failing (Q9). Carried from round 2.
- F-12 · advisory · src/modules/knowledge/contribute.ts:91 · `pinnedLine` only forwards to `entryLine` (Q5). Carried from rounds 1 and 2.
- F-13 · advisory · src/judge/questions.ts:229 · `consolidateState` derives `withFiles` from `wording.noun === "memory"`, so a wording label also decides the payload's shape, which neither `ConsolidateWording` nor the parameter name says (Q3). Carried from round 2.
- F-14 · advisory · src/cli/commands/mcp.ts:23 · The catch drops `checkedAgentId`'s error and writes the same sentence by hand (src/mcp/agent-id.ts:32), so the message lives in two places (Q2). Carried from rounds 1 and 2.
- F-15 · advisory · src/store/compact.ts:51 · `hasShownTables` (with the `moduleSchemaState` check at :103) repeats the "knowledge tables present and schema current" test that `knowledgeStatus` does in src/status/report.ts:194, each with its own sqlite_master query (Q2, boilerplate). Carried from round 2.
- F-16 · advisory · src/doctor/checks.ts:637 · Part 2 adds three more jobs to `knowledgeRepositories`: the off warning, the FTS row count, and collecting and measuring the pins. It is now about 250 lines. It is still one check, but a long one (Q1, long function).

## Outside the change
- none (no finding falls in the sibling item's paths, 2026-11-09-002 sharing; its hunks in the diff were not reviewed)

## Not answerable
- Q11 for part 1's text in docs/adr/0024-knowledge-module.md, entry.ts, store.ts, repo.ts and resolve.ts · From this item's base these appear as new files, so the diff holds no earlier text to check for a dropped fact, hedge or scope limit. Only part 2's section and the CLAUDE.md, README and ADR 0019 hunks were read against the code.
- Q7 · review/inputs.json lists no added dependency. Its one phrase (src/modules/knowledge/resolve.ts:200, "fall back to") was read in round 2 as a sort tiebreak, and nothing new is added here.
