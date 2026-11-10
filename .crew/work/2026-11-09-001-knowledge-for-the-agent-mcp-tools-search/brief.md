# Brief

## Request

Knowledge for the agent: MCP tools (search, get, propose, update, taxonomy), the knowledge module in the composer so a new project's first session is shown the shared and workspace knowledge that bears on its task within its share of the budget, the judgements (cataloguing, duplicates, contradictions, relevance) through the Judge interface with TypeSafe opt-in and heuristics as the fallback; with no entries the pinned snapshots stay byte for byte.

## Goal

The knowledge store of part 1 (item 2026-11-08-003-knowledge-store-entries-as-markdown-with, its spec in `.crew/work/2026-11-08-003-knowledge-store-entries-as-markdown-with/spec.md`) reaches the agent: the knowledge module joins the engine (`BUILT_IN`, the composer, the MCP server and the `tool` bridge); a new project's first session is shown the knowledge a person pinned for every new project, and every prompt is shown the entries that bear on it, inside the module's share of the budget; an agent searches, reads and proposes knowledge through MCP tools, and its proposals are catalogued and checked for duplicates and contradictions by a judge (TypeSafe when a key is set, heuristics otherwise, exact rules in code).

## Context

Part 1 gives the store: Markdown entries in git repositories per scope, an index, versions, proposals. Nothing reads it for the agent yet: no module in `BUILT_IN`, no contribution, no tool. The engine's contract (ADR 0019) is ready: `contribute(input)` within `budgetChars`, `tools(mode)`, the composer, `WIZARDINGCODE_MODULES`. ADR 0020 built and measured a knowledge contribution once (a share of 0.2, essential entries at session start, a lexical relevance floor on prompts with three rules, FTS5 with bm25, the F5′ composer rule that gives memory what the other modules did not use); that module was withdrawn and its code sits on `archive/knowledge-module`; the ideas may be read and every file is written fresh. The user's brief of 2026-11-08 asks that a new project start with the team's knowledge (personas, strategies, patterns) and that agents have knowledge as well as memory.

## Constraints

- The hook path stays light (ADR 0019, ADR 0022): no process, no network, no TypeSafe in a hook; the judge runs in tools and background work only.
- With knowledge on and no entries, the hook outputs and the memory-alone tool list stay byte for byte (the pinned snapshots): the module says nothing and memory keeps the whole budget.
- Semantic judgements go through the `Judge` interface, TypeSafe opt-in with heuristics as the fallback; exact rules and thresholds stay in code; the TypeSafe skill's guidance (System One questions: Noul, Choice, Score; one narrow judgement per question; state as named fields) is followed.
- Clean room: nothing from claude-mem. Product text in English. The binary keeps its name.
- Part 1's guarantee holds: an agent's write is a proposal; the MCP tools pass the host's agent id as the writer, never a tool argument.

## Acceptance

- The knowledge module is in `BUILT_IN` and on by default; the engine's composer gives memory the budget less what the other modules used; with no entries every pinned hook snapshot and the memory-alone tool list are unchanged.
- A project's first session is shown, at session start, the entries a person pinned (`pinned: true`) in the workspace and the shared repositories, within the module's share, each once per context; a later session of that project is not.
- Every prompt is shown at most two active entries of the project's visible scopes that bear on it by an exact lexical rule, within the module's share, each once per context.
- `knowledge_search`, `knowledge_get`, `knowledge_propose`, `knowledge_update` and `knowledge_taxonomy` are offered inside a project (search, get and taxonomy with `--global` too), with the host's agent id as the writer of a proposal.
- A proposal without an area is catalogued by the judge (TypeSafe: one Choice over the taxonomy with a no-match option; heuristic: a lexicon per area in code) or refused asking for one; a proposal that states what an existing entry states is refused naming it; a proposal that contradicts an existing entry is recorded with the contradiction for the person.
- `knowledge_search` reranks its candidates with the judge when TypeSafe is on and by the lexical rank otherwise.
- The hook latency budgets of `tests/perf/budgets.test.ts` hold with knowledge on.

## Assumptions

- Part 1's spec is the store this part reads and writes; where part 1 changes after the person's review, this part follows.
- The host agent's id reaches the MCP server as `mcp --agent <id>`, written into each host's configuration by `scripts/plugins.ts`; `mcp` by default.
- `pinned` is a new optional frontmatter field of part 1's entry format, kept by part 1's parser as an unknown key until this part defines it.
