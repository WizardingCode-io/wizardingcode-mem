# ADR 0030 — The client is told of a release, and does not replace itself

Date: 2026-11-12 · Status: **draft**. Work item 2026-11-12-006, piece 2 of 3 of 2026-11-11-004 ("updated everywhere on release"). It narrows [ADR 0029](0029-release-distribution.md)'s piece 2, "the client that learns of a release and follows it": the client learns; it does not follow by itself.

## Context

ADR 0029 made a release reach npm, the Homebrew tap and the plugin marketplace by itself, and made every writer of the staged binary (`<data dir>/bin/wizardingcode-mem`) move it only forward. What was left: nothing told a person that a release existed. An install through a plugin follows when the agent refreshes its marketplace; a direct install (ADR 0016), `scripts/install.sh` and a Homebrew copy stay where they were put.

The first concept had the client check once a day and replace its own staged binary. Six readers of that concept found four blockers, all in the replacement:

1. No binary version is recorded in the store, so the long-lived processes (`mcp`, the sync, the viewer) cannot know they are behind.
2. The sync's "a newer version takes over" does not happen after an update: `startSync` answers "running" for any live lease and compares no version.
3. The viewer and the sync open the store once and never check its schema again, so they keep writing to a store a newer binary migrated; `mcp` opens it per call and fails every call.
4. A daily replacement undoes `install --force`, ADR 0029's way back.

Beside them: release assets are not signed and `checksums.txt` travels with the binary, so whoever can publish a release would get code run on every machine within a day; a bad release would reach every machine with no hold; and nothing restores the store's upgrade copy.

## Decision

**Tell, do not replace.** The client asks which release is the latest and says so. It downloads nothing and changes nothing but its own state file. `latest` in that file is a notice, obtained with no authentication of a release's content: it must never start a download. A binary that replaces itself is a later item, to be taken up once release assets are signed, or once the author has a way to mark a release as not to be followed, and with the four blockers answered.

**The request.** One `GET https://github.com/<repository>/releases/latest` with redirects not followed. The answer counts only when it is a 301 or a 302 whose `Location` is exactly `https://github.com/<repository>/releases/tag/v<a>.<b>.<c>`; anything else is one of four fixed reasons (`offline`, `timed out`, `HTTP <status>`, `not a release redirect`). The body is never read. The API is not used: it limits requests per address, which machines behind one address share. The request has no body, no cookie and no authorization, and the one header this code sets is `User-Agent: wizardingcode-mem`, with no version (the runtime adds `Accept`, `Host` and `Accept-Encoding`). The shape was read from github.com on 2026-11-12: a 302 with an absolute `Location` to the tag, the owner and repository in the letter case of the request.

**When.** As a step after the drain in `wizardingcode-mem distill`: in the background process, never on a hook's path. At most once in 24 hours after a success and once an hour after a failure; a time in the future counts as stale; never in CI. `wizardingcode-mem update` asks at once, in CI too. `WIZARDINGCODE_MEM_UPDATE=off` stops both. Each process reads the key from its own environment and from `<data dir>/env`; a variable exported in a shell does not reach a hook started elsewhere, so the file is the way to turn the check off for every process, and the lines say where an `off` came from. An unknown value counts as off.

**The state.** `<data dir>/update.json`, beside the binary it describes and outside the store: a store on another disk, restored, or refused by an older binary neither carries nor blocks it. It is read strictly (a plain version, one of the four reasons, numbers), so no byte of it that the product did not shape reaches a terminal. The latest is overwritten at each success and never kept as a maximum, so a forged or withdrawn value is replaced by the next good answer.

**What a person sees.** `status`, `doctor` and `wizardingcode-mem update` say whether a release is out, and `status` and `update` list one command per channel (no channel is detected). A release already found stays announced when a later check fails. They also say, when the copy typed is not the staged binary, which version the agents run.

**Two copies.** A compiled copy older than the staged binary hands over: `status`, `doctor`, `update` and `ui` typed from it run the staged binary with the same arguments, so they never meet a store the newer binary migrated. `install` already did this; the function is now one. A copy newer than the staged binary only tells: it says that `wizardingcode-mem install` moves the agents to it, and stages nothing (D-3). The first design had it stage itself; the review showed the hooks would then run the new binary in the open session while that session's MCP server, sync and viewer stayed on the old one, which is blocker 3 again. Only `install` stages.

## Alternatives

- Self-replacement on every channel, or only where no channel manager exists. Deferred, for the blockers above.
- No check at all. Rejected: a direct install has no manager to tell it.
- The check off by default. Rejected by the author: who does not turn it on goes on not knowing.
- The state in the store's `meta`, and a detached process from the session-start hook under a lease. Rejected: the state is about the binary, and a daily task needs neither a spawn on the hook's path nor a lease.
- A backoff that doubles after each failure. Rejected for a flat hour: nothing measured asks for it, and it made the README's sentence about requests false.
- An older copy that only tells, as the newer one does. Weighed and not taken: the person typed `doctor` to diagnose and would get a schema error; `install` already handed over.
- A test seam through an address read from the environment. Rejected: the process would take a destination from its environment. The commands take their `fetch` as an argument, and their tests call them in the test's own process.

## Limits

- Nothing checks while no turn ends, and nothing checks from the hooks when the store cannot be opened (the hook starts `distill` only after it opened the store and found queued turns). `wizardingcode-mem update` checks in both cases.
- The hand-over exists only in copies that carry this change, on macOS and Linux, for the user who owns `<data dir>/bin` and is not root. For root, or over a folder of another user, the staged file is not run at all, not even for its version, and the lines say so. A person who needs their own copy's `doctor` when the newer staged binary is broken sets `WIZARDINGCODE_MEM_HANDED=1` for that command; `install --force` from the older copy is the way back for the binary itself (ADR 0029). A channel copy of an earlier version still fails against a migrated store. The other commands (`backup`, `compact`, `history` and the rest) do not hand over.
- An install made with `install --binary <path>` runs that path: for it, the line about what the agents run and the hand-over concern a file the agents do not run.
- A repository renamed or moved leaves every shipped client reading `not a release redirect`.
- The request goes through a configured proxy (`HTTPS_PROXY`). github.com sees the address and the time.
- `status`, `doctor`, `update` and `ui` typed from a channel copy run the staged file's `--version`, and the file itself when it is newer; hooks, and `install` for a newer staged binary, already did.
- A compiled build of a lower version than the developer's own staged binary, run with one of those four commands and no throwaway `WIZARDINGCODE_HOME`, hands over to that staged binary.
- A release is visible on github.com before `distribute.yml` has published it to the channels, and stays so if that run stops.
- A shipped version keeps checking until its user upgrades. What it is told changes only by moving or withdrawing the release (`gh release edit <tag> --latest`, in `docs/runbooks/release.md`), a procedure not yet run.
- A data directory that cannot be written keeps the state at "not checked yet"; the reason is in the log.
- Not seen before a real release: github.com's rate limiting of one address and its answer while a release's assets upload.
- The viewer has no About line and no Settings field for the key yet.
