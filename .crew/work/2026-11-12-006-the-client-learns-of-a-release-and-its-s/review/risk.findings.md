

## Clarifications
- # risk findings for 2026-11-12-006-the-client-learns-of-a-release-and-its-s
  reviewer: review-risk
  read: spec, plan, 39 files
  
  ## Findings
  - F-1 · advisory · src/update/check.ts:120 · When the data directory cannot be written, every `distill` (one per ended turn) fails to write `attemptAt`, so neither the 60-second window nor the hourly backoff ever applies: the log gets an `update.check` entry per turn and `status` keeps saying "not checked yet". It is visible in the log, stated in the spec's Limits and recorded as deferred in `docs/real-use/findings.md`, but nothing caps the repetition.
  - F-2 · advisory · src/update/reconcile.ts:104 · On a channel copy, a reconciled command runs the staged binary's `--version` up to twice (once in `reconcile`, once in `stagedFacts`), each with a 10-second limit. A staged binary that hangs therefore delays `status` or `doctor` by up to about 20 seconds with no line saying why. This is a stated limit, bounded in the code.
  
  As you said, nothing a person sees has changed since round 2. The ownership rule moved to `src/update/staged.ts` and is unchanged (`mayRunStaged`; Windows always allowed; root and another user's folder refused). The new parameters of `stagedFacts` (`who`) and of `status`'s `run` (`build`) default to the real ones. `src/update/reason.ts` keeps the same one-line reductions. `reconcile` now reads and removes `WIZARDINGCODE_MEM_HANDED` before its guarded look at the machine, so a throw there no longer leaves the mark in the environment. This round adds no irreversible write, no unhandled answer from github.com and no undeclared dependency on another deploy.
  
  ## Outside the change
  - src/install/binary.ts:45 · `stageBinary`, and so `install`, still runs the staged file's `--version` with no root or owner check. Recorded as deferred.
  - src/install/binary.ts:45 · `stageBinary` copies through the fixed name `<target>.new`, which two writers can collide on. Recorded as deferred.
  - tests/helpers/cli.ts:52 · `spawnCli` passes the child a whole environment and inherits nothing, so the preload's `WIZARDINGCODE_MEM_UPDATE=off` does not reach a `distill` or `update` started through it. Recorded as deferred.
  
  ## Not answerable
  - Third parties: rate and cost · github.com's rate limit per address, and its answer while a release's assets upload, cannot be seen before the first real release. The spec states this, and the author is to check it with `wizardingcode-mem update` on that release.
  - Rollback: withdrawing a notice · `gh release edit <previous tag> --latest` has never been run. The runbook (`docs/runbooks/release.md`) says so and names the author's check on the first release. The real redirect was only tried from macOS arm64 (`probes/build-notes.md`).
