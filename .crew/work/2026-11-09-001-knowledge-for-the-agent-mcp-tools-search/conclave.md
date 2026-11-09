# Conclave: knowledge for the agent

Checklists read: `endpoint` (the three MCP tools are an interface other programs call) and `migration-or-restore` (knowledge migration 7 adds a column, two tables and triggers). The change is not a login, a payment, an upload, a sync with a third party, a redirect, a deletion, a merge or a screen.

## Assumed by good practice

- Every tool validates its input at the boundary with a zod schema in the module's own shape (the area enum built from the taxonomies, `limit` 1 to 25, `refs` 1 to 10), answers a refusal as one line `refused <code>: <message>` with part 1's codes, and lets the MCP server's existing catch turn any other failure into `wizardingcode-mem: <message>` without a stack (AC-6, AC-7, AC-8).
- Every list is bounded: `knowledge_search` at most 25 lines, `knowledge_get` at most 10 refs, each body clipped at 8,000 characters and the whole answer at 32,000; pinned lines and relevant entries inside the module's share (AC-3, AC-4, AC-7).
- A rate limit on writes beside part 1's quotas: 20 proposals per server process per hour (AC-8).
- A migration that adds columns and tables and fills the FTS index from existing rows, reversible by dropping them; a backup first when the module already had a version (part 1's pass does this); the triggers sit on a module table, never on a core table (AC-2).
- Nothing on the hook path spawns a process, opens the network or rebuilds an index; a module that cannot answer stays silent and logs once per process (AC-5).
- Text from files is inert inside the wrapper, as memory's notes are; an echoed wrapper is stripped before distillation (AC-3, AC-4).
- `--global` never reads a project's repository (D-15, AC-7).

## Decisions only the user can make

Recorded on the item with their conservative defaults; where nobody watches, the validator applies the stated default under `stated-default`:

- D-1: on by default or opt-in (default: on by default, an explicit `memory` honoured as opt-out).
- D-2: what a new project's first session is shown (default: pinned entries; its first-session clause superseded by D-9).
- D-3: relevance on the hook path (default: the exact lexical floor).
- D-4: a duplicate proposal (default: refused naming the entry).
- D-5: a contradicting proposal (default: recorded, never refused).
- D-6: cataloguing a proposal without an area (default: the judge picks; superseded by D-10).
- D-7: how the server learns the agent id (default: a flag per host; superseded by D-12).
- D-8: the composer's rule (default: F5′).
- D-9: when pinned entries are shown (default: every session start, once per context).
- D-10: the area of a proposal (default: a required enum; cataloguing by a judge waits for part 3).
- D-11: the tools (default: three with fixed answer shapes).
- D-12: the agent id (default: the handshake's client name mapped in code, `--agent` an override, `mcp` otherwise).
- D-13: a rerank in search (default: none in this part).
- D-14: duplicates and contradictions (default: a knowledge-specific `Judge.relate`, memory's thresholds).
- D-15: what `--global` sees (default: the workspace and the shared repositories only).
- D-16: freshness on the hooks (default: hooks use the index as it is; the drain rebuilds).

The endpoint checklist's "who may call it": any agent whose host connects to the MCP server or the `tool` bridge, as for memory's tools today; its "which fields it exposes": an entry's full text to the agent inside a project, and the workspace's and the shared repositories' to a global client (D-15); no personal data beyond the author's name already in the files.

## Proposals

- A judged selection of entries for a new project in the background (the drain asks TypeSafe which shared and workspace entries bear on the project's name, remote and first prompt, and the next session start shows them): a later item, once the drain's refresh exists.
- A rerank of `knowledge_search` by the local embedding model, as `memory_search` does: a later item.
- Promotion of the author's user rules into pinned knowledge entries, with the memory side hidden where the entry is shown: a later item, with part 3's viewer to decide them.

## Warnings

- The agent id on a proposal is not authenticated: it comes from the MCP client's name or a local flag, which any local configuration can set. It tells an agent from a person, which is all part 1's guarantee needs, but `proposed_by` is not proof of which host proposed. Recorded as an advisory objection; the ADR says so.
- The TypeSafe breaker is shared between the tool path and distillation: a run of tool-path failures opens it for the drain too, and the reverse. Acceptable for one key and one service; recorded as an advisory objection.
