# History import, part 3: the trigger, progress and the viewer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** People find the history import without reading docs: `install` offers it, the viewer offers it once, both show its progress, the viewer can search past conversations, and the claude-mem replacement is a deliberate, previewed action in the viewer.

**Architecture:** One status function (`historyStatus`) feeds `status`, the viewer API and the install prompt. Background runs are `history import` spawned detached, guarded by a meta lease and recording their last report in meta. The viewer gains a History view (search over `history.db`) and a History card in Settings (import, progress, index, replace/restore with a preview count, forget).

**Tech Stack:** TypeScript on the pinned Bun, `bun:sqlite`; viewer: Vue 3 + Tailwind 4 + Nuxt UI in `ui/`, built into `src/ui/dist/index.html`.

**Spec:** `docs/superpowers/specs/2026-10-11-history-import-design.md` (component 6 "Trigger and progress", component 5's viewer tab, Testing "Trigger" and "Performance"). Parts 1–2 and ADR 0013 are the base.

## Global Constraints

- Written from scratch; never copy from claude-mem (`CLEAN-ROOM.md`).
- TDD for code: tests written and seen failing first. UI: component logic tested where the repo tests UI (`tests/integration/ui*.test.ts`); visual fidelity verified as below.
- **UI fidelity (binding, from the author):** every new view or card is built from the rendered Sales OS mockups (`~/Projects/wizardingcode/09-sales-os/mockups/*.dc.html`, rendered with `~/Projects/wizardingcode/03-website/mockups/support.js` and `~/Projects/wizardingcode/02-design-system/components/bundle.js`) and compared side by side in light and dark (headless Chrome screenshots: `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --screenshot=… --window-size=…`) before the task reports done. Follow `ui/src/app.css` tokens, existing components (`Dock`, `DockProps`, `MemoryList`, settings `Card`), 32px rows, 320px dock, the compact type scale. Long real text (XML-ish prompts, paths) is tidied for display, never dumped raw. Nothing leaves for the network.
- Nothing runs without consent: `install` asks (TTY) or prints a hint; the viewer asks once; replacement is never automatic and always shows its count first.
- Hooks never exit 2 and fail open; the hook path gains nothing in this part.
- One history run at a time (meta lease `history.lease`); a second start reports "already running".
- Repository text in English; `bun run ui:build` is part of `test`, `build` and `check`.

## Review Focus

1. Two imports started at once (install and viewer) — the second says "already running" and does not start.
2. A run that dies midway (killed) — status does not claim "running" forever (lease expiry), and the next run resumes.
3. Install without a TTY (plugins installing natively, CI) — never blocks, never imports silently; prints one hint line.
4. Replace-imports from the viewer — shows the exact count first; restore is offered right after.
5. Prompt hook latency while a backfill runs — stays within its budget (spec "Performance").

---

### Task 1: `historyStatus`, `status` output and `GET /api/history`

**Files:** Create `src/history/status.ts`; modify `src/status/report.ts` (+ its CLI printer), `src/ui/server.ts`; tests `tests/integration/history-status.test.ts`, the status and ui-server tests.

**Interfaces — produces:**

```ts
export interface HistoryStatus {
  transcripts: { claudeCode: number; codex: number }; // files found (listers with sinceMs 0); cheap: stat only
  run: { state: "never" | "running" | "done" | "failed"; startedAt: number | null; finishedAt: number | null; last: unknown | null };
  queue: { pending: number; done: number; skipped: number; failed: number }; // origin='history' turns
  index: { exists: boolean; files: number; turns: number; bytes: number };
  replace: { projectsReady: number; wouldArchive: number; replaced: number }; // wouldArchive = count replace-imports would archive now
  offer: { dismissed: boolean };
}
export function historyStatus(db: Db, storeDir: string, roots: { claudeCode: string; codex: string }, now: number): HistoryStatus;
```

`wouldArchive` needs a dry-run of `replaceAllImports` (`src/backfill/replace.ts`): add `previewReplaceImports(db): number` that runs the same selection without writing (share the query; no duplicated SQL). `run` comes from meta keys written in Task 2 (`history.run.started_at`, `history.run.finished_at`, `history.run.state`, `history.run.report` JSON) and the lease (`history.lease`, via `src/store/meta.ts` `leaseActive`); a "running" state whose lease expired reads as "failed".

- [ ] Tests first: fresh store → `never`, zero counts, `index.exists: false`; after seeding history turns and an index → right counts; `previewReplaceImports` equals what `replaceAllImports` then archives; expired lease with state running → `failed`. `status` CLI prints a "History" block (transcripts found, queue, index size, ready to replace with count). `GET /api/history` returns the JSON (auth as the other routes).
- [ ] Implement, `bun run check`, commit "History status: one view for status, the viewer and install".

### Task 2: one background run at a time, started from anywhere

**Files:** modify `src/cli/commands/history.ts`, `src/backfill/run.ts` (or a small `src/history/run-state.ts`), `src/ui/server.ts`; tests `tests/integration/history-cli.test.ts`, `tests/integration/ui*.test.ts`.

- `history import` (and `history index`) claim the meta lease `history.lease` (owner pid+uuid, renewed during the run like the drain lease, 120 s), write `history.run.state = running` and `started_at`, and at the end `done|failed`, `finished_at`, `report` (the summary object). A second invocation while the lease is held prints `history: already running` and exits 0.
- `POST /api/history/import` → if not running, `spawnDetached("history", "import")`; returns `{ started: boolean }`. `POST /api/history/index`, `POST /api/history/forget` (refuses while running), `POST /api/history/replace-imports` (body must carry the `expected` count shown to the user; if the preview no longer matches, 409 with the new count), `POST /api/history/restore-imports`, `POST /api/history/offer/dismiss` (meta `history.offer.dismissed = 1`). All behind the viewer's token like the other POST routes.

- [ ] Tests first: lease blocks a second run; killed run (lease expired) → next run proceeds and state ends `done`; each API route's happy path and refusals (409 on a stale expected count, forget refused while running).
- [ ] Implement, check, commit "History runs: one at a time, startable from the viewer".

### Task 3: `install` offers the import

**Files:** modify `src/cli/commands/install.ts` (single-agent Claude Code and Codex paths, and install-all); tests `tests/integration/install*.test.ts`.

- After installing, when `historyStatus` shows transcripts and `run.state === "never"` and the offer was not dismissed:
  - TTY: `confirm("Found <n> past sessions from Claude Code and Codex. Learn from the last <historyDays> days now, in the background? Nothing leaves this machine except TypeSafe judgements if you set a key.")` → yes: `spawnDetached("history", "import")` and a line `history: importing in the background — wizardingcode-mem status shows progress`; no: meta `history.offer.dismissed = 1` and a line telling the command to run later.
  - No TTY: one hint line, no import.
  - Flags: `--import-history` (yes without asking), `--no-import-history` (skip, no hint).
- [ ] Tests first (spawn stubbed the way existing install tests stub side effects; TTY simulated as they do for the claude-mem prompt): each branch above.
- [ ] Implement, check, commit "install: offer to learn from past sessions".

### Task 4: viewer — the History card in Settings and the one-time offer

**Files:** `ui/src/components/settings/History.vue` (new, using `Card.vue`), `ui/src/components/Settings.vue`, `ui/src/api.ts`, a small offer banner component shown on the Memories view (`ui/src/App.vue` or `MemoryList.vue` header, per the mockups' notice pattern); tests where the repo tests UI state (`tests/integration/ui-state.test.ts` / `ui-settings.test.ts`).

- Card content: transcripts found; run state with progress (queued/done, polling `/api/history` every 3 s while running); index files, turns, size; buttons Import (or Continue), Rebuild index, Forget index (confirm dialog); "Replace claude-mem imports" showing the preview count and what it means in one sentence, confirm dialog with the count, then Restore offered in the same card.
- Offer banner: on the Memories view when transcripts exist, `run.state === "never"` and not dismissed: one line + Import + Not now (→ dismiss).
- [ ] Render the relevant mockup artboards first (Settings/admin cards, notices, dialogs) and measure; build; screenshot the card and banner in light and dark; compare side by side; fix until they match. Attach the screenshot paths in the report.
- [ ] Tests for the state logic; `bun run check`; commit "Viewer: History card and a one-time offer to learn from past sessions".

### Task 5: viewer — the History view (past conversations)

**Files:** `ui/src/components/HistoryView.vue` (new), `ui/src/components/Rail.vue` (add the view; keys: Memories 1, Turns 2, Overview 3, History 4, Settings 5 — update the shortcut handling and the palette), `ui/src/viewer.ts` (`Tab`), `ui/src/api.ts`, `src/ui/server.ts` (`GET /api/history/search?q=&project=&limit=` → `searchHistory` hits, read-only open as in part 2; without `history.db` → `{ indexed: false }`).

- Layout per the mockups' list + dock pattern: search field in the page header, hits grouped by day with 32px rows (project, agent badge, first line of the prompt tidied), the 320px dock shows the prompt and the answer (Markdown component; wrappers like `<task-notification>` and long paths tidied), project filter from the sidebar's current project with an "All projects" toggle. Empty states: not indexed (with Import action), no matches.
- [ ] Server route test first; then UI; render mockups, screenshot light/dark, compare, fix; `bun run check`; commit "Viewer: search past conversations".

### Task 6: ADR, README, and the latency check

- [ ] Measure the prompt and session-start hooks' p95 while a `history import` runs on a temp copy (same safety rules as part 1/2: temp store, transcripts read-only, TypeSafe off); record against the budgets (prompt 80 ms, session-start 150 ms).
- [ ] ADR 0013 "Part 3" section (trigger, consent, lease, viewer, measured latency); README: a short "Learn from past sessions" section (commands, what is kept, what is not, how to undo); CLAUDE.md command line updated if needed.
- [ ] `bun run check`; commit "docs: ADR 0013 part 3, README section, latency under a running import".
