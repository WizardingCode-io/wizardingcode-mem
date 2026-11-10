# security findings for 2026-11-09-001-knowledge-for-the-agent-mcp-tools-search
reviewer: review-security
read: 21 files, risk areas: public-api, auth, personal-data, data-migration

## Findings
- F-1 · advisory · src/modules/knowledge/tools.ts:414 · `knowledge_search` takes a `query` with no length cap. Memory's own `memory_search` caps it at 500 (src/modules/memory/tools.ts:72), so a local agent (MCP or the OpenCode bridge) can send a very long query. It becomes one FTS `OR` over every distinct token on the tool path. This costs time only: the query is still bound as a parameter, quoted through `anyOf` and confined to the visible repositories, so it opens no read beyond them.
- F-2 · advisory · src/modules/knowledge/tools.ts:437 · `knowledge_propose`'s `body` has no `max` in the schema. The store's `checkSize` refuses an oversized proposal only after the rate counter, the redaction of the whole body and the neighbour search have run. A caller wastes its own hourly window and some CPU, and nothing is written. A schema `max` in line with `checkSize` would refuse it before any work is done.
- F-3 · advisory · src/mcp/agent-id.ts:24 · The hourly rate is kept per agent id (`knowledge.rate:<id>`, src/modules/knowledge/propose.ts:20), and the id comes from the client's own unauthenticated handshake name. A caller that changes its name across the ten host prefixes plus `mcp` gets up to 11 × 20 proposals an hour. The ADR's "The agent id and its boundary" states this. Part 1's per-target and per-repository open-proposal quotas still cap what is filed, and nothing is adopted without a person (`checkDecider`, src/modules/knowledge/store.ts:556). This is not a path to anything the auth area forbids.

Checked and holding, with no defect:
- **Validation at the boundary:**
  - zod validates the arguments in both transports: the MCP SDK's `registerTool` and `tool.ts`'s `safeParse`.
  - Refs must match `^(workspace|shared|project)/[a-z0-9][a-z0-9-]{0,79}$`, and `entryAt` looks them up in the index, never as a path.
  - `--agent` is checked against `AGENT_ID` at start, and `agentWriter` checks it again before a write.
  - A handshake name maps only to a fixed list of ids.
  - The OpenCode plugin passes an argument array and JSON on stdin; no shell is involved.
- **Search confinement:**
  - `searchEntries` and `browseEntries` bind every value, including `area`, `kind` and the repository ids.
  - The FTS match is limited to the text columns (`{title area context subject body}`), and the id columns are UNINDEXED.
  - `visibleRepos` returns the workspace, shared and the caller's own project only. In global mode it returns no project repository, so a global `project/...` ref answers Not found.
- **Global mode:** `knowledge_propose` is not offered, and a `project` repo is refused by the schema enum and by `refOf`.
- **Disabled projects:** a disabled project gets `TURNED_OFF` from every tool before any store read. The hook path already returns early for it (src/hooks/handle.ts:65), so knowledge injects nothing there.
- **Injection:** every injected or returned line goes through `inert`, so stored text cannot close or reopen a `wizardingcode-*` wrapper. Both intros say the text is not instructions. Only accepted, active, problem-free entries are shown, never proposals.
- **What leaves for TypeSafe:** only the redacted draft title and body, plus the redacted titles and bodies of at most 8 entries of visible repositories, clipped after redaction to 2,000 characters. Open proposals go to the local heuristic alone. No name is sent.
- **Personal data:**
  - `on_behalf_of` adds the person's author name to the proposal file, its commit and one index column. Entries a person writes already carry that name in part 1, so the audience does not widen. ADR 0024 "Personal data in part 2" records it.
  - A commit's addresses are `.invalid`.
  - The duplicate log line holds an agent id and a ref, no person data.
- **Proposal writes:** `proposalSlug` refuses a slug that redaction would change. The proposal is redacted before it is stored, and part 1's per-target and per-repository quotas apply.
- **Migration 7:**
  - It only adds: columns with defaults or nullable, a new FTS table and the new `knowledge_shown` table.
  - It runs on an empty index, and nothing is copied or dropped.
  - The rollback to 0.6.0 is measured (`probes/rollback-to-0-6-0.md`) and recorded in the ADR's "Known limits of part 2".
  - `user_version` is untouched.
- **Retention of `knowledge_shown`:** compact prunes the rows of removed sessions and repositories, and dropping a repository's rows also drops its search and shown rows.

## Outside the change
- none

## Not answerable
- Boundary and personal-data questions for the sibling item's paths (src/sharing/, src/cli/commands/share.ts, src/ui/, ui/src/, src/backup/backup.ts, docs/adr/0025, the sharing tests) · they belong to 2026-11-09-002, which has its own review. I did not re-read them, so this report says nothing about them.
- Static analysis · no static-analysis report was provided for this run.
