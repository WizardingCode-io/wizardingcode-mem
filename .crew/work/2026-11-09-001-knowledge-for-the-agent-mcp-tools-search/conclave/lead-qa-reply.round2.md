# qa lead's validation of 2026-11-09-001-knowledge-for-the-agent-mcp-tools-search: spec

verdict: returned

## Returns
- R-1 · .crew/work/2026-11-09-001-knowledge-for-the-agent-mcp-tools-search/spec.md:168 · AC-8 still tests the old rate rule. Its text says "the 21st proposal of a server process in an hour is `refused quota`". Line 126 and plan.md:62 now count 20 calls per agent id per hour in `meta` (`knowledge.rate:<agent id>`), shared with the `tool` bridge. Rewrite the AC-8 clause to the per-agent-id, `meta`-backed rule. Otherwise the acceptance text and the test in task 15 prove different behaviour.
- R-2 · .crew/work/2026-11-09-001-knowledge-for-the-agent-mcp-tools-search/spec.md:182 · The Risks section still says "20 per hour per server process". Change it to "per agent id, counted in `meta`".
- R-3 · .crew/work/2026-11-09-001-knowledge-for-the-agent-mcp-tools-search/spec.md:173 · AC-14 says the limiter counts "every `knowledge_propose` call that reaches the judge". Line 126 says it counts "every call that passes the schema, whatever its result", checked before the judge call. A call refused for `stale`, `invalid`, `exists` or `quota` never reaches the judge, so the two statements give different counts. Pick one wording. I suggest the line 126 wording, because task 15's "21 refused duplicates → 21st refused quota" works under either. Then add a task 15 case that a schema-invalid call (rejected before the handler) does not consume the window, and that an `invalid` area refusal does. That case is what proves which rule holds.

## Notes
- My Round 1 returns hold in plan.md.
  - R-1: task 17 (plan.md:64) drives a real `initialize` with claude-code, Cursor and nonesuch, tests the `--agent codex` override, and checks that `mcp --agent "Bad Id"` exits 64 at start. Task 15 (plan.md:62) has the `tool` bridge propose writing `agent:opencode`.
  - R-2: task 15 has the TypeSafe duplicate case (Score 2, Noul 0.1), the threshold edges (1.5/1.49, 0.49/0.5, 0.7/0.69) and `judged_by: none` on a written proposal.
  - R-3: task 17 asserts the global `instructions` name the two knowledge tools, and are byte for byte the old text with the setting at `memory`.
- AC-14 and AC-15 are provable as written. Task 15 has a request-body redaction check against a stub TypeSafe, a hostile FTS query, the global `Not found` for a project ref, and the `meta` counter shared between the server and the bridge. Task 3 has the `EXPLAIN QUERY PLAN` check on the trigger delete and a 2,000-entry rebuild under 2 s. Task 7 has the visible-ids `MATCH` check and the single-write stale mark. Task 18 has the compact transaction and `--dry-run` cases. Task 20 has the 30 non-visible repositories.
- The architects' evidence redesign is covered by task 5. It tests `namesIn`, `sharedStems` and `tellingOf` directly. It tests `knowledgeEvidence` for all three rules and for the area-only case. It requires `prompt-matches.test.ts` and `prompt-counts.test.ts` to pass unchanged after the move.
- AC-1 to AC-7 and AC-9 to AC-13 are otherwise unchanged and still have test-first tasks. AC-12 keeps its `crew tdd before` at task 0 and `crew tdd after` at task 20.
