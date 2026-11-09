# Concepts brief: knowledge for the agent

## Overview

The knowledge store of part 1 reaches the agent: a knowledge `EngineModule` joins `BUILT_IN`, on by default; at every session start it shows the entries a person pinned, and on prompts the entries that bear on the prompt by an exact lexical rule, inside a 0.2 share of each moment's budget that memory gets back whenever knowledge is silent; three MCP tools (`knowledge_search`, `knowledge_get`, `knowledge_propose`) let an agent search, read and propose, the proposal carrying the host's agent id and the person it worked for; a knowledge-specific judge method checks a proposal for duplicates and contradictions against every visible entry and open proposal. The concept (`concept.md`) went to six reviewers in brainstorm mode (`spec-review/brainstorm-goldfish-*.md`); this brief is the concept after them.

## Analysis

**Pinned only at a project's first session reaches almost no one.** Every project the store knows has a `sessions` row, the history import creates rows, `touchSession` runs before `compose`, a resume or a capture-only host skips the contribution, and an entry pinned later never reaches an existing project (zoom-out, comprehension, design, readiness, codebase, structural). Pinned entries are now shown at every session start, once per context, within the share; the mission's "a new project's first session" is one case of it. When they do not fit, a last line counts the rest and `doctor` warns.

**The existing `Judge.consolidate` cannot judge entries.** Its input is memory-shaped (a `MemoryKind`, files, numeric ids) and its questions speak of `new_memory` (zoom-out, design, codebase, structural). A knowledge-specific `Judge.relate` takes a draft and index-keyed neighbours, with its own question wording, a heuristic without files, the thresholds reused from `src/distill/policy.ts`, and `withFallback` wrapping it; a neighbour both same and contradicting is a contradiction, not a duplicate, as memory's consolidation already rules.

**Cataloguing by a judge is a second model for a choice the agent can make.** A per-area lexicon in code goes stale the first time a person adds an area, and the taxonomy is per root (zoom-out, comprehension, design, structural). `area` is a required enum of the tools' schema, built from the roots' taxonomies at listing time with the labels in its description; a judge that suggests an area waits for part 3, where a person writes in the viewer.

**The rerank by TypeSafe in search has no measured gain and an unbounded cost.** (zoom-out, design, structural.) Deferred: search ranks by bm25; the local embedding model is a later improvement.

**Five tools are two too many.** A change is a propose with a slug and a base version; the taxonomy lives in the propose schema's enum (zoom-out, structural). Three tools, each with a fixed answer shape (scope/slug references, versions, a refusal code reusing part 1's codes), descriptions drafted against memory's so the agent tells `knowledge_propose` from `memory_save`.

**The `--agent` flag through the plugin files does not work and does not reach installed hosts.** The wrapper script drops the arguments after `mcp`; direct installs write their own MCP entries in five places; existing installs never get the flag (readiness, codebase, structural). The host's id now comes from the MCP `initialize` handshake's `clientInfo.name`, mapped in one table in code to an agent id, `--agent` as an override and `mcp` when nothing matches; the OpenCode bridge is OpenCode by construction. No installer changes; the OpenCode plugin's tool list gains the three tools. The proposal also records the person the agent worked for (`on_behalf_of`), since on a shared repository five people's `agent:claude-code` look the same.

**The store has no FTS index, no shown table and no `pinned` column, and the hooks must not refresh it.** (zoom-out, design, readiness, codebase, structural.) Knowledge migration 7 adds the `pinned` column, a self-contained FTS5 table kept by triggers on `knowledge_entries` (so part 1's writes, `rebuild` and `adopt` keep it in step without knowing it), a `knowledge_shown` table that records the moment, the version and the hash shown, and clears the repositories' head and fingerprint so the next refresh parses `pinned`. Hooks read the index as it is and mark a repository stale when its head or fingerprint differ; the drain rebuilds stale repositories (bounded); the tools call `ensureFresh`. An empty store costs one query; a module schema that is not current keeps the module silent, logged once per process.

**F5′ needs exact words.** Separators are charged only for contributions that were accepted; declared modules are asked first and the output is joined in engine order; with knowledge silent memory gets exactly its budget (design, readiness). Recorded as its own ruling in ADR 0024.

**The lexical floor must not be a second copy, and rule 3 must not use the area.** (zoom-out, structural.) Memory's evidence rule is extracted into one function over named text fields that both modules call (the pinned snapshots guard memory's behaviour); knowledge's rule 3 counts title words only; the probe of ADR 0020 is rewritten as a fixture and its numbers pinned.

**Observability.** `knowledge_shown` records the moment, the floor rule, the version and the hash; a proposal records `judged_by`, `judge_version` and the scores; refusals are logged; `status` gains a knowledge line; `doctor`'s line grows; TypeSafe usage from tools is counted apart from distillation (codebase, design, structural).

**Cost and abuse.** A propose runs one judge call (3 s, no retries on the tool path), bodies clipped in the judge's state, part 1's quotas plus 20 proposals per server process per hour; `knowledge_get` and `knowledge_search` have size caps; `compact` prunes `knowledge_shown`; the perf corpus gains entries and the gate measures a propose (design, structural).

**Decision record.** ADR 0024 supersedes ADR 0019's note of 2026-10-13 and adopts F5′; a registry of frontmatter keys names the part that defined each (`pinned`, `contradicts`, `on_behalf_of`, `judged_by`, `judge_version`) (codebase, structural).

**Not taken, with the reason.** Reading the lexical floor from the archived branch (zoom-out): the mission says every file is written fresh; the rules and the probe's numbers are taken as requirements. Dropping duplicates and contradictions until real proposals exist (zoom-out): the mission asks for them, the heuristic exists, the thresholds are memory's, and they protect the person's queue; their precision is measured later. Personas showing twice once a personas module exists (structural): a later part's rule.

## Goals vs. Non-Goals

Goals: the module in `BUILT_IN`, on by default, F5′; pinned entries at every session start and relevant entries on prompts, within the share, once per context; three tools with fixed answers; the agent id from the handshake; `Judge.relate` for duplicates and contradictions; migration 7; `knowledge_shown`, `status`, `doctor`, `compact`; the frontmatter key registry; the perf corpus and the propose measure; ADR 0024's part 2.

Non-goals: the viewer (part 3), sharing and sync (parts 4 to 6), cataloguing by a judge (part 3), a rerank by TypeSafe or by the local model, a background briefing of a project, personas' own module.

## Alternatives Weighed

- Pinned entries only at a project's first session: rejected; it reaches no existing project and one chance is lost to a resume or a crash.
- Everything at session start: rejected; the share holds a handful of lines.
- A judged selection in the background: deferred; no pass exists yet.
- Cataloguing by a judge with a lexicon: rejected for this part; the agent chooses from an enum, the lexicon goes stale.
- A TypeSafe rerank in search: deferred; unmeasured gain, unbounded cost.
- Five tools: rejected; three cover the need with less standing cost.
- `--agent` in every host's configuration: rejected; the wrapper drops it, installers write their own entries, existing installs never get it.
- Reusing `Judge.consolidate` as it is: rejected; memory-shaped input and questions.
- Hooks calling `ensureFresh`: rejected; it may spawn git.
- Keeping the FTS index in code: rejected; triggers keep it in step with every writer.

## Key Decisions

D-1 (on by default), D-3 (the lexical floor on prompts), D-4 (duplicates refused), D-5 (contradictions recorded), D-8 (F5′) as recorded; D-2, D-6 and D-7 superseded in part by D-9, D-10 and D-12:

- D-9: pinned entries at every session start, once per context (supersedes D-2's first-session clause).
- D-10: `area` a required enum in the propose schema; cataloguing by a judge waits for part 3 (supersedes D-6).
- D-11: three tools with fixed answer shapes; a change is a propose with a slug and a base version.
- D-12: the agent id from the MCP handshake's client name, `--agent` as an override, `mcp` otherwise (supersedes D-7's plugin-file flag).
- D-13: no rerank in search in this part.
- D-14: a knowledge-specific `Judge.relate`, thresholds reused from memory's policy.
- D-15: `--global` sees the workspace and the shared repositories only.
- D-16: hooks never refresh the index; stale repositories are rebuilt by the drain.
