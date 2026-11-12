# infra findings for 2026-11-12-005-harden-the-releases-distribution-after-i
reviewer: review-infra
read: 8 files (the rubric, .crew/profile.json, diff.patch, files.txt, spec.md, plus the pipeline and deployment files: .github/workflows/release.yml (whole distribute job), .github/workflows/distribute.yml (tap and marketplace jobs), scripts/release/push.ts (whole writer and command))

## Findings
- F-1 · advisory · .github/workflows/release.yml:156 · The new `timeout-minutes: 5` on the dispatch-only `distribute` job is a value nobody has measured (spec "Risks and rollback" says `gh workflow run` latency has not been measured). If the job is cut, release.yml shows a failure after the GitHub release is already published, and the run may still have been dispatched. The runbook paragraph (docs/runbooks/release.md:69) states how to recover, so this is not a missing rollback; the risk is a false red on a slow API day (rubric Q4).
- F-2 · advisory · scripts/release/push.ts:91 · `redact` replaces only the exact base64 of `x-access-token:<token>`. The raw `MARKETPLACE_TOKEN` is never redacted from git's texts, and those texts go to the step summary as well as the log. git is never handed the raw value, so no path prints it today. ADR 0029 states the exact-match limit, so this is advisory (rubric Q2).

## Outside the change
- .github/workflows/release.yml:1 · Debt already recorded in docs/real-use/findings.md and not touched here: the workflow still references its actions by moving tag, and its checkouts keep credentials under a workflow-level `contents: write` that also covers `build` (always advisory).
- scripts/release/push.ts:117 · Debt the item names itself: the calls without the header (`config`, `status`, `diff`, `add`, `commit`, `rebase --abort`) still inherit `MARKETPLACE_TOKEN` through `process.env`, the token's git is not isolated from global and system config, and git calls have no time limit of their own, only the job's 15 minutes in distribute.yml (always advisory).

## Not answerable
- none

Rubric questions:
- Q1 (pipelines): no deploy step was added or reordered, and the profile's gates are unaffected.
- Q2 (secrets): no secret in the diff. Test tokens (`secret`, `a>?`) are fixtures.
- Q3 (permissions): `distribute` keeps `actions: write` only. The command's destinations are narrowed: `PUSH_REMOTE` and `PUSH_ORIGIN` are removed, and the remotes come from `REMOTES` and `GITHUB_REPOSITORY` (push.ts:237-238).
- Q4 (rollback): stated in spec.md:110 as a revert on `main`. A tag already cut keeps its 5 minutes, and the runbook's start by hand covers that case.
- Q5 (hosts): the remote URLs are the project's own org repositories, not one machine's paths.
- Q6 (reproducibility): no toolchain change.

The command tests now use a stub git first on PATH, so they reach no network. Real writes are covered through `commitAndPush` against local bare repositories (tests/integration/release-push.test.ts).
