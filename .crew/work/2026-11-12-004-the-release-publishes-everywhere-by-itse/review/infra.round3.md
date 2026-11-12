# infra findings for 2026-11-12-004-the-release-publishes-everywhere-by-itse
reviewer: review-infra
read: 13 files. Pipeline and deployment files read: .github/workflows/distribute.yml, .github/workflows/release.yml, scripts/release/plan.ts, scripts/release/npm.ts, scripts/release/push.ts, scripts/release/token.ts, scripts/release/lib.ts (plan, environment, hold and publish sections), the scripts/install.sh hunk, docs/adr/0029-release-distribution.md, docs/runbooks/release.md, npm/package.json, plugins/opencode/package.json and .crew/profile.json.

## Findings
- F-1 · advisory · .github/workflows/distribute.yml:43 · The `plan` job (scripts/release/plan.ts:113) accepts any complete, non-draft GitHub release for the tag. It never checks that the tag's own release.yml run, where `bun run check` ran, succeeded. A manual dispatch can therefore publish a release that was finished by hand, which is the path docs/runbooks/release.md:453 suggests (`gh release upload`), to npm, the tap and the marketplace without any gate run behind its binaries (rubric question 1). On the tag path the gates do run first, and ADR 0029's Limits already say the assets are not tied to the judged commit, so this is advisory.
- F-2 · advisory · .github/workflows/distribute.yml:92 · `setup-node` asks for `node-version: 24`, a floating major, while every other tool in the file is pinned (actions by commit, Bun by `.bun-version`). The step at line 97, which requires npm 11.5.1 or later, protects trusted publishing, but the npm that publishes still depends on the day the job runs (rubric question 6).

## Outside the change
- .github/workflows/release.yml:20 · release.yml still pulls its actions by moving tag (`actions/checkout@v7`, `docker/login-action@v3`, `docker/build-push-action@v6` and others, lines 20–90) while holding `contents: write` and, in `docker`, `packages: write`. distribute.yml pins by commit, so the release that `distribute` trusts is built by unpinned code. This is debt the diff did not introduce.
- .github/workflows/release.yml:13 · The workflow-level `permissions: contents: write` reaches `build`, which runs `bun install` and `bun run check` with a write-capable token. The new `distribute` job narrows itself to `actions: write`, but its neighbours are unchanged. This is debt.

## Not answerable
- Permissions: is the `v*` tag ruleset in place, and does `main` require a pull request? · They are repository settings, not files. `plan` checks the environment rule on every run but not the tag ruleset; ADR 0029 Limits and runbook setup step 2 leave that check to a person.
- Rollback and pipeline: will the four writes to the outside work in this project's pipeline (npm trusted publish, the two pushes with MARKETPLACE_TOKEN, the GHCR retag from distribute.yml)? · They have never run. A dry run does not do them (ADR 0029 Limits), so there is no run log to read. The rollbacks are stated: a higher version for npm, a revert commit in the tap and the marketplace, and a manual `imagetools create` for `latest` (docs/runbooks/release.md:462-468).

Checked and found sound:
- The `distribute` job in release.yml has only `actions: write` and interpolates nothing.
- In distribute.yml, `permissions: {}` sits at the top, with a minimal set per job. Inputs reach scripts only through `env:`, and the tag is checked as a version before any program sees it. All five actions are pinned by commit and every checkout sets `persist-credentials: false`.
- `npm` publishes from the judged commit with `--ignore-scripts`, and with `--tag next` for a pre-release.
- MARKETPLACE_TOKEN is used only in jobs that name the `release` environment. push.ts passes it as a `GIT_CONFIG_*` header, never in a URL, an argument or a file, and deletes the clone.
- `latest` runs only after npm, the tap and the marketplace all succeeded.
- The scripts/install.sh hunk adds no host-specific path. It keeps the existing `WIZARDINGCODE_*` overrides.
