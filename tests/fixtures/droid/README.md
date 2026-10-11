# Factory Droid fixtures

**From documentation, not yet captured.** Every payload here was written by hand from Factory's
official documentation (read on 2026-10-11). None comes from a real session yet; replace them
with captured payloads once one is recorded, and note what differed.

## Sources

- Hooks guide (locations, event table, `additionalContext`, exit codes, `timeout` in seconds):
  https://docs.factory.com/cli/configuration/hooks-guide
- Hooks reference (common input fields, per-event fields, `settings.json` nests events under
  `"hooks"`, standalone `hooks.json` is keyed by event): https://docs.factory.com/reference/hooks-reference
- MCP (`~/.factory/mcp.json`, `mcpServers`, `droid mcp add`):
  https://docs.factory.com/cli/configuration/mcp

## Payloads

| File | Host event | Documented fields used |
| --- | --- | --- |
| `payloads/session-start.startup.json` | `SessionStart` | common fields, `source` |
| `payloads/user-prompt-submit.json` | `UserPromptSubmit` | common fields, `message_id`, `prompt`, `has_images` |
| `payloads/stop.json` | `Stop` | common fields, `stop_hook_active`, `tool_execution_count`, `elapsed_time` |
| `payloads/session-end.json` | `SessionEnd` | common fields, `reason`, `session_duration_ms`, `message_count` |

## What the documentation does not say, and the choice made

- **A turn id.** Only an optional common `message_id` is documented, with no statement that
  `UserPromptSubmit` and `Stop` share it. The adapter names no turn (`turnId: null`), like Gemini
  CLI: a turn is the session's open one.
- **The final message.** `Stop` documents no assistant text, so `finalMessageInPayload: false`.
- **`transcript_path`.** The name is documented, the format is not: no transcript reader and no
  history reader (`transcript: false`).
- **Where our hooks go.** Hooks may live in `~/.factory/hooks.json` (keyed directly by event) or
  in `settings.json` under `"hooks"`. The installer writes `~/.factory/settings.json`, whose
  documented shape matches the other hosts, and never touches the user's `hooks.json`.
- **Comments in `settings.json`.** Not documented; the installer refuses a file it cannot parse
  as JSON and leaves it untouched.
- **The MCP server** goes into `~/.factory/mcp.json` (`mcpServers`, stdio entry), a separate file
  from the hooks; only the command and args are written (`type` defaults to stdio).
- **A config-dir environment variable.** None is documented; `~/.factory` under `HOME` is used.
- **Plugins.** Droid plugins carry `hooks/hooks.json`, but the plugin manifest format is not
  documented well enough to package; the install is direct.
- **Exit code 2** blocks in Droid; our hooks never use it.
