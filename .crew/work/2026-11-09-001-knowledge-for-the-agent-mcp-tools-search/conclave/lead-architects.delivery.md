# architects lead's validation of 2026-11-09-001-knowledge-for-the-agent-mcp-tools-search: delivery
verdict: validated
## Returns
(none)
## Notes
- The architecture gate is proven on the judge's latest ruling (review/ruling.json, gate "architecture"). Five rounds ran. The reviewer's final file, review/architecture.findings.md:12-17, says "No defect. The engine boundary holds". Its six findings are all advisory.
- I checked the engine boundary (ADR 0019) on the tree. src/mcp/server.ts does not name knowledge. Nothing under src/hooks imports from modules/knowledge. Hooks, the MCP server and the tool bridge therefore ask the modules, not knowledge by name. The reviewer also records that handle.ts names no module. It records that distill.ts calls refreshStale inside its own guard, off the hook path (D-16). It records that compact and status read the knowledge tables only behind moduleSchemaState.
- The Design follows the base on three points. F5-prime (D-8) is the composer rule, and AC-1 is red-then-green. The module's tables are versioned apart from the core schema, which is AC-18 (migration 7). The agent id is the handshake's client name (D-12), and the boundary is stated as O-1.
- ADR 0024 part 2 exists: docs/adr/0024-knowledge-module.md has 24 "part 2" occurrences. AC-26 is observed through probes/check-docs.ts, which exits 1 against the base and 0 on the tree. AC-31 (hook snapshots, memory-alone tool lists, budgets) is covered by probes/check-preserve.ts.
- The gates passed on the merged tree (report.md:62-70): build, test, lint, typecheck, secrets, prose, design-lint and the opencode plugin test. The lint pass reads "1 untouched file with problems, none of the item's". The e2e gate was skipped by a recorded user decision (report.md:289).
- All seven judgement gates are proven. There are no task briefs, as stated, and the report carries the coverage a brief would.
- Advisory, not returns, because the judge ruled them advisory and none breaks the engine contract:
  - src/modules/knowledge/tools.ts:113: rootAreas is a second hand reader of the taxonomy file beside doctor, against the CLAUDE.md sentence. It runs no git. Wrap taxonomyFor or name the reader in CLAUDE.md.
  - src/retrieve/render.ts:99: KNOWLEDGE_LINE copies contribute.ts's intro wording as regex literals. A test ties them together.
  - docs/adr/0019-one-engine.md:20: the contract paragraph is not updated for ToolCall, globalInstructions and the new default. ADR 0024 records them, so a pointer clause would close it.
  - src/judge/types.ts:57: ConsolidateTexts is typed as plain string where text leaves the machine. Both entry points still require Redacted.
  - src/modules/knowledge/index-store.ts:804: the forget step is repeated in refreshOne and rebuildAll.
  - src/modules/knowledge/repo.ts:712: taxonomyFor does not call refuseLinkedRoots. This is part 1's debt.
- The objections O-1 (the agent id is not authenticated) and O-2 (the TypeSafe breaker is shared) are advisory and stated in ADR 0024.
- Process point: the report lists the primary team as frontend with the session, and the judge's two last rounds are bounded by "rounds: judgement 5 of 2". These are engine bookkeeping, not architecture defects.
