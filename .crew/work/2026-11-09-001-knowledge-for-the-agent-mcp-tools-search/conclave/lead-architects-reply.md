# architects lead's validation of 2026-11-09-001-knowledge-for-the-agent-mcp-tools-search: spec
verdict: validated
## Returns
none
## Notes
- I searched `plan.md` for every reference to AC-8, AC-14, AC-16 and AC-17. The Phase E heading (line 58) and tasks 15 and 16 (lines 62 and 63) cite only AC-16 and AC-17, and task 15's inline tag does too. Task 22 (line 78) says "AC-16's cases". Neither superseded criterion, AC-8 or AC-14, appears anywhere in the plan.
- The round-1 to round-3 returns all hold:
  - Only the lexical primitives are shared, and memory's weighted rule stays in `prompt.ts`.
  - `settings.test.ts` is in scope.
  - The rate counter is kept per agent id in `meta` and is shared by the server and the bridge.
  - `knowledgeTools(mode)` takes no id, and the agent id is resolved inside each tool handler.
  - `BM25_WEIGHTS` has seven values.
  - AC-8 is superseded by AC-16, and AC-14 by AC-17, in the spec, the plan and `work.json`.
- The design fits the base. F5′ amends ADR 0019's F5 and reverses its note of 2026-10-13. Memory stays always on. The hooks spawn no process. The migration's triggers sit on module tables. The judge's `relate` follows the `personal` pattern.
- Part 1's code (`src/modules/knowledge/*`) is not in this tree yet. The plan states that this part starts after part 1 is merged, so this is a planned dependency and not a defect.
