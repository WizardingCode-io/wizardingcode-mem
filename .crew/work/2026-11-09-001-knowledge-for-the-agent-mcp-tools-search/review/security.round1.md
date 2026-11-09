# security findings for 2026-11-09-001-knowledge-for-the-agent-mcp-tools-search
reviewer: review-security
read: 17 files, risk areas: public-api, auth, personal-data, data-migration

## Findings
- F-1 · advisory · src/modules/knowledge/tools.ts:435 · Any MCP client (or the OpenCode bridge) can send `knowledge_propose` a `body` of any length, because the schema has `z.string().min(1)` and no max. Up to 20 times an hour, `judgeProposal` redacts and tokenises the whole body (src/modules/knowledge/propose.ts:92-99). Only after that does `propose` redact it again and `checkSize` refuse it (src/modules/knowledge/store.ts:486, :536). Nothing oversized gets written and nothing leaves the machine uncut, since the judge's copy is clipped to 2,000 characters. A cap in the schema (the store's size limit) would refuse such a call before any work is done.
- F-2 · advisory · src/mcp/agent-id.ts:24 · Any host can pick its rate window by naming itself after one of the ten known prefixes or anything else (which becomes `mcp`). The 20-an-hour rate is per id, and there are 10 distinct ids, so one host can spread its calls over 10 windows: about 200 proposals an hour instead of 20. Part 1's quotas still cap what waits for a person (5 open proposals per target, 200 per repository). The ADR states that the id is not authenticated, and the id never decides adoption (`agentWriter` + the `kind !== "proposed"` check at tools.ts:390), so this is not a defect for `auth`.
- F-3 · advisory · docs/adr/0024-knowledge-module.md:377 · The ADR's "Known limits of part 2" says `knowledge_propose` still writes when the `knowledge/` folder is gone and the index holds repositories. But tools.ts:331 calls `requireKnowledgeRoot(store, "written", "the agent")`, which refuses that write. The limit recorded for the risk area no longer matches the code, so the bullet should be removed.

## Outside the change
- none

## Not answerable
- none

Basis for the answers (no defect found):
- **Boundary, public-api:** every argument is validated where it enters:
  - The zod schemas in tools.ts:402-445 check the scope enum, the `REF` pattern for refs and the `SLUG` pattern for slugs. The bridge, src/cli/commands/tool.ts:58, runs `safeParse` against the same schemas.
  - `--agent` is checked against `AGENT_ID` (agent-id.ts:30), and `agentWriter` checks it again.
  - Query text reaches FTS only quoted (`anyOf`, src/util/words.ts:49), confined to the text columns (`ftsMatch`). Every other value is bound as a parameter.
  - The OpenCode plugin passes arguments as JSON on stdin with an argv array, never through a shell.
  - `knowledge_get` never resolves a ref as a path. In global mode a `project/` ref finds nothing, because `visibleRepos(db, null)` matches no project row.
  - The tool list and its schemas are pinned by tests/unit/__snapshots__/mcp-tools-list.test.ts.snap.
- **Auth:**
  - An agent's write can only be a proposal (store.ts `propose` takes an `AgentWriter`). No tool argument names the writer, sets `pinned` or sets `status`.
  - A project the person turned off answers TURNED_OFF in tools.ts:461, and src/hooks/handle.ts:65 returns before any module is asked.
  - The rate counter is read and written in one `withWrite` (propose.ts:28-50).
- **Personal-data:**
  - The hooks show only the active, problem-free entries of `visibleRepos`. Each line goes through `inert` and is inside the wrapper.
  - No open proposal is ever injected, searched or sent to TypeSafe. Proposals go to the heuristic only (propose.ts:128-131).
  - The `RelateInput` type requires `Redacted` text (src/judge/types.ts:76-77). TypeSafe gets titles and bodies only, no author or `on_behalf_of`, and only when a key is set.
  - `on_behalf_of` puts the person's name, already the entries' author, in one more place on this machine. The ADR documents it, and part 1's retention and erasure apply.
  - `knowledge_shown` holds ids, an event, a rule and a time. `compact` prunes the rows of gone sessions and gone repositories, and dropping a repository's rows removes them too.
  - The duplicate log line names a ref and the agent id, no text.
- **Data-migration:**
  - 0007_knowledge_agent.sql only adds columns, the `knowledge_fts` table, `knowledge_shown` and indexes. Nothing is destructive and nothing is backfilled: it applies with 6 on an empty index, and the index can be rebuilt from the files.
  - Rollback is to 0.6.0, which ignores the module's tables (ADR 0024:380). `user_version` stays 7.
- **Secrets:** none in the item's paths.
- **Sibling item 2026-11-09-002 (src/sharing/, share.ts, src/ui/, ui/src/, backup.ts, ADR 0025):** not reviewed here, and no finding is attributed to it.

Files read (all under /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/):
- src/modules/knowledge/tools.ts, propose.ts, visible.ts, contribute.ts, author.ts, index.ts
- src/modules/knowledge/index-store.ts (the readers and `requireKnowledgeRoot`), store.ts (`propose`)
- src/modules/knowledge/migrations/0007_knowledge_agent.sql
- src/mcp/server.ts, src/mcp/agent-id.ts
- src/cli/commands/tool.ts, src/install/opencode-plugin.ts
- src/judge/typesafe.ts, src/judge/types.ts
- src/hooks/handle.ts
- docs/adr/0024-knowledge-module.md (part 2)
