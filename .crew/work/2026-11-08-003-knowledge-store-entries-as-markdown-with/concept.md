# Concept: the knowledge store (part 1 of the knowledge module)

Mode: brainstorm

## Hypothesis

wizardingcode-mem gains a second engine module, `knowledge`, whose storage is Markdown files with frontmatter kept in one git repository per scope (workspace, project, shared) under the product's data directory, and whose index is a set of module-owned SQLite tables rebuilt from those files. Every write is one commit by its author, a person or an agent; an agent's write is a proposal file until a person accepts it. This part builds the storage, the index and the versioning only. The MCP tools and the composer contribution (part 2), the viewer (part 3), the sharing policy (part 4) and the team server and sync (parts 5 and 6) come after and read this store.

## Who it is for and what fails today

The WizardingCode team keeps its curated knowledge (strategies, personas, patterns, how the team works) in Obsidian. Agents cannot reach it, nothing versions what an agent would change, and a new project starts with no knowledge at all. Memory (the engine's one module today) records what happened in sessions: observed, local, decaying, never authoritative. Knowledge is the opposite: curated, written on purpose, authoritative, versioned.

## What exists today (facts from the repository)

- `src/engine/module.ts`: an `EngineModule` has `id`, `name`, `share`, optional `contribute(input)`, `tools(mode)`, `views`. No `migrations` field. `MomentInput` has `db, moment, projectId, branch, root, sessionId, epoch, prompt, path, error, now, budgetChars`.
- `src/engine/modules.ts`: `BUILT_IN = [memory]`; `enabledModules(raw)` reads `WIZARDINGCODE_MODULES`; memory is always on.
- `src/store/db.ts`: core migrations 1 to 7 by `PRAGMA user_version`; `openDb` migrates under a second connection's `BEGIN IMMEDIATE`. ADR 0019 ruling F2 put module-owned tables off "until a real case exists".
- `src/core/project.ts`: a project has `id`, `key` (its strongest alias: `remote:<host/path>`, `gitdir:<dir>` or `path:<root>`), `name`, `root`.
- `src/settings/settings.ts`: keys named like environment variables, in `<data dir>/env`; `SETTING_KEYS` is a fixed list validated by `RULES`.
- `src/util/paths.ts`: `defaultDataDir()` is `~/.wizardingcode/mem` (honouring the brand home and the product variable); the database may live in a separate store dir.
- ADR 0020 (withdrawn 2026-10-13) built a knowledge module whose files lived inside each project at `.wizardingcode/knowledge/`, with an FTS index, a fingerprint per folder, and proposals promoted from memory. Its code is on `archive/knowledge-module`. On 2026-11-08 the user reversed the 2026-10-13 decision: knowledge and personas are part of this engine.
- Hooks never spawn a process (`src/core/git.ts` reads `.git` by hand) and must stay light (ADR 0019, ADR 0022).

## Design sketch

### The entry

One file per entry, `entries/<slug>.md` in its scope's repository:

```markdown
---
title: Discovery call script for agency clients
kind: strategy            # knowledge | strategy | persona | pattern
area: sales               # one of the taxonomy's areas
context: agency-clients   # free text: the setting it applies in
subject: discovery-call   # free text: what it is about
status: active            # active | draft | archived
author: André             # a person's name, or agent:<id>
version: 3                # whole number from 1, raised by one at each write
created: 2026-11-08
updated: 2026-11-09
---
The body, in Markdown.
```

A file the parser cannot read whole (no closing `---`, a line that is not `key: value`, a bad field) is listed with its problem and never counted `active`. Unknown keys are kept.

### The repositories

- `<data dir>/knowledge/workspace/`: the person's own knowledge, across their projects on this machine. Also holds `taxonomy.md`.
- `<data dir>/knowledge/projects/<key>/`: one per project, `<key>` a filesystem-safe hash of the project's `key`.
- `<data dir>/knowledge/shared/`: what the team shares (synced by part 6).

Each is a git repository created on first write (`git init` with an empty template, hooks path pointed at an empty folder, no signing). Layout: `entries/`, `proposals/`, `taxonomy.md` (workspace only). Never inside a project's own folder.

### Versioning and writes

- A write is: read the current entry and its `version`; refuse when the caller's base version is not the current one (a stale write is refused, never applied over the other); write the file (temp file, rename); `git add`, `git commit` with author and committer set to the writer (a person: the author setting, else `git config --global user.name`, else `you`; an agent: `agent:<id>`), e-mail `<slug>@knowledge.wizardingcode.invalid`; raise `version` by one; update the index.
- One writer per repository at a time: a lock file (`.lock`, created exclusively, stale after 60 s).
- `git` is spawned synchronously (`Bun.spawnSync`), never on a hook path. Its absence refuses the write with a clear message, and `doctor` reports it.

### Proposals

An agent's write does not touch the entry. It writes `proposals/<id>.md`: the full proposed entry (same frontmatter) plus `target: <slug or new>`, `base_version: <n>`, `proposed_by: agent:<id>`, `proposed_at`. Committed with the agent as author. A person then:

- accepts: the entry is written from the proposal (the base version check applies: a proposal whose target moved is refused as stale, and the person decides), the proposal file is removed, one commit authored by the person whose message names the agent;
- rejects: the proposal file is removed in a commit by the person.

Both are in the history; nothing is deleted from it.

### The taxonomy

`taxonomy.md` in the workspace repository, frontmatter `areas:` as a list of slugs, starting with code, management, marketing, sales, video, design, operations, finance, people. An entry's `area` must be one of them. Adding is a write; renaming rewrites the taxonomy and every entry that carries the area in one commit; removing is refused while an entry carries it.

### The index

Module-owned tables, applied after the core migrations and recorded in `module_migrations(module, version, name, applied_at)`; the core `user_version` does not move. `EngineModule` gains `migrations?: readonly ModuleMigration[]`; the store reads every built-in module's list from a leaf file so it loads no module code.

- `knowledge_repos(scope, project_id, path, head, indexed_at)`
- `knowledge_entries(scope, project_id, slug, path, title, kind, area, context, subject, status, author, version, created, updated, body, problem, hash)`
- `knowledge_proposals(scope, project_id, id, path, target, base_version, proposed_by, proposed_at, title, kind, area, context, subject, body, problem)`
- `knowledge_fts` (FTS5, self-contained: title, area, context, subject, body)

`wizardingcode-mem knowledge rebuild [--scope workspace|shared|project]` deletes a scope's rows and reads the files again; the index is a cache. A write updates the index for the file it changed.

### What this part does not do

No composer contribution, no MCP tool, no viewer, no hook work, no sync, no judge call. Memory's output is untouched: the pinned hook snapshots stay byte for byte.

## Assumptions (what would have been asked)

- The git binary is on the machine; this product serves coding agents.
- The person's author name needs no new step to start (setting, then git identity, then `you`).
- A stale proposal is refused at accept, with the versions named; a merge view is the viewer's (part 3), not this part's.
- Entries are never deleted through the engine; `archived` is the end state (memory does the same).
- Area ids are lower-case slugs; `context` and `subject` are free text, catalogued by the index, judged (duplicates, cataloguing) in part 2.
- The workspace repository is the one place for the taxonomy; the shared scope reuses it until the team server (part 5) says otherwise.
