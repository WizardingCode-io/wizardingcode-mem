# security findings for 2026-11-12-004-the-release-publishes-everywhere-by-itse
reviewer: review-security
read: 12 files, risk areas: infra

## Findings
- F-1 · advisory · .github/workflows/distribute.yml:172 · The `latest` job takes `packages: write` with no `environment: release`. Any run of this file can retag `ghcr.io/wizardingcode-io/wizardingcode-mem:latest` without passing the environment that the ADR says the publishing rests on. The `if:` and the first step only check the job results that `plan` produced. The ADR and runbook already accept this ("a branch's workflow can ask for `packages: write`"), so it is hardening, not a new path. Putting the job behind `release` would make the retag need the same main-only rule as the token and npm, as a step towards piece 3.
- F-2 · advisory · .github/workflows/distribute.yml:127 · Each `tap` run downloads `checksums.txt` from the release by tag (line 133) and writes it into the formula with a write token. Nothing ties those checksums to the commit `plan` judged. An actor with write access who replaces the release assets between `release.yml` and the dispatch gets a formula in the tap that points users at their binary. The ADR and runbook accept this limit ("Signatures are not part of this item"). The only mitigation is the runbook's optional "immutable releases" setting. Making that a mandatory setup step, or having `plan` check it, would close the gap.

## Outside the change
- .github/workflows/release.yml:20 · The `build`, `sign`, `docker` and `publish` jobs still use actions by moving major tags (`actions/checkout@v7`, `docker/build-push-action@v6`, `docker/login-action@v3`, etc.) and run under `contents: write` / `packages: write`. These lines are not in the diff, but the jobs produce the binaries and `checksums.txt` that `distribute.yml` now carries automatically to the tap, the marketplace and the npm shim's download. A moved action tag upstream therefore reaches every channel without a human step. `distribute.yml` itself is pinned by commit (debt, advisory).
- .github/workflows/release.yml:13 · The workflow-level `permissions: contents: write` still applies to `build`, which runs `bun install --frozen-lockfile` and the whole test suite. The new `distribute` job correctly narrows itself to `actions: write` (debt, advisory).

## Not answerable
- infra: what runs under which identity · The design's barriers live in GitHub and npm settings that no file in the diff shows: the `v*` tag ruleset (D-4, called mandatory), main's ruleset (D-5), the `release` environment's secrets list, the scope of the fine-grained `MARKETPLACE_TOKEN`, and the npm trusted-publisher registration. `plan` (scripts/release/lib.ts:381, environmentState) checks only the environment's branch rule. The tag ruleset is never checked by any run, so its presence could not be confirmed.

Checked and found sound (no finding):
- No `run:` interpolates an expression. The `tag` input is checked against `^v\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$` (lib.ts:407) before it reaches git or gh.
- Every checkout in distribute.yml has `persist-credentials: false`.
- `npm publish` runs with `--ignore-scripts` (lib.ts:573) under `id-token: write`.
- The token goes to git as a `GIT_CONFIG_*` extraheader scoped to `https://github.com/`, never in a URL, argument or clone file (scripts/release/push.ts:1891 in the diff). `token.ts` passes it as `GH_TOKEN` in the environment.
- The rendered checksums are validated as 64-hex (lib.ts:201). The manifest version comes only from the validated tag.
- The tag is re-checked against the judged SHA before any push (push.ts `commitAndPush`).
- The new `distribute` job in release.yml has only `actions: write` and dispatches main's copy, never the tag's.
- scripts/install.sh runs the downloaded binary's `--version` only after the checksum match. The new `--force` parsing and `version_of` are quoted and regex-filtered.
- No credential appears in the diff, the fixtures or the docs.
