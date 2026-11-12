# Report: The client learns of a release and its staged binary follows (piece 2 of 2026-11

- Work: `2026-11-12-006-the-client-learns-of-a-release-and-its-s`
- Type: feature. Kind: feature (from work_type feature). Route: full (risk areas: infra, public-api)
- CTO plan: none
- Packs: none
- Checklists: sync (1 file)
- Verdict: **Proven**

## Spec review

- done: round 2 clean.

The file: `spec-review/consolidated.md`.

## Knowledge

- K-391 · validated-solution · "Harden the release's distribution after its first review (follow-up of 2026-11-1" · alone · stack node, word client, word release, word staged, word binary, word 2026 · unverified 0.79
- K-390 · validated-solution · "The release publishes everywhere by itself, and <data dir>/bin has one owner tha" · alone · stack node, word release, word staged, word binary, word 2026 · unverified 0.76
- K-381 · validated-solution · "Share a project without a git remote. Today a project can be set above Nothing o" · alone · stack node, word binary, word 2026 · unlikely 0.2
- K-363 · validated-solution · "Team server: wizardingcode-mem serve, one Docker image with SQLite and the repos" · alone · stack node, word client, word release · unverified 0.29
- K-383 · validated-solution · "Homebrew formula: 0.8.0 with the release's checksums. packaging/homebrew/wizardi" · alone · stack node, word release · unverified 0.72
- K-376 · validated-solution · "Homebrew formula: 0.7.0 with the release's checksums. packaging/homebrew/wizardi" · alone · stack node, word release · unverified 0.69
- K-375 · validated-solution · "Release 0.7.0: version 0.7.0 in package.json and in every file that carries the " · alone · stack node, word release · unverified 0.71
- K-372 · validated-solution · "Part 7 of the knowledge and team journey, the runbook: docs/runbooks/team-server" · alone · stack node, word client · unlikely 0.2
- K-371 · validated-solution · "Part 6 of the knowledge and team journey, the sync client: wizardingcode-mem kee" · alone · stack node, word client · unverified 0.25
- K-343 · validated-solution · "Knowledge for the agent: MCP tools (search, get, propose, update, taxonomy), the" · alone · stack node, word follows · unlikely 0.16
- Learned: not yet

## Acceptance criteria

| Id | Kind | Criterion | Test-first |
| :- | :- | :- | :- |
| AC-10 | behavior | latestRelease sends one GET with redirect: "manual", no body and no header of its own but User-Agent: wizardingcode-mem; it answers the version for a 301 or a 302 whose whole Location is https://github.com/<repository>/releases/tag/v<a>.<b>.<c>, and one of the fixed reasons for anything else (a 200, a 404, a 429, another host, http://, a trailing path, v1.2, a pre-release tag, a number of six digits, a request that throws); it never reads a body; REQUEST_LIMIT_MS is 5000 and a request that never settles answers timed out at the limit given. | red then green |
| AC-13 | behavior | distill runs the check after the drain, also when the store cannot be opened, and a check that throws does not change its exit code. | red then green; the green recorded 2 times (the latest decides) |
| AC-18 | behavior | a reconciled command run from a copy older than the staged binary prints the line of J-6 and runs the staged binary with the same arguments, with WIZARDINGCODE_MEM_HANDED=1, returning its exit code; a copy started with that variable set does not hand over; install hands over through the same function. | red then green |
| AC-19 | behavior | the test preload turns the check off for every test and every CLI a test starts unless the test sets the key, and distill's and update's tests give them a fake fetch in the test's own process. | red then green |
| AC-21 | behavior | the README no longer says "nothing leaves your machine" or "nothing ever leaves your machine", says the daily request in its network bullet with the key that turns it off, names the exception to "every setting can be changed from the viewer", has WIZARDINGCODE_MEM_UPDATE in its settings table and every command of CHANNEL_COMMANDS; the release runbook says that clients are told from the GitHub release and how a notice is withdrawn (gh release edit); ADR 0030 exists and names the redirect, update.json, the two rules for a channel copy and that latest must never start a download; CLAUDE.md names src/update/. | red then green |
| AC-23 | behavior | reconciles is true only for status, doctor, update and ui without --auto, over every command of the CLI; decide answers skip on Windows, for a process that is not compiled, whose real path is the staged binary's, with WIZARDINGCODE_MEM_HANDED set, running as root, or with <data dir>/bin not the effective user's, and compare otherwise. --version, --help, no command and an unknown command never reach it. | red then green |
| AC-27 | behavior | no file of src/update/ imports from src/store/, src/modules/, src/engine/, src/sync/, src/status/ or src/doctor/; src/cli/main.ts has no static import of src/update/ or src/install/binary.ts; src/cli/reconciled.ts imports nothing. | red then green |
| AC-28 | behavior | the automatic check asks only when due: with no state; with any time in the future; one hour after a failure; 24 hours after a success; and not within 60 seconds of an attempt. A forced check asks whatever the state's age. The result is written to <data dir>/update.json: a success records the latest, even a lower one, and clears the reason; a failure keeps the last known version and records the reason. A state file whose latest or reason holds any other text, an escape sequence or a line break included, reads as no state. | red then green |
| AC-29 | behavior | the automatic check makes no request when WIZARDINGCODE_MEM_UPDATE is off or any value but check, from the environment or from <data dir>/env, or when CI is set; a forced check makes no request when the key is off or any value but check, and makes one when only CI is set; the settings refuse any value of the key but check and off. | red then green |
| AC-30 | behavior | doctor prints a check update: warn when a release is out, ok otherwise, the failed check included, and its exit code is what it is without that check; the checks runChecks returns do not include it. wizardingcode-mem update asks now, prints the lines and the four commands, and exits 1 when its check failed or its result could not be recorded; with the key off it asks nothing, prints the off line and how to turn the check on where the value was set (the file, or this environment), prints no commands, and exits 0. | red then green |
| AC-31 | behavior | updateLine gives line 1 by the Design's first table, top to bottom: off from the file; off from the environment; an unknown value; a latest known and higher than the current, with and without a failed last check, and with the staged binary answering a version and not; CI with nothing asked; never checked; a failed check with and without a last known version; the latest equal; the latest lower. Line 2 follows the second table: none for the staged binary itself, for no staged file and for equal versions; the plain sentence for a higher staged version; wizardingcode-mem install moves them to it for a lower one; wizardingcode-mem install replaces it for a staged file that answers no version. status prints them with the commands when a release is out; with a store that cannot be opened it still prints them and exits 1, and status --json then prints one object with version, update and error. No command but install stages a binary. | red then green |
| AC-32 | behavior | status, doctor and update do not run the staged file when the command runs as root or when <data dir>/bin belongs to another user: the report says the staged binary was not run and why, and takes the running copy as the current version. A report that cannot be built is said with its reason in status, as in doctor, and a reconciliation that throws lets the command run in this copy. | red then green; the red recorded 2 times (the latest decides); the green recorded 2 times (the latest decides) |

## Gates

| Gate | Target | Status | Command | Duration | Log |
| :- | :- | :- | :- | -: | :- |
| secrets | . | pass | `built-in secret scan` | 58 ms |  |
| prose | . | pass | `built-in prose scan` | 54 ms |  |
| build | . | pass | `bun run build` | 2734 ms | logs/build-_-1794511473499.txt |
| test | . | pass | `bun run test` | 225446 ms | logs/test-_-1794511476266.txt |
| lint | . | pass: 1 untouched file with problems, none of the item's | `bun run lint` | 95 ms | logs/lint-_-1794511701712.txt |
| typecheck | . | pass | `bun run typecheck` | 393 ms | logs/typecheck-_-1794511701809.txt |

## Judgement gates

| Gate | Verdict | Reviewer | Findings | Tokens |
| :- | :- | :- | -: | -: |
| code-quality | proven | review-code-quality | 1 | 373830 |
| test-quality | proven | review-test-quality | 5 | 392567 |
| security | proven | review-security | 4 | 311662 |
| risk | proven | review-risk | 5 | 423541 |
| architecture | proven | review-architecture | 0 | 458079 |
| infra | proven | review-infra | 3 | 356928 |

- code-quality: src/update/reason.ts:5 Advisory, as filed (question 2). `reason` repeats `firstLine`'s one-line body instead of calling `firstLine`. The rubric treats duplicated boilerplate as advisory. The round 2 advisories are resolved. (advisory)
- test-quality: tests/unit/update-report.test.ts:228 Advisory, as filed. The owner case would fail when the suite runs as root, because it is skipped only on Windows. That is an environment gap, not a test that passes by construction or survives reversion. Both of round 2's defects are resolved: I confirmed `describe("stagedFacts")` at tests/unit/update-report.test.ts:211 and the throwing-build `status` case at tests/integration/update-command.test.ts:279. (advisory)
- test-quality: tests/unit/update-reconcile.test.ts:50 Advisory, as filed. The `realpathSync` step in `gather` is still not exercised. Recorded as deferred. (advisory)
- test-quality: tests/e2e/update-reconcile.test.ts:101 Advisory, as filed. AC-31 is pinned only through `status`. Recorded as deferred. (advisory)
- test-quality: tests/e2e/install-forward.test.ts:1247 Advisory, as filed (questions 5 and 6). The test asserts the observable hand-over, not that `handOver` is the function used. Recorded as deferred. (advisory)
- test-quality: tests/unit/settings.test.ts:1733 Advisory, as filed. Temporary folders are not removed. This is fixture hygiene, recorded as deferred. (advisory)
- security: src/update/staged.ts:58 Advisory, as filed. The root and owner guard is intact after the move. `who` defaults to the real effective user, and no argument or environment variable can supply it. (advisory)
- security: src/update/reconcile.ts:94 Advisory, as filed. `WIZARDINGCODE_MEM_HANDED` is now read and removed before the guarded look at the machine, so a failing look no longer leaves it for child processes. This is a hardening. (advisory)
- security: src/cli/commands/status.ts:44 Advisory, as filed (public-api, question 6). `status --json` gains an additive `update` field, and a store error now writes JSON to stdout. It is documented and recorded as deferred, and no field is removed or changed. (advisory)
- security: src/install/binary.ts:52 Advisory, debt (outside the change). `stageBinary` still runs the staged file's `--version` with no root or owner check. Recorded as deferred. (advisory)
- risk: src/update/check.ts:120 Advisory, as filed. When the data directory cannot be written, the log gets one entry per turn and nothing caps the repetition. The spec's Limits state it, and it is recorded as deferred. (advisory)
- risk: src/update/reconcile.ts:104 Advisory, as filed. A hung staged binary can delay a command by up to about 20 s. This is a stated limit, bounded in the code. (advisory)
- risk: src/install/binary.ts:45 Advisory, debt (outside the change). `stageBinary` (and so `install`) still runs `--version` with no root or owner check. Recorded as deferred. (advisory)
- risk: src/install/binary.ts:45 Advisory, debt (outside the change). Two writers can collide on the fixed `<target>.new` name. Recorded as deferred. (advisory)
- risk: tests/helpers/cli.ts:52 Advisory, debt (outside the change). `spawnCli` does not pass on the preload's `WIZARDINGCODE_MEM_UPDATE=off`. Recorded as deferred. (advisory, outside the change)
- infra: docs/runbooks/release.md:80 Advisory, as filed (question 4). The rollback for a wrong notice is stated but has never been run, and the runbook says so. (advisory, outside the change)
- infra: src/cli/commands/distill.ts:210 Advisory, as filed (question 1). The suite stays offline through the preload and the copied environment, and CI stays offline through `mode()` returning `ci`. Recorded as deferred. (advisory)
- infra: .github/workflows/release.yml:148 Advisory, debt (outside the change). A plain release on an older line becomes GitHub's latest and moves the notice back. The runbook names the manual correction. (advisory, outside the change)

## Verifications

| What | Ref | Answer | Confidence | Model | At |
| :- | :- | :- | -: | :- | :- |
| knowledge | K-391 | yes 0.79 | - | jev-1.14.0 | 2026-11-12T17:55:07.122Z |
| knowledge | K-390 | yes 0.76 | - | jev-1.14.0 | 2026-11-12T17:55:07.122Z |
| knowledge | K-381 | no 0.80 | - | jev-1.14.0 | 2026-11-12T17:55:07.122Z |
| knowledge | K-363 | no 0.71 | - | jev-1.14.0 | 2026-11-12T17:55:07.122Z |
| knowledge | K-383 | yes 0.72 | - | jev-1.14.0 | 2026-11-12T17:55:07.122Z |
| knowledge | K-376 | yes 0.69 | - | jev-1.14.0 | 2026-11-12T17:55:07.122Z |
| knowledge | K-375 | yes 0.71 | - | jev-1.14.0 | 2026-11-12T17:55:07.122Z |
| knowledge | K-372 | no 0.80 | - | jev-1.14.0 | 2026-11-12T17:55:07.122Z |
| knowledge | K-371 | no 0.75 | - | jev-1.14.0 | 2026-11-12T17:55:07.122Z |
| knowledge | K-343 | no 0.84 | - | jev-1.14.0 | 2026-11-12T17:55:07.122Z |
| validator | complete-gap-round v1 | yes 0.99 | 0.99 | jev-1.14.0 | 2026-11-12T18:18:08.329Z |
| validator | complete-gap-round v2 | no 0.74 | 0.26 | jev-1.14.0 | 2026-11-12T18:18:08.330Z |
| defect | code-quality src/install/binary.ts:18 | yes 0.88 | 0.88 | jev-1.14.0 | 2026-11-12T19:10:40.142Z |
| defect | code-quality src/update/report.ts:98 | yes 0.90 | 0.90 | jev-1.14.0 | 2026-11-12T19:10:40.142Z |
| defect | code-quality src/cli/commands/status.ts:20 | yes 0.53 | 0.53 | jev-1.14.0 | 2026-11-12T19:10:40.142Z |
| defect | test-quality tests/integration/update-command.test.ts:86 | yes 0.96 | 0.96 | jev-1.14.0 | 2026-11-12T19:10:40.142Z |
| defect | security src/update/report.ts:30 | yes 0.97 | 0.97 | jev-1.14.0 | 2026-11-12T19:10:40.142Z |
| defect | test-quality tests/unit/update-report.test.ts:163 | yes 0.97 | 0.97 | jev-1.14.0 | 2026-11-12T19:23:31.030Z |
| defect | test-quality tests/integration/update-command.test.ts:222 | yes 0.96 | 0.96 | jev-1.14.0 | 2026-11-12T19:23:31.030Z |

## Team

- Primary team: backend (the session)

| Seat | Team | Reason |
| :- | :- | :- |
| researcher | researchers | full route |
| review-code-quality | backend | full route |
| review-test-quality | qa | full route |
| review-security | security | full route |
| review-risk | architects | full route |
| review-architecture | architects | full route |
| review-infra | devops | risk area infra |
| lead-qa | qa | full route |
| lead-security | security | full route |
| lead-architects | architects | full route |
| lead-devops | devops | risk area infra |
| judge |  | a gate is planned |

- Rounds: judgement 3 of 2, validation 3 of 2
- Runtimes: claude (context at start: enforced; the status line per prompt: enforced; the denial of engine files: enforced; the denial of forbidden commands: enforced; the hold at Stop: enforced; the roles' answers filed: enforced; the roles read-only: enforced)

## Validations

| What | By | Verdict | Returns | Round | File |
| :- | :- | :- | -: | -: | :- |
| spec | lead-qa | returned | 7 | 1 | conclave/lead-qa.md |
| spec | lead-security | returned | 3 | 1 | conclave/lead-security.md |
| spec | lead-architects | returned | 6 | 1 | conclave/lead-architects.md |
| spec | lead-devops | returned | 3 | 1 | conclave/lead-devops.md |
| spec | lead-qa | returned | 1 | 2 | conclave/lead-qa-reply.md |
| spec | lead-security | validated | 0 | 2 | conclave/lead-security-reply.md |
| spec | lead-architects | validated | 0 | 2 | conclave/lead-architects-reply.md |
| spec | lead-devops | validated | 0 | 2 | conclave/lead-devops-reply.md |
| spec | lead-qa | validated | 0 | 3 | conclave/lead-qa-reply.md |
| spec | lead-security | validated | 0 | 3 | conclave/lead-security-reply.md |
| spec | lead-architects | validated | 0 | 3 | conclave/lead-architects-reply.md |
| spec | lead-devops | validated | 0 | 3 | conclave/lead-devops-reply.md |

## Gap round

- D-1: The scope after six lenses found four blockers in the self-replacement (D-6 of 2026-11-11-004): tell and add two pieces with no network, replace only where no channel manager exists, or keep the self-replacement on every channel? → Avisar + sem rede: this item tells (status, doctor, About) and adds the two pieces with no network (a newer Homebrew or npm copy stages itself when run; any command of an older copy hands over to the newer staged binary); the automatic replacement becomes an item of its own, after signatures or a hold signal exist. The author's choice in the question dialog on 2026-11-12., by the user, relayed by the agent
- D-2: The default of WIZARDINGCODE_MEM_UPDATE for the daily request to github.com: on (notice only) or off? → Ligada, só aviso: it checks once a day and shows the released version, never replaces anything; the README names the request among its exceptions; off with the key, and off in CI. The author's choice in the question dialog on 2026-11-12., by the user, relayed by the agent
- D-3: A newer channel copy run with status or doctor: does it stage itself (the hooks then run it at once, in the open session, while that session's MCP server, sync and viewer stay on the old one), or does it only tell? → Só avisa: status and doctor from a newer copy say which version the agents run and that wizardingcode-mem install moves them; nothing changes without an explicit command, as today. The author's choice in the question dialog on 2026-11-12, after the review's design reader showed the staging would take effect in the open session., by the user, relayed by the agent
- Debate: none

## Roles

| Role | Model | Personality | At | Tokens | Answer | Filed by |
| :- | :- | :- | :- | -: | :- | :- |
| goldfish-structural | claude-opus-5-5 | - | 2026-11-12T17:57:30.095Z | 35269 | spec-review/brainstorm-goldfish-structural.md | hook |
| goldfish-comprehension | claude-opus-5-5 | - | 2026-11-12T17:57:33.285Z | 48282 | spec-review/brainstorm-goldfish-comprehension.md | hook |
| goldfish-zoom-out | claude-opus-5-5 | - | 2026-11-12T17:58:28.941Z | 71836 | spec-review/brainstorm-goldfish-zoom-out.md | hook |
| goldfish-design | claude-opus-5-5 | - | 2026-11-12T17:59:04.586Z | 68202 | spec-review/brainstorm-goldfish-design.md | hook |
| goldfish-readiness | claude-opus-5-5 | - | 2026-11-12T17:59:11.133Z | 84018 | spec-review/brainstorm-goldfish-readiness.md | hook |
| goldfish-codebase | claude-opus-5-5 | - | 2026-11-12T17:59:47.519Z | 100232 | spec-review/brainstorm-goldfish-codebase.md | hook |
| tech-lead | claude-fable-5-2 | - | 2026-11-12T18:12:25.534Z | 82600 | conclave/lead-security.md | hook |
| tech-lead | claude-fable-5-2 | - | 2026-11-12T18:12:35.207Z | 94788 | conclave/lead-architects.md | hook |
| tech-lead | claude-fable-5-2 | - | 2026-11-12T18:12:44.889Z | 91910 | conclave/lead-devops.md | hook |
| tech-lead | claude-fable-5-2 | - | 2026-11-12T18:13:35.083Z | 99664 | conclave/lead-qa.md | hook |
| tech-lead | claude-fable-5-2 | - | 2026-11-12T18:16:34.280Z | 100674 | conclave/lead-security-reply.round2.md | hook |
| tech-lead | claude-fable-5-2 | - | 2026-11-12T18:16:34.320Z | 115619 | conclave/lead-architects-reply.round2.md | hook |
| tech-lead | claude-fable-5-2 | - | 2026-11-12T18:16:45.276Z | 117224 | conclave/lead-devops-reply.round2.md | hook |
| tech-lead | claude-fable-5-2 | - | 2026-11-12T18:17:09.001Z | 129091 | conclave/lead-qa-reply.round2.md | hook |
| tech-lead | claude-fable-5-2 | - | 2026-11-12T18:17:51.096Z | 126288 | conclave/lead-architects-reply.md | hook |
| tech-lead | claude-fable-5-2 | - | 2026-11-12T18:17:53.631Z | 129547 | conclave/lead-devops-reply.md | hook |
| tech-lead | claude-fable-5-2 | - | 2026-11-12T18:17:55.578Z | 112203 | conclave/lead-security-reply.md | hook |
| tech-lead | claude-fable-5-2 | - | 2026-11-12T18:17:56.728Z | 142071 | conclave/lead-qa-reply.md | hook |
| goldfish-zoom-out | claude-opus-5-5 | - | 2026-11-12T18:20:38.314Z | 52722 | spec-review/goldfish-zoom-out.round2.md | hook |
| goldfish-structural | claude-opus-5-5 | - | 2026-11-12T18:21:31.359Z | 33926 | spec-review/goldfish-structural.round2.md | hook |
| goldfish-style | claude-opus-5-5 | - | 2026-11-12T18:21:43.190Z | 37093 | spec-review/goldfish-style.round2.md | hook |
| goldfish-design | claude-opus-5-5 | - | 2026-11-12T18:23:00.054Z | 63645 | spec-review/goldfish-design.round2.md | hook |
| goldfish-readiness | claude-opus-5-5 | - | 2026-11-12T18:25:50.254Z | 94997 | spec-review/goldfish-readiness.round2.md | hook |
| goldfish-codebase | claude-opus-5-5 | - | 2026-11-12T18:27:13.895Z | 134044 | spec-review/goldfish-codebase.round2.md | hook |
| goldfish-zoom-out | claude-opus-5-5 | - | 2026-11-12T18:32:09.326Z | 51360 | spec-review/goldfish-zoom-out.round3.md | hook |
| goldfish-structural | claude-opus-5-5 | - | 2026-11-12T18:33:02.264Z | 39135 | spec-review/goldfish-structural.round3.md | hook |
| goldfish-style | claude-opus-5-5 | - | 2026-11-12T18:33:06.558Z | 37848 | spec-review/goldfish-style.round3.md | hook |
| goldfish-design | claude-opus-5-5 | - | 2026-11-12T18:34:38.129Z | 65531 | spec-review/goldfish-design.round3.md | hook |
| goldfish-zoom-out | claude-opus-5-5 | - | 2026-11-12T18:38:10.687Z | 61743 | spec-review/goldfish-zoom-out.md | hook |
| goldfish-structural | claude-opus-5-5 | - | 2026-11-12T18:39:03.788Z | 34938 | spec-review/goldfish-structural.md | hook |
| goldfish-style | claude-opus-5-5 | - | 2026-11-12T18:39:25.308Z | 39098 | spec-review/goldfish-style.md | hook |
| goldfish-design | claude-opus-5-5 | - | 2026-11-12T18:40:53.321Z | 61371 | spec-review/goldfish-design.md | hook |
| goldfish-readiness | claude-opus-5-5 | - | 2026-11-12T18:44:40.973Z | 106987 | spec-review/goldfish-readiness.md | hook |
| goldfish-codebase | claude-opus-5-5 | - | 2026-11-12T18:45:54.482Z | 180339 | spec-review/goldfish-codebase.md | hook |
| review-architecture | claude-opus-5-5 | - | 2026-11-12T19:08:16.192Z | 119216 | review/architecture.findings.md | hook |
| review-security | claude-opus-5-5 | - | 2026-11-12T19:08:25.548Z | 82127 | review/security.findings.md | hook |
| review-infra | claude-opus-5-5 | - | 2026-11-12T19:08:28.180Z | 92194 | review/infra.findings.md | hook |
| review-code-quality | claude-opus-5-5 | - | 2026-11-12T19:08:29.449Z | 89323 | review/code-quality.findings.md | hook |
| review-test-quality | claude-opus-5-5 | - | 2026-11-12T19:08:31.442Z | 103765 | review/test-quality.findings.md | hook |
| review-risk | claude-opus-5-5 | - | 2026-11-12T19:08:58.323Z | 114504 | review/risk.findings.md | hook |
| judge | claude-opus-5-5 | - | 2026-11-12T19:10:18.411Z | 81802 | review/ruling.json | hook |
| review-security | claude-opus-5-5 | - | 2026-11-12T19:21:48.885Z | 170532 | review/security.findings.md | hook |
| review-infra | claude-opus-5-5 | - | 2026-11-12T19:21:51.293Z | 199136 | review/infra.findings.md | hook |
| review-architecture | claude-opus-5-5 | - | 2026-11-12T19:21:52.156Z | 259986 | review/architecture.findings.md | hook |
| review-code-quality | claude-opus-5-5 | - | 2026-11-12T19:21:58.291Z | 200755 | review/code-quality.findings.md | hook |
| review-risk | claude-opus-5-5 | - | 2026-11-12T19:22:00.144Z | 241556 | review/risk.findings.md | hook |
| review-test-quality | claude-opus-5-5 | - | 2026-11-12T19:22:11.069Z | 222357 | review/test-quality.findings.md | hook |
| judge | claude-opus-5-5 | - | 2026-11-12T19:23:09.659Z | 181108 | review/ruling.json | hook |
| review-test-quality | claude-opus-5-5 | - | 2026-11-12T19:29:05.691Z | 344495 | review/test-quality.findings.md | hook |
| review-architecture | claude-opus-5-5 | - | 2026-11-12T19:29:06.458Z | 410007 | review/architecture.findings.md | hook |
| review-security | claude-opus-5-5 | - | 2026-11-12T19:29:06.947Z | 263590 | review/security.findings.md | hook |
| review-infra | claude-opus-5-5 | - | 2026-11-12T19:29:07.717Z | 308856 | review/infra.findings.md | hook |
| review-risk | claude-opus-5-5 | - | 2026-11-12T19:29:08.243Z | 375469 | review/risk.findings.md | hook |
| review-code-quality | claude-opus-5-5 | - | 2026-11-12T19:29:08.610Z | 325758 | review/code-quality.findings.md | hook |
| judge | claude-opus-5-5 | - | 2026-11-12T19:29:45.427Z | 288432 | review/ruling.json | hook |

## Decisions

- spec approved by the validator (rule: complete-gap-round) (2026-11-12T18:18:08.332Z): counted, a person was present
- AC-1 (behavior) removed (2026-11-12T18:15:45.526Z): latestRelease answers the version for a redirect to https://github.com/<repository>/releases/tag/v<plain version>, and a reason for anything else: a 200, a 404, a 429, a redirect to another host or path, a pre-release tag, a request that throws, a request that passes 5 seconds. It never follows the redirect and never reads a body.
- AC-2 (behavior) removed (2026-11-12T18:15:45.579Z): checkForRelease makes a request only when due (no state, a time in the future, 24 hours after a success, the backoff after a failure) and writes the result to <data dir>/update.json: a success records the latest and clears the failures; a failure keeps the last known version, records the reason and counts.
- AC-3 (behavior) removed (2026-11-12T18:15:45.632Z): checkForRelease makes no request when WIZARDINGCODE_MEM_UPDATE is off (from the environment or <data dir>/env), when it holds an unknown value, or when CI is set; the settings refuse any value of the key but check and off.
- AC-4 (behavior) removed (2026-11-12T18:15:45.685Z): wizardingcode-mem distill runs the check as a step after the drain, and a check that throws does not change its exit code.
- AC-5 (behavior) removed (2026-11-12T18:15:45.739Z): updateLine gives the sentences of the spec for: up to date, a release out, a failed check with and without a last known version, never checked, off, CI; and the second line when the running copy and the staged binary differ. status prints them, and the commands when a release is out.
- AC-6 (behavior) removed (2026-11-12T18:15:45.792Z): doctor has a check update: warn when a release is out, ok otherwise, the failed check included; wizardingcode-mem update checks now, prints the lines and the four commands, makes no request when off, and exits 1 only when its check failed.
- AC-7 (behavior) removed (2026-11-12T18:15:45.846Z): A command a person runs from a compiled copy outside the data directory, with the staged binary older, missing or answering no version, stages that copy, prints on standard error that the version is now in the path with what was there, and runs the command; two stagings at once leave a whole binary.
- AC-8 (behavior) removed (2026-11-12T18:15:45.899Z): A command a person runs from a copy older than the staged binary prints on standard error that it runs the staged version, and runs the staged binary with the same arguments, returning its exit code; the staged binary, started so, does not hand over again; hook, mcp, tool, distill, sync, serve and ui --auto never stage and never hand over.
- AC-9 (behavior) removed (2026-11-12T18:15:45.953Z): The README says the daily request in its network bullet and its header no longer says nothing leaves your machine; its settings table has WIZARDINGCODE_MEM_UPDATE; every command of CHANNEL_COMMANDS is in the README; ADR 0030 exists and names the redirect, update.json and the two rules for a channel copy; CLAUDE.md names src/update/.
- AC-11 (behavior) removed (2026-11-12T18:29:33.406Z): checkForRelease makes a request only when due (no state; any time in the future; 24 hours after a success; 1, 2, 4, 8, 16 and at most 24 hours after 1 to 6 or more failures), not within 60 seconds of an attempt, and writes the result to <data dir>/update.json: a success records the latest, even a lower one, and clears the failures; a failure keeps the last known version, records the reason and counts. A state file whose latest or reason holds any other text, an escape sequence or a line break included, reads as no state.
- AC-14 (behavior) removed (2026-11-12T18:29:33.461Z): updateLine gives the sentences of Design 2 for: the latest equal to, higher than and lower than the current version, with the staged binary answering a version and not; a failed check with and without a last known version; never checked; off; an unknown value; CI; and the second line when the running copy is not the staged binary and their versions differ. status prints them, also when the store cannot be opened, with the commands when a release is out, and status --json carries the update fields.
- AC-15 (behavior) removed (2026-11-12T18:29:33.519Z): doctor has a check update: warn when a release is out, ok otherwise, the failed check included, and its exit code stays 0 with that warning alone; wizardingcode-mem update checks now, prints the lines and the four commands, makes no request when off, and exits 1 only when its check failed.
- AC-16 (behavior) removed (2026-11-12T18:29:33.578Z): the decision to reconcile is none for every command but status, doctor, update and ui without --auto; and for those, when the process is not compiled, when its real path is the staged binary's, when WIZARDINGCODE_MEM_HANDED is set, when it runs as root, or when <data dir>/bin is not the effective user's. --version, --help, no command and an unknown command never reach it.
- AC-17 (behavior) removed (2026-11-12T18:36:34.504Z): a reconciled command run from a compiled copy outside the data directory, with the staged binary older, missing or answering no version, stages that copy, prints the line of J-5 with what was there, and runs the command; a staging that fails prints one sentence and the command still runs. stageBinary's temporary name carries the process id and is gone after the run; another process's fresh temporary file is neither renamed nor removed; one older than a day is removed.
- AC-20 (behavior) removed (2026-11-12T18:36:34.562Z): no file of src/update/ imports from src/store/, src/modules/, src/engine/ or src/sync/, and src/cli/main.ts has no static import of src/update/ or src/install/binary.ts.
- AC-24 (behavior) removed (2026-11-12T18:36:34.618Z): updateLine gives the lines of the Design's table: off; an unknown value; CI with nothing asked; never checked; a failed check with and without a last known version; the latest equal to, higher than and lower than the current version, with the staged binary answering a version and not; and the second line when this process is not the staged binary and their versions differ. status prints them with the commands when a release is out; with a store that cannot be opened it still prints them and exits 1, and status --json then prints one object with version, update and error.
- AC-12 (behavior) removed (2026-11-12T18:50:15.673Z): checkForRelease makes no request when WIZARDINGCODE_MEM_UPDATE is off or any value but check, from the environment or from <data dir>/env, or when CI is set; the settings refuse any value of the key but check and off.
- AC-22 (behavior) removed (2026-11-12T18:50:15.727Z): checkForRelease makes a request only when due: with no state; with any time in the future; one hour after a failure; 24 hours after a success; and not within 60 seconds of an attempt. It writes the result to <data dir>/update.json: a success records the latest, even a lower one, and clears the failures; a failure keeps the last known version, records the reason and counts. A state file whose latest or reason holds any other text, an escape sequence or a line break included, reads as no state.
- AC-25 (behavior) removed (2026-11-12T18:50:15.780Z): doctor has a check update: warn when a release is out, ok otherwise, the failed check included, and its exit code stays 0 with that warning alone; wizardingcode-mem update checks now, in CI too, prints the lines and the four commands, and exits 1 only when its check failed; with the check off it makes no request, prints the off line and how to turn it on, no commands, and exits 0.
- AC-26 (behavior) removed (2026-11-12T18:50:15.834Z): updateLine gives the lines of the Design's table: off; an unknown value; CI with nothing asked; never checked; a failed check with and without a last known version; the latest equal to, higher than and lower than the current version, with the staged binary answering a version and not. The second line says what the agents run when this process is not the staged binary: with wizardingcode-mem install moves them to it when this copy is newer, with wizardingcode-mem install replaces it when the staged file answers no version, and nothing when the versions are equal or no staged file exists. status prints them with the commands when a release is out; with a store that cannot be opened it still prints them and exits 1, and status --json then prints one object with version, update and error. No command but install stages a binary.

## Waits

- for the roles (2026-11-12T19:07:16.624Z), not proven: judgement gate code-quality not run
- for the roles (2026-11-12T19:08:35.626Z), not proven: judgement gate code-quality not run
- for the roles (2026-11-12T19:08:57.638Z), not proven: judgement gate code-quality not run
- for the roles (2026-11-12T19:09:27.161Z), not proven: judgement gate code-quality not run
- for the roles (2026-11-12T19:21:34.998Z), not proven: judgement gate code-quality not run on the current code
- for the roles (2026-11-12T19:22:05.097Z), not proven: judgement gate code-quality not run on the current code
- for the roles (2026-11-12T19:22:29.891Z), not proven: judgement gate code-quality not run on the current code
- for the roles (2026-11-12T19:28:56.487Z), not proven: judgement gate code-quality not run on the current code
- for the roles (2026-11-12T19:29:28.035Z), not proven: judgement gate code-quality not run on the current code

Fingerprint: sha256:15f04ea811bc559ec5e2d2ee47383a6de821275cf2d6882bc48334c34920e04e
