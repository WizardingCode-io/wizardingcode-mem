# Antigravity fixtures (Antigravity CLI, Antigravity 2.0, Antigravity IDE)

**From documentation, not yet captured.** Every payload here was written by hand from Google's
official Antigravity documentation (read on 2026-10-11). None comes from a real session yet;
replace them with captured payloads once one is recorded, and note what differed.

## Sources

- Hooks (locations: `~/.gemini/config/hooks.json` for all three surfaces, also
  `~/.gemini/antigravity-cli/settings.json` and plugins for the CLI; the file maps hook
  *names* to event configurations, with an optional `enabled`; `PreInvocation`,
  `PostInvocation` and `Stop` take a list of handlers directly, no matcher; handler fields
  `type` ("command"), `command`, `timeout` in seconds, default 30; payloads on stdin in
  camelCase with the common fields `conversationId`, `workspacePaths`, `transcriptPath`,
  `artifactDirectoryPath`, `modelName`; `PreInvocation` adds `invocationNum` ("0-indexed
  sequence number of the current model invocation (the first invocation is 0)") and
  `initialNumSteps`, and may answer `{ "injectSteps": [{ "ephemeralMessage": "…" }] }`;
  `Stop` adds `executionNum`, `terminationReason`, `error`, `fullyIdle` and answers
  `decision` / `reason`): https://antigravity.google/docs/hooks
- MCP (global servers in `~/.gemini/config/mcp_config.json`, `mcpServers` with `command`,
  `args`, `env`, `cwd`, `disabled`, …): https://antigravity.google/docs/mcp
- Plugins (`plugin.json`, a plugin's `hooks.json` and `mcp_config.json`; global plugins in
  `~/.gemini/config/plugins/`, CLI-installed ones staged in
  `~/.gemini/antigravity-cli/plugins/<name>/`; `agy plugin install`):
  https://antigravity.google/docs/cli/plugins (redirects to
  https://antigravity.google/docs/plugins?tab=cli)
- Migrating from Gemini CLI (MCP moved out of `~/.gemini/settings.json` into
  `~/.gemini/config/mcp_config.json`; `agy plugin import gemini` converts extensions):
  https://antigravity.google/docs/cli/gcli-migration
- Installation (`agy` in `~/.local/bin`, or `%LOCALAPPDATA%\agy\bin` on Windows):
  https://antigravity.google/docs/cli/install
- Settings and troubleshooting (`~/.gemini/antigravity-cli/settings.json`; no environment
  variable moving the configuration directory is documented):
  https://antigravity.google/docs/settings , https://antigravity.google/docs/cli/troubleshooting

## Payloads

| File | Host event | Our event | Notes |
| --- | --- | --- | --- |
| `payloads/pre-invocation.json` | `PreInvocation` | none (`invocationNum` 3: a later model call) | the documentation's example, verbatim |
| `payloads/pre-invocation.first.json` | `PreInvocation` | `session-start` | the same example with `invocationNum` 0 and `initialNumSteps` 1 (the first call; 1 is our choice, the value is not documented) |
| `payloads/stop.json` | `Stop` | `turn-end` | the documentation's example, verbatim |

The documentation's examples write `transcriptPath` and `artifactDirectoryPath` with a literal
`~`; they are kept so. No payload carries a working directory: the first of `workspacePaths`
stands for it. No payload carries the user's prompt or the model's final message, and the
transcript's format is not documented, so neither is read.

## Answers

- `PreInvocation`, first call: `{"injectSteps":[{"ephemeralMessage":"<brief>"}]}`, the documented
  shape; nothing when there is no brief.
- `Stop`: `{"decision":"stop"}`. The documentation marks `decision` as required and says only that
  `"continue"` re-enters the loop and "any other value allows the stop"; it shows no example of an
  allowing value, so `"stop"` is our choice.
- When the hook fails (or the payload is unusable), it prints nothing and exits 0, as for every
  host. Whether Antigravity accepts an empty answer to `Stop` silently is **unconfirmed**.
