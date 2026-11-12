# Spec: the client learns of a release

Predecessor: `concepts_brief.md` in this folder (the author's answers of 2026-11-12 are its K-1 and K-2, and D-3 in `conclave.md`). Parent: the concept `2026-11-11-004`, ADR 0029 (`docs/adr/0029-release-distribution.md`).

What this item attempts, in plain words: the program tells its user when a newer version has been published, without downloading anything; and when the user has two copies of the program at different versions, a command typed from the older copy runs the newer one, and a command typed from the newer copy says how to move the coding agents to it.

Words used here.

- The **staged binary** is `<data dir>/bin/wizardingcode-mem`, the copy the agents' hooks and MCP servers run, whatever channel put it there (an install made with `install --binary <path>` runs that path instead; see Limits).
- A **channel copy** is a compiled `wizardingcode-mem` elsewhere on the machine that a person types: the Homebrew copy, a downloaded binary. The npm package is a shim that stages and then runs the staged binary, so it is never a channel copy.
- The **reconciled commands** are `status`, `doctor`, `update`, and `ui` without `--auto`.
- A **turn** is one exchange in an agent's session; when it ends, a hook queues it and starts `wizardingcode-mem distill` in the background, whose work on the queue is **the drain**.

## Problem

1. Nothing tells a person that a release exists. An install through a plugin follows when the agent refreshes its marketplace; the direct installs (ADR 0016), `scripts/install.sh` and a Homebrew copy stay where they were put.
2. After `brew upgrade` the Homebrew copy is newer than the staged binary, and the agents keep running the old one until the person runs `wizardingcode-mem install` again, which nothing tells them to do.
3. When the staged binary is newer than a channel copy (a plugin moved it forward), `wizardingcode-mem doctor` typed by the person runs the older copy against a store the newer one may have migrated, and fails with `SchemaTooNewError`. Only `install` hands over to the staged binary today (`binaryOrHandOver`, `src/cli/commands/install.ts`).

## Goals and Non-Goals

Goals:

- G-1: when a newer release exists and the automatic check is on, then once a turn has ended more than 24 hours after the last successful check, `status` and `doctor` say so; `status` and `update` list one command per channel, and `doctor` points to `update`. The notice downloads nothing and writes nothing but its own state file (AC-10, AC-13, AC-28, AC-30, AC-31).
- G-2: the request names no version, platform, path or project; the README says when it is made; one setting turns it off; the automatic check never runs in CI; the project's own tests never make it (AC-10, AC-19, AC-21, AC-29).
- G-3: after a channel copy is upgraded, `status`, `doctor` and `update` typed from it say that the agents still run the older staged binary and that `wizardingcode-mem install` moves them; nothing is staged without that command (AC-31).
- G-4: on macOS and Linux, a reconciled command typed from an older compiled copy by the user who owns the data directory runs the newer staged binary (AC-18, AC-23).
- G-5: the new code stays off the hooks' path and outside the store, and the documents say what changed (AC-21, AC-27).

Non-goals:

- A binary that replaces itself from the network is not built, and neither is ending or restarting `mcp`, the sync or the viewer on a version change. That is a later item, to be taken up once release assets are signed, or once the author has a way to mark a release as not to be followed. `latest` in `update.json` is a notice, obtained with no authentication of a release's content: it must never by itself start a download.
- The viewer is not changed: the About line and a field in Settings for the new key are the next item, with their captures. Until then the key is set in `<data dir>/env`, and the README says so.
- No command but `install` stages a binary (D-3: a staging takes effect in the open session, where the MCP server, the sync and the viewer stay on the old binary).
- The hand-over is not extended to the other commands (`backup`, `compact`, `history`, `embed`, `knowledge`, `share`, `import`, `rejudge`, `uninstall`): typed from an older copy they behave as today.
- The hand-over does not run on Windows (no user id to compare); the notice works there.
- The install channel is not detected.
- The five places that read a staged binary's version (`stagedVersion`, the npm shim, the OpenCode package, the plugins' script, `scripts/install.sh`) are not brought to one rule here; that stays its own item.
- The team server's upgrade is piece 3 of the parent concept.

## Open Questions

None.

## Critical User Journeys

- **J-1, a release comes out.** Given a machine whose staged binary is 0.9.0 with the check on, when 0.10.0 is released and a turn ends more than 24 hours after the last check, then the background process that distils the turn asks github.com once and records 0.10.0. The next `wizardingcode-mem status` prints `update: 0.10.0 is out (checked 2 h ago); the agents run 0.9.0` and one command per channel; `doctor` shows `warn  update: 0.10.0 is out (checked 2 h ago); the agents run 0.9.0; run wizardingcode-mem update for the commands` and still exits 0.
- **J-2, the check cannot be made.** Given no network, a 429 or a captive portal, when the check runs, then nothing is recorded as latest, the reason and the time are kept, and the next attempt waits one hour. With no newer release known, `status` says `update: could not check (HTTP 429, 3 h ago); last known 0.9.0`. With 0.10.0 already found, it keeps saying `update: 0.10.0 is out (checked 3 d ago; last check failed: HTTP 429, 1 h ago); the agents run 0.9.0`.
- **J-3, turned off.** Given `WIZARDINGCODE_MEM_UPDATE=off` in `<data dir>/env`, when a turn ends, then no request is made, and `status` says `update: off (WIZARDINGCODE_MEM_UPDATE in <data dir>/env)`. Given the variable only in the shell where `status` is typed, `status` says `update: off (WIZARDINGCODE_MEM_UPDATE in this command's environment; other processes may not see it)`. Given `CI` set, the automatic check asks nothing and `status` says `update: not checked in CI`.
- **J-4, asked by hand.** Given the check on, or `CI` set, when the person runs `wizardingcode-mem update`, then it asks now, whatever the last check's age, and prints the lines and the commands. Given the key `off` or an unknown value, it asks nothing, prints the off line and how to turn the check on where the value was set, and exits 0.
- **J-5, after `brew upgrade`.** Given the staged binary at 0.9.0 and the Homebrew copy now at 0.10.0, when the person runs `wizardingcode-mem status` (the Homebrew copy), then nothing is staged, and after the `update` line it prints `agents run 0.9.0 from <path>; this copy is 0.10.0: wizardingcode-mem install moves them to it`. The person runs `wizardingcode-mem install`, which stages as it does today.
- **J-6, an older copy.** Given the staged binary at 0.10.0 and a Homebrew copy at 0.9.0, when the person runs `wizardingcode-mem doctor`, then the copy prints on standard error `wizardingcode-mem: running 0.10.0 from <path>; this copy is 0.9.0` and runs the staged binary with the same arguments, returning its exit code. The staged binary does not hand over again.
- **J-7, the staged binary does not answer.** Given a staged file that answers no version, when `status` runs from a channel copy, then nothing is staged and nothing is handed over, and after the `update` line it prints `agents run an unreadable binary from <path>; this copy is <running>: wizardingcode-mem install replaces it`. Given no staged file, no such line is printed.
- **J-8, a release is withdrawn.** Given a bad 0.10.0, when the author moves GitHub's latest back to 0.9.1 (`gh release edit v0.9.1 --latest`), then at its next successful check a client that already runs 0.10.0 reads `update: 0.10.0 is ahead of the latest release 0.9.1 (checked 1 h ago)`, and a client on 0.9.1 reads `update: 0.9.1 is the latest (checked 1 h ago)`.

## Design

### 1. The check

A new folder `src/update/`, beside `src/install/` and `src/settings/` and outside the engine's modules: it contributes nothing to a hook and has no table. It imports nothing from the store, the modules, the engine, the sync, the status or the doctor, and `src/cli/main.ts` has no static import of it (AC-27).

- **The request.** One `GET https://github.com/<repository>/releases/latest`, with redirects not followed, no body, no cookie, no authorization, and one header set by this code, `User-Agent: wizardingcode-mem`, with no version (the runtime adds its own `Accept`, `Host` and `Accept-Encoding`). The answer counts only when its status is 301 or 302 and its `Location` is exactly `https://github.com/<repository>/releases/tag/v<a>.<b>.<c>`, each number 1 to 5 digits and nothing after. Anything else gives one of four fixed reasons: `offline`, `timed out`, `HTTP <three digits>`, `not a release redirect`. The whole request is limited to 5 seconds, and the timer is cleared when the answer comes, so no process waits for it. The body is never read. `api.github.com` is not used. The shape was read from github.com on 2026-11-12 (`probes/releases-latest.md`): a 302, an absolute `Location` to `/releases/tag/v0.8.0`, the owner and repository in the letter case of the request.
- **The state.** `<data dir>/update.json`, `{ latest, checkedAt, attemptAt, failedAt, reason }`, written with the project's `writeFileAtomic`, mode 0600, the data directory created if missing. It is read strictly: `latest` is null or a plain version of the shape above; `reason` is null or one of the four fixed texts; the three times are null or finite numbers. A file that is missing, unreadable or fails any of these reads as no state, so no byte of it that the product did not shape reaches a terminal. The file is beside the binary it describes and outside the store. It is not in backups. A write that fails (a folder that cannot be written, another writer at the same instant) is logged by the caller, and the state stays as it was.
- **When the automatic check is due.** With no state, or with any of the three times later than now, it is due. Otherwise it is not due within 60 seconds of the last attempt (a request lasts at most 5 seconds). Otherwise: with neither a success nor a failure recorded, due; when the last event is a failure, due one hour after it; else due 24 hours after the last success.
- **The mode.** Each process reads the key's value once, the environment first and then `<data dir>/env`, with where it came from. `off` when the value is `off`; `off-unknown` when it is set and neither `check` nor `off` (in doubt, no request); `ci` when `CI` is set and not empty; otherwise `check`. A process started elsewhere (a hook of an agent opened from the desktop) does not see a variable exported in a shell, so the way to turn the check off for every process is the file, and the lines say where an `off` came from.
- **One check.** The automatic check asks only in mode `check` and when due. A forced check (the `update` command) asks in mode `check` or `ci`, whatever the state's age. Before asking it records the attempt's time, clearing any stored time later than now; after, it records the result: a success records the latest and its time and clears the reason; the latest is overwritten, never kept as a maximum, so a forged or withdrawn value is replaced by the next good answer. A failure records its time and reason and keeps the latest as last known. Two processes that end a turn in the same instant can both ask; one that starts after the other recorded its attempt does not.
- **Where it runs.** `wizardingcode-mem distill` runs the automatic check in its own guard after the drain, so it also runs when `distill`, started by hand, cannot open the store; an error is logged with `logError("update.check", …)` and never changes `distill`'s exit code. It is never on a hook's path.
- **The key.** `WIZARDINGCODE_MEM_UPDATE` (`check` or `off`, default `check`) joins the settings' keys with its rule (any other value written through the settings is refused); the viewer's type of setting keys gains the member, with no field.
- **The tests.** `distill` and `update` take their `fetch` and their clock as an argument with the real ones as default; their tests call them in the test's process with a fake `fetch`, never a child process and never an address read from the environment. The test preload sets `WIZARDINGCODE_MEM_UPDATE=off` whatever the developer's shell exports, so every CLI a test starts makes no request, on a laptop and on a runner alike; a test that wants the check sets the key itself and clears `CI` (AC-19).

### 2. What a person sees

The **current** version is the staged binary's when it answers one, else the running copy's; its words are `the agents run <v>` in the first case and `this copy is <v>` in the second. `<age>` is the project's existing short form (`ago(now, at)` in `src/status/report.ts`: `45 s ago`, `12 min ago`, `2 h ago`, `3 d ago`), moved to `src/util/` so the new folder does not import the status. The first row of the table that applies gives line 1; one function, `updateLine`, is the only place these texts are written.

| When | Line 1 |
| :- | :- |
| the mode is `off`, from the file | `update: off (WIZARDINGCODE_MEM_UPDATE in <data dir>/env)` |
| the mode is `off`, from the environment | `update: off (WIZARDINGCODE_MEM_UPDATE in this command's environment; other processes may not see it)` |
| the mode is `off-unknown` | `update: off (WIZARDINGCODE_MEM_UPDATE is neither check nor off)` |
| a latest is known and higher than the current | `update: <latest> is out (checked <age>); the agents run <v>` (or `; this copy is <v>`); when the last event is a failure, `(checked <age>; last check failed: <reason>, <age>)` |
| the mode is `ci` and this call asked nothing | `update: not checked in CI` |
| no latest is known and no failure is recorded | `update: not checked yet` |
| the last event is a failure | `update: could not check (<reason>, <age>); last known <version>`, or `…; no release known yet` |
| the latest equals the current | `update: <latest> is the latest (checked <age>)` |
| the latest is lower | `update: <current> is ahead of the latest release <latest> (checked <age>)` |

A second line when this process is not the staged binary and the staged file exists. The staged file is run, here as for the hand-over, only by the user who owns `<data dir>/bin` and never by root (on Windows, which has no user ids, always); otherwise the line is `the staged binary at <path> was not run: this command runs as root, or the folder belongs to another user`, and the current version is the running copy's (AC-32).

| The staged binary | Line 2 |
| :- | :- |
| answers a higher version | `agents run <staged> from <path>; this copy is <running>` |
| answers a lower version | `agents run <staged> from <path>; this copy is <running>: wizardingcode-mem install moves them to it` |
| answers no version | `agents run an unreadable binary from <path>; this copy is <running>: wizardingcode-mem install replaces it` |
| answers the same version | none |

- `status` builds this report before it opens the store; a failure to build it (the staged path cannot be read) leaves the report out and does not stop `status`. It prints the lines after its version line, and when a release is out, the commands, one per line as `  <channel>: <command>`. When the store cannot be opened, it prints the version line and the update lines on standard output and the error on standard error, exit 1. `status --json` carries the report as `update`; with a store that cannot be opened it prints one object `{ version, update, error }` and exits 1. The status type gains this optional field; the viewer's status leaves it empty.
- `doctor` appends a check `update` to the list of checks it prints: `warn` when a release is out, with line 1 followed by `; run wizardingcode-mem update for the commands`; `ok` otherwise, the failed check included, since a network that cannot be reached is not a fault of the install. A warning does not change `doctor`'s exit code. The check is added by the `doctor` command, not inside `runChecks`, so the viewer's doctor panel is unchanged.
- `wizardingcode-mem update` (in the CLI's commands and its usage text). With the mode `off` or `off-unknown` it prints line 1 and one of: `set WIZARDINGCODE_MEM_UPDATE=check in <data dir>/env to turn it on` (the value came from the file, or is unknown there), `unset WIZARDINGCODE_MEM_UPDATE in this environment to turn it on` (it came from the environment); no commands; exit 0. Otherwise it asks now, prints the lines and the commands, and exits 0; it exits 1 when its check failed or its result could not be recorded, with the reason.
- The commands, one per channel, in one constant (`CHANNEL_COMMANDS`); the three shell commands are also in the README:
  - `plugin`: update the wizardingcode-mem plugin from your agent's plugin manager;
  - `Homebrew`: `brew upgrade wizardingcode-mem && wizardingcode-mem install`;
  - `npm (and Windows)`: `npx wizardingcode-mem@latest install`;
  - `script`: `curl -fsSL https://raw.githubusercontent.com/WizardingCode-io/wizardingcode-mem/main/scripts/install.sh | sh`.

When the process is the staged binary, its version is the running one and the staged file is not run. Otherwise a reconciled command runs the staged binary's `--version` at most twice (once to decide the hand-over, once for the report), each bounded at 10 seconds.

### 3. An older copy hands over

**Which commands.** The list of the CLI's command names and the four reconciled ones live in a leaf, `src/cli/reconciled.ts`, that imports nothing; `main.ts` builds its table from that list, so a command cannot be in one and not in the other. `ui` with `--auto` among its arguments does not reconcile. A test can import the leaf; it cannot import `main.ts`, which runs at load.

**Where.** `src/cli/main.ts` asks the leaf after its returns for no command, `--help`, `--version` and an unknown command, and after the legacy data migration (an older copy must not skip it, and it is a no-op once done). Only on true does it load the reconciliation. Every other command, `hook` and `mcp` first, loads nothing of `src/update/` or `src/install/binary.ts` and starts nothing. `--version` on any copy answers that copy's version and writes nothing, which `scripts/install.sh`, the npm shim, the workflows and the formula's test rely on.

**Whether.** A pure function, `decide`, answers `skip` or `compare`; it compares no version. It answers `skip` when: the platform is Windows; the process is not a compiled binary; the staged file does not exist; the process's real path is the staged file's real path; `WIZARDINGCODE_MEM_HANDED` is set; the effective user is root; or `<data dir>/bin` belongs to another user. The real-path rule alone keeps the staged binary from handing over to itself; the variable is a second barrier, and the reconciliation deletes it from its own environment after reading it, as `install` does at its start, so nothing these commands start inherits it.

**What.** On `compare`, the staged binary's version is read once. When it is higher than this copy's, the copy prints the line of J-6 on standard error and runs the staged binary with the same arguments, standard streams inherited and `WIZARDINGCODE_MEM_HANDED=1`; its exit code, or 1 when it has none, is this command's. If it cannot be started, one sentence on standard error and exit 1. In every other case the command runs in this copy, and Design 2's second line says what the agents run. One function, `handOver`, does the running; `install`'s `binaryOrHandOver` calls it too and keeps its own sentences. Nothing is staged: `stageBinary` is not changed.

### 4. Documents

- `README.md`:
  - the header's "nothing leaves your machine unless you ask" becomes "none of your data leaves your machine unless you ask";
  - "Without a key, the rules judge every turn and nothing ever leaves your machine" becomes "…and none of your data ever leaves your machine";
  - the bullet "No telemetry, no account, no network — except…" gains the request: to `github.com`, for the number of the latest release; made automatically at most once a day while it succeeds and at most once an hour while it fails, never in CI, and once for each `wizardingcode-mem update` typed; it names no version, platform, path or project, and github.com sees the address and the time as for any request; `WIZARDINGCODE_MEM_UPDATE=off` in `~/.wizardingcode/mem/env` turns it off for every process;
  - "Every setting can be changed from the viewer…" names the one exception; the settings table gains the key; the install section gains the update commands and one sentence: a channel copy older than this version does not hand over.
- `docs/runbooks/release.md`:
  - under "Cutting a release": clients are told from the GitHub release, not from the end of `distribute.yml`, so while that run is stopped, failed or held, the Homebrew, npm and plugin commands find nothing newer and only the script does;
  - under "A bad release": the notice reaches a client at its next successful check, about a day for a machine in use. To withdraw it before a higher version exists, run `gh release edit <previous tag> --latest`. That command also moves what `scripts/install.sh` downloads. The procedure is unproven until the first real release, where the author checks it;
  - a plain tag on an older line can become GitHub's latest; it is corrected with the same command on the right tag.
- `docs/adr/0030-release-notice.md`: the decision (tell, do not replace; it narrows ADR 0029's "the client that learns of a release and follows it"); the four blockers that deferred the replacement (no binary version is recorded in the store, so long-lived processes cannot know they are behind; the sync's takeover does not happen after an update; the viewer and the sync keep writing to a store a newer binary migrated; a daily replacement undoes `install --force`), and beside them the unsigned assets; D-3 and why a newer copy only tells; the redirect in place of the API, with the probe; the request's content; the state file's place and strict reading; the hand-over; and the limits below.
- `CLAUDE.md`: one line under Commands, naming `src/update/`, `wizardingcode-mem update`, and that a compiled build of a lower version than the developer's staged binary hands over to it unless `WIZARDINGCODE_HOME` points elsewhere.
- `docs/real-use/findings.md`: the row of the version-reading rule goes from "deferred, to the client update item" to "deferred, its own item (ADR 0030)", with `tests/unit/release-docs.test.ts` following; a row for the replacement and its blockers, deferred; a row for the viewer's About and Settings field, deferred to the next item; a row for `stageBinary`'s fixed temporary name, which two writers can collide on, deferred.

## Limits

These are stated in ADR 0030.

- Nothing checks while no turn ends, and nothing checks from the hooks when the store cannot be opened (the hook starts `distill` only after it opened the store and found queued turns); `wizardingcode-mem update` checks in both cases.
- The hand-over exists only in copies that carry this item: a channel copy of an earlier version still fails against a store a newer staged binary migrated.
- An install made with `install --binary <path>` runs that path: for it, the second line and the hand-over concern a file the agents do not run.
- A repository renamed or moved leaves every shipped client reading `not a release redirect`.
- The request goes through a configured proxy (`HTTPS_PROXY`).
- On macOS and Linux, a reconciled command typed from a channel copy by the user who owns `<data dir>/bin` runs the staged file's `--version`, and the file itself when it is newer; hooks, and `install` for a newer staged binary, already did.
- A compiled build of a lower version than the developer's staged binary, run with a reconciled command and no throwaway `WIZARDINGCODE_HOME`, hands over to that staged binary.
- A data directory that cannot be written keeps the state at "not checked yet"; the reason is in the log.
- A shipped version keeps checking until its user upgrades; only moving or withdrawing the release changes what it reads.

## Alternatives

About the check:

- Self-replacement on every channel, or only where no manager exists. Rejected by the author for this item (K-1).
- No check at all. Rejected: direct installs have no manager.
- The check off by default. Rejected by the author (K-2).
- `api.github.com`. Rejected: a rate limit per address, and a second host to name.
- A detached process from the session-start hook under a lease. Rejected: a spawn on the hook's path and a lease among the store's, for a daily task.
- The state in the store's `meta`. Rejected: it is about the binary, not the store.
- A backoff of 1, 2, 4, 8, 16 and 24 hours. Rejected for a flat hour: nothing measured asks for the curve, and it made the README's sentence about requests false.
- For the tests, an address read from the environment (the existing pattern is `WIZARDINGCODE_MEM_RELEASE_BASE`). Rejected: the process would take a destination from its environment, the thing ADR 0029's writer just stopped doing.

About two copies:

- A newer copy that stages itself when a reconciled command runs: the author's first answer, withdrawn by D-3 after the review showed the hooks would run the new binary in the open session while that session's MCP server, sync and viewer stayed on the old one.
- The same limited to `update`. Not taken, for the same reason.
- A step in the Homebrew formula that stages after install. Not taken: whether Homebrew's sandbox lets such a step write the user's data directory was not checked, and it would be the same silent staging.
- An older copy that only tells, as the newer one does. Weighed: it removes `decide`, the guard variable, the leaf and an end-to-end test, and it keeps reconciled commands from running a file of the data directory. Not taken: the person typed `doctor` to diagnose and would get a schema error with advice to type another path; `install` already hands over, so the mechanism is generalised, not invented; and the author's D-1 chose it.
- Handing over for every command a person can type. Rejected: `backup` and `history` are also started by the hooks, and the list would have to track every new command.

## Acceptance criteria

- AC-10 (G-1, G-2): `latestRelease` sends one GET with `redirect: "manual"`, no body and no header of its own but `User-Agent: wizardingcode-mem`; it answers the version for a 301 or a 302 whose whole `Location` is `https://github.com/<repository>/releases/tag/v<a>.<b>.<c>`, and one of the fixed reasons for anything else (a 200, a 404, a 429, another host, `http://`, a trailing path, `v1.2`, a pre-release tag, a number of six digits, a request that throws); it never reads a body; `REQUEST_LIMIT_MS` is 5000 and a request that never settles answers `timed out` at the limit given.
- AC-13 (G-1): `distill` runs the check after the drain, also when the store cannot be opened, and a check that throws does not change its exit code.
- AC-18 (G-4): a reconciled command run from a copy older than the staged binary prints the line of J-6 and runs the staged binary with the same arguments, with `WIZARDINGCODE_MEM_HANDED=1`, returning its exit code; a copy started with that variable set does not hand over; `install` hands over through the same function.
- AC-19 (G-2): the test preload turns the check off for every test and every CLI a test starts unless the test sets the key, and `distill`'s and `update`'s tests give them a fake `fetch` in the test's own process.
- AC-21 (G-2, G-5): the README no longer says "nothing leaves your machine" or "nothing ever leaves your machine", says the daily request in its network bullet with the key that turns it off, names the exception to "every setting can be changed from the viewer", has `WIZARDINGCODE_MEM_UPDATE` in its settings table and every command of `CHANNEL_COMMANDS`; the release runbook says that clients are told from the GitHub release and how a notice is withdrawn (`gh release edit`); ADR 0030 exists and names the redirect, `update.json`, the two rules for a channel copy and that `latest` must never start a download; `CLAUDE.md` names `src/update/`.
- AC-23 (G-4): `reconciles` is true only for `status`, `doctor`, `update` and `ui` without `--auto`, over every command of the CLI; `decide` answers `skip` on Windows, for a process that is not compiled, whose real path is the staged binary's, with `WIZARDINGCODE_MEM_HANDED` set, running as root, or with `<data dir>/bin` not the effective user's, and `compare` otherwise. `--version`, `--help`, no command and an unknown command never reach it.
- AC-27 (G-5): no file of `src/update/` imports from `src/store/`, `src/modules/`, `src/engine/`, `src/sync/`, `src/status/` or `src/doctor/`; `src/cli/main.ts` has no static import of `src/update/` or `src/install/binary.ts`; `src/cli/reconciled.ts` imports nothing.
- AC-28 (G-1): the automatic check asks only when due: with no state; with any time in the future; one hour after a failure; 24 hours after a success; and not within 60 seconds of an attempt. A forced check asks whatever the state's age. The result is written to `<data dir>/update.json`: a success records the latest, even a lower one, and clears the reason; a failure keeps the last known version and records the reason. A state file whose `latest` or `reason` holds any other text, an escape sequence or a line break included, reads as no state.
- AC-29 (G-2): the automatic check makes no request when `WIZARDINGCODE_MEM_UPDATE` is `off` or any value but `check`, from the environment or from `<data dir>/env`, or when `CI` is set; a forced check makes no request when the key is `off` or any value but `check`, and makes one when only `CI` is set; the settings refuse any value of the key but `check` and `off`.
- AC-30 (G-1): `doctor` prints a check `update`: `warn` when a release is out, `ok` otherwise, the failed check included, and its exit code is what it is without that check; the checks `runChecks` returns do not include it. `wizardingcode-mem update` asks now, prints the lines and the four commands, and exits 1 when its check failed or its result could not be recorded; with the key `off` it asks nothing, prints the off line and how to turn the check on where the value was set (the file, or this environment), prints no commands, and exits 0.
- AC-31 (G-1, G-3): `updateLine` gives line 1 by the Design's first table, top to bottom: off from the file; off from the environment; an unknown value; a latest known and higher than the current, with and without a failed last check, and with the staged binary answering a version and not; CI with nothing asked; never checked; a failed check with and without a last known version; the latest equal; the latest lower. Line 2 follows the second table: none for the staged binary itself, for no staged file and for equal versions; the plain sentence for a higher staged version; `wizardingcode-mem install moves them to it` for a lower one; `wizardingcode-mem install replaces it` for a staged file that answers no version. `status` prints them with the commands when a release is out; with a store that cannot be opened it still prints them and exits 1, and `status --json` then prints one object with `version`, `update` and `error`. No command but `install` stages a binary.
- AC-32 (G-4, G-1): `status`, `doctor` and `update` do not run the staged file when the command runs as root or when `<data dir>/bin` belongs to another user: the report says the staged binary was not run and why, and takes the running copy as the current version. A report that cannot be built is said with its reason in `status`, as in `doctor`, and a reconciliation that throws lets the command run in this copy.

The ids missing from the sequence are retired.

Test files:

| File | Criteria |
| :- | :- |
| `tests/unit/update-check.test.ts` | AC-10, AC-28, AC-29 |
| `tests/unit/update-report.test.ts` | AC-31 (the lines), AC-32 |
| `tests/unit/update-reconcile.test.ts` | AC-23 (two tables: `reconciles`, `decide`) |
| `tests/unit/update-boundary.test.ts` | AC-19 (the preload), AC-27 |
| `tests/integration/update-command.test.ts` | AC-13, AC-30, AC-31 (`status`), with `run` called in the test's process |
| `tests/e2e/update-reconcile.test.ts` | AC-18, AC-23's last sentence and AC-31's last sentence, on the compiled binary (`tests/helpers/binary.ts`) |
| `tests/e2e/install-forward.test.ts` | AC-18 (`install` through the same function) |
| `tests/unit/update-docs.test.ts` | AC-21 |
| `tests/unit/settings.test.ts` | AC-29 (the key) |

## Risks and rollback

- After `brew upgrade` the agents stay on the older staged binary until the person runs `install`; the second line tells them at each `status` and `doctor`.
- github.com may change the shape of the `releases/latest` redirect; the check then reads `not a release redirect` and `status` says so.
- A release is visible on github.com before `distribute.yml` has published it, and stays so if that run stops; the runbook says it.
- The request tells github.com that an address runs the product. Stated in the README; off with one key in the file.
- Rollback: a revert removes the check and the hand-over from the next release on. A version already shipped keeps asking github.com and keeps handing over until its user upgrades; what it is told can only be changed by moving or withdrawing the release. `update.json` is then an unread file; nothing in the store changes.
- Not verifiable here: github.com's rate limiting of one address, its answer while a release's assets upload, the compiled binary's `fetch` on each platform, and `gh release edit … --latest` moving what clients read. The compiled binary's request is tried once by hand before the pull request (the plan's Verification); the rest is seen on the first release after the merge, when the author reads `wizardingcode-mem update`.

## Non-Functional Requirements

No request, no file read and no import of `src/update/` on a hook's path. Requests per data directory: automatically at most one in 24 hours while checks succeed and at most one an hour while they fail; one for each `update` typed. Cost and time: one item and one pull request, built and reviewed within the session that wrote this; nothing is added to a hook's time. Midway check: the compiled binary's `update` against the real github.com, before the gates.
