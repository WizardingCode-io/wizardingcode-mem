# risk findings for 2026-11-12-006-the-client-learns-of-a-release-and-its-s
reviewer: review-risk
read: spec, plan, 35 files

## Findings
- F-1 · advisory · src/cli/main.ts:94 · `reconcile(argv)` runs outside any guard. If it throws (a `realpathSync` of the staged path or of `process.execPath` fails, or the staged file disappears between `existsSync` and `realpathSync`), `status`, `doctor`, `update` and `ui` fail as a whole before the command loads, instead of skipping the hand-over and running in this copy. The error is visible but it costs the person their diagnostic command. `stagedFacts` in `src/cli/commands/update.ts:384` has the same gap; in `status` and `doctor` it sits inside a `try`.
- F-2 · advisory · docs/adr/0030-release-notice.md:112 · No document names a way for a person on an older copy to run their own copy's `status` or `doctor` when a newer staged binary is broken for those commands, since the hand-over always goes to it. The way back that exists is `install --force` (ADR 0029 and the runbook). The bypass `WIZARDINGCODE_MEM_HANDED=1` works but is stated nowhere for a person. The rollback exists but is manual and half-documented.
- F-3 · advisory · src/update/check.ts:833 · When the data directory cannot be written, every `distill` (one per ended turn) fails to write the attempt. It logs `update.check` each time and never records `attemptAt`, so neither the 60-second window nor the hourly backoff applies: the log gets one entry per turn and `status` says "not checked yet" indefinitely. The spec's Limits state this as "the reason is in the log", so it is seen, but nothing limits the repetition.
- F-4 · advisory · src/update/reconcile.ts:948 · On a channel copy, a reconciled command runs the staged binary's `--version` up to twice (once in `reconcile`, once in `stagedFacts`), each with a 10-second limit. A staged binary that hangs therefore delays `status` or `doctor` by up to about 20 seconds with no line saying why. The spec states the "at most twice, 10 s each" bound; this is not a defect.

## Outside the change
- src/install/binary.ts:45 · `stageBinary` copies through the fixed name `<target>.new`, which two writers can collide on. Recorded as deferred in `docs/real-use/findings.md`.
- tests/helpers/cli.ts:52 · `spawnCli` gives the child a whole environment and inherits nothing, so the preload's `WIZARDINGCODE_MEM_UPDATE=off` does not reach a `distill` or `update` started through it. No current test does so, but the guard depends on each new test setting the key itself.

## Not answerable
- Third parties: cost and rate · github.com's rate limit per address, and its answer while a release's assets upload, cannot be seen before the first real release. The spec states this, and the author is to check it with `wizardingcode-mem update` on that release.
- Rollback: withdrawing a release notice · `gh release edit <previous tag> --latest` has never been run. The runbook (`docs/runbooks/release.md`) says so and names the author's check on the first release. Only macOS arm64 was tried against the real redirect (`probes/build-notes.md`).
