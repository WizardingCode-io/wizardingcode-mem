# GitHub Copilot fixtures (Copilot CLI and VS Code agent mode)

**From documentation, not yet captured.** Every payload here was written by hand from GitHub's
and VS Code's official documentation (read on 2026-10-11). None comes from a real session yet;
replace them with captured payloads once one is recorded, and note what differed.

## Sources

- Copilot CLI hooks reference (locations, `"version": 1` format, command fields, events and
  their PascalCase aliases, camelCase payloads, outputs, exit codes, "command and HTTP
  config-file `userPromptSubmitted` hooks have their output dropped"):
  https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-hooks-reference
- Hooks configuration (the same format and payloads, the VS Code-compatible `SessionStart`
  payload with `hook_event_name`, `session_id`, ISO `timestamp`):
  https://docs.github.com/en/copilot/reference/hooks-configuration
- Copilot CLI plugin reference (manifest locations, `hooks.json`, `PLUGIN_ROOT` for MCP servers):
  https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference
- Copilot CLI configuration directory (`~/.copilot`, `COPILOT_HOME`, `hooks/`, `mcp-config.json`):
  https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference
- Adding MCP servers to Copilot CLI (`mcpServers`, `type: "local"`, `tools: ["*"]`):
  https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers
- VS Code agent hooks (reads `~/.copilot/hooks/*.json`; accepts Copilot-format files with a
  numeric `version` and lower camelCase events and maps them; supported events have no
  `SessionEnd`): https://code.visualstudio.com/docs/copilot/customization/hooks
- VS Code hooks reference (common input `timestamp`, `cwd`, `session_id`, `hook_event_name`,
  `transcript_path`; `SessionStart` output `hookSpecificOutput.additionalContext`):
  https://code.visualstudio.com/docs/agents/reference/hooks-reference
- VS Code MCP servers (user `mcp.json` per profile, `servers` key, `code --add-mcp`,
  `chat.mcp.discovery.enabled` with Copilot CLI as a source):
  https://code.visualstudio.com/docs/copilot/customization/mcp-servers

## Payloads

The hooks file registers lower camelCase events, so the CLI sends its camelCase payloads.
VS Code maps the same file to its own events and sends its own snake_case payload.

| File | Host | Host event | Documented fields used |
| --- | --- | --- | --- |
| `payloads/session-start.json` | CLI | `sessionStart` | `sessionId`, `timestamp` (ms), `cwd`, `source` |
| `payloads/user-prompt-submitted.json` | CLI | `userPromptSubmitted` | common fields, `prompt` |
| `payloads/agent-stop.json` | CLI | `agentStop` | common fields, `transcriptPath`, `stopReason`, `stop_hook_active` |
| `payloads/session-end.json` | CLI | `sessionEnd` | common fields, `reason` |
| `payloads/vscode.session-start.json` | VS Code | `SessionStart` | `hook_event_name`, `session_id`, `timestamp` (ISO), `cwd`, `transcript_path`, `source` |
| `payloads/vscode.user-prompt-submit.json` | VS Code | `UserPromptSubmit` | common fields, `prompt` |
| `payloads/vscode.stop.json` | VS Code | `Stop` | common fields, `stop_hook_active` |

## What the documentation does not say, and the choice made

- **Context on a prompt.** The CLI drops a command hook's output on `userPromptSubmitted`; VS
  Code documents only the common output fields there. `promptInjection: false`: the prompt is
  captured, nothing is printed.
- **Which host ran the hook.** Both read the same file. A payload with `hook_event_name` or
  `session_id` is VS Code's and is answered with `hookSpecificOutput`; a camelCase one is the
  CLI's and is answered with a top-level `additionalContext`.
- **VS Code's `cwd` and `session_id`** are documented as optional. Without either the payload is
  not used (silence), rather than guessing a project or a session.
- **`source: "new"`** is read as a fresh start (`startup`); anything undocumented is `other`.
- **A turn id and the final message.** Neither is documented in any payload: `turnId: null`
  (a turn is the session's open one) and `finalMessageInPayload: false`.
- **Transcripts.** `transcriptPath` is named, its format (the CLI's `events.jsonl`) is not
  documented: no transcript reader and no history reader.
- **VS Code session end.** VS Code has no `SessionEnd`; the CLI's `sessionEnd` in our file is
  simply not run there.
- **Plugins.** The plugin reference documents `PLUGIN_ROOT` for MCP servers only; whether a
  plugin's hook command can find files in the plugin is not documented, so no Copilot plugin is
  packaged; the install is direct.
- **VS Code's MCP file.** It is per profile and may hold other state; it is not edited. The
  install prints how to get the memory tools there (`code --add-mcp …`, or VS Code's MCP
  discovery of Copilot CLI's `mcp-config.json`).
- **`COPILOT_HOME`** moves the CLI's directory; VS Code documents `~/.copilot/hooks` without it.
- **Exit code 2** is a warning in Copilot (a deny for `preToolUse`); our hooks never use it.
