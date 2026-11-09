# architecture findings for 2026-11-09-001-knowledge-for-the-agent-mcp-tools-search
reviewer: review-architecture
read: the rubric; spec.md (Decisions D-1 to D-16, the whole Design); probes/criteria-round-five.md; files.txt (146 files); review/architecture.round4.md and review/ruling.round4.json, so I could re-check each carried finding against the final tree; ADR 0019 (the contract paragraph, lines 15-24); the ADR 0020 and 0024 lines on module-owned tables and the status/compact rulings. This item's code in the worktree: src/mcp/agent-id.ts, server.ts; src/cli/commands/mcp.ts, tool.ts, distill.ts (imports and the refresh call); src/store/compact.ts and src/status/report.ts (the knowledge parts); src/hooks/handle.ts. I checked by search that every round-four anchor is still at the same line and unchanged: tools.ts:113 rootAreas, render.ts:99 KNOWLEDGE_LINE, judge/types.ts:57 ConsolidateTexts, index-store.ts:804 refreshOne, ADR 0019:20. This agrees with the prompt that nothing in this item's paths changed since 93af04f. The sibling's commits b54a579 and be1f6b7 touch only src/sharing/ and ADR 0025. I did not judge them: they belong to item 2026-11-09-002.

## Findings
- F-1 · advisory · src/modules/knowledge/tools.ts:113 · Carried from round 4 F-1, unchanged. `rootAreas` reads a root's taxonomy file by hand and duplicates part 1's `taxonomyFor` (repo.ts:712). But the CLAUDE.md text this diff writes names `doctor` as the one reader that does not go through `openRepo`. If a guard is later added to `taxonomyFor`, it will not reach the area enum. It runs no git. Fix: wrap `taxonomyFor`, falling back to `DEFAULT_AREAS`, or name this second reader in CLAUDE.md.
- F-2 · advisory · src/retrieve/render.ts:99 · Carried from round 4 F-2. `KNOWLEDGE_LINE` copies the two intros and the count line from contribute.ts as regex literals instead of building them from the exported constants. If the wording changes, echoed blocks stop being stripped before distillation and nothing reports it.
- F-3 · advisory · docs/adr/0019-one-engine.md:20 · Carried from round 4 F-3. ADR 0019's contract paragraph still describes `ToolCall` as `projectDir` alone and does not list `globalInstructions`. Line 23 still gives `BUILT_IN` as memory and the default as `memory`. Only ADR 0024 part 2 records the module.ts additions and the new default. Fix: add one clause to the reversal note pointing to ADR 0024's list.
- F-4 · advisory · src/judge/types.ts:57 · Carried from round 4 F-4. `ConsolidateTexts` types `title` and `body` as plain `string`. That is the type `consolidateState` and `consolidateQuestions` take when they build the TypeSafe request, so the `Redacted` type does not guard the point where text leaves the machine. Both entry points still require `Redacted`, so nothing leaks today.
- F-5 · advisory · src/modules/knowledge/index-store.ts:804 · Carried from round 4 F-5. The step that forgets a gone repository (`dropRepoRows` plus the `knowledge_repos` delete) is written in both `refreshOne` and `rebuildAll`. The Design says the drain forgets "by `rebuildAll`'s own rule", which reads as one rule. Fix: one shared helper that both call.

No defect. The engine boundary holds:
- The MCP server and the `tool` bridge get tools and instructions from `enabledModules` and `moduleTools`/`globalInstructions`, never from knowledge by name.
- handle.ts names no module.
- distill.ts calls `refreshStale` inside its own guard, off the hook path, as D-16 says.
- compact and status read the knowledge tables only behind `moduleSchemaState`, as ADR 0024 part 2 rules.
- agent-id.ts takes `AGENT_ID` from entry.ts, as the Design names.

## Outside the change
- src/modules/knowledge/repo.ts:712 · Debt of part 1 (item 2026-11-08-003). `taxonomyFor` checks the root with `kindAt` but does not call `refuseLinkedRoots`, so it is a second hand reader beside doctor, against the CLAUDE.md sentence. F-1 inherits it.

## Not answerable
- none
