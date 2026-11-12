# ADR 0008 — M5: distribution

Date: 2026-10-05 · Status: accepted; its Homebrew row superseded, and its npm and curl rows amended, by [ADR 0029](0029-release-distribution.md), which also carries out the release automation listed below as left to do.

## What exists

| Channel | How | Where the binary ends up |
|---|---|---|
| GitHub release | tag `v<version>` → `.github/workflows/release.yml`: checks that the tag is the `package.json` version, runs `check`, builds the five binaries, signs the macOS ones ad hoc on a macOS runner, publishes with `checksums.txt` | — |
| `curl \| sh` | `scripts/install.sh`: the platform's binary from the release (latest, or `SHIBAOX_MEM_VERSION`), SHA-256 verified, then `shibaox-mem install` for every agent found | `~/.shibaox/mem/bin` |
| Claude Code plugin | this repository is the plugin (`.claude-plugin/plugin.json`, `hooks/hooks.json`, `.mcp.json`); the hooks go through `plugin/hook.sh`, which fetches the plugin's version of the binary on the first `SessionStart` | `${CLAUDE_PLUGIN_DATA}/bin` |
| Marketplace | `WizardingCode-io/shibaox-plugins`: `marketplace.json` with `source: github` pointing at this repository's tag | — |
| npm | `npm/`: the `shibaox-mem` package with a Node shim that fetches its version of the binary on first run; no `postinstall` | `~/.shibaox/mem/bin` |
| Homebrew | tap `WizardingCode-io/homebrew-shibaox`; the formula installs the release binary (source copy in `packaging/homebrew/`) | the Homebrew prefix |

The data always lives in `~/.shibaox/mem`, whatever the channel.

## Decisions

- **One version, four places, one test.** `package.json`, `.claude-plugin/plugin.json`, `npm/package.json` and the tag must agree; the tests compare the three files and the workflow refuses a different tag.
- **The plugin pins the binary's version.** `hook.sh` compares `--version` with `plugin.json` and only downloads on `SessionStart`; a prompt or turn-end hook never waits for a download. Fails open: with no network, the session starts without memory and without an error.
- **The plugin lives in the product's repository, the marketplace apart.** Each product of the brand keeps its plugin next to the code; the marketplace only points at published versions.
- **No `postinstall` on npm.** Install scripts are disabled in many organisations and run without the user seeing; the shim downloads when it is called, with the release's checksum.
- **Ad hoc signing, for now.** Enough for Apple Silicon to run binaries obtained with `curl`; a binary downloaded by a browser is quarantined. Developer ID and notarisation need WizardingCode's Apple account.
- **Direct install and plugin together: the plugin stands down.** Claude Code would run every hook twice. The plugin's run is the one that knows what it is (`CLAUDE_PLUGIN_ROOT`), so it is the one that leaves silently when `settings.json` already has the direct hooks. Since 0.1.1.
- **The plugin's MCP server is in `plugin.json`, not in a root `.mcp.json`.** With the plugin at the repository root, that file also made the server a project server for anyone opening the repository in Claude Code, with a path only a plugin expands. Since 0.1.1.

## Verified

- `scripts/install.sh`, `plugin/hook.sh` and the npm shim: tests against a stand-in release (local server, fake binary, right and wrong checksum).
- With the real releases 0.1.0 and 0.1.1: `curl | sh` in an empty HOME (ad hoc signed binary running on Apple Silicon); the plugin installed from the marketplace in an isolated configuration, fetching the binary from the release on the first `SessionStart`; `brew fetch` of the tap with the right checksum; the npm shim downloading its version.
- `claude plugin validate` passes on the plugin and on the marketplace.

## What went wrong, so as not to repeat it

- The first run of the 0.1.1 workflow failed in `check`: a test that inserts 1 200 rows took 7.7 s on a shared runner, against the default limit of 5 s. Nothing was published; the job was rerun and the test now has its own limit.
- Tests with a local server failed in bursts on this machine: `Bun.serve` without `hostname` listens on every interface, and the assigned port could already belong to another process on `127.0.0.1` — `curl` talked to that one. Test servers now listen on `127.0.0.1` by name.

## Left to do

- Automate the rest of a release: formula, marketplace and npm updated by the release workflow (the npm packages are published by the account's owner today).
- Signing: Developer ID and notarisation on macOS, Authenticode on Windows — only for whoever downloads the binary by hand; the native installs (ADR 0009) do not need them.
- A comparison page with measured numbers; the design of the paid services (managed judgements, sync, team memory — the team mode's shape is in ADR 0010's Settings card, and nothing more yet).
