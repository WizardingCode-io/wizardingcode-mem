# One engine with modules: the shared foundation — design

Date: 2026-10-12. Status: built (ADR 0019); approved direction (the author chose one engine with modules over separate products and asked to continue without further questions; the rulings below are the controller's, reported at the end). Roadmap item D1, wave 3, before D2 (knowledge and personas).

## Why

The family's target (memory, knowledge, personas) needs one place that decides what reaches the agent, one budget, one project identity, one app in one tab. The analysis of 2026-10-10 left two shapes open: separate products talking through a versioned contract and a registry file, or one engine with modules. The author chose **one engine with modules**: coherence by construction instead of a contract to keep in step across binaries. That makes the registry file and the cross-binary JSON contract of the earlier target unnecessary; their jobs move inside the binary.

Today everything is memory-specific: the hooks call `sessionBrief`, `retrieveForPrompt`, `notesForFile` and `notesForFailure` directly (`src/hooks/handle.ts`), the MCP server registers memory tools by name (`src/mcp/run.ts`), the viewer's rail is a fixed list (`ui/src/components/Rail.vue`), and the app's state file lives in the memory data directory (`src/ui/state.ts`). A second module would have to edit all of them.

## Decisions

- **A module contract inside the binary.** A module declares an id, a name, what it contributes at each injection moment, its MCP tools and its viewer views. Memory becomes the first module by wrapping what exists; no behaviour changes.
- **One injection point with one budget.** The hooks call a composer; the composer asks each enabled module in a fixed order for its contribution within its share of the event's budget and joins them. With memory alone, every hook's output is byte for byte what it is today.
- **Modules fail open one by one.** A module that throws or overruns its share contributes nothing; the others still inject; the hook still exits 0.
- **Modules are switched by a setting.** `WIZARDINGCODE_MODULES` (comma list, default `memory`) in `<data dir>/env`, environment wins. A module that is off contributes nothing, registers no tools and shows no views. A seam `moduleAllowed(id)` exists for a later licence check; today every built-in module is allowed.
- **Tools and views come from the modules.** The MCP server registers the enabled modules' tools; `/api/modules` tells the viewer which modules are on, and the rail shows their views. Tool names and the rail as seen today do not change.
- **The app's state is brand-level.** `ui.json` moves to `~/.wizardingcode/ui.json` (honouring `WIZARDINGCODE_HOME`) so any module's session-start hook reuses the app already running. The old location is read once and removed.
- **Project identity is the engine's.** `src/core/project.ts` and the links store (`src/store/links.ts`, ADR 0018) are documented as engine-level: every module keys its data by the same project ids and reads the same visible-projects set.

## Rulings (controller)

- **F1: the binary and the distribution keep the name `wizardingcode-mem` in D1.** Renaming means the plugins, the marketplace, the Homebrew formula and every install; with one module there is nothing for a user to gain. The rename (or a `wizardingcode` alias) lands with D2, when a second module ships. Cost if wrong: one rename later, which was going to happen anyway.
- **F2: modules' own tables wait for D2.** Memory keeps its migrations as they are; a per-module migration namespace is designed with the first module that needs tables, against a real case. Cost if wrong: D2 adds the namespace.
- **F3: the order of modules is fixed in code** (memory first), not configurable. Cost if wrong: a setting later.
- **F4: budget shares are per module, declared by the module, capped by the composer** so their sum never exceeds the event's budget; memory declares the whole budget while it is alone.
- F5-F9: see the rulings table in [ADR 0019](../../adr/0019-one-engine.md), which is authoritative (F5 memory takes the remainder; F6 a module fits the budget it is given; F7 no Modules card in D1; F8 unknown-id log once per process; F9 memory cannot be switched off in D1).

## The contract

```ts
export type Moment = "session-start" | "prompt" | "file-read" | "tool-failed";
export type Contribution = string | null; // text already rendered in the module's own wrapper
export interface MomentInput {
  db: Db; moment: Moment; projectId: number; branch: string | null; root: string;
  sessionId: number; epoch: number;
  prompt: string | null; path: string | null; error: string | null; // as the moment needs
  now: number; budgetChars: number; // this module's share, in characters
}
export interface EngineModule {
  id: string;                           // "memory"
  name: string;                         // "Memory"
  share: number | "remainder";          // 0..1 of each moment's budget, or what the others leave
  contribute?(input: MomentInput): Contribution;
  tools?(mode: ToolMode): Promise<ModuleTool[]> | ModuleTool[]; // run(args, call: ToolCall) gets the project
  views?: { tab: string; label: string; icon: string; key: string }[];
}
```

`src/engine/module.ts` is the source of truth, with [ADR 0019](../../adr/0019-one-engine.md). The sketch above changed during the build: the project belongs to the call (`ToolCall`), not to the listing; the module renders its own text, so notes never cross the contract; and `"remainder"` lets memory keep the whole budget while alone.

The composer keeps the memory module's exact rendering (intro sentence, wrapper tags, labels), so a single module produces today's text. With several modules, each contribution stays inside its own wrapper block, in module order.

## Testing

TDD, each test seen failing first.

- Byte-for-byte: the four hook outputs, for each agent adapter, equal pinned snapshots taken from the current code before the change.
- A test-only second module (a fixture, never shipped) plugs in through the contract: its text appears after memory's, inside its share; turning it off removes its text, tools and views; a module that throws leaves memory's output intact.
- Shares never sum above the budget; an overrunning module is cut to nothing, not truncated mid-note.
- `WIZARDINGCODE_MODULES` parsing: unknown ids ignored and logged once; empty means memory only.
- MCP tool list unchanged with memory alone; the fixture's tools appear only when it is on.
- `/api/modules` and the rail: the rail renders the same buttons as today with memory alone (screenshots light and dark, compared with today's).
- `ui.json`: written at brand level; an old file is read once, then removed; two hooks racing still find one app.
- Hook budgets unchanged (`tests/perf`).

## Not in this design

- The rename to one `wizardingcode` binary and the plugins' move (F1, with D2).
- Module-owned tables and their migrations (F2, with D2).
- Licences and paid modules: only the seam.
- Knowledge and personas themselves (D2).
