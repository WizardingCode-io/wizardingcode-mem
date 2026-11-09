# security findings for 2026-11-09-001-knowledge-for-the-agent-mcp-tools-search
reviewer: review-security
read: 16 files, risk areas: public-api, auth, personal-data, data-migration

## Findings
- F-1 · advisory · src/mcp/agent-id.ts:21 · auth: the agent id comes from the client's own handshake name. A local MCP client can switch between the eleven known host prefixes and `mcp` to get eleven `knowledge.rate:<id>` windows, so up to about 240 proposals an hour instead of 20. Part 1's quotas (5 open proposals per target, 200 per repository) still cap it, and a person must still accept every proposal. ADR 0024 already states the id is not authenticated, so this is a recorded limit, not a way past the guarantee.
- F-2 · advisory · src/modules/knowledge/tools.ts:420 · public-api: `knowledge_search.query` has no maximum length in the schema, and `knowledge_propose.body` has only `min(1)`. The store's `checkSize` limits the body only after redaction, and the search query is tokenised whole. A local agent can hand over an arbitrarily large string. This is hardening; no data or permission is exposed.
- F-3 · advisory · src/modules/knowledge/tools.ts:247 · personal-data: `knowledge_get` now puts each entry's `author` line in the agent's context. That line holds the person's author setting or git `user.name`, so the name reaches the agent's model provider. ADR 0024's "Personal data in part 2" names only `on_behalf_of`, though the tool contract does list `author` among the nine keys. Today every entry author is this machine's person, so no wider audience gets it, but the section should say so before parts 4 to 6 bring other people's names.

## Outside the change
- none

## Not answerable
- none

Checked and holding, with no finding:
- **Boundary:** every tool input is validated by its zod schema. The MCP server checks it and the `tool` bridge runs `safeParse` itself. `--agent` is checked against `AGENT_ID` at start (exit 64), and the client name is mapped to a fixed list, so no caller text reaches a `meta` key. `knowledge_get` refs must match a scope/slug pattern and are looked up through the index, never as a file path. The search query is built from tokens quoted by `anyOf` and limited to the text columns. All SQL is parameterised.
- **auth:**
  - An agent's write goes through `agentWriter` and is always a proposal (store.ts:368). No tool argument names the writer, and an agent cannot set `pinned`.
  - In a project the person turned off, all three tools answer `TURNED_OFF`, and the hooks return early (handle.ts:65).
  - `--global` drops the `project` repo option from the schema. A global `knowledge_get` of a project ref finds no visible repository and answers Not found.
- **personal-data:**
  - The hooks show only active, problem-free entries of `visibleRepos`, passed through `inert` inside the wrapper. Open proposals are never shown or searched. Their text goes only to the local heuristic judge, and a duplicate refusal names only the proposal's id.
  - `judgeProposal` redacts, then clips, the draft and at most 8 entry neighbours before either judge reads them. TypeSafe receives no name.
  - `alreadyShown` and `dropStaleShown` limit a session's `knowledge_shown` rows to those written since the session started. Those rows hold ids only.
  - The duplicate log line carries the ref and the agent id, nothing personal.
  - The ADR records that backups now carry the indexed entry text.
- **data-migration:** 0007 is additive: new columns with defaults, a new FTS table and a new table, at module version 7, with `user_version` left at 7. The 0.6.0 rollback probes show the old binary ignores it and changes nothing. `refreshStale` now refuses linked roots and forgets nothing when the knowledge root is absent.
- **public-api:** with the modules setting at `memory`, the tool lists and instructions are pinned byte for byte. The new tools and the global instructions are recorded in ADR 0024 and in the snapshot tests.
- **Secrets:** I found no credential-shaped string in the diff.

None of the findings falls in the sibling item's paths (2026-11-09-002, the sharing policy).

Relevant files:
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/mcp/agent-id.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/modules/knowledge/tools.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/docs/adr/0024-knowledge-module.md
