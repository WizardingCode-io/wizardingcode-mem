# security findings for 2026-11-09-001-knowledge-for-the-agent-mcp-tools-search
reviewer: review-security
read: 19 files, risk areas: public-api, auth, personal-data, data-migration

## Findings
- F-1 · advisory · src/modules/knowledge/tools.ts:240 · `knowledge_get` now gives the agent each entry's `author:` line, which is the person's name (from the setting or the global git `user.name`), so the name reaches the agent's model provider. Before this change no agent tool returned it. The audience is the person's own agent, so this is not a broader audience. Still, ADR 0024's "Personal data in part 2" (docs/adr/0024-knowledge-module.md:366-368) lists `on_behalf_of` and TypeSafe but not this output. Part 1's "nothing leaves the machine" is no longer the whole story, and the gap matters once parts 4 to 6 bring other people's names into shared repositories.
- F-2 · advisory · src/mcp/agent-id.ts:26 · The hourly rate is keyed by an unauthenticated id. A host that reconnects under several of the ten known client names, or under `--agent` ids, gets 20 proposals per hour for each id. Part 1's per-target (5) and per-repository (200) quotas still bound what is written, and the TypeSafe breaker is shared with distillation (ADR "Rate, cost and the shared breaker"), so the only cost is judge requests. The ADR records the id as not authenticated, so this is hardening, not a defect.
- F-3 · advisory · src/modules/knowledge/tools.ts:78 · `knowledge_search` and `knowledge_get` are announced with `readOnlyHint: true`, but each call runs `openRepo` and `ensureFresh` under the repository's lease. That can rewrite index rows and put back an interrupted operation's files (ADR "Freshness"). These are cache and recovery writes, never the person's content, but the hint promises the client more than the call does.
- F-4 · advisory · src/modules/knowledge/tools.ts:437 · `knowledge_propose`'s `body` has a minimum length but no maximum. A large body is redacted and searched before part 1's `ENTRY_MAX_BYTES` (256 KiB) refuses it at the write. The judge only reads the first 2,000 characters, and the transport bounds the message, so this only affects local cost.

What holds, checked against the code:
- **Boundary:**
  - Every argument is checked by the zod schema before it is used, both over MCP and through the `tool` bridge (`tool.ts:58`, `safeParse`).
  - References are checked against `REF` again at use and looked up through `entryAt` over `visibleRepos`, never as a file path. Under `--global`, a `project/` ref answers `Not found`.
  - The search match is built through `anyOf` with every token quoted, limited to the text columns, and the `area` and `kind` filters are bound parameters.
  - The OpenCode plugin starts the binary with an argument array and passes the JSON on stdin, so no shell is involved.
- **Auth:**
  - No tool argument names the writer. `agentWriter` checks the id against `AGENT_ID`, and `agentIdFromClient` maps the client's name to a fixed list or to `mcp`, so a client cannot choose an arbitrary id.
  - `--agent` is checked when the server starts.
  - Only a proposal can be written (`written.kind !== "proposed"` throws), and no field of a proposal sets `pinned`.
  - The rate is checked in one write transaction, before the judge.
  - In a project the person turned off, every tool answers before reading anything, and the hooks return early (`handle.ts:65`).
- **Personal data:**
  - The hooks show only the visible repositories' active entries that have no problem, through `inert`, under intros that call them information or background, not instructions.
  - What goes to TypeSafe is redacted with the store's env and then clipped, at most 8 neighbours, and open proposals never go to TypeSafe.
  - `knowledge_shown` keeps ids only. Compact and repository deletion remove its rows.
  - `on_behalf_of` is recorded in the ADR, and erasure follows part 1's.
  - The duplicate log line names only the ref and the agent id.
- **Data migration:** 0007 only adds columns and tables and runs on an empty index. Rollback to 0.6.0 was measured (probes/rollback-to-0-6-0.md): 0.6.0 changes no row and drops nothing. The ADR states this in place of a down migration.
- **Public API:**
  - With the modules setting at `memory`, the tool lists and the instructions are pinned byte for byte by snapshot.
  - The new default `memory,knowledge`, the added tools and the extra sentence in the global instructions are announced in ADR 0024 part 2, the README and CLAUDE.md.

## Outside the change
- src/mcp/server.ts:64 · A tool's unexpected failure is answered as `wizardingcode-mem: <error.message>` with `isError`, which can carry local paths to the model. This is the existing pattern, which the knowledge tools inherit, not something this diff adds. Debt.
- No finding falls in the sibling item's paths (2026-11-09-002: src/sharing/, src/ui/, ui/src/, src/cli/commands/share.ts, src/backup/backup.ts). They were not reviewed here beyond confirming that this item's tools and hooks do not read the sharing policy, and that TypeSafe judging is outside its scope (the team server).

## Not answerable
none
