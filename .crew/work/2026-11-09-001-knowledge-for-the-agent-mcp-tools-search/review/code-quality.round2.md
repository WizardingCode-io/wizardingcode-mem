# code-quality findings for 2026-11-09-001-knowledge-for-the-agent-mcp-tools-search
reviewer: review-code-quality
read: 26 files, 58 hunks

## Findings
- F-1 · defect · docs/adr/0024-knowledge-module.md:242 · The D-9 (part 2) ruling still says "One function, `showsPins`, decides whether a session start shows pins" and that the other answer "changes the body of `showsPins` and its tests". `showsPins` was removed after round 1 and appears nowhere in src/ or tests/. src/modules/knowledge/contribute.ts:196 now says the other answer "would add one check here", so the ADR names code that does not exist (Q11). The probe .crew/work/…/probes/check-docs.ts:60 requires that exact string, so the probe keeps the stale sentence in place.
- F-2 · defect · src/modules/knowledge/tools.ts:504 · `META[name].annotations === undefined ? {} : …` can never take its `{}` side, because all three `META` rows define `annotations`. It is a dead branch (Q4), and memory's tools (src/modules/memory/tools.ts:327) pass the value directly.
- F-3 · advisory · src/mcp/agent-id.ts:6 · Two JSDoc comments sit stacked on `UNKNOWN_AGENT` (lines 6–7), and line 9 adds `const UNKNOWN = UNKNOWN_AGENT`, an alias used once at :28. Both are left over from the round-1 fix (Q8/Q10).
- F-4 · advisory · src/cli/commands/mcp.ts:18 · The catch drops `checkedAgentId`'s error and writes the same sentence again by hand (src/mcp/agent-id.ts:34), so the message lives in two places (Q2). Carried from round 1, unchanged.
- F-5 · advisory · src/judge/heuristic.ts:248 · `relate` converts `RelateInput` to `ConsolidateTexts` (index→id, `files: []`) and maps the verdict back. src/judge/typesafe.ts:77 repeats that mapping word for word; one helper beside `ConsolidateTexts` would do (Q2, mapping boilerplate). Carried from round 1.
- F-6 · advisory · src/judge/questions.ts:230 · `withFiles = wording.noun === "memory"` lets a wording label decide the payload's shape, and the name `ConsolidateWording` does not say it does that (Q3). Carried from round 1.
- F-7 · advisory · src/retrieve/render.ts:101 · `KNOWLEDGE_LINE` hard-codes contribute.ts's `INTRO`, `PROMPT_INTRO`, the `pinnedCountLine` text and the four kinds. If any of them is edited, echo-stripping stops matching and nothing reports it (Q2). Carried from round 1.
- F-8 · advisory · src/modules/knowledge/tools.ts:65 · `KINDS` restates the list that entry.ts:9 exports as the `KINDS` regex: one name with two shapes, and src/install/opencode-plugin.ts:92 holds a third copy (Q2/Q3). In the same file, `REF` at :102 and the `.max(80)` at :438 restate entry.ts's `SLUG` and its 80-character cap, although `SLUG` is imported here (Q2).
- F-9 · advisory · src/modules/knowledge/tools.ts:318 · `proposeKnowledge` turns a `KnowledgeError` into `refusal`, and its only production caller `runTool` does the same at :485, so the propose path catches twice (Q2).
- F-10 · advisory · src/modules/knowledge/contribute.ts:36 · `logTooNew` is called for every state that is not `current`, `behind` included, and its message now says "behind, or too new". The name says only the second case (Q3).
- F-11 · advisory · src/modules/knowledge/contribute.ts:91 · `pinnedLine` only forwards to `entryLine`, a layer that adds nothing (Q5). Carried from round 1.
- F-12 · advisory · src/modules/knowledge/index-store.ts:812 · `refreshOne` repeats `ensureFresh`'s head/fingerprint comparison (:780), and its docstring says so. Its "forget a gone repository" block (:806–809) also repeats `rebuildAll`'s (:757–760) (Q2).
- F-13 · advisory · src/modules/knowledge/index-store.ts:1045 · `searchEntries` builds `repoIds.map(() => "?").join(", ")` inline, although the file's `placeholders` helper (:918) is what its neighbours use (Q6). At :1050 it also rebuilds `shownKey`'s `<repo>:<entry>` format in SQL, so the key's format is written in two places (Q2).
- F-14 · advisory · src/modules/knowledge/propose.ts:147 · `scopeOf.get(…) ?? "workspace"` guards a case that cannot happen, because the proposals come from the same `repoIds`. If it ever did happen, it would silently name a wrong ref (Q9).
- F-15 · advisory · src/modules/knowledge/propose.ts:57 · `judgedBy`'s doc says "the judge that answered about the entries … null with no neighbour". The proposals-only path at :162 records `heuristic`, so the comment no longer matches the code (Q10/Q3).
- F-16 · advisory · src/judge/index.ts:28 · `TOOL_USAGE_KEYS` is exported, but nothing outside the file imports it (Q8).
- F-17 · advisory · src/doctor/checks.ts:604 · `pinnedChars` sorts the pins before measuring `pinnedBlock(lines).length`. The block's length does not depend on the order, so the sort does nothing (Q5).
- F-18 · advisory · src/doctor/checks.ts:590 · `knowledgeOff`'s doc still describes "the built-in modules minus the ones the setting enables". The body is now `!moduleEnabled(...)`, and it forwards just as `knowledgeOn` does in src/status/report.ts:216 (Q10/Q5).
- F-19 · advisory · src/store/compact.ts:51 · `hasShownTables` repeats the sqlite_master table-presence count that `knowledgeStatus` does in src/status/report.ts:194 (Q2, boilerplate).

## Outside the change
- None of the findings above fall in the sibling item's paths (2026-11-09-002, sharing). The diff's sharing hunks, including the settings bullet at CLAUDE.md:22 and the README's Sharing section, belong to that item and were not reviewed here.

## Not answerable
- Q11 for part 1's text in docs/adr/0024-knowledge-module.md · From this item's base, the diff shows the ADR, entry.ts, store.ts, repo.ts and resolve.ts as new files. So there is no earlier text in the diff to check whether part 2 changed a fact, a hedge or a scope limit of part 1. Only part 2's section was read against the code.
- Q7 · review/inputs.json lists no added dependency. Its one phrase (src/modules/knowledge/resolve.ts:200, "fall back to") is a sort tiebreak, not a fallback, so it gives no finding.
