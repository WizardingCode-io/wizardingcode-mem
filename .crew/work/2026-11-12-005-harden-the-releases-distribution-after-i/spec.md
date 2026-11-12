# Spec: harden the release's distribution after its first review

Predecessor: `concepts_brief.md` in this folder. Parent: item `2026-11-12-004`, ADR 0029 (`docs/adr/0029-release-distribution.md`), `docs/runbooks/release.md`. The "client update item" below is the next item of the parent concept: the client learns of a release and replaces its staged binary.

## Problem

The release's distribution was merged on 2026-11-12 with advisories its reviewers left open. This item takes three, all in code that has never yet run against GitHub:

1. `scripts/release/push.ts` gives git the marketplace token as the header `Authorization: Basic <base64("x-access-token:" + token)>`, in the child's environment. The script puts git's standard error into its failure sentences, which it prints and appends to the run's summary file, and it prints git's `diff` on a dry run. If a git message quotes the header, the encoded credential, which authenticates as the token does, is in that text.
   In the run's log the runner already hides it: it registers the base64 of every secret at three byte alignments (`ValueEncoders.cs` in `actions/runner`, read on 2026-11-12), and the prefix `x-access-token:` is 15 bytes, so the token's base64 sits whole inside the header's. Nothing read shows that the same masking is applied to the step summary file, and off a runner nothing masks anything. The script itself never removes the value from what it emits.
2. `push.ts`'s command reads `PUSH_REMOTE` and `PUSH_ORIGIN` when `GITHUB_ACTIONS` is not `true`, so that its test can write to local repositories. The process that holds the token takes its destination from two variables named in production code.
3. `release.yml`'s job `distribute` (one step, `gh workflow run distribute.yml`) has no `timeout-minutes`. A stalled call holds the release's run for the runner's default of six hours.

## Goals and Non-Goals

Goals:

- G-1: the encoded credential, as `push.ts` builds it, is in no text `push.ts` prints or writes to the summary (AC-9, AC-19).
- G-2: `push.ts`'s command takes its two repositories from its code and `GITHUB_REPOSITORY`, and from nothing else in its environment (AC-11, AC-12, AC-17).
- G-3: `release.yml`'s `distribute` job runs for at most 5 minutes, and the runbook says what to do when it is cut (AC-6, AC-20).
- G-4: the tracked documents say what was done, what rule a later change must keep, and what stays open (AC-21, AC-22).

Non-goals:

- A `::add-mask::` line for the encoded credential (see Alternatives).
- One rule for reading a staged binary's version: moved to the client update item (`concepts_brief.md`, Analysis).
- Isolating the token's git from global and system configuration, and a time limit on `push.ts`'s git calls. This item writes both down as open in `docs/real-use/findings.md` (AC-21).
- Any change to `gitEnv`'s output, to `distribute.yml`, or to what is distributed.
- `plan` checking the ruleset on `v*` tags or the tag's own `release.yml` run; `release.yml`'s other jobs; the `latest` job and the retag by digest.

## Open Questions

None.

## Critical User Journeys

- **J-1, a push fails and git quotes the header.** Given a distribution run with `MARKETPLACE_TOKEN` set and a git whose error text quotes the authorization header, when the clone or the push fails, then the failure sentence on standard error and the line appended to the summary carry `***` where the encoded value was.
- **J-2, a dry run.** Given `dry_run` true and a token, when the command runs, then the status and diff it prints are passed through the same redaction.
- **J-3, a person runs the command with the old variables set.** Given `PUSH_REMOTE` or `PUSH_ORIGIN` in the environment, on or off a runner, when the command runs, then git is asked for the github.com repositories only.
- **J-4, the dispatch stalls.** Given a tag's `release.yml` run whose `gh workflow run` call does not return, when 5 minutes pass, then the job is cut, and the runbook tells the person how to see whether the distribution started and how to start it without harm.

## Design

### 1. The encoded credential is redacted

In `scripts/release/push.ts`, the only file that builds a derived form of the token:

- `encodedCredential(token)`: the base64 of `x-access-token:<token>`. `gitEnv` builds its header from it (its output does not change), so the header and the redaction cannot name different values.
- `redact(text, token)`: `text` with every occurrence of the encoded value replaced by `***`, by literal string replacement. With `token` null, or when the value does not occur, the text is returned unchanged.
- `commitAndPush` wraps the runner once, where it picks `options.runner ?? run`: the standard output and standard error of every git call go through `redact` before any other code reads them, and the environment given to the call is passed through untouched. Every failure sentence and every dry-run line is built from those texts.

The limit is the match: the replacement is exact, so a git text that splits, wraps, truncates or re-encodes the value is not covered, and neither is another form of the credential a later change might build (a `Bearer` header, a URL with userinfo); such a change must add its own redaction. git prints the header whole on one line in its traces, which is the known case. The raw token is not redacted by the script: it is in no URL or argument, and on a runner Actions masks it. `scripts/release/token.ts` passes the raw token to `gh` in `GH_TOKEN` and builds no derived form.

### 2. No destination from the environment

The command passes `REMOTES[target]` and `https://github.com/<GITHUB_REPOSITORY>.git`. The reads of `PUSH_REMOTE`, `PUSH_ORIGIN` and the `onRunner` test around them are deleted.

`gitEnv` is not changed. When a token is set, the calls that carry it (clone, push, `pull --rebase`) get `GIT_CONFIG_COUNT: "1"`, which discards any `GIT_CONFIG_KEY_n` the environment carries for those calls. Every other git call, the `ls-remote` of this repository included, keeps the inherited git configuration; with no token set, so do the clone and the push (`gitEnv` then adds only `GIT_TERMINAL_PROMPT=0`).

No named test knob is left in the command. This is not a boundary against whoever controls the step's environment, who already holds the raw token and can still reach git through `GIT_CONFIG_GLOBAL`, `GIT_CONFIG_PARAMETERS` or a home `.gitconfig`.

The tests that wrote to local repositories through the command move one level down. `editTap` and `editMarketplace` are exported, and the two write cases call `commitAndPush` with them and a local `remote` and `origin`, in `tests/integration/release-push.test.ts` (AC-12). The command keeps cases on a stub `git` that answers `ls-remote` with the judged commit and whose `clone` creates what the edit needs, in `tests/integration/release-commands.test.ts`: the three of AC-17, and the calls git's log shows for each target (AC-11).

### 3. The time limit

`timeout-minutes: 5` on `release.yml`'s `distribute` job, held where the job's shape already is (`tests/unit/deploy-files.test.ts`). `release.yml` runs from the tag's commit, so the limit applies to tags cut after the merge.

`docs/runbooks/release.md` gains one paragraph under "Repeating a target", consistent with that section (only the highest release can be repeated; wait for a run to end before starting another). It says:

- the job that starts the distribution is cut after 5 minutes, and GitHub shows it as cancelled or failed;
- look for the tag's run with `gh run list --workflow distribute.yml` (the run is named `distribute <tag>`), and look again after a minute before starting one, since the dispatch may have been accepted just before the cut;
- if a run exists, the distribution is under way; if none exists, re-run the failed job of `release.yml` or start `distribute.yml` from `main`;
- a second run for the same tag writes nothing the first already wrote and writes what the first had not reached: npm answers `already published`, the tap and the marketplace answer `already at <version>`, and `latest` is tagged again onto the same version's image and answers `latest: moved to <version>` again;
- the exception is "A bad release": after a tap or marketplace write was reverted by hand, or `latest` was moved back by hand, a second run writes it again.

### 4. The documents

- `docs/real-use/findings.md`. The row of 2026-11-12 about the encoded header is answered: it cites item `2026-11-12-005` and says the redaction was added and why no mask line was. The row that today mixes five advisories is split by content: an answered row (`PUSH_REMOTE` and `PUSH_ORIGIN` removed, `timeout-minutes`) citing the item; a row for the reading of a staged binary's version, with the status `deferred, to the client update item` and the points of `concepts_brief.md`'s Analysis (the normalisation, the time limit, one table of answers across the five readers, the OpenCode harness); and the remainder (`decideHold`'s `previous === null` branch, the temporary folders of `deploy-files.test.ts`), still `deferred`. A new `deferred` row names the token's git not isolated from global and system configuration (`GIT_CONFIG_GLOBAL`), no time limit on `push.ts`'s git calls, and `MARKETPLACE_TOKEN` inherited by the git calls that do not carry the header (the security lead's note in `conclave/lead-security.md`). No other row changes.
- `docs/adr/0029-release-distribution.md` (a draft, amended in place), in its Decision paragraph on the token: `push.ts` redacts the encoded credential by exact match from every text git answers, with the limit of Design 1; the runner masks the base64 of a secret itself, so no `::add-mask::` line is printed. In its Limits: the command takes no destination from its environment, and writes are tested through `commitAndPush`.
- The Releasing line of `CLAUDE.md`: the same two rules, in one sentence each.

### Alternatives

- **A `::add-mask::` line** printed by the command on a runner, as `actions/checkout` does for its own header. Rejected: the runner already masks the token's base64 inside the header, so the line adds nothing in the log; it prints the whole encoded credential to standard output on purpose and is safe only while the runner reads that output as a command (not after a `::stop-commands::`, not if a later change captures the step's output); and it needs an ordering rule and a `GITHUB_ACTIONS` gate.
- **`gitEnv` appends its header after the inherited `GIT_CONFIG_COUNT`**, so the command's test can use `url.insteadOf`. Rejected: an inherited `url.<x>.insteadOf` would then redirect the token's clone and push on a runner, which today's overwrite prevents.
- **A `credential.helper` answering the token**, so no encoded form is in the environment. Rejected here: it replaces the authentication of writes that have never run against GitHub, and git still builds the same header in its own process.
- **`timeout-minutes` on every job of `release.yml`.** Rejected here: the other jobs build, sign and publish, each limit needs its own measured duration, and they are listed as debt in `docs/real-use/findings.md` with the jobs' other open points.

## Acceptance criteria

The ids are the engine's; the ids missing from the sequence are retired.

- AC-6 (G-3): `release.yml`'s `distribute` job has `timeout-minutes: 5`.
- AC-9 (G-1): `commitAndPush`, given a token, replaces the encoded credential with `***` in every text git answers: the sentence of a failed tag read, clone, push, rebase and second push, and the lines of a dry run. A text without the value comes back byte for byte, and with no token nothing is replaced.
- AC-11 (G-2): The command asks git for the github.com repositories only: for each target git's log shows `ls-remote --tags` of `https://github.com/<GITHUB_REPOSITORY>.git` and `clone --quiet` of the target's github.com repository, and the path given in `PUSH_REMOTE` or `PUSH_ORIGIN` nowhere, on and off a runner.
- AC-12 (G-2): `editTap` and `editMarketplace` are exported, and `commitAndPush` with them writes the formula and both manifests to a local repository; a second run for the tap answers already-at with no second commit, and a manifest at a higher version is left alone.
- AC-17 (G-2, preserve): On a stub `git` the command keeps its wiring: `--target tap` ends with exit 0, empty standard error and the summary `tap: written, 9.9.9`; `--target marketplace` runs the marketplace edit and writes `marketplace: written, 9.9.9`; a moved tag ends with exit 1 and the summary `tap: failed: v9.9.9 no longer names the commit that was judged`. It holds today and must still hold once the overrides are gone.
- AC-19 (G-1): The command, given a token, lets the encoded credential into none of its output: when git fails quoting the header, standard output, standard error and the summary file carry `***` in its place and the summary says `tap: failed`; on a dry run whose git output quotes the header, the printed lines carry `***` and the summary says `tap: would write 9.9.9 (dry run)`.
- AC-20 (G-3): The release runbook says what to do when the dispatch job is cut: one paragraph under "Repeating a target" names the minutes `release.yml` sets, cites `gh run list --workflow distribute.yml`, and says what a second run for the same tag does at each target (already published, already at, latest moved again) and the exception after a write was reverted by hand.
- AC-21 (G-4): In `docs/real-use/findings.md` the rows of 2026-11-12 that this item answers cite item `2026-11-12-005`, say what was done (the redaction; `PUSH_REMOTE` and `PUSH_ORIGIN` removed; `timeout-minutes`) and no longer have the status `deferred`; the file names what stays open: the reading of a staged binary's version moved to the client update item, `GIT_CONFIG_GLOBAL` not isolated for the token's git, no time limit on `push.ts`'s git calls, `MARKETPLACE_TOKEN` inherited by the calls without the header.
- AC-22 (G-4): ADR 0029 and the Releasing line of `CLAUDE.md` say that `push.ts` redacts the encoded credential by exact match from every text git answers, and that `push.ts`'s command takes no destination from its environment; the ADR also says the runner masks the base64 of a secret itself and why no `::add-mask::` line is printed.

Test files: `tests/integration/release-push.test.ts` for AC-9 and AC-12; `tests/integration/release-commands.test.ts` for AC-11, AC-17 and AC-19; `tests/unit/deploy-files.test.ts` for AC-6; `tests/unit/release-docs.test.ts` for AC-20, AC-21 and AC-22.

## Risks and rollback

- The redaction changes a text only where the encoded value occurs; AC-9 holds a text without it byte for byte.
- That the runner masks the token's base64 inside the header rests on the runner's source as read on 2026-11-12 and on the 15-byte prefix; a prefix whose length is not a multiple of 3 would still be covered by the runner's two shifted forms. It is not tested here. The redaction does not depend on it.
- A dispatch slower than 5 minutes cuts the job though the distribution may have started; the runbook's paragraph is the answer. How long `gh workflow run` takes under GitHub API latency has not been measured; it is seen in real runs.
- Changes 1 and 2 are live for any `distribute.yml` run dispatched after the merge (it runs `push.ts` from `main`), a re-run for an older tag included; a run dispatched before the merge keeps the commit it was dispatched at. Rollback of each is a revert on `main`. For change 3 a revert removes the limit for later tags; a tag already cut keeps its 5 minutes, and the runbook's hand start is the answer there. No stored data or format moves.
- What only the first real release shows: the four external writes of the parent item, and this item's failure sentences as GitHub renders them. The author reads that run's log and summary on the first real release; `docs/runbooks/release.md` ("The first release") already has them read the summary of the dry run before it.

## Non-Functional Requirements

The redaction is one string replacement per git call. Cost: one item, one pull request; nothing is added to a run's duration.
