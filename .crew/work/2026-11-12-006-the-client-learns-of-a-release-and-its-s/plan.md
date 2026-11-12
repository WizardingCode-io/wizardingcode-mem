# Plan: the client learns of a release

Spec: `spec.md` in this folder. Branch `feature/client-update`, on top of `fix/release-hardening` (pull request 39); when that one is merged this branch is rebased on `main`. Each phase leaves `bun run typecheck` and its named tests passing. Tests run with the pinned Bun: `./node_modules/.bin/bun test <file>`. Lint by name, since the lint gate checks no file inside a crew worktree: `./node_modules/.bin/biome check src scripts tests`.

## Files

| File | Change | What and why |
| :- | :- | :- |
| `src/util/ago.ts` | Create | `ago(now, at)`, moved from `src/status/report.ts`, which re-exports it |
| `src/util/atomic-write.ts` | Modify | the temporary name carries the process id |
| `src/util/version.ts` | Modify | `PLAIN_VERSION` and `isPlainVersion`, beside `isVersion` |
| `src/install/binary.ts` | Modify | `stagedPath`, and `stagedVersion` exported with a limit and a per-process memo; `stageBinary` is not changed |
| `src/update/state.ts` | Create | `UpdateState`, `STATE_FILE`, `REASON`, `readState`, `writeState` |
| `src/update/check.ts` | Create | `REQUEST_LIMIT_MS`, `latestRelease`, `due`, `mode`, `checkForRelease` |
| `src/update/channels.ts` | Create | `REPOSITORY`, `CHANNEL_COMMANDS` |
| `src/update/report.ts` | Create | `stagedFacts`, `updateReport`, `updateLine`, `agentsLine`, `commandLines` |
| `src/update/reconcile.ts` | Create | `decide`, `reconcile`, `handOver`, `handedEnv` |
| `src/cli/reconciled.ts` | Create | `COMMAND_NAMES`, `RECONCILED`, `reconciles`; imports nothing |
| `src/cli/commands/update.ts` | Create | `wizardingcode-mem update` |
| `src/cli/main.ts` | Modify | `update` in `COMMANDS` and the usage text; `COMMANDS` typed by `COMMAND_NAMES`; the call of `reconciles` and the dynamic import |
| `src/cli/commands/distill.ts` | Modify | `run(args, deps)`; the check in its own guard after the drain |
| `src/cli/commands/status.ts`, `src/status/report.ts` | Modify | the optional `update` field, its lines, the path without a store |
| `src/doctor/checks.ts` | Modify | the check `update` (`DoctorContext` already has `env`; it gains an optional `facts` for tests) |
| `src/cli/commands/install.ts` | Modify | `binaryOrHandOver` calls `handOver` |
| `src/settings/settings.ts`, `ui/src/api.ts` | Modify | the key, its rule, its field and default; the viewer's union member |
| `tests/preload.ts` | Modify | `process.env.WIZARDINGCODE_MEM_UPDATE = "off"` |
| `tests/helpers/cli.ts` | Modify | a comment on `spawnCli`: it inherits nothing, so a test starting `distill` or `update` through it sets the key |
| `README.md`, `docs/runbooks/release.md`, `docs/adr/0030-release-notice.md` (Create), `CLAUDE.md`, `docs/real-use/findings.md` | Modify | the spec's Design 4 and Limits |
| `tests/unit/update-check.test.ts`, `update-report.test.ts`, `update-reconcile.test.ts`, `update-boundary.test.ts`, `update-docs.test.ts`, `tests/integration/update-command.test.ts`, `tests/e2e/update-reconcile.test.ts` | Create | per criterion, below |
| `tests/unit/settings.test.ts`, `tests/integration/install.test.ts`, `tests/unit/release-docs.test.ts` | Modify | the key (and the whole-object defaults case); `stagedVersion`'s two new cases; the findings row's new status |

`tests/e2e/install-forward.test.ts` and `src/ui/server.ts` are not changed.

## Phase 1: the shared pieces

- `src/util/ago.ts`: the function as it is in `src/status/report.ts:151`; that file imports and re-exports it, so no caller changes.
- `src/util/version.ts`: `export const PLAIN_VERSION = /^\d{1,5}\.\d{1,5}\.\d{1,5}$/; export const isPlainVersion = (text: string) => PLAIN_VERSION.test(text);` with a comment: narrower than `isVersion` on purpose, for text that comes from the network or from a file a person can write.
- `src/util/atomic-write.ts`: the temporary name becomes `.<base>.<pid>.tmp`. Nothing else changes.
- `src/install/binary.ts`:
  - `export function stagedPath(dataDir: string): string` (the join the function has inline today, `.exe` on win32);
  - `export function stagedVersion(target: string, timeoutMs = VERSION_TIMEOUT_MS): string | null`, remembered in a module `Map` keyed by `target` when called with the default limit; `stageBinary` deletes the entry after its rename;
  - `stageBinary` is not changed, except that it deletes the memo's entry after its rename.

`tests/integration/install.test.ts`, beside the `stageBinary` cases, each seen failing first (the function is not exported today): `stagedVersion` of a script that sleeps 5 seconds with a limit of 200 ms is null (the test allows 3 seconds); `stagedVersion` called twice with the default limit runs the staged script once (the script appends to a file), and once more after a `stageBinary` that replaced the file. `src/util/atomic-write.ts`'s existing test gains: the temporary name holds the process id, and a stale `.<base>.tmp` of the old fixed name is not touched.

## Phase 2: the state and the check (AC-10, AC-12, AC-22)

`src/update/state.ts`:

```ts
export interface UpdateState { latest: string | null; checkedAt: number | null; attemptAt: number | null;
  failedAt: number | null; reason: string | null; failures: number }
export const STATE_FILE = "update.json";
export const REASON = /^(offline|timed out|not a release redirect|HTTP \d{3})$/;
export function readState(dataDir: string): UpdateState | null   // null: missing, unreadable, or any field off
export function writeState(dataDir: string, state: UpdateState): void  // mkdirSync(dataDir, { recursive: true, mode: 0o700 }); writeFileAtomic
```

A field is off when: `latest` is neither null nor `isPlainVersion`; `reason` is neither null nor a match of `REASON`; a time is neither null nor a finite number; `failures` is not a non-negative integer.

`src/update/check.ts`:

```ts
export const REQUEST_LIMIT_MS = 5000;
export type Latest = { ok: true; version: string } | { ok: false; reason: string };
export async function latestRelease(fetchImpl: typeof fetch, repository: string,
  options?: { timeoutMs?: number }): Promise<Latest>
export function due(state: UpdateState | null, now: number): boolean
export type Mode = "check" | "off" | "off-unknown" | "ci";
export function mode(value: string | null, env: Record<string, string | undefined>): Mode
export async function checkForRelease(input: { dataDir: string; mode: Mode; now: number; fetch: typeof fetch;
  repository: string; force?: boolean }): Promise<{ asked: boolean; state: UpdateState | null }>
```

- `latestRelease` calls `fetchImpl(url, { method: "GET", redirect: "manual", headers: { "User-Agent": "wizardingcode-mem" }, signal })` with an `AbortController` aborted by a timer of `timeoutMs`; an abort is `timed out`, any other throw `offline`; a status other than 301 and 302 is `HTTP <status>` when it is three digits, else `not a release redirect`; the `Location` must equal `https://github.com/<repository>/releases/tag/v<version>` with `isPlainVersion(version)`, compared after lower-casing the owner and repository on both sides.
- `due`, in order: no state → true; `attemptAt`, `checkedAt` or `failedAt` greater than `now` → true; `attemptAt` not null and `now - attemptAt < 60_000` → false; `checkedAt` and `failedAt` both null → true; `failedAt` not null and (`checkedAt` null or `failedAt > checkedAt`) → `now - failedAt >= 3_600_000`; else `now - checkedAt >= 86_400_000`.
- `mode`: `off` → `off`; any other non-empty value but `check` → `off-unknown`; `env.CI` non-empty → `ci`; else `check`. (`null` and `check` fall through to the `CI` test.)
- `checkForRelease`: asks when the mode is `check` and the state is due, or when `force` and the mode is `check` or `ci`. Otherwise `{ asked: false, state: readState(dataDir) }`. When asking: the state to write starts from the read one (or all null, failures 0), any time greater than `now` set to null, `attemptAt = now`; `writeState`; `latestRelease`; then `writeState` of the result (success: `latest`, `checkedAt = now`, `reason` null, `failures` 0; failure: `failedAt = now`, `reason`, `failures + 1`).

`src/settings/settings.ts`: `"WIZARDINGCODE_MEM_UPDATE"` in `SETTING_KEYS`; `RULES` entry `(v) => (v === "check" || v === "off" ? null : "check or off")`; `Settings` gains `update: string`, the raw value or `"check"` when unset (never normalised); the public view gains the key with the default `check`. `ui/src/api.ts`: the union member only.

Tests, each seen failing first (the files do not exist):

- `tests/unit/update-check.test.ts`. AC-10: a fake `fetch` records its arguments and returns an object with `status`, `headers` and getters `body`, `text`, `json` that throw. Cases: 301 and 302 with the right `Location` give the version; the options hold `redirect: "manual"`, method `GET`, headers equal to `{ "User-Agent": "wizardingcode-mem" }`, and no `body` or `credentials` key; 200, 404, 429; `http://`, another host, another repository, a trailing `/x`, `v1.2`, `v1.2.3-rc.1`, `v123456.0.0`; a `fetch` that throws; `REQUEST_LIMIT_MS === 5000`; a `fetch` that never settles with `timeoutMs: 20` gives `timed out`. AC-22: a table for `due` (no state; each of the three times in the future, alone and with the others valid; an attempt 59 s and 60 s old with nothing else; one millisecond before and at one hour after a failure, with `checkedAt` null and with an older `checkedAt`; one millisecond before and at 24 hours after a success); `checkForRelease` in a temporary data directory that does not exist yet: a success creates the folder and the file, records the latest and clears the failures; a lower latest replaces a higher; a failure keeps the latest and counts; a second call started after the first wrote `attemptAt` and before it answered asks nothing; a state with `checkedAt` in the future and a failing `fetch` asks once, and a second call at the same `now` asks nothing; `readState` gives null for a `latest` of `"1.0.0\u001b[31m"`, a `reason` with a line break, a time of `"x"`, `failures` of -1 and of 1.5. AC-12: `mode` for `off`, `check`, null, `maybe`, each with and without `CI`; `checkForRelease` asks nothing for `off`, `off-unknown` and `ci`, and asks for `ci` with `force`.
- `tests/unit/settings.test.ts`: the key is accepted as `check` and `off` and refused otherwise; `loadSettings` returns the raw unknown value from the environment and from the file; the whole-object defaults case (line 27) gains `update: "check"`.

## Phase 3: what is said (AC-26's lines)

`src/update/channels.ts`: `REPOSITORY = "WizardingCode-io/wizardingcode-mem"`; `CHANNEL_COMMANDS: ReadonlyArray<{ channel: string; command: string; shell: boolean }>` with the four lines of the spec (`shell` false for the plugin's sentence).

`src/update/report.ts`:

```ts
export interface StagedFacts { path: string; version: string | null; isSelf: boolean }
export function stagedFacts(dataDir: string): StagedFacts   // stagedPath, stagedVersion, realpath(process.execPath) === realpath(path) when it exists
export interface UpdateReport { running: string; staged: string | null; stagedPath: string; latest: string | null;
  checkedAt: number | null; failedAt: number | null; reason: string | null; mode: Mode; out: boolean; lines: string[] }
export function updateReport(input: { dataDir: string; mode: Mode; now: number; running: string;
  facts: StagedFacts; asked?: boolean }): UpdateReport
export function updateLine(input: { mode: Mode; asked: boolean; state: UpdateState | null; current: string;
  currentIsStaged: boolean; now: number }): { line: string; out: boolean }
export function agentsLine(running: string, facts: StagedFacts): string | null
export function commandLines(): string[]   // "  <channel>: <command>" for each of CHANNEL_COMMANDS
```

`updateLine` follows the table of the spec's Design 2, top to bottom; "the last event is a failure" is `failedAt` not null and (`checkedAt` null or later than it). `agentsLine` is null when `facts.isSelf`, when the staged file does not exist, or when its version equals `running`; otherwise `agents run <staged> from <path>; this copy is <running>`, followed by `: wizardingcode-mem install moves them to it` when `olderThan(staged, running)`; and `agents run an unreadable binary from <path>; this copy is <running>: wizardingcode-mem install replaces it` when the file exists and answers no version. `StagedFacts` gains `exists: boolean` for that. `updateReport` reads the state, sets `lines` to `updateLine`'s line followed by `agentsLine`'s when there is one, and copies `out`.

`tests/unit/update-report.test.ts`: one case per row of the table (the last three rows each with the staged binary answering and not), `ci` with `asked: true` giving the state's line, and `agentsLine` in its five cases (self; no staged file; equal; staged higher; staged lower; unreadable).

## Phase 4: the commands (AC-13, AC-19, AC-27, AC-25, and AC-26 for `status`)

- `tests/preload.ts`: `process.env.WIZARDINGCODE_MEM_UPDATE = "off";` beside the viewer's switches, with the comment that it is not `??=` because a developer's shell must not turn the check on for the suite.
- `src/cli/commands/update.ts`: `run(args, deps = { fetch, now: Date.now })`. `defaultDataDir()`, `loadSettings(process.env, dataDir).update`, `mode`. For `off` and `off-unknown`: the line, then `set WIZARDINGCODE_MEM_UPDATE=check in <dataDir>/env to turn it on`, exit 0. Otherwise `checkForRelease({ …, force: true })` inside a `try` (a write that fails prints `wizardingcode-mem: could not record the check: <code or first line>` and exits 1), the report with `asked: true`, its lines, `commandLines()`, and exit 1 when the state's last event is a failure, else 0.
- `src/cli/reconciled.ts` is created here (Phase 5 uses the rest): `export const COMMAND_NAMES = [...] as const` with every key `main.ts` has today plus `update`; `RECONCILED`; `reconciles`. `main.ts` types its table as `Record<(typeof COMMAND_NAMES)[number], …>`, so a command added to one and not the other fails the typecheck; `update` joins the table and the usage text.
- `src/cli/commands/distill.ts`: `run(args: string[] = [], deps = { fetch, now: Date.now })`. The body's result is kept in a variable instead of returned from inside the `try`; after the `try/catch/finally`, a second guard: `try { const { checkForRelease, mode } = await import("../../update/check.ts"); const dataDir = defaultDataDir(); await checkForRelease({ dataDir, mode: mode(loadSettings(process.env, dataDir).update, process.env), now: deps.now(), fetch: deps.fetch, repository: REPOSITORY }); } catch (error) { logError("update.check", error); }`, then the kept code is returned.
- `src/status/report.ts`: `StatusReport` gains `update?: UpdateReport`; `statusReport` does not set it; `formatStatus` prints `update.lines` after the version line when the field is present, and `commandLines()` when `update.out`. `src/cli/commands/status.ts`: before the store's `try`, the update report is built (`stagedFacts`, `mode`, `updateReport`); after `statusReport` returns it is assigned to `report.update`, as `history` is. In the `catch`: with `--json`, one object `{ version: pkg.version, update, error: <message> }` on standard output; otherwise the version line and the update lines on standard output and the error on standard error; exit 1 in both.
- `src/doctor/checks.ts`: a check `update` after `backups`: the report from `context.dataDir`, `context.now`, `context.env ?? process.env`, `pkg.version` and `(context.facts ?? stagedFacts)(context.dataDir)`; `warn` with `<line 1>; run wizardingcode-mem update for the commands` when `out`, else `ok` with line 1. `DoctorContext` gains `facts?: (dataDir: string) => StagedFacts`.

Tests:

- `tests/integration/update-command.test.ts`. Each test sets `WIZARDINGCODE_HOME` to a temporary folder, `WIZARDINGCODE_MEM_UPDATE=check` and deletes `CI` on `process.env`, replaces `process.stdout.write` and `process.stderr.write` with collectors, and restores all in `afterEach`. AC-13: `distill`'s `run([], { fetch, now })` with a fake redirect writes `update.json` and returns 0; with a `fetch` that throws synchronously it returns 0; with a folder at `update.json`'s path it returns 0; with a file where the database should be it returns 1 and `update.json` is written. AC-25: `update`'s `run` prints the lines and the four commands and returns 0; with a 429 it prints `update: could not check (HTTP 429, 0 s ago); no release known yet` and returns 1; with `CI=1` it still asks; with the key `off` the fake `fetch` is never called, the output is the off line and the turn-it-on sentence with no command, and it returns 0; it asks although `attemptAt` is one second old. `doctor`: `runChecks` in the test's process, with a context whose `facts` returns a fixed version and a state where a release is out, gives a check named `update` with status `warn` and the sentence; with the latest equal, and with a failed check, `ok`. A second case runs `runCli("doctor")` on that state and asserts the output has a line starting `warn  update:` and that the exit code equals that of the same run without the state (the warning adds no failure). AC-26 for `status` through `runCli`, with `WIZARDINGCODE_MEM_UPDATE=check` and `CI` empty in the child's environment, a state written by the test (`checkedAt` two hours before) and a shell-script staged binary answering `0.0.1`: standard output has `update: … is out (checked 2 h ago); the agents run 0.0.1` and the four command lines; with no `bin`, `this copy is <pkg.version>`; with a file where the database should be, the update line is on standard output and the exit code is 1; the same with `--json` parses as one object with `version`, `update` and `error`.
- `tests/unit/update-boundary.test.ts`. AC-27: every `.ts` file under `src/update/` has no import path containing `/store/`, `/modules/`, `/engine/`, `/sync/`, `/status/` or `/doctor/`; `src/cli/main.ts` has no static `import … from` naming `update/` or `install/binary`; `src/cli/reconciled.ts` has no import. AC-19: `process.env.WIZARDINGCODE_MEM_UPDATE` is `off` here, and the source of `tests/preload.ts` assigns it with `=`, not `??=`.

## Phase 5: the hand-over (AC-18, AC-23, and AC-26's last sentence)

`src/update/reconcile.ts`:

```ts
export type Decision = "skip" | "compare";
export function decide(input: { platform: string; compiled: boolean; self: string; staged: string | null;
  handed: boolean; uid: number | null; binOwner: number | null }): Decision
export function handedEnv(env: Record<string, string | undefined>): Record<string, string | undefined>
export function handOver(path: string, argv: string[], say: () => void, fail?: (message: string) => string): number
export function reconcile(argv: string[]): { code: number } | null
```

- `decide`: `skip` when `platform === "win32"`, `!compiled`, `staged !== null && self === staged`, `handed`, `uid === 0`, or `binOwner !== null && binOwner !== uid`; else `compare`. `staged` is null when the staged file does not exist.
- `reconcile`: the data directory is `defaultDataDir()`. It reads and then deletes `process.env.WIZARDINGCODE_MEM_HANDED`; gathers `isCompiled()`, `realpathSync(process.execPath)`, the real path of `stagedPath(dataDir)` or null when it does not exist, `process.geteuid?.() ?? null`, and the `uid` of `lstatSync` on `<data dir>/bin` or null when it does not exist; on `compare` it reads `stagedVersion(path)` once. When that version is not null and `olderThan(pkg.version, staged)`: `handOver(path, argv, sayJ6)` and `{ code }`. In every other case null: it stages nothing.
- `handOver`: `say()`, then `Bun.spawnSync([path, ...argv], { stdin: "inherit", stdout: "inherit", stderr: "inherit", env: handedEnv(process.env) })`; returns `exitCode ?? 1`; a throw prints `fail(message)` when given, else `wizardingcode-mem: could not run <path>: <first line of the message>`, and returns 1.
- `src/cli/commands/install.ts`: `binaryOrHandOver` keeps its own sentence on standard output and its failure text (`wizardingcode-mem install: could not run …`, passed as `fail`) and calls `handOver(binary.path, ["install", ...argv], () => {}, …)`. `install`'s `run` deletes `process.env.WIZARDINGCODE_MEM_HANDED` at its start, so the agents' commands it starts do not inherit it.
- `src/cli/main.ts`: after the legacy migration block, `if (reconciles(name, rest)) { const { reconcile } = await import("../update/reconcile.ts"); const handed = reconcile(argv); if (handed !== null) return handed.code; }`.

Tests:

- `tests/unit/update-reconcile.test.ts`. Table 1: for every name of `COMMAND_NAMES`, `reconciles(name, [])` is true exactly for the four; `reconciles("ui", ["--auto"])` is false and `reconciles("ui", ["--port", "1"])` true; the usage text of `src/cli/main.ts`, read as text, names `update`. Table 2: `decide` for `win32`, not compiled, the staged path itself, handed, root, another owner's `bin`, a missing staged file (`compare`), and the plain case (`compare`). `handedEnv` sets the variable and changes nothing else.
- `tests/e2e/update-reconcile.test.ts` (skipped on Windows; the compiled binary from `hostBinary()`; every run sets `WIZARDINGCODE_HOME` to a `realpathSync`'d temporary folder and `WIZARDINGCODE_MEM_UPDATE=off`). A fake staged binary is a shell script that answers a version to `--version` and otherwise appends its arguments and `$WIZARDINGCODE_MEM_HANDED` to `called.txt` and exits 7. Cases: staged `0.0.1` and `status` → the staged file's bytes are unchanged, standard error is empty, and standard output has `agents run 0.0.1 from <path>; this copy is <version>: wizardingcode-mem install moves them to it`; no staged file and `status` → no `bin` folder is created; a staged script that exits 1 → the staged file unchanged and the `unreadable` line; staged `99.0.0` and `doctor --x` → standard error has `running 99.0.0 from <path>; this copy is <version>`, `called.txt` holds `doctor --x` and `1`, exit 7; the same with `WIZARDINGCODE_MEM_HANDED=1` in the environment → no `called.txt`, no such line; `--version` with staged `0.0.1` → the staged file unchanged, standard error empty; `hook claude-code session-start` with staged `0.0.1` → the staged file unchanged.

## Phase 6: the documents (AC-21)

`tests/unit/update-docs.test.ts` first, red for each document: the README does not contain the exact strings "nothing leaves your machine unless you ask" or "nothing ever leaves your machine" (case-sensitive, so "Nothing leaves your machine for knowledge" stays); its network bullet (the one line starting `- **No telemetry`) contains `github.com`, "once a day", "once an hour" and `WIZARDINGCODE_MEM_UPDATE=off`; the line with "Every setting can be changed from the viewer" contains `WIZARDINGCODE_MEM_UPDATE`; the settings table has a row for the key; every `command` of `CHANNEL_COMMANDS` with `shell` true is in the README. The runbook contains `gh release edit`, `--latest` and "told from the GitHub release". `docs/adr/0030-release-notice.md` exists and contains `releases/latest`, `update.json`, "hands over", "only tells" and "must never start a download". The Commands section of `CLAUDE.md` contains `src/update/` and `wizardingcode-mem update`.

Then the documents as the spec's Design 4 and Limits list them. `docs/real-use/findings.md`: the `version_of` row's status becomes `deferred, its own item (ADR 0030)`, and `tests/unit/release-docs.test.ts`'s expected status follows; two new rows (the replacement with its four blockers; the viewer's About and Settings field), `deferred`.

## Verification

- The seven new test files and the three modified ones; `bun run typecheck`; `./node_modules/.bin/biome check src scripts tests`; `bun run test` once before the gates; `bun run build` (the e2e builds the compiled binary itself through `hostBinary()`).
- Already done, in `probes/releases-latest.md`: the real redirect of github.com, read on 2026-11-12.
- By hand, with a throwaway home: `WIZARDINGCODE_HOME=$(mktemp -d) WIZARDINGCODE_MEM_UPDATE=check ./dist/<binary> update`, once, to see the compiled binary read the real redirect; its output goes in `probes/`.
- Not verifiable here: github.com's rate limiting, and `gh release edit … --latest` moving what clients read. Both are seen on the first release after the merge.

## Corrections after the review's round 2

These override the phases above where they differ; the spec's final text is the reference.

- **Not changed after all:** `src/util/atomic-write.ts` (and so no test of it), `stageBinary`, `src/doctor/checks.ts`, `src/doctor/context.ts`, `src/ui/server.ts`. `src/install/binary.ts` only exports `stagedPath(dataDir)` and `stagedVersion(target, timeoutMs = VERSION_TIMEOUT_MS)`; there is no memo. Phase 1's `install.test.ts` cases reduce to: `stagedPath` gives the path `stageBinary` returns, and `stagedVersion` of a script that runs `exec sleep 5` with a limit of 200 ms is null within 3 seconds.
- **The state has no `failures` field.** `UpdateState` is `{ latest, checkedAt, attemptAt, failedAt, reason }`. "The last event is a failure" is `failedAt !== null && (checkedAt === null || failedAt > checkedAt)`. A success sets `reason` to null and leaves `failedAt` as it was.
- **`latestRelease`** races `fetchImpl(...)` against a timer promise that resolves to `timed out` after `timeoutMs`, and clears the timer in a `finally`; the `AbortController` is still aborted on the timeout so a real request is dropped. The test's `fetch` returns a promise that never settles. The `Location` is compared exactly, with no lower-casing.
- **The key's source.** `src/settings/settings.ts` exports `updateSetting(env, dataDir): { value: string | null; source: "env" | "file" | "default" }`, built on the existing `rawSettings` (the environment's value is trimmed, as for every key; an empty one is unset). `mode(value, env)` takes that value. `Settings` does not gain a field, so the whole-object cases of `tests/unit/settings.test.ts` (the defaults at line 27 and the file at lines 48 to 69) do not change; the test adds: the rule accepts `check` and `off` and refuses `maybe`; `updateSetting` returns the value and the source from the environment, from the file, and the default; the public view lists the key with the default `check`.
- **`checkForRelease`** returns `{ asked: boolean; state: UpdateState | null; error?: string }`; a `writeState` that throws is caught there and returned as `error` (the code, or the message's first line), so `distill` logs it and `update` prints `wizardingcode-mem: could not record the check: <error>` and exits 1.
- **`src/update/report.ts`.** `StagedFacts` is `{ path: string; exists: boolean; version: string | null; isSelf: boolean }`; `stagedFacts(dataDir, running)` does not run the file when `isSelf` (its version is `running`) or when it does not exist. `updateReport({ dataDir, mode, source, now, running, facts, asked })` and `updateLine({ mode, source, asked, state, current, currentIsStaged, now })` follow the spec's two tables row by row; `asked` is the name in both documents. The channel labels are exactly `plugin`, `Homebrew`, `npm (and Windows)`, `script`, and the plugin's text is `update the wizardingcode-mem plugin from your agent's plugin manager`. The README test checks the three commands whose `shell` is true.
- **`doctor`.** `src/cli/commands/doctor.ts` builds the `update` check itself (`updateCheck(dataDir, env, now)` exported from `src/update/report.ts`, returning `{ name: "update", status, detail }`, wrapped in a `try` that yields an `ok` check with `not checked: <error>` on a throw) and appends it to `runChecks(...)`'s list before printing. Its tests: `updateCheck` in the test's process for `warn` and `ok`; `runCli("doctor")` with a state whose `latest` is `99.0.0` prints a line starting `warn  update:` and exits with the code of the same run without the state; `runChecks` has no check named `update`.
- **`status`.** The report is built in a `try` before the store is opened; on a throw it is left undefined and `status` goes on. The state in its tests has `latest: "99.0.0"`.
- **`update`.** It calls `stagedFacts(dataDir, pkg.version)` and `updateSetting`. With the mode off: line 1, then `set WIZARDINGCODE_MEM_UPDATE=check in <dataDir>/env to turn it on` when the source is the file (or the value is unknown and came from the file), or `unset WIZARDINGCODE_MEM_UPDATE in this environment to turn it on` when it came from the environment; exit 0.
- **`distill`.** The guard imports `REPOSITORY` from `../../update/channels.ts`, `checkForRelease` and `mode` from `../../update/check.ts`, `updateSetting` from `../../settings/settings.ts` and `defaultDataDir` from `../../util/paths.ts`.
- **`src/cli/reconciled.ts`** exports `COMMAND_NAMES`, `type CommandName`, `RECONCILED` and `reconciles`. `main.ts` declares `const COMMANDS: Record<CommandName, Loader>` and looks a name up with `(COMMANDS as Record<string, Loader | undefined>)[name]`, so an unknown command still returns `EXIT_USAGE`.
- **`decide`** takes `{ platform, compiled, self, staged, handed, uid, binOwner }` with `staged: string | null` (the real path, or null when the file does not exist) and answers `skip` for a null `staged`; `binOwner` is the owner of `<data dir>/bin`, which exists whenever the staged file does. `reconcile` runs `stagedVersion(stagedPath(dataDir))` and prints `stagedPath(dataDir)` in J-6's line.
- **`install`.** `run` deletes `process.env.WIZARDINGCODE_MEM_HANDED` at its start; `binaryOrHandOver` calls `handOver`. `tests/e2e/install-forward.test.ts` gains one assertion: its fake staged binary also records `$WIZARDINGCODE_MEM_HANDED`, and it is `1` (red while `install` spawns by itself).
- **The e2e** (`tests/e2e/update-reconcile.test.ts`) is skipped on Windows and when `process.getuid?.() === 0`. Cases: staged `99.0.0` with `doctor --x` (the J-6 line, `called.txt` holds `doctor --x` and `1`, exit 7); the same with `WIZARDINGCODE_MEM_HANDED=1` (no `called.txt`); staged `99.0.0` with each of `--version`, `--help`, no argument and `nonsense` (no `called.txt`); staged `99.0.0` with `hook claude-code session-start` (no `called.txt`); staged `0.0.1` with `status` (the staged file's bytes unchanged, standard output has the line ending `: wizardingcode-mem install moves them to it`); a staged script that exits 1 with `status` (unchanged, the `unreadable` line); no staged file with `status` (no `bin` folder afterwards, no second line).
- **The documents test** also holds: the README's network bullet contains "once an hour" and `~/.wizardingcode/mem/env`; ADR 0030 contains "only tells".
