# More agents (A6, first wave) — design

Date: 2026-10-11. Status: built (A1 to A6 on `design/more-agents`), from documentation; ADR 0016 records it. The real-session checks wait on the author's yes, agent by agent. Roadmap item A6 ("reach").

## Why

wizardingcode-mem supports Claude Code, Claude Desktop, Codex, Cursor, Gemini CLI and OpenCode. A competitor advertises 41 agents. Research on 2026-10-11 (official docs first; `docs/research/2026-10-11-agents.md`) found that Google retired Gemini CLI for most users on 2026-06-18 in favour of the closed-source Antigravity CLI, and that four agents give the best reach for the effort: Antigravity CLI, GitHub Copilot (CLI and VS Code agent mode), Qwen Code and Factory Droid.

## Decisions

| Topic | Decision |
|---|---|
| First wave | Qwen Code, Factory Droid, GitHub Copilot (CLI + VS Code, one adapter), Antigravity CLI. |
| Gemini CLI | **Removed now**: adapter, installer, extension, release artefact. Existing installs are recognised and cleaned up (uninstall; `install` offers to remove our Gemini hooks and points to Antigravity). Stored data from Gemini sessions stays. |
| Sources | Official documentation of each agent and real sessions only. Never claude-mem's code, docs or names (`CLEAN-ROOM.md`), even where it documents the same agent. |
| Confirmation | Payload fixtures start from official docs; each agent is confirmed in a real session on the author's machine only with the author's yes, agent by agent, and recorded in ADR 0016 (as ADR 0006 did). |

## Components

Each agent follows the existing pattern: an adapter in `src/adapters/<agent>/` (parse payloads, render output, read turn detail, capabilities), an installer in `src/install/<agent>.ts` (hooks + MCP, install and uninstall, never touching other entries), generated native files through `scripts/plugins.ts`, and `AgentId` gains the new ids.

| Agent | Host events → ours | Injection | MCP | Transcripts | Native install |
|---|---|---|---|---|---|
| Qwen Code | `SessionStart`, `UserPromptSubmit`, `Stop`, `SessionEnd` (Claude-Code-shaped JSON on stdin) | `hookSpecificOutput.additionalContext` at session start and per prompt | `mcpServers` in Qwen settings / `qwen mcp add` | JSONL under `~/.qwen/projects/*/chats` (or `QWEN_DATA_DIR`): a history reader if the record shape allows it | Qwen extension, else settings hooks |
| Factory Droid | `SessionStart`, `UserPromptSubmit`, `Stop`, `SessionEnd` (Claude-Code-compatible) | `additionalContext` at session start and per prompt | Droid MCP config | only if a real session shows `transcript_path` | `~/.factory/hooks.json` (plugin if Droid's plugin format is documented) |
| GitHub Copilot (CLI + VS Code) | `sessionStart`, `userPromptSubmitted` (capture only), `agentStop` (turn end), `sessionEnd` | **session start only** (a brief); per-prompt output is dropped by the host, so the rest is through MCP | `~/.copilot/mcp-config.json` (CLI); VS Code user `mcp.json` | `events.jsonl` under `~/.copilot/session-state/<id>/` (format undocumented: a reader only if stable) | Copilot CLI plugin (`plugin.json` with hooks and MCP) + `~/.copilot/hooks/*.json`, which VS Code also reads |
| Antigravity CLI | `PreInvocation` (first invocation of a conversation → session start; each user turn → prompt, prompt text from `transcriptPath` if the payload lacks it), `Stop` → turn end; no session-end event | `injectSteps` with one ephemeral message | `~/.gemini/config/mcp_config.json` (or workspace `.agents/mcp_config.json`) | `transcriptPath` in every payload | Antigravity plugin with `hooks.json`, else `~/.gemini/config/hooks.json` |

Gemini removal follows `src/install/legacy-plugins.ts`: recognise our entries in Gemini's settings and extension, remove them on `uninstall` and, with confirmation (TTY) or a hint (no TTY), on `install`; `doctor` reports a leftover Gemini install. `hook gemini …` from an old install exits 0 with empty output.

## Testing

TDD throughout.

- **Per agent:** parse every documented payload; a broken or strange payload gives null, never a throw; render gives exactly the host's expected shape (`additionalContext` or `injectSteps`), empty when there is nothing; install into temp dirs beside existing entries; uninstall removes only ours; reinstall is idempotent; `bun scripts/plugins.ts --check` passes; a history reader (when built) yields turns from a sample and skips unreadable lines.
- **Gemini:** an old install is detected, cleaned by uninstall, offered for removal by install; no generated file mentions Gemini; `hook gemini` fails open.
- **Budgets:** `tests/perf/budgets.test.ts` measures each new agent's prompt and session-start hooks within the existing budgets.
- **Proof on this machine:** a read-only script reports, per agent, whether it is installed, where its hooks, MCP and transcripts would live, and what our installer would change — without writing outside temp dirs.
- **ADR 0016:** per agent, what is confirmed from docs, what in a real session, and what remains.

## Out of scope

Kiro, Augment, Amp, Cline, Kilo, Windsurf/Devin Desktop and tier-2 agents (rules file + MCP): later waves. Per-prompt injection for Copilot (the host drops it).
