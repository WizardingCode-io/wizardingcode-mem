# Brief

## Request

Harden the release's distribution after its first review (follow-up of 2026-11-12-004, the rows of 2026-11-12 in docs/real-use/findings.md). Four changes, no change to what is distributed. (1) scripts/release/push.ts registers the base64 form of the token's authorization header with the runner's ::add-mask:: before the first git call, so a git trace or a debug re-run cannot print a write credential in a public log. (2) The command of scripts/release/push.ts no longer reads PUSH_REMOTE and PUSH_ORIGIN at all: its test reaches local repositories another way. (3) The distribute job of .github/workflows/release.yml gets timeout-minutes, as every job of distribute.yml has. (4) scripts/install.sh and stageBinary (src/install/binary.ts) read a staged binary's version by one rule: exit status 0 and an answer that is a version and nothing else.

## Assumptions

- The request's change 4 (one rule for reading a staged binary's version) is not built here. Six lenses showed it needs a shared table of answers across five readers, one normalisation, a common time limit and a test harness the OpenCode package lacks. It moves to the next item of the parent concept (the client learns of a release and replaces its staged binary). The author was told on 2026-11-12 and can reverse this before the spec is approved.
- Change 1 is built as a redaction inside the script plus the runner's mask line, since nothing shows the mask covers the step summary.
- Change 2 leaves `gitEnv` as it is; the command's test checks the wiring with a stub `git`.
- A second `distribute.yml` run for a tag is harmless: every target answers "already at" (held by the parent item's tests).
