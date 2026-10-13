# ADR 0019 — One engine with modules

Date: 2026-10-12 · Status: accepted; built with no change to what the agent sees (every hook output and tool list is pinned by snapshots taken before the change). Roadmap item D1, wave 3, before D2 (knowledge and personas). Design: `docs/superpowers/specs/2026-10-12-foundation-design.md`; plan: `docs/superpowers/plans/2026-10-12-foundation.md`.

## Context

The family's target is memory, knowledge and personas: one place that decides what reaches the agent, one budget, one project identity, one app in one tab. The analysis of 2026-10-10 left two shapes open: separate products that talk through a versioned contract and a registry file, or one engine with modules. Everything was memory-specific: the hooks called the retrieval functions by name, the MCP server registered memory tools by name, the viewer's rail was a fixed list, and the app's state file lived in memory's data directory. A second module would have had to edit all of them.

## Decision

**One engine with modules**, chosen by the author. Coherence by construction instead of a contract to keep in step across binaries: a module is code inside the binary, so the budget, the project identity and the app are shared because there is only one of each. Memory is the first module, wrapping what exists. It is the only one shipped.

The registry file and the cross-binary JSON contract of the 2026-10-10 target are **superseded**: their jobs (who is installed, what each may add to the context) move inside the binary, as `src/engine/modules.ts` and the composer.

## The contract

`src/engine/module.ts`. An `EngineModule` has an `id`, a `name`, a `share` (a number from 0 to 1, or `"remainder"`: memory's, what the other modules leave) and optionally:

- `contribute(input)` returns the text for one moment (`session-start`, `prompt`, `file-read`, `tool-failed`), already rendered in the module's own wrapper, or null. The input carries the database, project id, branch, root, session, context epoch, the prompt, file or error as the moment needs, the time, and `budgetChars`, the module's share in characters.
- `tools(mode)` returns the MCP tools for `"project"` or `"global"` mode. It is called once per server or bridge run, never on the hook path. Each tool's `run(args, call)` receives the per-call `ToolCall` (`projectDir`, null in global mode), because one server serves many calls. The first draft had `tools(context, mode)`; the project belongs to the call, not to the listing.
- `views` are the rail buttons (`tab`, `label`, `icon`, `key`).

`src/engine/modules.ts` lists `BUILT_IN` (memory) and `enabledModules(raw)`, which reads `WIZARDINGCODE_MODULES` (comma list, default `memory`, in `<data dir>/env`, the environment wins; it only adds modules, memory is always on, F9). Unknown ids are ignored and logged once per process; duplicates collapse; the order is always the engine's. `moduleAllowed(id)` is the seam for a later licence check and returns true today. The MCP server registers only the enabled modules' tools, and `/api/modules` tells the viewer which modules are on so the rail shows their views.

## The composer, budgets and fail-open

`compose` (`src/engine/compose.ts`) asks each enabled module in order for its contribution and joins them with a blank line; null when nobody has anything to say. `src/engine/budget.ts` holds `MOMENT_BUDGET`, a leaf so retrieval can read the defaults without loading the composer: 4200 characters at session start, 2400 on a prompt, 1200 on a file read, 1200 on a tool failure. These are exactly the numbers memory had before, so alone it produces byte-for-byte today's text.

Shares are taken in order from the moment's budget, each at most what is left, in characters so rounding cannot push the sum above the budget. A module with `share: "remainder"` gets what the others leave. A module without `contribute` takes nothing. The blank lines that join contributions count against the budget: 2 characters per join are set aside before shares are computed, so the combined text never exceeds it (alone, memory pays nothing).

Fail-open, module by module: a module that throws contributes nothing and is reported (once per call, to the log); a contribution longer than its budget is dropped whole, never truncated mid-note, because half a note reads as a complete one. The others still inject and the hook still exits 0.

## Rulings

| Ruling | Decision | Why | Cost if wrong |
|---|---|---|---|
| F1 | The binary and the distribution keep the name `wizardingcode-mem` in D1. | Renaming touches the plugins, the marketplace, the Homebrew formula and every install; with one module there is nothing for a user to gain. | One rename later, which was going to happen anyway. |
| F2 | Modules' own tables wait for D2. | A per-module migration namespace should be designed against the first real case, not in the abstract. Memory keeps its migrations as they are. | D2 adds the namespace. |
| F3 | The order of modules is fixed in code, memory first. | Nobody has asked for another order. | A setting later. |
| F4 | Shares are declared by each module and capped by the composer so their sum never exceeds the budget. | One budget is the point: the agent's context is not a sum of products. | A change to the cap rule. |
| F5 | Memory takes the "remainder" of each moment's budget (1 minus the other enabled modules' shares). | The spec's "memory declares the whole budget while alone" read as: alone it keeps the whole budget, and other modules' shares come off the top. | A share setting later. |
| F6 | A module must fit the budget it is given (it is passed exactly); the composer's drop of an overrunning contribution is a safety net only. Memory measures before recording anything as shown. | A drop after recording would count a note as shown that the agent never saw. | A dropped module's notes counted as shown once. |
| F7 | No Modules card in the viewer in D1. | With one shipped module there is nothing to switch; the key lives in the settings API like `HISTORY_DAYS`. | A small card later. |
| F8 | The unknown-id log line is once per hook process, not once ever. | A database marker is not worth it for a misconfiguration line. | A repeated line in the log. |
| F9 | Memory cannot be switched off in D1: `enabledModules` always includes it, and the settings API refuses a `WIZARDINGCODE_MODULES` list without it. | Capture, distilling and the viewer are memory's and are not gated by the setting, so "off" would leave it half on while the user believes it stopped. Stopping memory for a project stays the per-project "memory off". | A user cannot stop memory everywhere with one setting until a real off exists (D2). |

## A latent overrun, found while pinning snapshots

Pinning the file-read output before the change showed that `notesForFile` measured its notes against the file-read budget without the introductory sentence the hook adds, so a full set of notes could exceed 1200 characters once the intro was in front. It now measures with the real intro. Not a regression from the engine: it was there before, and the pinned snapshots are taken after this fix so they hold the corrected numbers.

## The app's state is brand-level

`ui.json` moved from memory's data directory to `~/.wizardingcode/ui.json` (honouring `WIZARDINGCODE_HOME`), so any module's session-start hook reuses the app already running instead of starting another. The old file is read once, migrated and removed. The migration is race-safe: the brand-level file is created exclusively, the old one removed, and the loser of a race re-reads the winner's file; if both exist, the brand-level one wins. `ui --auto` passes both locations. A test starts two `--auto` processes at once and finds one app.

## Test isolation

Writing the migration test exposed a real leak: the viewer, started by tests that pass their own `env`, wrote `ui.json` into the real home directory. The test preload (`tests/preload.ts`) now points `WIZARDINGCODE_HOME`, `HOME` and `USERPROFILE` at a throwaway directory removed at exit, and deletes every path override from the shell environment (the mem data, store and claude-mem dirs, Claude Desktop's config, `SHIBAOX_HOME`, `CODEX_HOME`, `CLAUDE_CONFIG_DIR`, `XDG_CONFIG_HOME`, `QWEN_HOME`, `COPILOT_HOME`, `GEMINI_CLI_HOME`, `APPDATA`, `LOCALAPPDATA`). The tool-list tests set their own store and `WIZARDINGCODE_MODULES`. The suite passes with all sixteen variables exported to fresh directories, and nothing is written to them.

## Not in this ADR (waits for D2)

- The rename of the binary, or a `wizardingcode` alias, and the plugins' move (F1): with the second module.
- Module-owned tables and a per-module migration namespace (F2).
- Per-module MCP instructions: the `--global` instructions are still memory's, sent even with memory off.
- Licences and paid modules: only the `moduleAllowed` seam exists.
- A Modules card in the viewer (F7).
- Knowledge and personas themselves.

## Project identity is the engine's

`src/core/project.ts` and the links store (`src/store/links.ts`, ADR 0018) are engine-level: every module keys its data by the same project ids and reads the same visible-projects set.

## Note (2026-10-13): knowledge and personas are a separate product

The author decided that knowledge and personas are not modules of wizardingcode-mem but a product of their own, started after the mem is consolidated (ADR 0020 records the knowledge module that was built here and withdrawn before release). The engine contract stays as the mem's internal seam; memory is its only module. How the separate product and the mem share an app and avoid injecting the same context twice is that product's design.
