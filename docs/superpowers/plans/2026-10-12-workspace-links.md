# Linked projects and your own rules (B1/B2) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A session also knows, in a small labelled share, what was learned in the projects confirmed as related to its own (same product, or a library it uses) and the author's own rules; the mem suggests the links and the rules, and the author confirms them through the agent or the viewer.

**Architecture:** Migration 7 adds `project_links`, `rule_proposals` and a `user_memories` marker. A pure `visibleProjects(db, projectId)` gives retrieval and search the set of projects to read; the brief and the prompt notes give linked projects and user rules fixed, small shares and fall back to today's output when there is nothing linked. Suggestions (links and rules) are computed by exact rules in the background drain, never on the hook path. An MCP tool and a viewer "Projects" view let the author act on them.

**Tech Stack:** TypeScript on the pinned Bun; `bun:sqlite` (FTS5); the MCP server (`src/mcp/`); the viewer (Vue 3 + Tailwind 4 + Nuxt UI, `ui/`).

**Spec:** `docs/superpowers/specs/2026-10-12-workspace-links-design.md`

## Global Constraints

- Written from scratch (`CLEAN-ROOM.md`). No resident process, no generative model. Suggestions use exact rules in code; semantic judgements only through the `Judge` interface (TypeSafe opt-in, heuristic fallback).
- Nothing leaves the machine, except to TypeSafe when a key is set.
- Fail open: a missing table, a failed query or any error in links or user rules → retrieval of the current project only, as today; hooks exit 0 with their usual output.
- With no confirmed links and no user rules, `sessionBrief` and `retrieveForPrompt` return byte for byte what they return today.
- Brief budget unchanged (4,200 characters): user rules ≤ 15%, linked projects ≤ 15% and only importance ≥ 4; the unused share goes to the current project.
- Prompt notes: at most 1 note from a linked project per prompt, only if it outranks the current project's best note (or the project has none).
- Links never chain. `uses` is one way (the consumer sees the library, not the reverse). A rejected link or proposal never returns.
- The owner of a git remote alone never suggests a link: owner + a shared name stem of ≥ 3 characters.
- Only `convention` and `decision` memories can become the author's; project copies are superseded, never deleted.
- No `link`/`unlink` CLI commands: by hand means the MCP tool `project_links` and the viewer.
- Hook budgets unchanged (prompt p95 ≤ 80 ms; session start ≤ 150 ms); suggestions and proposals never run on the hook path.
- Never write to the author's real data (`~/.wizardingcode`, agent dirs); tests use temp dirs; real-data measurements on a temporary copy (`sqlite3 -readonly … ".backup '<tmp>/…'"`), TypeSafe off; nothing from the author's data in committed text.
- Viewer changes follow the WizardingCode Sales OS mockups and are compared side by side in light and dark (CLAUDE.md).
- TDD (each test seen failing first); English in the repository; explicit `.ts` imports; `bun run check` green at every commit.

**Ruling P1 (plan, against the spec's data section):** a user rule is marked by a row in a new `user_memories(memory_id PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE, proposal_id, created_at)` table instead of a new `'user'` value in `memories.scope`. Changing that CHECK means rebuilding `memories` (≈90k rows on the author's store, FTS5 external content, triggers, five tables with foreign keys to it) inside a migration that older processes race; the marker gives the same behaviour with a plain `CREATE TABLE`. "Scope user" in the spec reads as "has a `user_memories` row" everywhere below. Cost if wrong: a later migration moves the marker into the column.

## Review Focus

1. A project with no remote, a remote on a self-hosted git, or a remote URL in SSH form (`git@host:owner/repo.git`) — owner and name are parsed the same as HTTPS; no remote means no owner signal, never a crash (Task 3).
2. A manifest that is missing, unreadable, huge, or not valid JSON/TOML — skipped silently, the run continues with the next project (Task 3).
3. A project linked to itself, the same pair linked twice, `uses` in both directions, or a link to a project that no longer exists — refused or deduplicated, never a broken row (Tasks 1 and 4).
4. A rule proposal whose source memories were archived, superseded or edited before the author answers — accept uses only the still-active ones and refuses if fewer than the proposal's reason needs (Task 5).
5. Many linked projects (10+) with thousands of memories each — the brief and prompt stay inside their time budgets; the linked share is capped by count before ranking (Task 2).

---

### Task 1: Schema and the links store

**Files:**
- Create: `src/store/migrations/0007_links.sql`, `src/store/links.ts`, `tests/unit/links-store.test.ts`
- Modify: `src/store/db.ts` (add `{ version: 7, name: "links", sql: links }` to `MIGRATIONS`); any test that pins `LATEST_VERSION` or the table list.

**Schema (`0007_links.sql`):**

```sql
-- Links between projects (B1, ADR 0018). 'product' is stored once per unordered pair (smaller id
-- in from_project) and read both ways; 'uses' means from_project uses to_project, one way.
CREATE TABLE project_links (
  id INTEGER PRIMARY KEY,
  from_project INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  to_project INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('product','uses')),
  status TEXT NOT NULL CHECK (status IN ('suggested','confirmed','rejected')),
  origin TEXT NOT NULL CHECK (origin IN ('suggested','manual')),
  signals TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  decided_at INTEGER,
  CHECK (from_project <> to_project)
);
CREATE UNIQUE INDEX project_links_pair ON project_links(from_project, to_project, kind);
CREATE INDEX project_links_to ON project_links(to_project, status);

-- Rules proposed as the author's own (B2).
CREATE TABLE rule_proposals (
  id INTEGER PRIMARY KEY,
  memory_ids TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('repeated','said-always')),
  status TEXT NOT NULL CHECK (status IN ('proposed','accepted','rejected')),
  user_memory_id INTEGER REFERENCES memories(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  decided_at INTEGER
);
-- The sorted memory ids, so the same set is never proposed twice.
CREATE UNIQUE INDEX rule_proposals_set ON rule_proposals(memory_ids);

-- A memory that is one of the author's own rules (Ruling P1: a marker, not a scope value).
CREATE TABLE user_memories (
  memory_id INTEGER PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,
  proposal_id INTEGER REFERENCES rule_proposals(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);
```

**Interfaces — produces (`src/store/links.ts`):**

```ts
export type LinkKind = "product" | "uses";
export type LinkStatus = "suggested" | "confirmed" | "rejected";
export interface Link { id: number; from: number; to: number; kind: LinkKind; status: LinkStatus; origin: "suggested" | "manual"; signals: string[]; createdAt: number; decidedAt: number | null }
export interface Visible { id: number; name: string; relation: "product" | "uses" }
/** Projects the current one may read besides itself: confirmed 'product' either way, confirmed 'uses' from it. No chaining. [] on any error. */
export function visibleProjects(db: Db, projectId: number): Visible[];
/** Inserts or refreshes a suggestion; never touches a pair that is confirmed or rejected. Returns the link id or null when skipped. */
export function suggestLink(db: Db, from: number, to: number, kind: LinkKind, signals: string[], now: number): number | null;
/** A link made by hand: confirmed at once (a rejected row for the pair becomes confirmed). Throws on from === to or unknown projects. */
export function linkProjects(db: Db, from: number, to: number, kind: LinkKind, now: number): Link;
export function decideLink(db: Db, id: number, decision: "confirmed" | "rejected", now: number): Link | null;
/** A confirmed link goes back to rejected (so it is not suggested again). */
export function unlinkProjects(db: Db, id: number, now: number): Link | null;
export function linksOf(db: Db, projectId: number): Link[]; // both directions, every status
export function isUserMemory(db: Db, memoryId: number): boolean;
```

`product` pairs are normalised (smaller id first) inside every function; `uses` keeps the order. Linking `A uses B` while `B uses A` is confirmed is allowed (two rows). `visibleProjects` wraps its query in `try/catch` and returns `[]` (logged once) when the table is missing.

- [ ] **Step 1: Failing tests** (`tests/unit/links-store.test.ts`, temp DB through `openDb`): migration 7 on a v6 database keeps every memory and vector; `product` read both ways; `uses` visible from the consumer only; no chaining (A–B, B–C confirmed → A sees only B); suggested/rejected links are not visible; `suggestLink` refreshes signals of a suggested pair but returns null for a confirmed or rejected pair; `linkProjects` refuses self-links and unknown ids, turns a rejected pair into confirmed; the same pair twice is one row; deleting a project removes its links; `visibleProjects` on a database without `project_links` (a v6 file) returns `[]` without throwing.
- [ ] **Step 2:** Run `./node_modules/.bin/bun test tests/unit/links-store.test.ts` — fails (module missing).
- [ ] **Step 3:** Write the migration and `src/store/links.ts`; register migration 7.
- [ ] **Step 4:** Tests pass; `bun run check` (fix any test that pins version 6).
- [ ] **Step 5:** Commit "Links: the schema and the store (migration 7)".

### Task 2: The brief and the prompt read linked projects and your rules

**Files:**
- Modify: `src/retrieve/brief.ts`, `src/retrieve/prompt.ts`, `src/retrieve/render.ts` (`Note` gains `origin?: string`; `renderHeading` appends ` (you)` or ` (from <name>)` when set), `src/retrieve/notes.ts` (`toNote` accepts an origin)
- Test: `tests/unit/brief-links.test.ts`, `tests/unit/prompt-links.test.ts`, `tests/golden/retrieval.test.ts` (unchanged results), `tests/perf/budgets.test.ts` (a case with 10 linked projects × 2,000 memories and 20 user rules)

**Interfaces:**
- Consumes: `visibleProjects`, `user_memories` (Task 1).
- Produces: `Note.origin?: string`; constants `USER_SHARE = 0.15`, `LINKED_SHARE = 0.15`, `LINKED_MIN_IMPORTANCE = 4`, `MAX_LINKED_NOTES = 1`, `LINKED_POOL = 50` exported from `src/retrieve/brief.ts`.

**Brief:** build three ranked pools with the existing `prior` order: user rules (`JOIN user_memories`, any project, active, not stale), linked (`project_id IN visible`, importance ≥ 4, active, not stale, `LIMIT LINKED_POOL` before ranking), current (today's query, excluding ids already in the user pool). Fill user notes up to `0.15 × 4200`, linked up to `0.15 × 4200`, then current up to the full budget (current gets whatever the first two left). Render user and linked notes with their origin label, after the current project's notes in the same list order (current first, then linked, then you) so the top of the brief is unchanged for a reader. When both extra pools are empty, the code path is exactly today's (snapshot test).

**Prompt:** run today's lexical query for P; run the same query for `visible` ids (`m.project_id IN (…)`, cap `LINKED_POOL`) and for user rules. A linked candidate enters only if its fused score beats P's best (or P has none), at most `MAX_LINKED_NOTES`; user rules join P's candidates and compete normally. Linked and user notes carry `origin`. Any error in the extra queries → today's result (try/catch, logged once).

- [ ] **Step 1: Failing tests:** no links and no user rules → `sessionBrief` and `retrieveForPrompt` outputs equal pinned snapshots taken from the current code (write the snapshot from `main` before changing code); user rules use ≤ 15% of the budget and are labelled "(you)"; linked notes only importance ≥ 4, ≤ 15%, labelled "(from <name>)"; unused shares go to P (P fills to the full budget when nothing is linked); a library project does not see its consumer's memories; at most one linked prompt note and only above P's best; a broken `project_links` (dropped in the test) → today's output; golden retrieval unchanged (19/24, 0/23).
- [ ] **Step 2:** Run them; they fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Pass; `bun run check`; the perf budgets hold with the large linked case.
- [ ] **Step 5:** Commit "Retrieval: a small, labelled share for linked projects and your rules".

### Task 3: Suggesting links (background)

**Files:**
- Create: `src/links/signals.ts` (pure), `src/links/suggest.ts`, `tests/unit/link-signals.test.ts`, `tests/integration/link-suggest.test.ts`
- Modify: `src/cli/commands/distill.ts` (after `healVectors`, call `suggestLinks` bounded, inside its own try/catch), `src/core/git.ts` only if `normalizeRemote` needs an exported owner/name split

**Interfaces — produces:**

```ts
// src/links/signals.ts — pure, no I/O
export function parseRemote(remote: string): { host: string; owner: string; name: string } | null; // from the normalised 'host/owner/name' form; SSH and HTTPS alike
export function nameStems(name: string): string[]; // split on - _ . , lower-case, drop parts < 3 chars and generic ones: api, web, app, ui, frontend, backend, server, client, core, service, lib, mobile
export function sharedStem(a: string, b: string): string | null;
export interface Manifest { packageName: string | null; deps: string[]; localPaths: string[]; gitUrls: string[]; workspaces: string[] }
export function readManifests(root: string): Manifest; // package.json, composer.json, go.mod, Cargo.toml; each read capped at 256 KiB; any error → empty fields
// src/links/suggest.ts
export function suggestLinks(db: Db, options: { now: number; maxProjects?: number }): { suggested: number }; // default maxProjects 200
```

Rules (only projects not `disabled`, roots from their `path:` alias that still exist):
1. Same `host` and `owner` and `sharedStem(nameA, nameB)` is not null and not the owner's own name → `suggestLink(a, b, "product", ["same owner <host/owner>", "shared name <stem>"])`.
2. A's manifest names B: B's `packageName` in A's `deps`, a `localPaths` entry resolving to B's root, or a `gitUrls` entry normalising to B's remote → `suggestLink(A, B, "uses", ["<file> depends on <name>"])`.
3. A and B under one root whose manifest declares `workspaces` (or that has `pnpm-workspace.yaml`) covering both → `product`, signal "one workspace <root>".

The run is bounded by `maxProjects` and never throws out of `distill` (the drain's exit code is unchanged).

- [ ] **Step 1: Failing tests:** `parseRemote` for HTTPS, SSH `git@host:owner/repo.git`, self-hosted hosts, and garbage → null; `sharedStem("shop-api","shop-web") === "shop"`, `sharedStem("acme-api","zeta-web") === null`, `sharedStem("client-a-api","client-b-web") === null` ("client" is generic); under owner `acme`, `acme-shop` and `acme-bank` share only the owner's own name → no suggestion; two client repos under one owner with unrelated names → no suggestion; a `package.json` depending on another known project → `uses` in the right direction; `file:../lib` → `uses`; a pnpm workspace with two packages → `product`; a malformed or 10 MB manifest → skipped; a confirmed or rejected pair is not touched; a project without a remote → no crash.
- [ ] **Step 2:** Fail. **Step 3:** Implement. **Step 4:** Pass; `bun run check`; the distill integration test shows suggestions written after a drain and none on the hook path.
- [ ] **Step 5:** Commit "Links: suggested from remotes, manifests and workspaces, in the background".

### Task 4: Search over the group, and the agent's `project_links` tool

**Files:**
- Modify: `src/mcp/tools.ts` (`searchMemories`/`rankMemories` default to P + visible; each result names its project — `projectNames` exists), `src/mcp/server.ts` (register `project_links`), `src/ui/api.ts` (`/api/memories` gains `scope=project|linked`, default `project`; `/api/search` searches P + visible and returns the project name), `src/ui/server.ts` (routes below)
- Create: `src/mcp/links-tool.ts`, `tests/unit/links-tool.test.ts`
- Test: extend `tests/unit/mcp-tools.test.ts` (or the file that covers `searchMemories`), `tests/integration/ui-server.test.ts` (or equivalent)

**Interfaces — produces:**

```ts
// src/mcp/links-tool.ts
export type LinksAction =
  | { action: "list" }
  | { action: "link"; project: string; kind: "product" | "uses" }
  | { action: "unlink"; project: string }
  | { action: "confirm" | "reject"; id: number };
export function projectLinksTool(context: ToolContext, args: LinksAction): string; // plain text for the agent
```

`project` is matched like `memory_projects` names projects (exact name first, then a unique case-insensitive match; ambiguous or unknown → a refusal that lists candidates). `kind: "uses"` means the current project uses `project`. Viewer routes (loopback + token like every route): `GET /api/links` (all links with names and signals, plus pending counts), `POST /api/links` (`{from, to, kind}`), `POST /api/links/:id/confirm`, `POST /api/links/:id/reject`, `POST /api/links/:id/unlink`.

- [ ] **Step 1: Failing tests:** `memory_search` in P finds a linked project's memory, labelled with its project, and does not find the consumer's from a library; `project` filter still narrows; `--global` unchanged; the tool lists, links (both kinds), unlinks, confirms, rejects; unknown and ambiguous names are refused with candidates; self-link refused; the routes require the token and act on the store.
- [ ] **Step 2:** Fail. **Step 3:** Implement. **Step 4:** Pass; `bun run check`.
- [ ] **Step 5:** Commit "Search covers linked projects; the agent can link projects".

### Task 5: Proposing your rules

**Files:**
- Create: `src/links/rules.ts`, `tests/integration/rule-proposals.test.ts`
- Modify: `src/judge/types.ts` (optional `personal?(input: { title: string; body: string; projects: string[] }): Promise<{ personal: boolean; confidence: number }>`), the TypeSafe judge (implements it when a key is set; follow the `typesafe:typesafe-ai` skill and docs.typesafe.ai for the call shape), `src/cli/commands/distill.ts` (call `proposeRules` after `suggestLinks`, bounded, own try/catch), `src/mcp/tools.ts` (`searchMemories` includes user rules)

**Interfaces — produces:**

```ts
export const SAID_ALWAYS: RegExp; // \b(sempre|em todos os projetos|always|every project|in every repo|in all projects)\b, case-insensitive
export function proposeRules(db: Db, deps: { judge: Judge; now: number; maxMemories?: number }): Promise<{ proposed: number }>; // default maxMemories 300
export function acceptProposal(db: Db, id: number, now: number): { userMemoryId: number } | { refused: string };
export function rejectProposal(db: Db, id: number, now: number): boolean;
export function undoUserRule(db: Db, userMemoryId: number, now: number): boolean; // archives the user memory, restores the copies to active
```

**Repeated:** for active `convention`/`decision` memories not already in a proposal or a user rule, find neighbours in other projects with the `findNeighbours` text rule and the `DUPLICATE` threshold from `src/distill/policy.ts` (and the semantic score when a model is loaded); keep groups spanning ≥ 2 projects with no confirmed link between them. **Said always:** the memory's `source_turn_id` turn prompt matches `SAID_ALWAYS` → a single-memory proposal. When `judge.personal` exists, a `personal: false` verdict drops the group. The proposal's text is the most important memory's title and body (consolidation never writes text). **Accept:** inserts a new memory (origin `manual`, same kind, importance = max of the group), a `user_memories` row, supersedes every still-active source (`supersede`), sets `status='accepted'`; refuses when fewer than 2 sources (repeated) or 1 (said-always) are still active. **Undo:** archives the user memory, sets the sources back to `active` and `superseded_by = NULL`.

- [ ] **Step 1: Failing tests:** the same convention in two unlinked projects → one proposal with both ids; in two linked projects → none; a decision whose prompt said "sempre" → a proposal; a `fix` never proposed; rejected set never proposed again; accept creates the user memory, supersedes the copies, and the brief of a third project shows it "(you)"; accept after one source was archived → refused (repeated) ; undo restores; a judge saying `personal: false` drops it; the fallback judge (no `personal`) keeps it.
- [ ] **Step 2:** Fail. **Step 3:** Implement. **Step 4:** Pass; `bun run check`.
- [ ] **Step 5:** Commit "Your rules: proposed when they repeat or when you say always".

### Task 6: The viewer — Projects, You, the banner and the filter

**Files:**
- Create: `ui/src/components/ProjectsView.vue`, `ui/src/components/RulesView.vue` (or one view with two sections, matching the mockups' page pattern), `ui/src/components/LinksOffer.vue`
- Modify: `ui/src/components/Rail.vue`, `ui/src/App.vue`, `ui/src/api.ts`, `ui/src/components/MemoryList.vue` (filter "this project / with linked", origin label), `src/ui/server.ts` + `src/ui/api.ts` (`GET /api/rules`, `POST /api/rules/:id/accept|reject`, `POST /api/rules/:id/undo`, `GET /api/links/offer` + `/dismiss` like the history offer)
- Test: `tests/integration/ui-server.test.ts` routes; view helpers as unit tests like `ui/src/settings.ts`'s

Build from the rendered Sales OS mockups (`09-sales-os/SHELL.md`, `DENSITY.md`): page header with three rows, grouped list with 32px rows, the 320px detail dock for a project's links and signals, buttons Link / Reject / Unlink, Make mine / Reject / Undo. Screenshots of every state (no links, suggestions pending, confirmed, rules proposed, accepted) in light and dark under the scratchpad, compared side by side with the mockups and the existing History view.

- [ ] **Step 1: Failing tests** for the routes (token required; accept/reject/undo/unlink change the store; the offer counts new suggestions and proposals and can be dismissed) and the view helpers.
- [ ] **Step 2:** Fail. **Step 3:** Implement, `bun run ui:build`, take screenshots, compare. **Step 4:** Pass; `bun run check`.
- [ ] **Step 5:** Commit "Viewer: projects and their links, your rules, and an offer when there are new ones".

### Task 7: Proof on real data, ADR 0018, docs

**Files:** Create `docs/adr/0018-linked-projects.md`, `scripts/proof/links.sh` (and `.ts` if the measuring part needs it, as `scripts/proof/semantic.*`); modify README ("Linked projects and your rules"), CLAUDE.md (the tool, the routes, the background steps), the spec's status line.

- [ ] **Step 1: Proof** on a temporary copy of the author's database (read-only `.backup`, temp `WIZARDINGCODE_HOME`, TypeSafe vars unset, the off flags): run the suggestion and proposal passes; list the suggested links with their signals and the proposed rules **in the task report only** (never committed), judged by eye — above all, whether any suggestion mixes two clients; brief and prompt p50/p95 before and after confirming the suggested links on the copy.
- [ ] **Step 2:** ADR 0018 (Ruling P1, the signals and why the owner alone never suggests, the shares, the anonymised proof numbers, what is not done: team links file (C2), clones/worktrees); README; CLAUDE.md; spec status; `bun run check`.
- [ ] **Step 3:** Commit "Linked projects and your rules: proof and ADR 0018".
