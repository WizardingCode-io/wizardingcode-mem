# security findings for 2026-11-12-004-the-release-publishes-everywhere-by-itse
reviewer: review-security
read: 10 files, risk areas: infra

## Findings
- F-1 · advisory · scripts/release/push.ts:216 · The production command still reads the test overrides `PUSH_REMOTE` and `PUSH_ORIGIN` from its environment. If either variable is ever set in the tap or marketplace job's environment, the writer that holds `MARKETPLACE_TOKEN` pushes to that remote and checks the tag against another origin, and nothing in the workflow refuses it. The `extraheader` is scoped to `https://github.com/`, so the token only reaches github.com remotes. Only someone who can change `main` could set the variables, so this is hardening: honour the overrides only when, for example, `GITHUB_ACTIONS` is unset.
- F-2 · advisory · .github/workflows/distribute.yml:172 · The `latest` job holds `packages: write` with no `environment: release`. Only `plan`'s in-script check on `refs/heads/main` gates it, not GitHub's deployment rule. The ADR's Limits already accept that a branch's workflow can ask for `packages: write`, so this records where the barrier sits rather than opening a new path. Piece 3, which will read `latest`, should not treat this job as environment-gated.

No defect. I checked the paths a caller could take through the new infra:
- **Dispatch and the environment.** A dispatch from a non-`main` ref is refused by `decidePlan` (lib.ts:432) before any job that holds a secret runs. Those jobs also sit behind the environment `release`, whose rule `plan` reads and refuses unless it is exactly the branch `main` (lib.ts:366-374, plan.ts:115).
- **The tag input.** It is checked against a strict version regex before it reaches git, `gh` or `GITHUB_OUTPUT` (lib.ts:434, version.ts:1, plan.ts:99). Every `run:` gets its values through `env:`, so the tag cannot inject into a shell.
- **npm.** The job publishes the tree `plan` judged, with `--ignore-scripts` (lib.ts:569), by OIDC trusted publishing with no stored token.
- **The marketplace token.** It travels as an `extraheader` in `GIT_CONFIG_*`, never in a URL, an argument or the clone's config (push.ts:33-45). It is withheld from the `ls-remote` of this repository, and the tag is re-checked against the judged commit before any write (push.ts:82-95).
- **What gets written.** The formula's checksums must be 64 hex characters and the version must pass the version regex, so the Ruby template cannot be injected (lib.ts:198-229). The manifest edit only replaces the `ref` and `version` values with a validated version (lib.ts:309-333).
- **Checkouts and actions.** Every checkout in `distribute.yml` sets `persist-credentials: false`, every action is pinned by commit, and the workflow's default is `permissions: {}`.
- **release.yml's new `distribute` job.** It holds only `actions: write` and passes `GITHUB_REF_NAME` through the environment.
- **Installers.** `scripts/install.sh` runs the downloaded binary only after its checksum is verified (install.sh:~90 before :923). `stageBinary` and the `install` hand-over run only the file already staged in the user's own data directory, which the plugins already run. The ADR's Limits accept the high-version case.

## Outside the change
- .github/workflows/release.yml:20 · The jobs that build and push the binaries, the image and `checksums.txt` (lines 20-21, 35, 45, 56, 71-72, 76-79, 84, 90, 104, 107) use actions by mutable major tags (`actions/checkout@v7`, `docker/login-action@v3`, `docker/build-push-action@v6`, …) under `contents: write` and `packages: write`. These lines are not new. This change does make their output travel automatically into the tap's formula and the image's `latest`, so pinning them by commit, as `distribute.yml` does, would close the remaining supply-chain gap.
- .github/workflows/release.yml:104 · The `publish` job's checkout keeps the default persisted `contents: write` credentials in `.git/config` while it runs `git describe` and `git log`. The diff only added `fetch-depth: 0` here. `persist-credentials: false` would match `distribute.yml`.

## Not answerable
- infra: "what runs under which identity". The actual settings cannot be read from the repository: the environment `release`'s rule beyond what `plan` checks at run time, the ruleset on `v*` tags (D-4, which `plan` does not check, per the ADR's Limits), `main`'s ruleset (D-5), and whether the ghcr package grants this repository's workflows write.
- infra: "is a permission widened". The scope and expiry of `MARKETPLACE_TOKEN` are not visible. The runbook says Contents read and write on two repositories, one year, one person's token. `token.ts` checks access and expiry at run time but not that the token covers nothing else.

Files reviewed (absolute):
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.github/workflows/distribute.yml
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.github/workflows/release.yml
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/scripts/release/lib.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/scripts/release/plan.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/scripts/release/push.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/scripts/release/token.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/scripts/release/npm.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/util/version.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.crew/work/2026-11-12-004-the-release-publishes-everywhere-by-itse/review/diff.patch (workflows, docs, shims, install.sh, install.ts, binary.ts hunks)
