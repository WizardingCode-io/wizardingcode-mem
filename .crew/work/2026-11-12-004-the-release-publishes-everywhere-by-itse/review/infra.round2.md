# infra findings for 2026-11-12-004-the-release-publishes-everywhere-by-itse
reviewer: review-infra
read: 8 files: the rubric, `.crew/profile.json`, `review/files.txt`, `review/diff.patch` (all of it for `.github/workflows/distribute.yml`, `.github/workflows/release.yml`, `scripts/install.sh`, `scripts/release/{npm,plan,push,token}.ts` and `docs/runbooks/release.md`), `.github/workflows/release.yml` in full, `scripts/release/lib.ts:355-580`, `npm/package.json` and `plugins/opencode/package.json`

## Findings
- F-1 · advisory · scripts/release/push.ts:161 · The `tap` job checks out only `main` (`.github/workflows/distribute.yml:122`), and `editTap` reads `packaging/homebrew/wizardingcode-mem.rb.template` relative to that checkout, not from the commit `plan` judged. If the template changes on `main` after a tag (a new target, a renamed asset), the release's `checksums.txt` gets rendered into a formula that is not that release's, on the first run or on a repeat. The `npm` job avoids this with its second checkout at `needs.plan.outputs.sha`, so this is a gap in the deployed artifact and how it is reproduced (Q6), not a widened right.
- F-2 · advisory · .github/workflows/distribute.yml:36 · Real runs, dry runs and repeats all share the concurrency group `distribute` with `cancel-in-progress: false`. A third dispatch therefore silently replaces the waiting run: a hand-started dry run can drop the real run that `release.yml` queued for a new tag, while `release.yml` stays green. The runbook mentions this ("a third started meanwhile replaces the one that waits") but nothing in the pipeline reports it (Q1, a job that silently does not run).

No defects. What I checked:
- **Order of gates and deploy (Q1).** `release.yml`'s `build` job runs `bun run check` (typecheck, lint, tests) and `bun run build` before `publish`. `distribute` needs `publish`. `plan` refuses a release that is missing or lacks any of the five binaries or `checksums.txt`, so every npm, tap, marketplace and `latest` write comes after the gates, including on a manual repeat.
- **Permissions (Q3).** These are narrower than before, not wider:
  - The workflow's default is `permissions: {}`.
  - `plan` has `contents: read` and `actions: read`, and names no environment, so it gets no secrets.
  - `npm` has `contents: read` and `id-token: write`, under `release`, and publishes with `--ignore-scripts`.
  - `tap` and `marketplace` have `contents: read`, under `release`.
  - `latest` has `packages: write` alone.
  - `release.yml`'s new `distribute` job narrows the workflow's `contents: write` down to `actions: write`, which the dispatch needs.
- **Secrets (Q2).**
  - `MARKETPLACE_TOKEN` comes only from the environment's secrets.
  - It reaches git through `GIT_CONFIG_*` and gh through `GH_TOKEN`, never through an argument, a URL or a file in the clone.
  - No checkout keeps credentials.
  - No `run:` interpolates an expression.
  - No default value carries a secret.
- **Rollback (Q4).** `docs/runbooks/release.md` ("A bad release") states one for each destructive write: npm is fixed by a higher version, the tap and the marketplace by a revert commit, and `latest` by a stated `imagetools create` command back to the previous version.
- **Hosts and pins (Q5, Q6).**
  - No machine-specific path is added, in `scripts/install.sh` or elsewhere.
  - Every action in `distribute.yml` is pinned by commit.
  - Bun comes from `.bun-version`.
  - `node-version: 24` floats, but a step that fails below npm 11.5.1 guards it.

## Outside the change
- .github/workflows/release.yml:13 · The workflow-level `contents: write` still covers the `build` job, which runs `bun install --frozen-lockfile` and the test suite with a token that can write. This is debt from before the change (advisory).
- .github/workflows/release.yml:104 · The `publish` job's checkout was touched (`fetch-depth: 0` added) but is still `actions/checkout@v7`, unpinned and keeping credentials under `contents: write`. Its new neighbour `distribute.yml` pins every action by commit, and none of the `release.yml` actions are pinned. This is debt (advisory).
- .github/workflows/release.yml:89 · As ADR 0029's Limits say, a `v*` tag on an older commit runs that commit's `release.yml`, which still tags `latest`. Only the tag ruleset, which exists in the runbook and not in any file, closes this. Nothing reads `latest` yet (advisory).

## Not answerable
- Q3 Permissions: whether the npm trusted publishers for `wizardingcode-mem` and `wizardingcode-mem-opencode` name exactly `distribute.yml` and the environment `release`. This is registry configuration and not in the repository. Only the environment's branch rule is checked by `plan` at run time (`scripts/release/lib.ts:367`).
- Q3 Permissions: whether the GHCR package `wizardingcode-io/wizardingcode-mem` gives this repository's workflows write access for the `latest` retag. This is package configuration and not in the repository.
- Q1 Pipelines: whether the four writes to the outside succeed (npm publish, the two pushes, the retag). ADR 0029 says a dry run cannot prove them, and no run of `distribute.yml` was available to read.
