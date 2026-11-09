# architects lead's validation of 2026-11-09-001-knowledge-for-the-agent-mcp-tools-search: spec
verdict: returned
## Returns
- R-1 · .crew/work/2026-11-09-001-knowledge-for-the-agent-mcp-tools-search/plan.md:58, :62, :63, :78 · The plan still cites the two superseded criteria, and no task cites AC-16 or AC-17.
  - Line 58 (the Phase E heading), the start of task 15 (line 62) and task 16 (line 63) cite AC-8.
  - Line 62 also tags its rate and security cases "(AC-14)".
  - Line 78 says "AC-8's cases log it".
  - The engine ties each task's red and green runs to a live criterion. A task that names a superseded criterion leaves AC-16 and AC-17 with no proof, and the 21st-proposal, shared-counter, redaction and FTS-quoting cases would be recorded against criteria nobody validates.
  - Change the Phase E heading and tasks 15 and 16 to name AC-16 in place of AC-8, and AC-17 in place of AC-14.
  - Change line 78 to "AC-16's cases".
  - Check that the `crew tdd` runs for those tasks name AC-16 and AC-17.
## Notes
- The round-2 returns hold.
  - spec.md:156 now limits the sharing to the primitives, and each module keeps its own rule.
  - Spec.md:168 and :174 mark AC-8 and AC-14 as superseded, by AC-16 and AC-17.
  - Spec.md:184 (Risks) is updated, and plan.md:15 carries the seven weights in `BM25_WEIGHTS`.
  - Plan task 14 (line 61) resolves the agent id inside each tool handler from `getClientVersion()`, with `tools(mode)` called once with the mode alone.
- work.json records `supersededBy` for AC-8 (lines 56-57) and for AC-14 (lines 90-91), and has AC-16 and AC-17 as live criteria at lines 101 and 106.
- Nothing else in the design needs to change.
  - The F5′ composer rule, migration 7 with the triggers, and the lazy tools all fit ADR 0019 and 0020.
  - The `meta` rate counter fits the bridge, which is a new process for each call.
  - The judge's `relate` follows the `personal` pattern.
  - The reversal of ADR 0019's note, F5′ and the key registry are carried into AC-13.
