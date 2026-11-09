# qa lead's validation of 2026-11-09-001-knowledge-for-the-agent-mcp-tools-search: spec

verdict: returned

## Returns
- R-1 · .crew/work/2026-11-09-001-knowledge-for-the-agent-mcp-tools-search/plan.md:58 · The plan never names AC-16 or AC-17. A grep of the item's files finds them only in `spec.md` and `work.json`. Phase E's heading (line 58) and tasks 15 and 16 (lines 62 and 63) are still tagged `AC-8`, which is superseded. Task 15 carries the security cases only as an inline "(AC-14)", and AC-14 is also superseded. Task 22 (line 78) says "AC-8's cases log it". Each live behavior criterion needs a task that names it for the red and green runs. As written, AC-16 and AC-17 have no task, and the tasks point at criteria that are no longer in force. Make these changes:
  - Replace `AC-8` with `AC-16` in the heading and in tasks 15 and 16.
  - Replace the inline `(AC-14)` in task 15 with `AC-17`, and add `AC-17` to the tags at the start of tasks 15 and 16.
  - Replace "AC-8's cases" in task 22 with "AC-16's cases".

## Notes
- The substance of AC-16 holds and is covered by task 15. The rate rule is in `meta` per agent id. It counts calls that pass the schema and is checked before the judge. The server and the bridge share it. The 21st call is refused with no judge request, and another agent id proceeds. A schema-invalid call does not consume the window and an invalid-area refusal does. The window resets after an hour (plan.md:62, "consume" and "window" present).
- The Risks line (spec.md:184) now matches: 20 calls per hour per agent id, counted in `meta` and shared by the server and the bridge.
- The AC-8 and AC-14 stubs (spec.md:168 and 174) say each is superseded and point to its replacement. `work.json` records the supersession for both.
- AC-15 and the rest are unchanged. The architects' constants change (seven bm25 weights) is a plan detail and does not alter any criterion.
