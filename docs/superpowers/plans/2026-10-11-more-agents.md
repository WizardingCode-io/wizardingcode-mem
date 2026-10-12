# More agents (A6, first wave) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** wizardingcode-mem installs into and works with Qwen Code, Factory Droid, GitHub Copilot (CLI + VS Code) and Antigravity CLI; Gemini CLI support is removed and old Gemini installs are cleaned up.

**Architecture:** One adapter (`src/adapters/<agent>/adapter.ts`) and one installer (`src/install/<agent>.ts`) per agent, on the existing `HostSpec` / `installHooksFile` framework (`src/install/hooks-file.ts`) wherever the host keeps hooks in a JSON settings file; native packaging through `scripts/plugins.ts` where the host has a plugin format. Payload fixtures come from each agent's official documentation and are replaced by captures when the author confirms the agent in a real session.

**Tech Stack:** TypeScript on the pinned Bun; existing hook pipeline (`src/hooks/handle.ts`, `src/adapters/common/hook-json.ts`, `src/cli/commands/{hook,install,uninstall}.ts`, `src/install/detect.ts`, `src/doctor/`).

**Spec:** `docs/superpowers/specs/2026-10-11-more-agents-design.md`. Research with official-doc URLs: `docs/research/2026-10-11-agents.md`.

## Global Constraints

- Written from scratch (`CLEAN-ROOM.md`). **Sources: each agent's official documentation and real sessions only — never claude-mem's code, docs or names, even where they describe the same agent.**
- Hooks never exit with code 2 and fail open (code 0, empty stdout) on any failure, unknown agent, or unparseable payload.
- Installers never touch other entries in the host's files; uninstall removes only ours; reinstall is idempotent; settings files are backed up before a change the way the existing installers do.
- Tests use temporary `HOME` / config dirs only. Never write to the author's real `~/.claude`, `~/.codex`, `~/.gemini`, `~/.qwen`, `~/.factory`, `~/.copilot`, `~/.wizardingcode`.
- Generated plugin files change only through `bun run plugins`; `bun scripts/plugins.ts --check` passes.
- **Agent contract (Tasks 1–4).** Each new agent: (a) `AgentId` gains its id (`qwen`, `droid`, `copilot`, `antigravity`); (b) fixtures `tests/fixtures/<id>/payloads/*.json`, one per host event we use, built from the official docs, with `tests/fixtures/<id>/README.md` naming each doc URL and saying "from documentation, not yet captured"; (c) an adapter registered in `src/adapters/index.ts` with honest `capabilities`; (d) an installer with `install<Name>`, `uninstall<Name>`, `inspect<Name>…`, `<name>Context(binaryPath, env)` honouring the host's own config-dir environment variable when it has one; (e) `install <id>` / `uninstall <id>` / install-all / `detectAgents` (`AGENT_ORDER`, the agent's command name and config dir) / `SUPPORTED_AGENTS` and its label / usage text / `doctor` checks / the `standsDownAsPlugin` lookup in `src/cli/commands/hook.ts` when it ships a plugin; (f) tests: every fixture parses; a broken payload gives null; render gives the exact host shape and empty when there is no context; install beside existing user entries, uninstall, reinstall; plugins check; (g) a history reader only when the transcript format is documented, else none (say so in the task report).
- Repository text in English; explicit `.ts` imports; TDD.

## Review Focus

1. A user whose host settings file already has their own hooks for the same events (and comments or unknown keys in JSONC) — kept exactly; ours added beside; removed cleanly (each task's install tests seed such a file).
2. A host that is installed but whose config dir does not exist yet (fresh install) — `install` creates only what it needs; `detectAgents` finds the agent by its command on PATH (each task).
3. An old Gemini install (our hooks in `~/.gemini/settings.json`, our extension under `~/.gemini/extensions`) after the upgrade — `uninstall` removes it, `install` offers to, `doctor` names it, `hook gemini …` exits 0 silently (Task 5).
4. Antigravity sharing `~/.gemini/` with the old Gemini CLI — installing for Antigravity must not be mistaken for (or removed as) a Gemini leftover, and the reverse (Task 4 and Task 5 tests on one temp home holding both).
5. A host that runs our hook with a payload missing fields we rely on (no `cwd`, no session id, extra unknown fields) — null and silence, never a throw (each task's broken-payload test).

---

### Task 1: Qwen Code

**Docs (official):** https://qwenlm.github.io/qwen-code-docs/en/users/features/hooks/ (and the MCP / settings / extensions pages it links). Qwen Code is a Gemini CLI fork: its settings file and extension format may match `src/install/gemini.ts`; reuse that code by moving what is shared (it is deleted in Task 5), not by importing from `gemini.ts`.

**Files:** Create `src/adapters/qwen/adapter.ts`, `src/install/qwen.ts`, `tests/fixtures/qwen/payloads/*.json` + `README.md`, `tests/unit/qwen-adapter.test.ts`, `tests/integration/install-qwen.test.ts`; modify the registration points in the Agent contract; `scripts/plugins.ts` if Qwen has a documented extension format (`plugins/qwen/…`).

**Mapping:** `SessionStart` → session-start, `UserPromptSubmit` → prompt, `Stop` → turn-end, `SessionEnd` → session-end; injection via `hookSpecificOutput.additionalContext` at session start and per prompt (confirm the field names in the docs; if they match Claude Code's, reuse `parseHookJson` / `renderHookJson` with the right turn-id field). MCP through `qwen mcp add` or the settings `mcpServers` (whichever the docs make the supported way). Config dir: `~/.qwen` (and the docs' env override, e.g. `QWEN_DATA_DIR`/home variable, if any). History reader: only if the chats JSONL record shape is documented.

- [ ] **Step 1:** Read the docs; write the fixtures and the README with URLs.
- [ ] **Step 2: Failing tests** per the Agent contract (f), plus Review Focus 1, 2, 5.
- [ ] **Step 3:** Run, fail. **Step 4:** Implement. **Step 5:** Run, pass; `bun run plugins` if packaging changed; `bun run check`.
- [ ] **Step 6:** Commit "Qwen Code: hooks, context and memory tools".

### Task 2: Factory Droid

**Docs (official):** https://docs.factory.com/cli/configuration/hooks-guide (and the hooks reference, MCP and plugins pages it links).

**Files:** Create `src/adapters/droid/adapter.ts`, `src/install/droid.ts`, `tests/fixtures/droid/payloads/*.json` + `README.md`, `tests/unit/droid-adapter.test.ts`, `tests/integration/install-droid.test.ts`; registration points; `scripts/plugins.ts` only if Droid documents a plugin format.

**Mapping:** `SessionStart`, `UserPromptSubmit`, `Stop`, `SessionEnd` → ours; Claude-Code-compatible payloads and `additionalContext` (confirm field names, including the turn id and `transcript_path`). Hooks in `~/.factory/hooks.json` (or the documented settings file); MCP in the documented Droid MCP config (`~/.factory/mcp.json` per research — confirm). Command name for detection: the documented CLI binary (`droid`). History reader: none unless the session format is documented.

- [ ] **Step 1:** Docs → fixtures + README. **Step 2:** Failing tests per the Agent contract, Review Focus 1, 2, 5. **Step 3:** Fail. **Step 4:** Implement. **Step 5:** Pass; plugins; check.
- [ ] **Step 6:** Commit "Factory Droid: hooks, context and memory tools".

### Task 3: GitHub Copilot (CLI + VS Code agent mode)

**Docs (official):** https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-hooks-reference , https://docs.github.com/en/copilot/reference/hooks-configuration , https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference , https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference , https://code.visualstudio.com/docs/copilot/customization/hooks .

**Files:** Create `src/adapters/copilot/adapter.ts`, `src/install/copilot.ts`, fixtures + README (separate fixtures for CLI and VS Code payloads where the docs differ), `tests/unit/copilot-adapter.test.ts`, `tests/integration/install-copilot.test.ts`; registration points; `scripts/plugins.ts` → a Copilot CLI plugin (`plugins/copilot/plugin.json` with hooks and MCP, the plugin's own hooks file).

**Mapping:** `sessionStart` → session-start (injection: `additionalContext` per the docs); `userPromptSubmitted` → prompt, **capture only** (`capabilities.promptInjection: false` — the host drops command-hook output there); `agentStop` → turn-end; `sessionEnd` → session-end. Hooks in a file we own entirely, `~/.copilot/hooks/wizardingcode-mem.json` (`"version": 1` per the docs), which both the CLI and VS Code read — so uninstall deletes that file and nothing else. If the documented event names differ between the CLI (camelCase) and VS Code (PascalCase), the hook file carries what each needs and the adapter accepts both. MCP: `~/.copilot/mcp-config.json` (CLI); VS Code's user `mcp.json` only if documented and safely mergeable — otherwise print the line to add and say so in the report. Config-dir override: the documented env variable, if any. Detection: the `copilot` command or `~/.copilot`. History reader: none (the `events.jsonl` format is undocumented).

- [ ] **Step 1:** Docs → fixtures + README. **Step 2:** Failing tests per the Agent contract, Review Focus 1, 2, 5, plus: a prompt payload yields a captured turn and empty output. **Step 3:** Fail. **Step 4:** Implement. **Step 5:** Pass; plugins; check.
- [ ] **Step 6:** Commit "GitHub Copilot: a brief at session start, capture and memory tools".

### Task 4: Antigravity CLI

**Docs (official):** https://antigravity.google/docs/hooks , https://antigravity.google/docs/mcp , https://antigravity.google/docs/cli/plugins .

**Files:** Create `src/adapters/antigravity/adapter.ts`, `src/install/antigravity.ts`, fixtures + README, `tests/unit/antigravity-adapter.test.ts`, `tests/integration/install-antigravity.test.ts`; registration points; `scripts/plugins.ts` → an Antigravity plugin with `hooks.json` if the plugin format is documented.

**Mapping:** `PreInvocation` → session-start when it is the conversation's first invocation (the documented field, e.g. `invocationNum`), and prompt when it starts a user turn (if the payload does not carry the user's text, read it from `transcriptPath` best-effort; if neither is possible, inject at session start only and record that in `capabilities`). `Stop` → turn-end. No session-end event: sessions end by the existing stale-turn rules. Injection: `injectSteps` with one ephemeral message (exact JSON from the docs). Hooks in `~/.gemini/config/hooks.json` (or the plugin); MCP in `~/.gemini/config/mcp_config.json`. **Shared `~/.gemini/`**: our Antigravity entries must be distinguishable from old Gemini CLI entries (`hook antigravity …` vs `hook gemini …`) — test both in one temp home (Review Focus 4). Detection: the `agy` command or its config. History reader: none unless the transcript format is documented.

- [ ] **Step 1:** Docs → fixtures + README. **Step 2:** Failing tests per the Agent contract, Review Focus 1, 2, 4, 5. **Step 3:** Fail. **Step 4:** Implement. **Step 5:** Pass; plugins; check.
- [ ] **Step 6:** Commit "Antigravity CLI: hooks, context and memory tools".

### Task 5: Remove Gemini CLI; clean up old installs

**Files:** Delete `src/adapters/gemini/`, `src/install/gemini.ts` (after Task 1 moved anything shared), `plugins/gemini/`, `scripts/package-gemini.sh`, Gemini fixtures and tests; modify `.github/workflows/release.yml` (no Gemini archives or install line), `scripts/plugins.ts`, `src/adapters/index.ts`, `src/cli/commands/{hook,install,uninstall}.ts`, `src/install/{detect,hooks-file,legacy-plugins}.ts`, `src/doctor/`, `npm/` texts, `plugins/opencode/README.md` if it lists agents; create `src/install/gemini-leftover.ts` (recognise and remove our old Gemini hooks/extension/MCP entry) with tests.

**Behaviour:** `AgentId` keeps `"gemini"` only where stored data or leftover detection needs it (sessions recorded under it stay readable); `hook gemini …` exits 0 with empty output (old installs keep calling it); `uninstall` (all agents) removes our Gemini leftovers; `install` without an agent, finding leftovers, asks on a TTY to remove them (no TTY: one hint line) and mentions Antigravity; `doctor` reports a leftover as a warning with the command to clean it. `~/.gemini/config/` (Antigravity) is never touched by the Gemini cleanup.

- [ ] **Step 1: Failing tests:** leftover detection on a temp home with our old Gemini hooks + extension dir + MCP entry and the user's own Gemini hooks; uninstall removes only ours; install offers (TTY simulated as the existing install tests do) and hints (no TTY); doctor warns; `hook gemini session-start` exits 0 with empty stdout; a temp home holding both old Gemini and new Antigravity entries — Gemini cleanup leaves Antigravity's alone; no generated file or release step mentions Gemini (`git grep -i gemini` limited to the leftover module, its tests, ADRs and the changelog-like docs).
- [ ] **Step 2:** Fail. **Step 3:** Implement and delete. **Step 4:** Pass; `bun run plugins`; `bun run check`.
- [ ] **Step 5:** Commit "Gemini CLI: removed; old installs are recognised and cleaned up".

### Task 6: Budgets, the machine report, ADR 0016, docs — and the real-session stop

**Files:** Modify `tests/perf/budgets.test.ts`; create `scripts/proof/agents.ts`, `docs/adr/0016-more-agents.md`; modify `README.md`, `CLAUDE.md` (the install line and agent list), `docs/superpowers/specs/2026-10-11-more-agents-design.md` (status line).

- [ ] **Step 1: Budgets:** the prompt and session-start hooks of `qwen`, `droid`, `copilot` (session-start; prompt is capture-only — measure it too) and `antigravity` (its PreInvocation path) within the existing budgets, like the current agents.
- [ ] **Step 2: Machine report** `scripts/proof/agents.ts`: read-only; for each supported agent prints whether it is installed (command on PATH / config dir), the files our installer would write and whether they exist, whether our entries are already there, and Gemini leftovers. It writes nothing; run it on the author's machine and paste the output (paths shortened to `~`) into the task report, not into the repository.
- [ ] **Step 3: ADR 0016:** per agent — events and mapping, injection capability, MCP, history, packaging, what is confirmed from docs (with URLs) and what awaits a real session; the Gemini removal and its cleanup path; budgets measured.
- [ ] **Step 4:** README (supported agents, install commands), CLAUDE.md, spec status; `bun run check`; commit "A6: budgets, ADR 0016, docs".
- [ ] **Step 5: Stop and ask the author**, agent by agent, before any real-session check: each one installs into that agent's real configuration on the author's machine (and runs this build's migrations on the real database — see ADR 0015's note on 0.4.4 binaries). With a yes per agent: install, run one session, capture one payload per event into the fixtures (personal paths replaced by `/work/shop`), confirm the injected context appears, and record it in ADR 0016.
