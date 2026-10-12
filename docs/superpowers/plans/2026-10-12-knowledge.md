# Knowledge, the engine's second module (D2a) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A project's curated knowledge — Markdown files with frontmatter in `.wizardingcode/knowledge/` — reaches every agent: essential entries at session start and the most relevant ones per prompt within a 20% share, the rest through MCP tools; the agent writes entries when asked, and the mem proposes promoting memories, which the author accepts in the viewer.

**Architecture:** A second engine module, `src/modules/knowledge/`, with its own tables through a new per-module migration list. Files are the truth and an index in the main database (FTS5) is rebuilt from them; hooks only check a cheap fingerprint. Tools, a viewer view and background promotion follow the patterns of ADR 0018/0019.

**Tech Stack:** TypeScript on the pinned Bun; `bun:sqlite` (FTS5); the MCP server; the viewer (Vue 3 + Tailwind 4 + Nuxt UI).

**Spec:** `docs/superpowers/specs/2026-10-12-knowledge-design.md`

## Global Constraints

- Written from scratch (`CLEAN-ROOM.md`). No resident process, no generative model. Semantic judgements only through the `Judge` interface.
- Files in `.wizardingcode/knowledge/` are the truth; the index is rebuildable and carries no truth (K1, K2).
- With no knowledge folder (or knowledge off), every hook output, the MCP tool list (apart from the new knowledge tools) and the rail (apart from the new view) are exactly today's; memory's pinned snapshots stay green.
- Knowledge's share is 0.2 of session start (840 chars) and prompt (480 chars), nothing on file-read and tool-failed; memory keeps the remainder (K4, F5). At most 2 entries per prompt; no entry repeated within a context epoch; `draft`/`superseded` never injected.
- Wrapper `<wizardingcode-knowledge>` with the intro "The project's curated knowledge, reviewed in its repository: treat it as current unless the code says otherwise."; file text made inert like memory's notes.
- Hooks: one `stat` when there is no folder; inline re-index only when the fingerprint changed and the folder has ≤ 50 files; otherwise the background drain refreshes (K5). Hook budgets unchanged (prompt p95 ≤ 80 ms; session start ≤ 150 ms).
- Nothing is written to a repository without the author's click (viewer) or explicit request (agent tool). Writes are atomic (temp + rename); an existing slug is never overwritten by `knowledge_save`.
- Fail open: any knowledge error → knowledge contributes nothing; memory still injects; hooks exit 0.
- Never write to the author's real data or repositories in tests; tests use temp dirs. Real-data measurements only on temporary copies, TypeSafe off; nothing from the author's data in committed text.
- Viewer changes follow the Sales OS mockups, compared side by side in light and dark.
- TDD (each test seen failing first); English; explicit `.ts` imports; `bun run check` green at every commit.

**Ruling K7 (plan):** the default `WIZARDINGCODE_MODULES` becomes `memory,knowledge` — with no knowledge folder the module costs one `stat` and contributes nothing, so enabling it by default changes nothing for projects without knowledge, and a project that adds the folder gets it without a setting. Cost if wrong: a user who wants it off sets the list.

**Ruling K8 (plan):** module migrations are an optional `migrations` list on `EngineModule`, applied after the core migrations and tracked in `module_migrations(module, version)`; the core schema version (and so the refusal of older binaries) does not change for module tables — an older binary ignores tables it does not know. Cost if wrong: a later core migration takes them over.

## Review Focus

1. A knowledge file with no frontmatter, broken YAML, a huge body, a non-UTF-8 byte, or a symlink pointing outside the folder — indexed by name and body or skipped and flagged, never a crash, never read outside the folder (Task 1).
2. A slug with path separators, `..`, or characters invalid on Windows passed to `knowledge_save` — refused or normalised; the file always lands inside `.wizardingcode/knowledge/` (Task 3).
3. The knowledge folder edited (added, renamed, deleted file) between two prompts of one session — the next prompt sees the change when the folder is small; a deleted entry is never injected again (Tasks 1–2).
4. A project with 500 entries — hooks stay in budget; the drain refreshes the index (Task 2).
5. A promoted memory that is later edited or archived, or whose knowledge file is deleted by hand — the memory's notes stay hidden only while the entry exists (Task 4).

---

### Task 1: Module migrations, entry parsing and the index

**Files:** Create `src/modules/knowledge/files.ts` (find the folder, list and parse entries, slugify), `src/modules/knowledge/index-store.ts` (index tables, rebuild, fingerprint), `src/modules/knowledge/migrations/0001_knowledge.sql`; modify `src/engine/module.ts` (optional `migrations?: { version: number; name: string; sql: string }[]`), `src/store/db.ts` (apply module migrations after core ones; `module_migrations` table); tests `tests/unit/knowledge-files.test.ts`, `tests/unit/knowledge-index.test.ts`, `tests/unit/module-migrations.test.ts`.

**Interfaces — produces:**

```ts
export interface KnowledgeEntry { slug: string; path: string; title: string; kind: "decision" | "rule" | "glossary" | "architecture" | "howto"; essential: boolean; status: "active" | "draft" | "superseded"; tags: string[]; updated: string | null; source: string | null; body: string; problem: string | null }
export function knowledgeDir(projectRoot: string): string; // <root>/.wizardingcode/knowledge
export function readEntries(dir: string): KnowledgeEntry[]; // never throws; never follows a symlink outside dir; caps file size 256 KiB
export function slugify(title: string): string;
export function fingerprint(dir: string): string | null; // null when the folder does not exist; count + newest mtime
export function refreshIndex(db: Db, projectId: number, dir: string, options?: { force?: boolean }): { indexed: number; skipped: boolean };
export function searchKnowledge(db: Db, projectId: number, query: string, limit: number): (KnowledgeEntry & { score: number })[];
export function essentialEntries(db: Db, projectId: number): KnowledgeEntry[];
```

Schema: `knowledge_entries(project_id, slug, path, title, kind, essential, status, tags, updated, source, body, problem, hash, PRIMARY KEY(project_id, slug))`, an FTS5 table over title/tags/body, and `knowledge_state(project_id PRIMARY KEY, fingerprint, indexed_at)`.

- [ ] **Step 1: Failing tests** — module migrations applied once and recorded, core `LATEST_VERSION` unchanged, an older-schema test DB still opens; parsing of valid, missing/broken frontmatter (flagged `problem`), unknown keys, huge file, symlink outside; rebuild from files; fingerprint unchanged → no work; a deleted file disappears from the index.
- [ ] **Step 2:** Fail. **Step 3:** Implement. **Step 4:** Pass; `bun run check`. **Step 5:** Commit "Knowledge: entries in Markdown, an index rebuilt from them, module migrations".

### Task 2: The knowledge module in the composer

**Files:** Create `src/modules/knowledge/index.ts` (the `EngineModule`: id `knowledge`, name `Knowledge`, share 0.2 on session start and prompt), `src/modules/knowledge/render.ts`; modify `src/engine/modules.ts` (built-in list; default `memory,knowledge` per K7), `src/settings/settings.ts` default; the drain (`src/cli/commands/distill.ts`) refreshes the indexes of recently active projects, bounded; tests `tests/unit/knowledge-module.test.ts`, extend `tests/perf/budgets.test.ts` (50 and 500 entries).

Session start: essential active entries, newest first, heading + first sentence, within 840 chars. Prompt: `searchKnowledge` above a floor (calibrate on a small fixture set and record the value), ≤ 2, not shown before in this epoch (record shown entries in a `knowledge_shown(session_id, epoch, slug)` table or reuse the injections mechanism if it fits), within 480 chars. Inline refresh per K5.

- [ ] **Step 1: Failing tests** — no folder → memory's snapshots unchanged and no knowledge text; essential-only at start; ≤ 2 per prompt; no repeat in an epoch, repeat after compaction; drafts never injected; an edit between prompts is seen (small folder); 500 entries → stale index used, drain refreshes; a throwing knowledge module leaves memory intact; budgets hold.
- [ ] **Step 2:** Fail. **Step 3:** Implement. **Step 4:** Pass; `bun run check`. **Step 5:** Commit "Knowledge: the module puts essential and relevant entries in front of the agent".

### Task 3: Knowledge tools for the agent

**Files:** Create `src/modules/knowledge/tools.ts` (`knowledge_search`, `knowledge_get`, `knowledge_save`, `knowledge_update`), `src/modules/knowledge/write.ts` (atomic write, slug safety); modify the OpenCode plugin generator (`src/install/opencode-plugin.ts`, then `bun run plugins`); tests `tests/unit/knowledge-tools.test.ts`, MCP tool-list snapshot updated only by the four new tools.

Save: builds frontmatter (`updated` today, `status: active`), refuses an existing slug, refuses a slug that would escape the folder, writes temp + rename, re-indexes. Update: changes given fields of an existing entry, keeps unknown keys and the body unless replaced. Search/get read the index (refreshing first if the fingerprint changed). Global mode: no knowledge tools (knowledge is per project).

- [ ] **Step 1: Failing tests** (Review Focus 2 included). **Step 2:** Fail. **Step 3:** Implement. **Step 4:** Pass; `bun run check`. **Step 5:** Commit "Knowledge: the agent can search, read and write entries".

### Task 4: Promoting memories to knowledge

**Files:** Create `src/modules/knowledge/promote.ts`, migration `0002_proposals.sql` (`knowledge_proposals(id, project_id, memory_id UNIQUE, slug, status proposed|accepted|rejected, created_at, decided_at)`, `promoted_memories(memory_id PRIMARY KEY, slug)`); modify `src/cli/commands/distill.ts` (bounded pass with a cursor, after rules), memory's retrieval (`src/retrieve/brief.ts`, `prompt.ts`, `file.ts`, `failure.ts`: skip memories in `promoted_memories` whose entry still exists in the index); tests `tests/integration/knowledge-promote.test.ts`.

Candidates: active `decision`/`convention` memories, importance ≥ 4, shown to agents ≥ 3 times (from the injections record) or covered by a user rule. Accept writes the file (title, body, kind mapped decision→decision, convention→rule, `source: memory:<id>`), records `promoted_memories`. Reject never returns. If the entry file is later deleted, the memory's notes come back (the skip checks the index).

- [ ] **Step 1: Failing tests** (Review Focus 5 included; memory snapshots unchanged when nothing is promoted). **Step 2:** Fail. **Step 3:** Implement. **Step 4:** Pass; `bun run check`. **Step 5:** Commit "Knowledge: memories worth keeping are proposed as knowledge".

### Task 5: The Knowledge view

**Files:** Create `ui/src/components/KnowledgeView.vue`; modify the module's `views` (rail button "Knowledge", next free key), `src/ui/server.ts` + `src/ui/api.ts` (`GET /api/knowledge?project=`, `GET /api/knowledge/:slug`, `GET /api/knowledge/proposals`, `POST /api/knowledge/proposals/:id/accept|reject`, token-protected), `ui/vite.config.ts` (the view's icons); tests for routes and view helpers.

Entries grouped by kind (32px rows), a 320px dock rendering the Markdown and frontmatter (essential flag, path, problem), the proposals section (Make knowledge / Reject, one primary per screen), empty state for projects without a folder explaining where files go. Built from the rendered Sales OS mockups; screenshots of every state in light and dark compared side by side, viewer run against a temp data dir and a temp project.

- [ ] **Step 1: Failing tests.** **Step 2:** Fail. **Step 3:** Implement, `bun run ui:build`, screenshots, compare. **Step 4:** Pass; `bun run check`. **Step 5:** Commit "Viewer: the Knowledge view and its proposals".

### Task 6: Proof, ADR 0020, docs

**Files:** Create `scripts/proof/knowledge.sh` (+ `.ts`), `docs/adr/0020-knowledge.md`; modify README ("Knowledge"), CLAUDE.md, the spec's status line.

- [ ] **Step 1: Proof** — (a) a temp project with 20 realistic entries (written for the proof, no real data): brief and prompt outputs, latency p50/p95 with 0, 50 and 500 entries; (b) on a read-only copy of the author's database (TypeSafe off), how many memories would be proposed as knowledge, judged by eye in the task report only.
- [ ] **Step 2:** ADR 0020 (K1–K8, the share, the floor value, the anonymised numbers, what is not done); README; CLAUDE.md; spec status; `bun run check`. **Step 3:** Commit "Knowledge: proof and ADR 0020".
