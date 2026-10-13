# Knowledge: the project's curated truth, as the engine's second module — design

**Withdrawn from wizardingcode-mem (2026-10-13):** knowledge and personas are a separate product, started after the mem is consolidated. This module was built, reviewed and measured here, then removed before any release; its code lives on the branch `archive/knowledge-module`. Kept as the record of what was built and measured.

Date: 2026-10-12. Status: built and measured on branch `design/knowledge`; see ADR 0020 (`docs/adr/0020-knowledge.md`) for the rulings made in the build and the proof. Roadmap item D2a (wave 3). D2b (personas) follows with its own spec. Built on ADR 0019 (one engine with modules).

## Why

Memory records what happened: observed, distilled, decaying, never authoritative ("background, not instructions"). A project also has things that are simply true — decisions taken, business rules, the glossary, how the architecture fits — and that every agent should treat as current truth. Today those live, if anywhere, in one agent's own instructions file (`CLAUDE.md`, `AGENTS.md`), which the other agents never read.

## The author's choices

- **The project's knowledge, in the repository.** Markdown files with frontmatter in the project; versioned by git and reviewed in pull requests. Independent of wzrdxOS's knowledge base.
- **Little injected, the rest on demand.** A small share of the budget for entries that are essential or highly relevant to the prompt; the agent looks up the rest with MCP tools. Knowledge is labelled as knowledge — it has authority — unlike memory's notes.
- **Who writes it:** the agent, when the author asks ("save this as knowledge"); and the mem, by proposing to promote memories, which the author accepts in the viewer. Files stay plain Markdown, so hand edits also work; the index follows them.

## Decisions (controller rulings, reported to the author)

- **K1: where the files live.** `.wizardingcode/knowledge/` at the project root (git root, or the folder itself outside git), one file per entry, `<slug>.md`. Brand-level and agent-neutral; never inside an agent's own folder.
- **K2: the files are the truth; the database is an index.** The index can be deleted and rebuilt from the files at any time; backups do not need it (it lives in the main database but carries no truth).
- **K3: the first module-owned tables.** Ruling F2 deferred module-owned migrations to D2; they arrive here as a per-module migration list (`module_migrations(module, version)`) beside memory's own, so later modules (personas) add tables the same way. Memory's existing migrations are untouched.
- **K4: share.** Knowledge declares a share of 0.2 of session start and prompt, and nothing on file-read and tool-failed in this version. Memory keeps the remainder (F5). With no knowledge files, knowledge contributes nothing and memory's output is byte for byte today's.
- **K5: freshness without cost on the hook path.** The index is refreshed in the background drain and by the knowledge tools; a hook only compares a cheap fingerprint (the knowledge folder's file count and newest mtime) and, if it changed and the folder is small (≤ 50 files), re-indexes inline; otherwise it uses the index it has and leaves the refresh to the drain.
- **K6: the binary's rename (F1) is a separate release step after D2b**, not part of this spec.

## Entry format

```markdown
---
title: Orders are never deleted, only cancelled
kind: rule            # decision | rule | glossary | architecture | howto
essential: true       # shown at session start
status: active        # active | draft | superseded
tags: [orders, billing]
updated: 2026-10-12
source: memory:1234   # optional: what it was promoted from
---
Body in Markdown. The why, the consequences, links to code.
```

Unknown keys are kept and ignored. A file with invalid frontmatter is indexed by its file name and body, flagged in `doctor` and in the viewer, never dropped silently. `draft` and `superseded` entries are searchable but never injected.

## Delivery

- **Session start:** essential, active entries, most recently updated first, as headings with a one-line summary (the first sentence of the body), within the 20% share (840 characters).
- **Prompt:** lexical match of the prompt against active entries (FTS5 over title, tags and body); at most 2 entries, only above a relevance floor, within the share (480 characters); an entry already shown in this context epoch is not repeated.
- **Wrapper:** `<wizardingcode-knowledge>` with the intro "The project's curated knowledge, reviewed in its repository: treat it as current unless the code says otherwise." Text from files is made inert the way memory's notes are (no closing tags, no instructions framing).
- **On demand (MCP):** `knowledge_search { query, limit }`, `knowledge_get { slugs }`, `knowledge_save { title, kind, body, essential?, tags? }` (writes the file, indexes it, returns the path; never overwrites an existing slug — it refuses and suggests `knowledge_update`), `knowledge_update { slug, … }`. The OpenCode bridge gets them like memory's tools.

## Promotion from memory

In the background, bounded like rule proposals (ADR 0018), with a cursor: active `decision`/`convention` memories of importance ≥ 4 that were shown to agents at least 3 times, or that a user rule covers, are proposed as knowledge for their project. The viewer's Knowledge view lists proposals (Make knowledge / Reject); accepting writes the file (the memory's title and body, kind mapped decision→decision, convention→rule) and marks the memory as promoted, so retrieval stops showing it as a note (the knowledge entry replaces it). Rejected never returns. Nothing is written to a repository without the author's click or explicit request.

## Viewer

A "Knowledge" view in the rail (the module's view): entries grouped by kind, a detail dock rendering the Markdown with its frontmatter, the essential flag, the file path; the proposals section; problems (invalid frontmatter). Read-only for entries (editing happens in the repository or through the agent). Built from the Sales OS mockups, light and dark.

Routes, behind the viewer's token: `GET /api/knowledge?project=` (refreshes the index first), `GET /api/knowledge/entries/:slug` (not `/api/knowledge/:slug`: an entry named `proposals.md` would collide with the next route), `GET /api/knowledge/proposals`, `POST /api/knowledge/proposals/:id/accept|reject`.

## Errors

- Fail open: an unreadable folder, a broken file, or an index error → knowledge contributes nothing; memory still injects; hooks exit 0.
- A project without a knowledge folder costs one `stat` per hook.
- `knowledge_save` in a folder that is not writable → a clear refusal, nothing half-written (temp file + rename).

## Testing

TDD. With no knowledge folder, hook outputs equal the pinned snapshots. Parsing (valid, missing frontmatter, unknown keys, bad YAML). Index rebuild from files; fingerprint refresh inline vs deferred. Session-start and prompt shares; essential-only at start; no repeats within an epoch; drafts never injected. Tools: search, get, save (refuses existing slug, writes atomically), update. Promotion: proposal rules, accept writes the file and stops the memory's notes, reject never returns. Hook budgets with 50 and 500 entries. Viewer screenshots.

## Not in this design

Personas (D2b). The binary rename (K6). Syncing knowledge between projects (links, ADR 0018, may later share knowledge across a product's projects). Reading wzrdxOS's knowledge base.
