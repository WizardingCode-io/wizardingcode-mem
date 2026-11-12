# Concept brief: harden the release's distribution after its first review

## Overview

Item `2026-11-12-004` (the release distributes itself; ADR 0029, `docs/runbooks/release.md`) was merged on 2026-11-12 as pull request 38. Its judgement rounds left advisories, recorded as deferred in `docs/real-use/findings.md` (rows of 2026-11-12, "release distribution"). The hypothesis (`probes/concept.md`) took four of them. Six lenses read it. This brief keeps three, changes the mechanism of two of those, and moves the fourth to the next item.

What this item does, none of it changing what is distributed:

1. **The token's encoded form cannot reach the run's log or its summary through this script.** `scripts/release/push.ts` hands git the marketplace token as `Authorization: Basic <base64("x-access-token:" + token)>` in the child's environment. Actions masks the secret's raw value, not this form. One function derives the encoded value; the header and everything below are built from it. Every text git answers is passed through a redaction of that value before it can enter a failure sentence (printed, and appended to `GITHUB_STEP_SUMMARY`). On a runner (`GITHUB_ACTIONS` is `true`) with a token set, the command also prints `::add-mask::<encoded value>` on standard output as its first line, on a dry run too, before any git call.
2. **The command of `push.ts` reads no destination from the environment.** `PUSH_REMOTE` and `PUSH_ORIGIN` are removed. `gitEnv` is not changed: it keeps setting `GIT_CONFIG_COUNT` to 1, which discards any `GIT_CONFIG_KEY_n` the step's environment carries. The command's test checks the wiring with the stub `git` it already has (the two github.com URLs and the target's edit reach git); real writes stay tested through `commitAndPush` against local repositories, as `tests/integration/release-push.test.ts` already does.
3. **The dispatching job has a time limit.** `timeout-minutes: 5` on `release.yml`'s job `distribute`, and one line in the runbook for the case where it is cut: look for a `distribute.yml` run for the tag before starting another; a second run for the same tag is harmless, because every target answers "already at".

## Analysis

**The mask (design, zoom-out, comprehension, readiness).** The concept contradicted itself: git redacts `Authorization` in its curl traces unless `GIT_TRACE_REDACT=0`, so a trace alone prints nothing. The exposures are redaction turned off, or git's standard error quoting the header, and that text goes to two places: the log, and the step summary through `command()` and `summary()` in `scripts/release/lib.ts`. Whether `::add-mask::` covers the summary file could not be shown by any lens. The redaction inside the script answers that without depending on the runner, and a test can hold it: a stub `git` that prints the header and fails, then no output and no summary file carries the encoded value. The mask line stays as defence in depth for anything else in the job, in the pattern `actions/checkout` follows. Masking is by line and by exact value: a later change that builds another form of the credential (a `Bearer` header, a URL with userinfo) must add its own. `GITHUB_ACTIONS=true` is also set by local emulators; whoever sets it declares a runner, and the line is then printed on their terminal. `scripts/release/token.ts`, which runs earlier in the same jobs, passes the raw token to `gh` in `GH_TOKEN` and builds no derived form. A test cannot observe that the line precedes git's work, only that it is the first line of standard output when the stub `git` fails at once; that the runner honours it is seen only in a real run.

**The test override (zoom-out, design, readiness, structural).** Three lenses found the concept's mechanism wrong. Making `gitEnv` append after an inherited `GIT_CONFIG_COUNT` would let a `url.<x>.insteadOf` in the step's environment redirect the token's clone and push, on a runner too, and would keep a second `http.https://github.com/.extraheader` if one were inherited. That is weaker than today's code and would have been shipped as hardening. It is dropped. The gain of removing the two variables is stated as it is: no named test knob is left in the command. It is not a narrower threat, since `GIT_CONFIG_GLOBAL`, `GIT_CONFIG_PARAMETERS` or the home's `.gitconfig` still reach git for whoever controls the step's environment. The case "on a runner the two test overrides are ignored" (`tests/integration/release-commands.test.ts`) tests a mechanism that no longer exists and is replaced by the wiring case; the three local-repository cases of the command move to `commitAndPush` where they are not already covered there.

**The time limit (design, readiness).** `gh workflow run` only dispatches. If the five minutes run out after GitHub accepted the dispatch, the release's run is red while `distribute.yml` runs, and "re-run failed jobs" dispatches a second one. `distribute.yml`'s concurrency group queues it, and it finds every target already at the version. The runbook says so. `push.ts`'s own git calls have no time limit and are cut only by the job's 15 minutes; that stays open.

**The version a staged binary answers (all six lenses).** The concept called this "align two shell readers". The lenses showed it is more: "trimmed" differs (JavaScript's `.trim()` strips a carriage return and leading blanks, a shell substitution strips only trailing newlines); two readers stop waiting after 10 seconds and three wait for ever; the OpenCode package's `ensureBinary` has no test harness; the plugins' script already rejects a second line, so that case gives no failing test there; `version_of` in `scripts/install.sh` also judges the downloaded binary; under `set -e` the obvious capture of the exit status aborts the installer in the very case meant to be replaced; when a writer replaces a binary "with no version", nothing tells the person. No released binary is affected: each prints its version and one newline and exits 0 (`src/cli/main.ts`). Done properly this needs one table of answers run against the five readers, one definition of the normalisation, a common time limit and a new harness. It moves to piece 2 of the parent concept (the client learns of a release and replaces its staged binary), which must define what the staged binary's version is, for `doctor` and for the replacement.

**Rollout.** `distribute.yml` runs `push.ts` from `main`, so changes 1 and 2 apply to any distribution run after the merge, including a re-run for an older tag. `release.yml` runs from the tag's commit, so the time limit applies to tags cut after the merge. Undoing each is a revert on `main`. No stored format or data moves.

## Goals vs. Non-Goals

Goals:

- The encoded credential is in no text this script prints or writes to the summary, shown by a test; it is registered with the runner's mask.
- The command of `push.ts` takes its two repositories from its code and `GITHUB_REPOSITORY` only.
- `release.yml`'s `distribute` job cannot hold the run past five minutes, and the runbook says what to do when it is cut.
- The rows of `docs/real-use/findings.md` say what was done, and the row of the version rule points to piece 2 with what the lenses found.

Non-goals:

- One rule for reading a staged binary's version (piece 2).
- Isolating the token's git from global and system configuration. The four external writes have never run; changing how git is configured before the first real run adds a risk nothing here can test. Recorded as open.
- A time limit on `push.ts`'s git calls.
- `plan` checking the ruleset on `v*` tags or the tag's own `release.yml` run; `release.yml`'s older jobs (the backlog's debt point); the `latest` job and the retag by digest (piece 3).

## Alternatives Weighed

- **`gitEnv` appends its header after the inherited configuration**, so the command's test can use `url.insteadOf`. Rejected: it lets the environment redirect the token's writer on a runner, the thing the change set out to close.
- **A `credential.helper` that answers the token**, so no encoded form exists in the environment. Rejected for this item: it replaces the authentication of four writes that have never run against GitHub, and git then builds the same header in its own process, where a trace with redaction off would still print it. The mask and the redaction are the smaller change.
- **The mask line alone.** Rejected: nothing shows it covers the step summary, where failure sentences with git's standard error are appended.
- **Printing the mask line off a runner as well.** Rejected: on a person's terminal the line is the leak.
- **Keeping the version rule here, limited to the two cases the concept named.** Rejected: it would leave the carriage-return and time-limit disagreements in place and call the rule "one".
- **`timeout-minutes` on every job of `release.yml`.** Rejected here: the other jobs are the debt point, with their own review.

## Key Decisions

- K-1: redaction inside the script is the guarantee; `::add-mask::` is defence in depth. One function derives the encoded value for both and for the header.
- K-2: `gitEnv` keeps overwriting `GIT_CONFIG_COUNT`. `PUSH_REMOTE` and `PUSH_ORIGIN` are deleted, with no replacement seam in the command.
- K-3: five minutes for the dispatch, with the runbook's line; a second distribution for a tag is relied on to be harmless, which the parent item's tests of "already at" hold.
- K-4: the version rule moves to piece 2. This narrows the request as recorded in `brief.md`; the author was told on 2026-11-12 and can reverse it before the spec is approved.
