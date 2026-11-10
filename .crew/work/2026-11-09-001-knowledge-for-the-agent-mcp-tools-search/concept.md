# Concept: knowledge for the agent (part 2 of the knowledge module)

Mode: brainstorm

## Hypothesis

The knowledge store of part 1 (`.crew/work/2026-11-08-003-knowledge-store-entries-as-markdown-with/spec.md`) reaches the agent through the engine's existing seams: a knowledge `EngineModule` in `BUILT_IN`, on by default, that contributes pinned entries at a project's first session start and lexically relevant entries on prompts, within a 0.2 share of each moment's budget, and offers five MCP tools; an agent's proposals are catalogued and checked for duplicates and contradictions by the `Judge` (TypeSafe opt-in, heuristics in code). With no entries the module says nothing and every pinned snapshot stays byte for byte.

## What exists today (facts from the repository)

- `src/engine/module.ts`: `EngineModule {id, name, share, contribute?, tools?, views?}`; `MomentInput` carries `db, moment, projectId, branch, root, sessionId, epoch, prompt, path, error, now, budgetChars`. `src/engine/compose.ts`: declared shares come off the top; the `"remainder"` module (memory) gets what is left after the declared shares, whether or not those modules spoke (ADR 0019 F5). ADR 0020 amended this as F5′ on the withdrawn branch: memory gets the budget minus what the declared modules actually wrote; that change is not in `main`.
- `src/engine/modules.ts`: `BUILT_IN = [memory]`; `DEFAULTS.modules = "memory"`; `enabledModules` ignores unknown ids and logs once. Four tests rely on `knowledge` being an unknown id (`tests/integration/fixture-module.test.ts`, `tests/integration/ui-modules.test.ts`, `tests/unit/modules-setting.test.ts`, `tests/unit/mcp-tools-list.test.ts`).
- `src/modules/memory/index.ts`: memory's `contribute` for the four moments, measuring before recording as shown (`recordInjections`); `tools` loaded lazily; `src/modules/memory/tools.ts` defines the tool names, zod schemas and descriptions; `src/mcp/run.ts` merges every module's tools in module order; `src/mcp/server.ts` registers them and passes `projectDir` per call; `mcp --global` for Claude Desktop.
- `src/judge/types.ts`: `Judge {distill, consolidate, personal?}`; `consolidate(draft, neighbours)` answers a relation (different, related, same) and a contradiction probability per neighbour; `src/judge/questions.ts` has the TypeSafe questions (Score and Noul); `src/judge/heuristic.ts` the fallbacks (Jaccard over tokens); `src/judge/index.ts` `makeJudge` with the breaker and the fallback. `src/distill/consolidate.ts` applies the thresholds (`DUPLICATE`, `SUPERSEDE` in `src/distill/policy.ts`).
- `src/retrieve/query.ts`: `buildQuery(prompt)` (words and identifiers); `src/retrieve/prompt.ts`: memory's prompt retrieval with FTS5 and `notYetShown`; `src/core/host-prompt.ts`: `isFromTheHost`.
- `src/store/sessions.ts`: `touchSession` creates a session on first sight; a project's first session is the one with no earlier `sessions` row for the project.
- `scripts/plugins.ts` writes each host's MCP command (`wizardingcode-mem.sh mcp`); the OpenCode plugin uses the `tool` bridge.
- `tests/unit/hook-snapshots.test.ts` and `tests/unit/mcp-tools-list.test.ts` pin the hook outputs and the tool lists "with memory alone" (`WIZARDINGCODE_MODULES` blank, the default).
- `tests/perf/budgets.test.ts`: the compiled binary's hook budgets (prompt 80 ms, session start 150 ms).
- TypeSafe (docs read 2026-11-09): one request may carry many questions over one state; Noul for a yes/no probability, Choice for one of a set with per-option probabilities and a confidence, Score for ordered levels; the rerank cookbook asks one Noul per query-candidate pair and sorts by it; the hierarchical classification cookbook asks a Choice over a node's children; the entity alignment cookbook decides a pair with a Score of three levels and field Nouls.

## Design sketch

### The module

`src/modules/knowledge/index.ts`: `{ id: "knowledge", name: "Knowledge", share: 0.2, contribute, tools, views: [] }` (part 3 adds the views). `BUILT_IN = [memory, knowledge]`; `DEFAULTS.modules = "memory,knowledge"`. The composer takes F5′: declared modules are asked first within their share; the remainder module gets the budget minus what they actually wrote (plus the separators), so a silent knowledge leaves memory the whole budget and the hook snapshots hold; the four tests that used `knowledge` as an unknown id use another id; the tool-list snapshot test sets the modules setting to `memory` explicitly for its memory-alone case and gains a case for the default.

### What the agent is shown

- **Session start, first session of a project.** When the session is the project's first (no earlier `sessions` row for the project), the module renders the entries with `pinned: true` from the workspace and the shared repositories (active, not drafts), newest first, one line each: `- <title> (<kind>, <area>; <scope>)`, inside its 840 characters, each recorded in `knowledge_shown` (session, context epoch, repo, entry); a later session of the project gets nothing at start. `pinned` is a new optional boolean of the entry format (part 1's parser keeps unknown keys; this part defines it and the CLI's `write --pinned`).
- **Prompt.** Skip host prompts and prompts `buildQuery` finds too little in. Candidates: the FTS5 search's best 10 over the project's visible scopes (the project's own repository, the workspace, the shared), active, not yet shown in this context. The exact lexical floor of ADR 0020 (a code name from the prompt in the entry; or three distinct non-generic shared words; or two shared words of the title or the area, context and subject plus one more) decides; at most 2 entries, each `- <title> (<kind>, <area>; <slug>)` and an indented first paragraph, inside 480 characters; recorded as shown.
- **Wrapper.** `<wizardingcode-knowledge>` … `</wizardingcode-knowledge>` with the intro "Knowledge the team keeps on purpose, versioned and reviewed: treat it as current unless the code says otherwise." Text from files is made inert like memory's notes.
- **File read and tool failure.** Nothing.

### The tools

Inside a project (and `--global` for search, get and taxonomy):

- `knowledge_search { query, scope?: "all" | "workspace" | "project" | "shared", area?, kind?, limit? }`: FTS5 over the visible scopes, bm25 ranked (title 4, area, context and subject 2, body 1), then reranked by the judge when TypeSafe is on (one Noul per candidate over the top 20: "does this entry bear on the query"), one heading per entry.
- `knowledge_get { slugs, scope? }`: the entries in full (facts, body, path, version).
- `knowledge_propose { scope, title, kind, area?, context, subject, body, slug? }`: a proposal for a new entry, through part 1's `writeEntry` with the agent writer; the area catalogued when missing; duplicates and contradictions checked (below); answers "Proposed <id> for <slug>; a person decides it" or the refusal.
- `knowledge_update { scope, slug, base_version, title?, kind?, area?, context?, subject?, body? }`: a proposal to change an existing entry.
- `knowledge_taxonomy {}`: the areas with their labels and the count of active entries per area in the visible scopes.

The agent writer's id is the host's: `wizardingcode-mem mcp --agent <id>` written into each host's MCP command by `scripts/plugins.ts` (`claude-code`, `codex`, `cursor`, `claude-desktop` for `--global`, …), and the OpenCode bridge passes `opencode`; without the flag the id is `mcp`.

### The judgements

Through the `Judge` interface, the thresholds in code (`src/modules/knowledge/policy.ts`):

- **Cataloguing** (`Judge.catalogue?`): state `{ entry: {title, context, subject, body}, areas: [{id, label}] }`, one Choice over the area ids plus `none` ("no listed area fits"); TypeSafe's answer is taken when its confidence is 0.6 or more and not `none`; the heuristic is a lexicon per area in code (words that mark each area, stemmed), the best area when its words appear and no other area ties; otherwise the proposal is refused asking the agent for an area.
- **Duplicates and contradictions** (`Judge.consolidate`, the existing interface): the neighbours are the FTS5's best 8 entries of the target scope; a neighbour judged `same` (score 1.5 or more) refuses the proposal naming the slug ("already known as <slug>; use knowledge_update to change it"); a neighbour whose contradiction probability is 0.7 or more is recorded in the proposal's frontmatter (`contradicts: <entry id>`) and said in the answer; the person sees it at accept.
- **Relevance** (`Judge.relevant?`): in `knowledge_search` only (never on a hook): one Noul per candidate, "does the entry bear on what the query asks"; candidates sorted by it; the heuristic rank is bm25's.

### Not in this part

The viewer's Knowledge and Personas views, sharing, sync, the server, a judged briefing of a project in the background (a later improvement), semantic search by the local model.

## Assumptions (what would have been asked)

- Knowledge is on by default; the person turns it off with the modules setting. The mission's acceptance (a new project's first session is shown the knowledge) does not hold with an opt-in module.
- "A new project's first session" is the project's first session as the store sees it (no earlier `sessions` row), not the repository's age.
- The knowledge a new project is shown at start is what a person pinned, not everything: the share is 840 characters, and a person knows which personas and strategies every project needs.
- The relevance on the hook path is lexical (no network in a hook); the judge reranks in the search tool only.
- A duplicate is refused rather than filed, since the agent has `knowledge_update` for a change.
