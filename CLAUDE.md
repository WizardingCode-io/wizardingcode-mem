# wizardingcode-mem

Persistent memory across sessions for coding agents, by **WizardingCode**. One binary, no daemon, no generative LLM, local by default.

Brand conventions: products, plugins and skills are called `wizardingcode-<thing>`; variables `WIZARDINGCODE_<THING>_*`; data in `~/.wizardingcode/<thing>` (honouring `WIZARDINGCODE_HOME`). Until 0.3.0 this was `shibaox-mem`. The shibaox brand is retired, and installs of it are taken over automatically (`src/util/legacy.ts`, `src/install/legacy-plugins.ts`). Never reintroduce the old names outside that compatibility code. See `docs/adr/0011-wizardingcode-brand.md`.

## The non-negotiable rule

**This project is written from scratch. It is not a fork of claude-mem.** Never copy code, schema, prompts, text or names from claude-mem, and never open its source to implement a feature. See `CLEAN-ROOM.md`.

## Where things are

- Design and decisions: `docs/design/2026-10-05-shibaox-mem-design.md` (written under the old name)
- Measured decisions and departures from the design: `docs/adr/` (read the latest before touching the schema or retrieval)

## Commands

- `bun run check` — typecheck, lint and tests
- `bun run build` — compiles the five binaries into `dist/`
- `bun run format` — formats and fixes lint
- `bun run plugins` — rewrites what each agent installs (manifests, hooks, `wizardingcode-mem.sh`, the OpenCode package) from `scripts/plugins.ts`; run it after changing the version or the events
- `wizardingcode-mem install [claude-code|claude-desktop|codex|cursor|opencode|qwen|droid|copilot|antigravity]` installs for one agent (Claude Desktop: its chat gets the MCP server with `--global`, across every project; Cowork gets the plugin; ADR 0012); with no agent, for every one it finds. In Claude Code it imports claude-mem's memories and retires it (with confirmation); `wizardingcode-mem import claude-mem` only imports. claude-mem's database is only read, never changed. Gemini CLI is no longer supported: `install gemini` points to Antigravity, `uninstall gemini` removes an old install (`src/install/gemini-leftover.ts`; never touches Antigravity's `~/.gemini/config`).
- Adapters in `src/adapters/<agent>/`; installers in `src/install/`. The design per agent, and what was or was not confirmed in real sessions, is in ADR 0006.
- Installation is native in each agent (plugin, extension, npm package): ADR 0009. The files in `.claude-plugin/`, `hooks/`, `plugin/` and `plugins/` are generated; do not edit them by hand.
- `wizardingcode-mem rejudge [--limit n] [--concurrency n]` asks TypeSafe for the kind and importance of imported memories; what is not worth keeping becomes `archived` (never deleted). Resumable; needs a key.
- `wizardingcode-mem history import [--days n] [--agent claude-code|codex] [--max-seconds n]` distils the agents' own transcripts from the last days (`historyDays`, default 180) into memories dated when they happened, live turns first; resumable, never archives. `wizardingcode-mem history replace-imports` then archives the claude-mem imports inside each finished project's history span, sparing those history confirmed; `wizardingcode-mem history restore-imports` undoes it. `wizardingcode-mem history index [--agent] [--max-seconds n]` keeps a separate, redacted, searchable index of every past turn in `history.db` (store dir, rebuildable, not in backups; session end updates it once the file exists); `history search <words> [--project] [--limit]` reads it (also the MCP `history_search`), `history forget` deletes it; never injected. One run at a time (meta lease `history.lease`); `install` offers it once (`--import-history` / `--no-import-history`), the viewer has a banner offer, a Settings History card (progress via `/api/history/progress`) and a History view that searches `history.db`. ADR 0013.
- `wizardingcode-mem ui [--port n] [--no-open] [--auto]` opens the viewer (loopback, token in the URL, stops when idle and no tab is open; `--auto` is what the session-start hook runs: show the viewer already running, or become it). `wizardingcode-mem compact [--dry-run]` prunes old records; never deletes memories. `wizardingcode-mem backup [--list | --restore <name>]` copies the database to the configured folder or bucket.
- Settings live in `<data dir>/env` (dotenv, 0600; `src/settings/`), edited from the viewer's Settings tab; keys are named like the environment variables and the environment wins. The data directory (`defaultDataDir`) holds the binary, the settings, the logs and `ui.json`; the database may live elsewhere (`resolvePaths().storeDir`, `WIZARDINGCODE_MEM_STORE_DIR`): open it with `openDb()` and its default, never from `dataDir` directly. ADR 0010.

The `bun` the scripts use is the one pinned in `devDependencies`, not the global one; run tests as `bun run test` (or `./node_modules/.bin/bun test <files>`).

## Conventions

- TDD: the test is written and seen failing before the code.
- Hooks never exit with code 2 (in the agents, 2 blocks the action). They fail open: code 0 and empty stdout. In tests, `WIZARDINGCODE_MEM_DISTILL=off` and `WIZARDINGCODE_MEM_UI_AUTO_OPEN=off` keep hooks from starting background work, `WIZARDINGCODE_MEM_MIGRATE=off` keeps them away from a real `~/.shibaox`; `WIZARDINGCODE_MEM_UI_BROWSER=none` keeps the browser closed. Claude Code also gets notes on `file-read` (`PostToolUse`, matcher `Read`): at most two, once per context, no background work. `tool-failed` (`PostToolUseFailure`) is built but held, not installed, until a narrower version passes ADR 0015's bar.
- No heavy SDKs on the hook path; use `await import()` per command.
- Semantic judgements go through the `Judge` interface (TypeSafe opt-in, heuristics as the fallback). Exact rules and calculations stay in code.
- Imports with an explicit `.ts` extension.
- The viewer is a Vue 3 + Tailwind 4 + Nuxt UI app in `ui/`, built by Vite into a single `src/ui/dist/index.html` (not in git; `bun run ui:build`, included in `test`, `build` and `check`) that the binary embeds. The viewer follows WizardingCode's app pattern (the Sales OS mockups in the rebrand repository, `09-sales-os/SHELL.md` and `DENSITY.md`): dark frame (40px top bar, 56px rail, 216px sidebar), three-row page header, grouped lists with 32px rows, a 320px detail dock, the compact type scale. The tokens live in `ui/src/app.css` and feed Nuxt UI's `--ui-*` variables (`--ui-radius` sets every radius); its component sizes are set in `ui/vite.config.ts`; icons are bundled at build time; the fonts in `src/ui/assets/` travel in the binary. Nothing leaves for the network from the viewer. `bun run ui:dev` to develop against a running `wizardingcode-mem ui`.
- Repository documents (README, design, ADRs, this file) are written in English.
