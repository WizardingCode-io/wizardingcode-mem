

## Clarifications
- # risk findings for 2026-11-12-006-the-client-learns-of-a-release-and-its-s
  reviewer: review-risk
  read: spec, plan, 37 files
  
  ## Findings
  - F-1 · advisory · src/update/check.ts:124 · When the data directory cannot be written, every `distill` (one per ended turn) fails to write `attemptAt`, so neither the 60-second window nor the hourly backoff ever applies: the log gets an `update.check` entry per turn and `status` keeps saying "not checked yet". This is visible in the log and stated in the spec's Limits, and now recorded as deferred in `docs/real-use/findings.md`. There is still no cap on the repetition.
  - F-2 · advisory · src/update/reconcile.ts:972 · On a channel copy, a reconciled command still runs the staged binary's `--version` up to twice (once in `reconcile`, once in `stagedFacts`), each with a 10-second limit. A staged binary that hangs therefore delays `status` or `doctor` by up to about 20 seconds with no line saying why. This is a stated limit, bounded in the code.
  
  Round 1's F-1 is resolved: `reconcile` now catches a throw from its look at the machine and the command runs in this copy, and `update` builds its report through `reportOrReason`. Round 1's F-2 is resolved: `WIZARDINGCODE_MEM_HANDED=1` is documented in the README's install section and in ADR 0030's Limits, beside `install --force` as the way back. The new `mayRunStaged` (AC-32) removes the earlier path where `status` or `doctor` run as root would execute a file in the user's data directory. Nothing in this round adds an irreversible write, an unhandled third-party answer, or an undeclared dependency between deploys.
  
  ## Outside the change
  - src/install/binary.ts:45 · `stageBinary`, and so `install` (`sudo -E wizardingcode-mem install`), still runs the staged file's `--version` with no root or owner check. Recorded as deferred.
  - src/install/binary.ts:45 · `stageBinary` copies through the fixed name `<target>.new`, which two writers can collide on. Recorded as deferred.
  - tests/helpers/cli.ts:52 · `spawnCli` passes the child a whole environment and inherits nothing, so the preload's `WIZARDINGCODE_MEM_UPDATE=off` does not reach a `distill` or `update` started through it. Recorded as deferred.
  
  ## Not answerable
  - Third parties: rate and cost · github.com's rate limit per address, and its answer while a release's assets upload, cannot be seen before the first real release. The spec states this; the author is to check it with `wizardingcode-mem update` on that release.
  - Rollback: withdrawing a notice · `gh release edit <previous tag> --latest` has never been run. The runbook (`docs/runbooks/release.md`) says so and names the author's check on the first release. Only macOS arm64 was tried against the real redirect (`probes/build-notes.md`).
