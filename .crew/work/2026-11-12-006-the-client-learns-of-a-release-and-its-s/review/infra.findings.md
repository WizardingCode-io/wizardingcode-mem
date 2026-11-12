

## Clarifications
- # infra findings for 2026-11-12-006-the-client-learns-of-a-release-and-its-s
  reviewer: review-infra
  read: 10 files. Pipeline and deployment files read: `.github/workflows/ci.yml`, `.github/workflows/release.yml` and `.github/workflows/distribute.yml` (searched for how they run the suite, mark pre-releases and set GitHub's latest), `docs/runbooks/release.md` (the diff), `.crew/profile.json`, `tests/preload.ts`, `tests/helpers/cli.ts`, `tests/helpers/binary.ts`, `tests/e2e/agent.test.ts`, and the round-2 diff (`src/update/reconcile.ts`, `src/update/report.ts`, `docs/real-use/findings.md`, `docs/adr/0030-release-notice.md`)
  
  ## Findings
  - F-1 · advisory · docs/runbooks/release.md:80 · The way to withdraw a wrong notice from every shipped client is written down (`gh release edit <previous tag> --latest`, which also moves what `scripts/install.sh` downloads), but the runbook says this procedure has never been run, so it is unproven until the first real release (rubric question 4: the rollback is stated but not tested; unchanged since round 1).
  - F-2 · advisory · src/cli/commands/distill.ts:210 · Inside the suite, the background check stays off the network only because `tests/preload.ts:14` forces `WIZARDINGCODE_MEM_UPDATE=off` and most helpers copy `process.env` into the child. `spawnCli` copies nothing, so a test that starts `distill` through it on a developer's machine would ask github.com. On the CI runners `CI` is set and `mode()` returns `ci`, so the pipeline itself stays offline. This is now recorded as deferred in `docs/real-use/findings.md:165` (rubric question 1: the pipeline can still run its jobs).
  
  No defects. The round-2 changes to the code add no infra risk. `mayRunStaged` (`src/update/report.ts:1017`) never runs the staged file as root or from a folder another user owns, for both the hand-over and the report; that narrows what can run, it does not widen it. `reconcile` returns null when it cannot look at the staged binary, so the command the person typed still runs. No secret, no new permission and no new pipeline step is in the diff.
  
  ## Outside the change
  - .github/workflows/release.yml:148 · `gh release create` makes every plain release GitHub's "latest", whatever its version line, and every shipped client now reads that flag. So a patch cut on an older line moves the notice back until someone corrects it by hand with the runbook's command. This is recorded as deferred in `docs/real-use/findings.md:165` (always advisory, debt).
  
  ## Not answerable
  - Rollback (question 4): how github.com answers `releases/latest` while a release's assets are still uploading, and how it rate-limits one address. The ADR's limits say this has not been seen before a real release, so it cannot be checked from the diff.
