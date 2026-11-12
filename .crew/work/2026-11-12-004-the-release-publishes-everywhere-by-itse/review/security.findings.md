# security findings for 2026-11-12-004-the-release-publishes-everywhere-by-itse
reviewer: review-security
read: 14 files, risk areas: infra

## Findings
- F-1 · advisory · scripts/release/push.ts:43 · `gitEnv` puts `Authorization: Basic base64(x-access-token:<MARKETPLACE_TOKEN>)` into `GIT_CONFIG_VALUE_0` without registering that encoded form with `::add-mask::`. Actions masks the raw secret but not its base64. Today no path prints it: git redacts the header in its traces, and only stderr is echoed into the `ReleaseError` sentences at 104, 138, 144 and 149. But a later `GIT_TRACE_CURL`/`GIT_CURL_VERBOSE`, or a debug re-run, would put an unmasked write credential for the tap and the marketplace into the public run log. actions/checkout masks the same header form for this reason. Masking it in `push.ts` before the first git call would close that.

## Outside the change
- none

## Not answerable
- infra: "what runs under which identity" for `plan`'s environment read (scripts/release/plan.ts:60-77) · the diff does not show whether the repository is public or private. On a private repository, the `GITHUB_TOKEN` scoped to `contents: read, actions: read` (.github/workflows/distribute.yml:46-48) must be able to read `environments/release` and its deployment-branch-policies. If it cannot, `plan` fails closed, which is safe but untested against the real API until the first run (ADR 0029 Limits, first bullet).

Notes for the judge (not findings). I answered the rubric's two general questions and the infra questions as follows.
- Boundary: the dispatch input `tag` reaches no program before `decidePlan` checks it with `isVersionTag`, a strict anchored semver pattern (src/util/version.ts:1). Every `run:` takes inputs through `env:`, quoted. `VERSION` is held to that same pattern, and the checksums to `[0-9a-f]{64}`, before either is written into the formula, the manifests, `GITHUB_OUTPUT` or a commit message. So no path injects Ruby, JSON or an output line.
- Permissions: `distribute.yml` sets `permissions: {}` and narrows each job. The npm job's `id-token: write` and the marketplace token are both behind the environment `release` (main only), and `plan` checks that rule exactly (scripts/release/lib.ts:366-374). The new `distribute` job in `release.yml` gets only `actions: write`. `npm publish` runs with `--ignore-scripts` on the commit `plan` judged. The writers to other repositories re-check the tag's commit against `plan`'s sha before writing (scripts/release/push.ts:82-95), and they ignore the `PUSH_REMOTE`/`PUSH_ORIGIN` overrides on a runner. Every action in `distribute.yml` is pinned by commit, and no checkout keeps credentials.
- Secrets: nothing moves into configuration or an image. The test fixtures hold only the literal `secret`.
- Installers: `scripts/install.sh` and `stageBinary` now run the already-staged binary's `--version`, and `install` hands over to a newer staged binary. Only someone who can already write the user's data directory controls those files, and the hooks already run them, so the change gives no new identity anything.
- Already deferred, not raised again: the `latest` job's `packages: write` outside the environment, and its retag by name rather than by digest; release assets not tied to the judged commit; `plan` not checking the `v*` tag ruleset; the template and scripts read from `main`; D-5's no-approval merge to `main`; `release.yml`'s unpinned actions and persisted credentials. All are in docs/real-use/findings.md (the 2026-11-12 "release distribution" rows) and in ADR 0029's Limits.

Files: /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/scripts/release/push.ts, /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/scripts/release/plan.ts, /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.github/workflows/distribute.yml
