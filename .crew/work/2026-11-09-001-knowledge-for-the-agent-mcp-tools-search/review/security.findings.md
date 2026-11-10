# security findings for 2026-11-09-001-knowledge-for-the-agent-mcp-tools-search
reviewer: review-security
read: 12 files, risk areas: public-api, auth, personal-data, data-migration

## Findings
- F-1 · advisory · src/mcp/agent-id.ts:21 · auth: a local MCP client picks its own `clientInfo.name`, so by switching between the host prefixes and `mcp` it gets about 11 separate `knowledge.rate:<id>` windows, roughly 220 proposals an hour instead of 20. Part 1's quotas still cap the volume, a person must still accept every proposal, and ADR 0024 already says the id is not authenticated. This is a recorded limit, not a way around the guarantee.
- F-2 · advisory · src/modules/knowledge/tools.ts:420 · public-api, hardening: `knowledge_search.query` has no maximum length, and `knowledge_propose.body` (line 443) has only `min(1)`. The store's size check applies only after redaction, so a local agent can pass an unbounded string. No data or permission is exposed.
- F-3 · advisory · src/modules/knowledge/tools.ts:247 · personal-data: `knowledge_get` puts each entry's `author` line, the person's name, into the agent's context. ADR 0024's "Personal data in part 2" (docs/adr/0024-knowledge-module.md:368-370) still names only `on_behalf_of`. Today every author is the local person, so no new audience sees the name. The section should say this before parts 4 to 6 bring in other people's names.

## Outside the change
- none

## Not answerable
- none

Round five checks:
- **Nothing changed in this item's paths since round four (93af04f).** The cited lines still read the same:
  - `agentIdFromClient` and `checkedAgentId` in src/mcp/agent-id.ts
  - the zod schemas and `REF` in src/modules/knowledge/tools.ts:108 and 412-444
  - `allowProposal` and the redact-then-clip in `judgeProposal` in src/modules/knowledge/propose.ts:28-50 and 95-125
  - the personal-data section of ADR 0024
  
  So round four's three advisories stand unchanged, and no defect is open.
- **The sibling item's new commits do not reach this item's risk paths.**
  - b54a579 changed src/sharing/policy.ts, levels.ts and report.ts. Nothing under src/modules/knowledge/, src/mcp/ or src/hooks/ imports src/sharing/. Only status, doctor, the ui API and server, settings, share, backup and module-schemas do.
  - be1f6b7 is ADR 0025 only.
  - Both belong to item 2026-11-09-002 and were reviewed there.
- **What still holds:**
  - **Boundary:** every tool input passes its zod schema, and the `tool` bridge runs its own `safeParse`. `--agent` is checked against `AGENT_ID` when the server starts, and the client name maps to a fixed list, so no caller text reaches a `meta` key. Refs are checked against `REF` and looked up through the index, never used as a file path. All SQL is parameterised, and the search query is built from quoted tokens.
  - **Auth:** an agent's write always goes through `agentWriter` as a proposal, and no tool argument names the writer. A project the person turned off answers `TURNED_OFF`.
  - **Personal data:** the judge only ever sees redacted, clipped text from at most 8 neighbours, and no name goes to TypeSafe.
  - **Data migration:** 0007 only adds columns and tables, and the 0.6.0 rollback probes show it is harmless to the old binary.
  - **Secrets:** no credential-shaped string in the diff.
- **None of the three findings is in the sibling item's paths.**

Files:
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/mcp/agent-id.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/modules/knowledge/tools.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/modules/knowledge/propose.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/docs/adr/0024-knowledge-module.md
