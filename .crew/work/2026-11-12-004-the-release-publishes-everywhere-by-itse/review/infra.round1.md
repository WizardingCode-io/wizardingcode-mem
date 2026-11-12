# infra findings for 2026-11-12-004-the-release-publishes-everywhere-by-itse
reviewer: review-infra
read: 13 files: the diff, files.txt, profile.json, the rubric, .github/workflows/release.yml and distribute.yml in full, scripts/release/plan.ts, npm.ts, push.ts and token.ts, scripts/release/lib.ts (publishArgs, summary, command), scripts/install.sh, npm/package.json and plugins/opencode/package.json

## Findings
- F-1 · advisory · .github/workflows/distribute.yml:202 · The `latest` job moves the image's `latest` tag with `imagetools create`. The runbook's "A bad release" (docs/runbooks/release.md:68-70) covers npm (fix by a higher version) and the tap and marketplace (revert the commit), but it never says how to point `latest` back at the previous plain version. `distribute.yml` cannot do it either, because it only distributes the highest tag. Nothing reads `latest` until piece 3, so this is not a defect yet (rubric question 4, rollback).
- F-2 · advisory · .github/workflows/distribute.yml:92 · The `npm` job sets `node-version: 24`, which floats within the major, while the other jobs pin Bun through `.bun-version`. The npm that publishes can change from one run to the next. The `npm --version >= 11.5.1` step guards the lower bound only (rubric question 6, reproducibility).

## Outside the change
- .github/workflows/release.yml:20 · release.yml still references its actions by tag (`actions/checkout@v7`, `oven-sh/setup-bun@v2`, `docker/*@v3`, `docker/build-push-action@v6`, `docker/metadata-action@v5`), while the new distribute.yml pins every action by commit. The `docker` job runs these with `packages: write`, and the other jobs inherit the top-level `contents: write` (debt; the diff touched line 104 only to add `fetch-depth: 0`).
- .github/workflows/release.yml:13 · The top-level `permissions: contents: write` applies to `build`, which runs `bun install` and the whole check with a write token. That job only needs read (debt).

## Not answerable
- Rubric question 3 (permissions) and question 1 (pipelines), for the GitHub settings: the `release` environment's branch rule, the `v*` tag ruleset, `main`'s ruleset and the ghcr package's Actions access for this repository live in the repository settings, not in files. `plan` checks the environment at run time (scripts/release/plan.ts:57-79). Nothing in the diff checks the tag ruleset or the package access.
- Rubric question 1 (pipelines), for the four writes to the outside (npm publish, the two pushes, the retag): no run of distribute.yml exists to read. The runbook and ADR 0029 both say the first real run is their first exercise.

Checked and found sound, for the judge:
- Gates run before any deploy. `release.yml`'s `build` job runs `bun run check` and `bun run build`. `publish` needs `sign` and `docker`, `distribute` needs `publish`, and `plan` refuses a tag without a whole release.
- Permissions are narrow. `distribute.yml` starts at `permissions: {}`, and each job asks only for what it needs: `id-token: write` only in `npm`, `packages: write` only in `latest`, and `actions: write` only in release.yml's new `distribute` job.
- The secret stays in the `release` environment, on the `tap` and `marketplace` jobs only. `push.ts` sends it as an extraheader through `GIT_CONFIG_*` environment variables, never in a URL or an argument. `token.ts` passes it as `GH_TOKEN`.
- `npm publish` runs with `--ignore-scripts` from the commit `plan` judged.
- No `run:` interpolates an expression.
- `scripts/install.sh` adds no host-specific path, and `--force` restores the old behaviour of always replacing the binary.
