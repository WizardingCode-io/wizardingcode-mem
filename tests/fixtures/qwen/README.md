# Qwen Code fixtures

**From documentation, not yet captured.** Every payload here was written by hand from Qwen
Code's official documentation (read on 2026-10-11). None comes from a real session yet;
replace them with captured payloads once one is recorded, and note what differed.

## Sources

- Hooks (events, common input fields, per-event fields, output shape, exit codes, timeouts,
  `name`): https://qwenlm.github.io/qwen-code-docs/en/users/features/hooks/
- Settings (`~/.qwen/settings.json`, `QWEN_HOME`, `mcpServers`):
  https://qwenlm.github.io/qwen-code-docs/en/users/configuration/settings/
- MCP (`qwen mcp add` writes the same `mcpServers` entry as editing `settings.json`):
  https://qwenlm.github.io/qwen-code-docs/en/users/features/mcp/
- Extensions (`qwen-extension.json`; no `hooks` key documented):
  https://qwenlm.github.io/qwen-code-docs/en/developers/extensions/extension/ and
  https://qwenlm.github.io/qwen-code-docs/en/users/extension/introduction/
- Conversation recovery (no transcript record shape documented):
  https://qwenlm.github.io/qwen-code-docs/en/users/conversations-recovery/

## Payloads

| File | Host event | Documented fields used |
| --- | --- | --- |
| `payloads/session-start.startup.json` | `SessionStart` | common fields, `source`, `model` |
| `payloads/user-prompt-submit.json` | `UserPromptSubmit` | common fields, `prompt_id`, `prompt`, `submitted_prompt` |
| `payloads/stop.json` | `Stop` | common fields, `prompt_id`, `stop_hook_active`, `last_assistant_message` |
| `payloads/session-end.json` | `SessionEnd` | common fields, `reason` |

## What the documentation does not say, and the choice made

- **The value of `transcript_path` and `prompt_id`.** Their names are documented, their
  format is not: the fixtures use placeholders (`/path/to/transcript.jsonl`, `prompt-1`).
- **The transcript's record shape.** Not documented, so the adapter reads nothing from it
  (`transcript: false`) and there is no history reader.
- **Whether `prompt_id` stays the same across the `UserPromptSubmit` events of one turn.**
  `UserPromptSubmit` also fires for tool-result and hook sends, so the adapter takes the
  turn's prompt only from `submitted_prompt`, as the documentation asks of consumers that
  need the user's own text. Without it (Vim mode, ACP clients that do not declare it,
  continuations) nothing is opened or injected for that event; `Stop` still records the turn.
- **Comments in `settings.json`.** The settings page calls the file JSON. The installer
  refuses a file it cannot parse as JSON and leaves it untouched.
- **A Qwen extension carrying hooks.** `qwen-extension.json` documents no `hooks` key, so
  nothing is packaged as an extension; the install is direct.
