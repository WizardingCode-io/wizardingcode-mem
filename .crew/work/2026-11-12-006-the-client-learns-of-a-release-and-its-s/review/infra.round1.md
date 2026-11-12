# infra findings for 2026-11-12-006-the-client-learns-of-a-release-and-its-s
reviewer: review-infra
read: 9 files. Pipeline and deployment files read: `.github/workflows/ci.yml`, `.github/workflows/release.yml` and `.github/workflows/distribute.yml` (searched for how they run the suite, mark pre-releases and set GitHub's latest), `docs/runbooks/release.md` (the diff), `.crew/profile.json`, `tests/preload.ts`, `tests/helpers/cli.ts`, `tests/helpers/binary.ts` and `tests/e2e/agent.test.ts` (how the suite passes its environment to child processes)

## Findings
- F-1 · advisory · docs/runbooks/release.md:80 · The rollback for a wrong notice is now stated (`gh release edit <previous tag> --latest`, which also moves what `scripts/install.sh` downloads), but the runbook itself says it has never been run, so the way back for every shipped client rests on a step nobody has tried until the first real release (rubric question 4: stated, but not tested).
- F-2 · advisory · src/cli/commands/distill.ts:197 · Inside the suite, the background check is kept off the network only because `tests/preload.ts:14` forces `WIZARDINGCODE_MEM_UPDATE=off` and the test helpers (`runCliWith`, `runBinary`, the hook's detached `distill`) copy `process.env` into the child. A future test that runs `distill` with an environment built from scratch would ask github.com on a developer's machine. On the CI runners `CI` is set and `mode()` returns `ci` anyway, so the pipeline itself stays offline (rubric question 1: the pipeline can still run its jobs).

## Outside the change
- .github/workflows/release.yml:148 · `gh release create` makes every release that is not a pre-release GitHub's "latest" by GitHub's default rule, whatever its version line. Every shipped client now reads that flag through `releases/latest`, while `distribute.yml` only distributes the highest version. So a patch cut on an older line moves the notice back until someone corrects it by hand. The runbook names this correction, but the workflow does not pass `--latest=false` for an older line (always advisory, debt).

## Not answerable
- Rollback (question 4): how github.com answers `releases/latest` while a release's assets are still uploading, and how it rate-limits one address. The diff and the ADR both say this has not been seen before a real release, so the reviewer cannot check whether the notice reaches a client before `distribute.yml` has published the version, beyond what the runbook already admits.
