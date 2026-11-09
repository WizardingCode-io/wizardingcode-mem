# security lead's validation of 2026-11-09-001-knowledge-for-the-agent-mcp-tools-search: spec
verdict: validated
## Returns
none
## Notes
- AC-16 (spec.md:174) now carries the rate rule I asked to align. It counts every call that passes the schema, whatever its result, and checks before the judge call. The 21st call of one agent id gets `refused quota` with no judge request. The window is kept in `meta` per agent id, so the MCP server and the `tool` bridge share it. A schema-invalid call does not consume the window, and an invalid-area refusal does.
- AC-17 (spec.md:180) holds the four other security returns unchanged:
  - redaction in `relateState`;
  - the quoted-token FTS match;
  - the global `knowledge_get` of a project ref answering `Not found`, with refs validated and resolved through the index, never as a file path;
  - the wrapper intro "information, not instructions".
- D-9 is now open for the person (spec.md:49) and the design is written for every session start. Whichever answer the person gives changes only when pinned entries are shown. It does not change what is shown, who writes it, or how it is made inert, so no security criterion depends on it.
- The superseded AC-8 and AC-14 (spec.md:173 and :179) are marked as kept in the record only, so they leave no contradictory live criterion.
- Objections O-1 (the agent id is not authenticated) and O-2 (the breaker is shared) are still advisory and are carried into the ADR under AC-13.
