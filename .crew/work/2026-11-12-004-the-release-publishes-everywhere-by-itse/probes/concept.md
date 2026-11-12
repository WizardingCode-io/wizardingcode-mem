# Concept: the release publishes everywhere, and `<data dir>/bin` only moves forward

Mode: brainstorm. The hypothesis the lenses attack.

## Where this comes from

This is piece 1 of 3 of the item `2026-11-11-004-updated-everywhere-on-release-whenever-a`. That item's concept went to the six lenses on 2026-11-11; its brief (`.crew/work/2026-11-11-004-updated-everywhere-on-release-whenever-a/concepts_brief.md`) cut the work into three items, and the author confirmed the cut on 2026-11-12 (D-8). This item is goals 1 and 2 of that brief. Piece 2 (a client's daily check and the staged binary replacing itself) and piece 3 (the team server upgrading itself on its host) are later items and are out of bounds here. What the lenses attack now is the mechanics chosen for piece 1, which the first round did not see.

## The problem

wizardingcode-mem is one local binary per machine, distributed through each agent's plugin (a marketplace repository, `WizardingCode-io/wizardingcode-plugins`), a Homebrew tap (`WizardingCode-io/homebrew-wizardingcode`), two npm packages (the shim `wizardingcode-mem` from `npm/`, and the OpenCode plugin `wizardingcode-mem-opencode` from `plugins/opencode/`) and a Docker image of the team server (`ghcr.io/wizardingcode-io/wizardingcode-mem`). The author tags `v<version>`; `.github/workflows/release.yml` builds, signs, pushes the image (the version tag and, for a plain release, `latest`) and creates the GitHub release with five binaries and `checksums.txt`. Everything after that is done by hand: the formula is rewritten with the checksums and put into the tap through the contents API, two manifests of the marketplace are edited (`.claude-plugin/marketplace.json`: the plugin's `version` and `source.ref`; `.agents/plugins/marketplace.json`: `source.ref`), the release notes are rewritten because the workflow's shallow checkout lists one commit, and npm is not published at all (both packages are at 0.4.4 on npm; the repository is at 0.8.0). A release the author forgets a step of leaves the channels on different versions.

Every channel puts the binary the agents run at the same path, `<data dir>/bin/wizardingcode-mem`. The plugins' script and OpenCode's `binary.js` replace it only with a newer version (`older()`); the npm shim (`npm/bin/wizardingcode-mem.js:65`) replaces it whenever the versions differ, and `wizardingcode-mem install` from a Homebrew binary copies itself there whatever is already staged (`src/install/binary.ts`, `stageBinary`). A machine with a plugin at 0.8.0 and an npm shim at 0.7.0 has its binary moved back by every `npx wizardingcode-mem …`, across a store schema bump the older binary then refuses (`SchemaTooNewError`).

## The hypothesis

### 1. The release workflow publishes every target, in order, and can be repeated

`release.yml` keeps one file (npm's trusted publishing registers the workflow file that was triggered) and gains a second trigger, `workflow_dispatch` with a `tag` input, for repeating a release that exists.

- **`plan`** (first job): resolves the tag (the pushed ref or the input), whether it is a pre-release (a hyphen in the tag), whether the GitHub release already exists, and whether this release raises the team contract (below). Its outputs gate every other job.
- **`build`, `sign`, `docker`, `publish`** run only when the GitHub release does not exist yet. `docker` pushes the version tag only; it no longer pushes `latest`. `publish` checks out the full history so the Changes list is the commits since the previous tag.
- **Four distribution jobs**, each needing `publish` (or its skip when the release exists), each reading only from the published GitHub release (`gh release download <tag> -p checksums.txt`), each idempotent:
  - **`npm`**: for `npm/` and `plugins/opencode/`: the package's version must equal the tag (else the job fails); `npm view <name>@<version>` answering means "already published" and is success; otherwise `npm publish` by trusted publishing (`permissions: id-token: write`, Node ≥ 22.14, npm ≥ 11.5.1, no token), with `--tag next` for a pre-release so npm's `latest` dist-tag only ever names a plain release.
  - **`tap`** (plain releases only): `scripts/release/formula.ts` renders `packaging/homebrew/wizardingcode-mem.rb.template` with the version and the four checksums read from `checksums.txt` (a missing file name fails the job); the result is written to `Formula/wizardingcode-mem.rb` in the tap through the contents API with `MARKETPLACE_TOKEN`; identical content is success with no commit. The rendered `packaging/homebrew/wizardingcode-mem.rb` is deleted from this repository: the tap holds the only rendered formula.
  - **`marketplace`** (plain releases only): `scripts/release/marketplace.ts` sets, in the two manifests, the `wizardingcode-mem` entry's `version` and `ref` to the tag, touching no other plugin's entry and no other key (the marketplace's own `metadata.version` stays the marketplace's); one commit per changed file through the contents API with `MARKETPLACE_TOKEN`; no change is success with no commit. A manifest that names a newer version than the tag is left alone and reported (repeating an old tag never moves the marketplace back).
  - **`token`** (a step both `tap` and `marketplace` run first): a missing `MARKETPLACE_TOKEN` fails the job with a message that names the secret and what it must be allowed to do; the response header `github-authentication-token-expiration` of an authenticated API call gives the expiry, and fewer than 30 days left is a `::warning::` annotation on the run (D-9: the token is kept, with a warning a month ahead).
- **`latest`** (last; plain releases only): needs `npm`, `tap` and `marketplace` to have succeeded; retags the already-pushed version image as `latest` with `docker buildx imagetools create` (no rebuild). It never moves `latest` to a lower version than it holds (the current `latest`'s version is read from the image's `org.opencontainers.image.version` label). **The client-first rule (D-10):** when the tag's `CONTRACT` (`src/team/contract.ts`) is higher than the previous plain release's, `latest` is not moved and the run says so; the next plain release with the same contract moves it. `plan` reads the two values with `git show <tag>:src/team/contract.ts`.

A failed target is repeated with GitHub's "re-run failed jobs" on the same run, or later with `workflow_dispatch` and the tag. Because each target is idempotent, repeating does no harm to the targets that had succeeded.

The scripts under `scripts/release/` are pure functions over text (render the formula, edit a manifest, compare versions, parse `checksums.txt`, read `CONTRACT` from a source text) with a thin command on top that the workflow calls; the functions are unit-tested, and `tests/unit/deploy-files.test.ts` holds the workflow's shape (job order, `needs`, conditions, permissions), as it does today for `docker`.

### 2. `<data dir>/bin` only moves forward

- The npm shim downloads only when there is no staged binary or the staged one is older than the package (`older()`, the same rule as the plugins' script, copied into the shim since it is dependency-free CommonJS); with a newer staged binary it runs that binary and downloads nothing.
- `stageBinary` leaves a staged binary of a newer version in place and returns its path; `install` then says in one line that a newer version is already staged and which one. A staged file that does not answer `--version` (corrupt, another architecture) is replaced.

### What the author does once

Creates the fine-grained token (the two repositories, contents read and write, one year) as the secret `MARKETPLACE_TOKEN`; registers `release.yml` as a trusted publisher for the two packages on npmjs.com. Until both exist the distribution jobs fail and `latest` stays where it is; the GitHub release itself is unaffected.

## What is asked of each lens

Attack the mechanics: the job graph and its conditions, the idempotency rules, the repeat path, the contract rule for `latest`, the token check, the forward-only rule, and what a person sees when each piece fails. Check the claims about the code against the repository.
