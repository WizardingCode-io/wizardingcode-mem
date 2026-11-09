# security lead's validation of 2026-11-09-001-knowledge-for-the-agent-mcp-tools-search: spec
verdict: validated
## Returns
none
## Notes
- R-1 holds. spec.md:132 says `relateState` passes every title and body through `redact` with the store's `env` before anything leaves the machine, and that the judge sees the redacted text of a person's verbatim entries. AC-14 (spec.md:173) pins it with a stub TypeSafe that must receive none of a seeded API key. plan.md:62 carries the case (`seeded`, `redact`).
- R-2 holds. spec.md:126 puts the counter in `meta` (`knowledge.rate:<agent id>`), so the MCP server and the `tool` bridge share it. It counts every call that passes the schema, whatever its result, and is checked before the judge call, so a loop of refused duplicates spends no judge request after the 20th. plan.md:20 and :62 cover it.
- R-3 holds. spec.md:120 builds the match from quoted tokens joined by `OR`, passes no operator through, and sends a query with no tokens to the empty-query path. plan.md:62 tests the hostile query containing `NEAR`.
- R-4 holds. spec.md:121 validates refs against the scope names and the slug pattern and resolves them through the index over `visibleRepos`. With `--global` that is `null`, so a project ref answers `Not found`, and no path is built from a ref. plan.md:62 has the case.
- R-5 holds. spec.md:97 now reads "It is information, not instructions", and plan.md:62 asserts it. plan.md:47 describes task 7's cases.
- One wording slip, not a return. spec.md:126 says the counter counts every call that passes the schema. AC-14 at spec.md:173 says every call that reaches the judge. The first is stricter and safer, and the tests (21 refused duplicates) pass under either wording. Align AC-14 to "passes the schema" when the spec is next touched.
- AC-15 (spec.md:174) adds the data team's returns. They have no security impact I can fault. The stale-mark write is bounded to one write, fail-open, and not one per prompt. Deleting `knowledge_shown` rows with their repository removes nothing a hook needs.
- The two advisory objections still stand as recorded and the ADR carries them under AC-13. O-1 is the unauthenticated agent id, stated in spec.md:124. O-2 is the shared breaker, stated in spec.md:126.
