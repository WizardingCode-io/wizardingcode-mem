# ADR 0016 — Four more agents: Qwen Code, Factory Droid, GitHub Copilot, Antigravity; Gemini CLI removed

Date: 2026-10-11 · Status: accepted; built from official documentation, none yet run in a real session. Roadmap item A6. Design: `docs/superpowers/specs/2026-10-11-more-agents-design.md`.

## Context

Google retired Gemini CLI for most users on 2026-06-18 in favour of Antigravity CLI, and four agents give the most reach for the effort. Each follows the pattern of ADR 0006: an adapter (parse the host's payload, render its answer, say honestly what it can do), a direct installer that writes the host's hooks and MCP server beside what the user already has there, and fixtures. The sources are each agent's official documentation only (`CLEAN-ROOM.md`); every fixtures `README.md` names its URLs and says "from documentation, not yet captured".

## Decisions common to the four

- **No plugins.** None of the four ships as a plugin or extension: where a plugin format exists, its documentation does not say how a plugin's hook finds the launcher it bundles (Copilot documents `PLUGIN_ROOT` for MCP servers only; Antigravity documents no variable at all; Qwen's extension manifest has no `hooks` key; Droid's manifest is not documented well enough). Users run `wizardingcode-mem install <agent>`; `standsDownAsPlugin` has no case for them.
- **One write, receipts and backups.** All four reuse `HostSpec` in `src/install/hooks-file.ts` with opt-in fields (`mcpInSettings`, `mcpFile`, `mcpEntry`, `unwrapped`, `definition`, `topLevel`): backups before a change, a receipt that lets an untouched file be restored byte for byte, only our entries removed from an edited one, reinstall idempotent. A file that is not JSON (comments included) is refused and left untouched, in the four cases the documentation shows plain JSON.
- **Detection** by the agent's command on `PATH` or its configuration directory (`qwen`, `droid`, `copilot`, `agy`), so a fresh install without a directory is found. `COPILOT_HOME` and `QWEN_HOME` are honoured; Droid and Antigravity document no override.
- **Fail open.** Every adapter's `parse` returns null for a payload missing `cwd` or the session id, or of the wrong types; the hook then exits 0 with empty output.
- **A turn end with nothing in it queues nothing.** A `Stop` with no text, no turn id, no transcript and no open turn used to insert an empty turn that the distiller would send to the judge. `handle.ts` now skips `completeTurn` in exactly that case (`hasOpenTurn`, `src/store/turns.ts`); with an open turn behaviour is unchanged, and Claude Code and Codex (transcript on) are unaffected. It also reaches the two older agents without a transcript: Cursor (whose turn id is always null) and OpenCode. For them it is benign: their turn end normally carries the response text, and after a captured prompt there is an open turn, so both still complete as before; what is skipped is a turn end with no text and no open turn, which held nothing to distil.
- **Viewer.** Each agent has a label, an entry in Settings, Agents and a letter tile in the brand's five agent hues (which repeat: the letter tells them apart): Q aqua, F sun, P blue, A violet.

## Qwen Code

Documentation: hooks https://qwenlm.github.io/qwen-code-docs/en/users/features/hooks/ · settings https://qwenlm.github.io/qwen-code-docs/en/users/configuration/settings/ · MCP https://qwenlm.github.io/qwen-code-docs/en/users/features/mcp/ · extensions https://qwenlm.github.io/qwen-code-docs/en/developers/extensions/extension/ · conversation recovery https://qwenlm.github.io/qwen-code-docs/en/users/conversations-recovery/.

| Qwen event | Ours | Notes |
|---|---|---|
| `SessionStart` | session-start | injects `hookSpecificOutput{hookEventName:"SessionStart", additionalContext}` |
| `UserPromptSubmit` | prompt | injects with `hookEventName:"UserPromptSubmit"`; turn id `prompt_id` |
| `Stop` | turn-end | final text `last_assistant_message`, turn id `prompt_id` |
| `SessionEnd` | session-end | |

- **Full experience**: session-start and per-prompt injection (clipped to 10,000 characters, the one documented limit), capture of the prompt and of the final answer.
- **Prompt text only from `submitted_prompt`.** `UserPromptSubmit` also fires for tool-result and hook sends, and the documentation says `prompt` must not be assumed to be the user's text. Without `submitted_prompt` (Vim mode, ACP clients, continuations) nothing is opened or injected for that event; `Stop` still records the turn. `HookJsonShape` gained an optional `promptField` for this.
- **MCP** in `~/.qwen/settings.json` (`mcpServers`), in the same write as the hooks, so one receipt restores both. A non-object `mcpServers` is refused.
- **No extension, no history reader** (the transcript record shape is not documented). Settings with comments are refused untouched.
- **Awaiting a real session:** `prompt_id` present and equal on `UserPromptSubmit` and `Stop`; the formats of `transcript_path` and `prompt_id`; whether Qwen accepts comments in `settings.json`; the real context limit; that `hookSpecificOutput` is honoured as documented.

## Factory Droid

Documentation: hooks guide https://docs.factory.com/cli/configuration/hooks-guide · hooks reference https://docs.factory.com/reference/hooks-reference · MCP https://docs.factory.com/cli/configuration/mcp.

- **Full experience**: `SessionStart`, `UserPromptSubmit`, `Stop`, `SessionEnd`; `hookSpecificOutput.additionalContext` on the first two.
- **Hooks in `~/.factory/hooks.json`**, keyed directly by event (no `"hooks"` wrapper). The reference says the `hooks` key of `settings.json` is read only when `hooks.json` is absent, so hooks written there would be dropped for a user who has a `hooks.json`. The installer therefore always writes `hooks.json` (the `unwrapped` option), merged beside the user's groups, and never writes `settings.json`. MCP goes in `~/.factory/mcp.json`.
- **A user's `settings.json` hooks keep running.** Creating `hooks.json` would silence them, so when `hooks.json` is absent and `settings.json` has a non-empty `hooks` object, the new `hooks.json` starts from a copy of those groups, ours beside them (the `seed` option). The receipt records the copy; uninstall removes a `hooks.json` we created that holds only it (Droid falls back to `settings.json`), and a `hooks.json` that was already there is never seeded and only loses our entries. A `settings.json` that is not plain JSON (comments) stops the install before anything is written.
- **No turn id and no Stop text.** `message_id` is optional and its sharing between the events is not stated; `Stop` carries no assistant text. A turn is the session's open one; `finalMessageInPayload` and `transcript` are false. No history reader.
- **Awaiting a real session:** the turn id; the Stop text; the transcript format; comments in the JSON files; the plugin manifest.

## GitHub Copilot (CLI and VS Code agent mode)

Documentation: CLI hooks reference https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-hooks-reference · hooks configuration https://docs.github.com/en/copilot/reference/hooks-configuration · plugins https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference · config directory https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference · MCP https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers · VS Code hooks https://code.visualstudio.com/docs/copilot/customization/hooks and reference https://code.visualstudio.com/docs/agents/reference/hooks-reference · VS Code MCP https://code.visualstudio.com/docs/copilot/customization/mcp-servers.

- **One adapter, two dialects.** The CLI sends camelCase payloads (`sessionId`, `prompt`, `transcriptPath`); VS Code, reading the same file, maps the events and sends snake_case with `hook_event_name`. A payload with `hook_event_name` or `session_id` is VS Code's; the answer is rendered in the dialect that came in (`HookInput.dialect`; `render` gained an optional third argument).
- **One file of our own**, `~/.copilot/hooks/wizardingcode-mem.json` (`version: 1`; `COPILOT_HOME` moves it), which both hosts read. The user's other hook files and `settings.json` are never opened. The entry uses `command` plus `timeout`, the CLI's cross-platform fallback and VS Code's native fields.
- **A brief at session start only.** The CLI documents that a `userPromptSubmitted` command hook's output is dropped, so the prompt hook captures the prompt and prints nothing (`promptInjection` false). Events: `sessionStart`, `userPromptSubmitted`, `agentStop`, `sessionEnd` (VS Code has no session end).
- **MCP** for the CLI in `~/.copilot/mcp-config.json` (`type: "local"`, `tools: ["*"]`). VS Code's own `mcp.json` (per profile) is not edited: the install prints a `code --add-mcp '{...}'` line, or the `chat.mcp.discovery.enabled` alternative.
- **No CLI plugin**: the plugin documentation gives `PLUGIN_ROOT` for MCP servers only, not for hooks.
- **Known gap, Windows without bash.** With no `bash` field the CLI runs `command` through the platform shell, which on Windows without bash is PowerShell, where the single-quoted launcher path we write is not run as a command. Unconfirmed and untested here.
- **Awaiting a real session:** that VS Code sends its snake_case payload for a Copilot-format file and reads `hookSpecificOutput` for it; that it accepts `command` and `timeout`; that the CLI runs `command` through a shell on macOS and Linux; VS Code when `COPILOT_HOME` is set (it documents `~/.copilot/hooks` literally); `source: "new"`. No history reader (`events.jsonl` is not documented).

## Antigravity (CLI `agy`, 2.0 app, IDE)

Documentation, all on antigravity.google: hooks https://antigravity.google/docs/hooks · MCP https://antigravity.google/docs/mcp · plugins https://antigravity.google/docs/cli/plugins · migration from Gemini CLI https://antigravity.google/docs/cli/gcli-migration · install https://antigravity.google/docs/cli/install · settings https://antigravity.google/docs/settings.

- **Files**: `~/.gemini/config/hooks.json` and `~/.gemini/config/mcp_config.json`, read by all three surfaces. The hooks file maps hook names to definitions; ours is the one named `wizardingcode-mem` (`definition` option), the rest kept exactly, handlers listed directly under `PreInvocation` and `Stop` (flat layout).
- **A brief at the first model call.** There is no session-start event. `PreInvocation` fires before every model call, so only `invocationNum === 0` is treated as the start (as our session-start, injected as `{"injectSteps":[{"ephemeralMessage":"<brief>"}]}`, clipped to 10,000 characters); any other call parses to null and prints nothing. The session id is `conversationId`, the cwd `workspacePaths[0]`.
- **`Stop` is answered `{"decision":"stop"}`.** The documentation marks `decision` required and says any value but `"continue"` allows the stop. Only the fail-open path prints nothing.
- **It captures nothing.** No prompt event, no prompt text in any payload, and the transcript format is not documented, so there is no prompt capture and no history reader. Antigravity receives the brief and the MCP tools; its turns are not recorded.
- **No plugin**, for the reason under "common".
- **Shares `~/.gemini` with the old Gemini CLI**, and the two never mistake each other: the leftover search reads only `settings.json` and two named extension directories, never `config/`; our Antigravity entries say `hook antigravity`, the old ones `hook gemini`, and receipts are per agent. Both directions are tested on one temporary home.
- **Awaiting a real session:** whether `invocationNum` counts per conversation or per execution (the brief would then repeat once per user turn at most); whether a resumed conversation restarts at 0; whether subagent conversations run our hooks; whether empty stdout is accepted when our hook fails; whether the shell quotes our launcher path as one word; whether 10,000 characters of `ephemeralMessage` are accepted; that the 2.0 app and the IDE send the same payloads as the CLI.

## Gemini CLI removed

- The adapter, installer, `plugins/gemini/`, the release archive and its packaging script, and the fixtures are gone. `gemini` leaves `AgentId`; a separate `RetiredAgentId` is accepted only where an old install must be recognised (receipts, `ourShellHookBinary`). Sessions already stored as `gemini` keep their name and tile in the viewer, and their memories stay.
- **Cleanup path** (`src/install/gemini-leftover.ts`): `wizardingcode-mem uninstall gemini` removes our hooks and MCP server from `~/.gemini/settings.json` (an old receipt is honoured: the file is restored if untouched since, otherwise only our entries come out) and our extension (`gemini extensions uninstall`, then the directory if it is still there). `install` with no agent offers it (`--yes` accepts; without a terminal it prints one hint line), `doctor` warns "old Gemini CLI install", and `install gemini` refuses and points to `install antigravity`.
- **`hook gemini …` exits 0, silent**, before reading stdin or opening the database, so a direct install (hooks written into `settings.json`, running the installed binary) keeps running harmlessly until removed. The 0.4.4 Gemini extension is different: its hooks run its own bundled binary (`${extensionPath}/bin/wizardingcode-mem hook gemini … --via-plugin`) and so does its MCP server, so it keeps working, at 0.4.4, until the extension is removed; once this build's migrations have run, the old binary fails open against the newer schema ("database schema version … is newer than this wizardingcode-mem supports"). `uninstall gemini` removes the extension; a directory under our name is removed only when its `gemini-extension.json` names `wizardingcode-mem` or `shibaox-mem`.
- Antigravity's files are never touched by the cleanup. "Uninstall (all agents)" in the plan was read as `uninstall gemini`: there is no all-agents uninstall.
- A copy of our old extension inside Qwen Code is not detected; like the extension above, it runs its own bundled binary and keeps working until removed.

## Budgets

`tests/perf/budgets.test.ts`, the compiled binary measured from outside, 30 runs after one unmeasured, a project of 5,000 memories in a store of 65,000 (the method of ADR 0015). Budgets are the existing ones: prompt p95 ≤ 80 ms and session start ≤ 150 ms (Windows 200 and 300), on CI the median against the budget × 2.5. Copilot's prompt is capture only and is held to the prompt budget; Antigravity's is its first `PreInvocation`. Each test also checks that retrieval ran: Qwen and Droid prompts answered with notes in more than half the runs, every session start carries the brief, Copilot's prompt prints nothing, Antigravity's first call prints `injectSteps`. Apple M4 Max, macOS, the pinned Bun 1.4.2:

| Agent and event | p50 | p95 | Budget (p95) |
|---|---|---|---|
| Claude Code prompt (for reference) | 34.3 ms | 38.1 ms | 80 ms |
| Claude Code session start (for reference) | 17.7 ms | 24.4 ms | 150 ms |
| Qwen prompt | 34.0 ms | 36.4 ms | 80 ms |
| Qwen session start | 19.8 ms | 21.1 ms | 150 ms |
| Droid prompt | 34.4 ms | 37.4 ms | 80 ms |
| Droid session start | 20.1 ms | 21.7 ms | 150 ms |
| Copilot session start | 19.8 ms | 26.8 ms | 150 ms |
| Copilot prompt (capture only) | 14.7 ms | 16.3 ms | 80 ms |
| Antigravity first `PreInvocation` | 18.9 ms | 20.7 ms | 150 ms |

These are the binary called directly; none of the four goes through a plugin script.

## What waits for a real session

Everything above marked "awaiting". Each agent is checked only with the author's yes, agent by agent: install into that agent's real configuration with a named install (`wizardingcode-mem install <agent>`), never the bare `install`, which would touch every agent it finds (which also runs this build's migrations on the real database; see ADR 0015's note on 0.4.4 binaries), run one session, capture one payload per event into `tests/fixtures/<agent>/payloads/` (personal paths replaced by `/work/shop`), confirm that the injected context appears, and record the result here. `scripts/proof/agents.ts` is the read-only report of what is on a machine before that: which agents, which files our installer would write, whether our entries are already there, and any Gemini leftovers.

None of that has been done. As of this record, all four are as the documentation describes them and nothing more.
