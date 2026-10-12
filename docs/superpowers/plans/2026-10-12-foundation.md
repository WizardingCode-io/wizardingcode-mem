# One engine with modules (D1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Memory becomes the first module of one engine: the hooks, the MCP server and the viewer's rail go through a module contract and one composer with one budget, so knowledge and personas (D2) can be added as modules without editing memory's code — with no change in behaviour today.

**Architecture:** `src/engine/` holds the contract (`EngineModule`), the module list and switch (`WIZARDINGCODE_MODULES`), and the composer that turns each injection moment into one hook output under a shared budget. `src/modules/memory/` wraps today's retrieval, tools and views. The app's `ui.json` moves to the brand directory. A test-only fixture module proves the seams.

**Tech Stack:** TypeScript on the pinned Bun; `bun:sqlite`; the MCP server (`src/mcp/`); the viewer (Vue 3 + Tailwind 4 + Nuxt UI, `ui/`).

**Spec:** `docs/superpowers/specs/2026-10-12-foundation-design.md`

## Global Constraints

- Written from scratch (`CLEAN-ROOM.md`). No resident process, no generative model.
- With memory as the only module, every hook output, the MCP tool list and the rail are exactly what they are today (pinned snapshots, screenshots).
- Fail open per module: a module that throws or overruns contributes nothing; the others still inject; hooks exit 0.
- Budget shares are declared by modules and capped by the composer so they never sum above the moment's budget; memory declares the whole budget while alone.
- Module order is fixed in code, memory first (Ruling F3).
- The binary and distribution keep the name `wizardingcode-mem` (Ruling F1); no module-owned migrations in D1 (Ruling F2).
- `WIZARDINGCODE_MODULES` (comma list, default `memory`) in `<data dir>/env`, environment wins; unknown ids ignored and logged once.
- No heavy imports on the hook path; hook budgets unchanged (prompt p95 ≤ 80 ms; session start ≤ 150 ms).
- Never write to the author's real data; tests use temp dirs.
- Viewer changes follow the Sales OS mockups and are compared side by side in light and dark (the rail must look as today).
- TDD (each test seen failing first); English; explicit `.ts` imports; `bun run check` green at every commit.

## Review Focus

1. A module that throws on one moment but not others (e.g. prompt only) — that moment loses only that module's text; the other moments and modules are untouched (Task 1).
2. `WIZARDINGCODE_MODULES` set to an empty string, whitespace, duplicates, `memory` absent, or an unknown id — memory-only behaviour unless memory is explicitly absent, in which case nothing is injected and the hook still exits 0 (Task 2).
3. Two session-start hooks racing while `ui.json` moves from the old location to the brand location — one app, no crash, the old file gone (Task 4).
4. A file-read or tool-failed moment for an agent without prompt injection — still nothing injected, as today (Task 1).
5. The MCP server started in `--global` mode — its tool list is unchanged and modules that have no global tools add none (Task 3).

---

### Task 1: The contract, the composer, and memory as a module

**Files:**
- Create: `src/engine/module.ts` (types), `src/engine/compose.ts`, `src/modules/memory/index.ts`, `tests/unit/compose.test.ts`, `tests/unit/hook-snapshots.test.ts`
- Modify: `src/hooks/handle.ts` (the four `case`s call `compose(...)` instead of the retrieval functions directly; everything else — turn bookkeeping, epochs, recording — stays where it is or moves into the memory module unchanged)

**Interfaces — produces:**

```ts
// src/engine/module.ts
export type Moment = "session-start" | "prompt" | "file-read" | "tool-failed";
export interface MomentInput {
  db: Db; moment: Moment; projectId: number; branch: string | null; root: string;
  sessionId: number; epoch: number; prompt: string | null; path: string | null; error: string | null;
  now: number; budgetChars: number;
}
/** Text already rendered in the module's own wrapper; null or "" contributes nothing. */
export type Contribution = string | null;
export interface ModuleTool { name: string; description: string; inputSchema: unknown; run(args: unknown): Promise<string> | string }
export interface ModuleView { tab: string; label: string; icon: string; key: string }
export interface EngineModule {
  id: string; name: string; share: number;
  contribute?(input: MomentInput): Contribution;
  tools?(context: ToolContext, mode: "project" | "global"): ModuleTool[];
  views?: ModuleView[];
}
// src/engine/compose.ts
export const MOMENT_BUDGET: Record<Moment, number>; // today's numbers: brief 4200, prompt 2400, file-read and tool-failed as today
export function compose(modules: readonly EngineModule[], input: Omit<MomentInput, "budgetChars">, onError?: (moduleId: string, error: unknown) => void): string | null;
```

`compose` gives each module `floor(share × budget)` (shares capped so the sum ≤ 1, in module order), calls `contribute` in a try/catch, drops a contribution longer than its share (whole, never truncated), and joins non-empty contributions with a blank line. With memory alone it returns exactly what the hook returns today. The memory module's `contribute` performs today's per-moment logic, including `recordInjections` and the `withWrite` atomicity for file-read and tool-failed.

- [ ] **Step 1:** Pin snapshots from the current code (before any change): for each adapter in `src/adapters/`, the stdout of `session-start`, `prompt`, `file-read` and `tool-failed` on a seeded temp DB (with and without links/user rules from ADR 0018). Commit them in the test file.
- [ ] **Step 2: Failing tests** (`compose.test.ts`): order; shares capped; an overrunning module dropped whole; a throwing module skipped with `onError` called and others kept; null/"" ignored; a moment a module does not handle skipped.
- [ ] **Step 3:** Run; fail. **Step 4:** Implement the contract, the composer and `src/modules/memory`; switch `handle.ts` to `compose([memory], …)`.
- [ ] **Step 5:** Snapshots and the existing hook, golden and perf tests pass; `bun run check`. Commit "Engine: a module contract and one composer; memory is the first module".

### Task 2: Switching modules, and a fixture module that proves the seams

**Files:**
- Create: `src/engine/modules.ts` (the built-in list and `enabledModules(settings)`, `moduleAllowed(id)`), `tests/fixtures/echo-module.ts` (test-only), `tests/unit/modules-setting.test.ts`, `tests/integration/fixture-module.test.ts`
- Modify: `src/settings/settings.ts` (the `WIZARDINGCODE_MODULES` key, shown in the viewer's Settings like the others), `src/hooks/handle.ts` (uses `enabledModules`)

**Interfaces — produces:** `export const BUILT_IN: readonly EngineModule[]` (memory only); `export function enabledModules(raw: string | undefined, available?: readonly EngineModule[]): EngineModule[]` (default `memory`; unknown ids ignored and logged once; duplicates collapsed; order always `available`'s); `export function moduleAllowed(id: string): boolean` (true for every built-in today). A test hook lets tests pass `available` including the fixture.

- [ ] **Step 1: Failing tests:** parsing (empty, whitespace, duplicates, unknown, `memory` absent → nothing injected, hook exits 0); with the fixture enabled its text appears after memory's within its share, and memory's text is unchanged; fixture throwing on `prompt` only → memory's prompt text intact and the fixture's session-start text still appears.
- [ ] **Step 2:** Fail. **Step 3:** Implement. **Step 4:** Pass; `bun run check`. Commit "Engine: modules switched by a setting; a fixture proves another module plugs in".

### Task 3: Tools and views come from the modules

**Files:**
- Modify: `src/mcp/run.ts` (register `enabledModules(...).flatMap(m => m.tools?.(context, mode) ?? [])`; memory's tools move into `src/modules/memory/tools.ts` with identical names, descriptions and schemas), `src/cli/commands/tool.ts` (the OpenCode bridge resolves tools the same way), `src/ui/server.ts` + `src/ui/api.ts` (`GET /api/modules` → `{ id, name, views }[]` of enabled modules, token-protected like the rest), `ui/src/components/Rail.vue` + `ui/src/api.ts` (the rail renders module views from `/api/modules`; memory's views are today's five, same order, labels, icons and keys)
- Test: `tests/unit/mcp-tools-list.test.ts` (tool list snapshot for project and global modes, before/after), route test, a view-helper test; screenshots of the rail light and dark compared with today's

- [ ] **Step 1:** Pin the current MCP tool lists (project and `--global`) and the OpenCode bridge's accepted names as snapshots. **Step 2: Failing tests:** `/api/modules`; the fixture's tool and view appear only when enabled; global mode unchanged. **Step 3:** Fail. **Step 4:** Implement; `bun run ui:build`; screenshots `rail-{light,dark}.png` before and after, identical. **Step 5:** Pass; `bun run check`. Commit "Engine: tools and views come from the modules".

### Task 4: The app's state at brand level

**Files:**
- Modify: `src/ui/state.ts` (read/write `<brand home>/ui.json` where brand home is `WIZARDINGCODE_HOME` or `~/.wizardingcode`; on read, if only the old `<data dir>/ui.json` exists, use it, write the brand file, remove the old one), any caller that passes `dataDir` for the state, `src/util/legacy.ts` if it references the old path
- Test: `tests/unit/ui-state.test.ts` (brand path; migration from old; both present → brand wins and old removed; concurrent readers during migration see one app)

- [ ] **Step 1: Failing tests.** **Step 2:** Fail. **Step 3:** Implement. **Step 4:** Pass; `bun run check`; the `ui --auto` integration test still shows one app. Commit "App: its state lives at the brand level, so any module reuses it".

### Task 5: ADR 0019 and docs

**Files:** Create `docs/adr/0019-one-engine.md` (the choice and why; the contract; the composer and budgets; rulings F1–F4; what waits for D2: the rename, module tables, licences); modify CLAUDE.md (where things are: `src/engine/`, `src/modules/memory/`; `WIZARDINGCODE_MODULES`; brand-level `ui.json`), README (one short paragraph: modules, and that memory is the one shipped today), the spec's status line, and the target-architecture note in the ADR that the registry file and cross-binary contract are superseded.

- [ ] **Step 1:** Write the docs; `bun run check`. **Step 2:** Commit "One engine with modules: ADR 0019".
