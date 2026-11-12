

## Clarifications
- # infra findings for 2026-11-12-006-the-client-learns-of-a-release-and-its-s
  reviewer: review-infra
  read: 11 files. Pipeline and deployment files read: `.github/workflows/ci.yml`, `.github/workflows/release.yml` and `.github/workflows/distribute.yml` (searched for how they run the suite, mark pre-releases and set GitHub's latest), `docs/runbooks/release.md` (the diff), `.crew/profile.json`, `tests/preload.ts`, `tests/helpers/cli.ts`, `tests/helpers/binary.ts`, `tests/e2e/agent.test.ts`, and the round-3 diff (`src/update/staged.ts`, the `run` of `src/cli/commands/status.ts`, `tests/integration/update-command.test.ts`)
  
  ## Findings
  - F-1 · advisory · docs/runbooks/release.md:80 · The way to withdraw a wrong notice from every shipped client is written down (`gh release edit <previous tag> --latest`), but the runbook says it has never been run, so it is unproven until the first real release (rubric question 4: the rollback is stated but not tested; unchanged since round 1).
  - F-2 · advisory · src/cli/commands/distill.ts:210 · Inside the suite, the background check stays off the network only because `tests/preload.ts:14` forces `WIZARDINGCODE_MEM_UPDATE=off` and most helpers copy `process.env` into the child; `spawnCli` copies nothing. On the CI runners `CI` is set and `mode()` returns `ci`, so the pipeline itself stays offline. This is recorded as deferred in `docs/real-use/findings.md:165` (rubric question 1: the pipeline can still run its jobs).
  
  No defects. The round-3 changes add no infra risk:
  - The rule on who may run the staged file moved unchanged to `src/update/staged.ts:1209`: never as root, never from a folder another user owns.
  - The new `who` parameter of `stagedFacts` and the `build` parameter of `status`'s `run` default to the real effective user and the real report, so no default identity or setting is widened.
  - `tests/integration/update-command.test.ts:1565` turns the check on and removes `CI` only inside the test's own process. It uses the injected `fetch` (`deps`, :1587) and restores both keys in `afterEach`, so the suite still makes no request.
  - No secret, no new permission and no new pipeline step is in the diff.
  
  ## Outside the change
  - .github/workflows/release.yml:148 · `gh release create` makes every plain release GitHub's "latest", whatever its version line, and every shipped client now reads that flag. So a patch cut on an older line moves the notice back until someone corrects it by hand with the runbook's command. This is recorded as deferred in `docs/real-use/findings.md:165` (always advisory, debt).
  
  ## Not answerable
  - Rollback (question 4): how github.com answers `releases/latest` while a release's assets are still uploading, and how it rate-limits one address. The ADR's limits say this has not been seen before a real release, so it cannot be checked from the diff.
