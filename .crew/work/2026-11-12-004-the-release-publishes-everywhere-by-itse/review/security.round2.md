# security findings for 2026-11-12-004-the-release-publishes-everywhere-by-itse
reviewer: review-security
read: 11 files, risk areas: infra

## Findings
- F-1 · advisory · .github/workflows/distribute.yml:202 · The `latest` job retags the image by its version name (`ghcr.io/wizardingcode-io/wizardingcode-mem:$VERSION`), not by the digest that release.yml pushed. Anyone with `packages: write` (any branch's own workflow) who overwrites `:<version>` between the release and the distribution has their image promoted to `latest`. The spec already accepts that `latest` can be moved outside distribute.yml, so this opens no new path. Recording the digest in release.yml and retagging by digest would bind `latest` to the judged build.
- F-2 · advisory · .github/workflows/distribute.yml:172 · `latest` is the one job that holds a write permission (`packages: write`) without `environment: release`. Its only gate is that `plan` succeeded on `refs/heads/main`. That holds today, but the environment's main-only rule does not protect this job if `plan` is weakened later. The spec accepts this limit, since a branch workflow can already request `packages: write`.
- F-3 · advisory · scripts/release/plan.ts:115 · `plan` checks the environment `release` and its branch rule, but not the `v*` tag ruleset that the spec calls mandatory (D-4). The spec's "stray or hand-made release" risk depends entirely on that ruleset. Without it, a person with write access can tag a correctly versioned commit on main, make a release by hand with their own `checksums.txt`, and dispatch, and the tap then carries those checksums. A refusal when the ruleset is absent would make D-4 a checked fact rather than a setup step.

No defect found. All of the following hold in the diff:
- No `run:` in distribute.yml interpolates `${{ }}`.
- Every action is pinned by commit.
- Every checkout sets `persist-credentials: false`.
- The workflow-level permission is `{}`, with each job scoped.
- `secrets.MARKETPLACE_TOKEN` reaches only the `env:` of the steps in `tap` and `marketplace`.
- The token reaches git only through `GIT_CONFIG_*` scoped to `https://github.com/`, never in a URL, an argument or a file of the clone (scripts/release/push.ts:33-45). The tag check through `git ls-remote` runs without it.
- `npm publish` runs with `--ignore-scripts` from the commit `plan` judged (scripts/release/lib.ts:560-569).
- The tag is checked against `^v\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$` before it reaches git, gh or `GITHUB_OUTPUT`, so no argument or output-line injection is possible.
- The new `distribute` job in release.yml holds only `actions: write` and dispatches main's copy of distribute.yml.
- scripts/install.sh still verifies the checksum before it runs the downloaded binary. Its `--version` probe of the binary already in place runs a file in the user's own directory.

## Outside the change
- .github/workflows/release.yml:13 · The workflow-level `permissions: contents: write` applies to the `build` job, which runs `bun install --frozen-lockfile` and `bun run check` (third-party dependency code) with a token that can write the repository and its releases. Per-job least privilege would confine it. This is debt the diff did not introduce.
- .github/workflows/release.yml:20 · release.yml still uses tag-pinned actions (`actions/checkout@v7`, `oven-sh/setup-bun@v2`, `docker/*@v3`, `docker/build-push-action@v6`, `docker/metadata-action@v5`) in jobs that hold `contents: write` and `packages: write`. Its image and assets are what distribute.yml carries to the tap and to `latest`, so the commit pinning applied to distribute.yml does not cover the build it distributes. This is debt the diff did not introduce.

## Not answerable
- infra: is a permission widened (the repository settings) · The environment `release` (its main-only branch policy, its secret), the ruleset on main, the `v*` tag ruleset (D-4), the npm trusted-publisher registration and the fine-grained token's scope are all GitHub or npm settings outside the diff. What they actually are could not be read; only the design's claims about them and `plan`'s runtime check of the environment could.

Files read:
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.crew/work/2026-11-12-004-the-release-publishes-everywhere-by-itse/review/diff.patch
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.crew/work/2026-11-12-004-the-release-publishes-everywhere-by-itse/spec.md
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.github/workflows/release.yml
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/scripts/release/lib.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/scripts/release/plan.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/scripts/release/push.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/scripts/release/npm.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/scripts/release/token.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/util/version.ts
