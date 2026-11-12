# The release publishes everywhere, and `<data dir>/bin` only moves forward

Piece 1 of 3 of `2026-11-11-004-updated-everywhere-on-release-whenever-a`. The predecessor is `concepts_brief.md` in this folder.

## Problem

When a version of wizardingcode-mem is tagged, a person still has to carry it by hand to most of the places people install it from, and three of the five programs that put the binary on a machine can replace a newer binary with an older one. This item makes a tag reach every place by itself, and makes the binary on a machine only ever move to a newer version.

The author tags `v<version>`. `.github/workflows/release.yml` builds five binaries, signs the macOS ones, pushes the team server's image and creates the GitHub release with `checksums.txt`. Four steps are then left to a person. Three were done by hand for 0.7.0 and 0.8.0:

- the Homebrew formula, rewritten with the release's checksums and put into the tap `WizardingCode-io/homebrew-wizardingcode` (a tap is the git repository Homebrew reads a formula from);
- the plugin's entry in two manifests of the marketplace `WizardingCode-io/wizardingcode-plugins`, the repository the agents' plugin managers read (`.claude-plugin/marketplace.json`: `version` and `source.ref`; `.agents/plugins/marketplace.json`: `source.ref`);
- the release notes, because the workflow's shallow checkout lists one commit.

The fourth was not done: npm. `wizardingcode-mem` and `wizardingcode-mem-opencode` are at 0.4.4 on npm (read on 2026-11-12) while the repository is at 0.8.0.

A release with a forgotten step leaves the channels on different versions, and nobody is told.

Separately, every channel stages the binary the agents run at one path, `<data dir>/bin/wizardingcode-mem` (`<data dir>` is `~/.wizardingcode/mem` by default), and three of its five writers move it back to an older version:

| Writer | Rule today | Where |
| :- | :- | :- |
| The plugins' script | replaces only an older binary | `scripts/templates/wizardingcode-mem.sh`, `older()` |
| OpenCode's package | replaces only an older binary | `plugins/opencode/binary.js`, `older()` |
| The npm shim | replaces whenever the versions differ | `npm/bin/wizardingcode-mem.js:65` |
| `wizardingcode-mem install` | always copies itself | `src/install/binary.ts`, `stageBinary` |
| The curl script | always moves the download in | `scripts/install.sh:64` |

A machine whose plugin staged a newer binary than its npm shim's version has that binary moved back by every `npx wizardingcode-mem …`; the older binary then refuses a store the newer one has migrated (`SchemaTooNewError`, `src/store/db.ts`). The two writers that do compare versions order two pre-releases of one version as strings, so `0.9.0-rc.10` counts as older than `0.9.0-rc.9` and they too can move a pre-release back; one place in the code already uses the right order (`src/store/meta.ts:158`, `Bun.semver.order`).

## Goals

1. A tagged release reaches npm, the tap and the marketplace with no hand step, and the image's `latest` tag moves last.
2. A target that failed can be repeated for the same tag; repeating makes no new write to a target that already holds the version, and no run of `distribute.yml` moves a target to a lower version.
3. Somebody who can push a branch or a tag, but cannot merge to `main` or change the repository's settings, cannot reach the marketplace token or the npm publish, neither by dispatching the distribution from their branch nor by pushing a tag.
4. The author sees, on the run's page, what each target did and why.
5. `<data dir>/bin` is replaced only by a newer or equal version by every writer this item ships, under one version order, and a person has a stated way back (`install --force`, or `--force` passed to the curl script).
6. A release run names a marketplace token that is missing, expired or without access, and warns within 30 days of its expiry when GitHub returns the expiry.

## Non-Goals

- A client that checks for a newer release and replaces its own staged binary, and the CLI re-staging itself after `brew upgrade`: piece 2.
- The team server upgrading itself on its host, and any reader of `latest`: piece 3.
- A GitHub App in place of the token (the author kept the token: D-9 of `2026-11-11-004`).
- A scheduled check of the token between releases (the author removed it on 2026-11-12, D-3: GitHub emails a token's owner before it expires, and the author notes the date when creating it).
- A signature over the binaries beyond the sha256 in `checksums.txt`.
- A record of which channel staged the binary (piece 2, where `doctor` shows it).
- Publishing to npm the versions between 0.4.4 and the first release that carries this item.
- Changing shims already published: a machine that holds the 0.4.4 shim keeps its old rule until that package is updated.
- A rewrite of `docs/adr/0008-m5-distribution.md` (it records what was true then; the ADR this item adds, 0029, supersedes its Homebrew row).

## Open Questions

None. The author answered five on 2026-11-12: this item's D-1 (the workflow's shape), D-2 (the contract rule), D-3 (no weekly token check), D-4 (the ruleset on `v*` tags is mandatory) and D-5 (the limit of `main`'s ruleset is written, not changed).

## Critical User Journeys

**J-1, a plain release.** Given `main` carries this item and the author has done the one-time setup. When the author pushes `v0.9.0`. Then `release.yml` creates the GitHub release with the Changes list since `v0.8.0` and starts `distribute.yml` with the tag; that run publishes the two npm packages at 0.9.0 (npm's `latest` dist-tag), commits the formula for 0.9.0 to the tap, commits the plugin's entry at 0.9.0 to the marketplace, then tags the 0.9.0 image `latest`; the run's summary has one line per target, each "published", "written" or "moved".

**J-2, a pre-release.** Given the same. When the author pushes `v0.9.0-rc.1`. Then the two npm packages are published under the dist-tag `next`; the tap, the marketplace and `latest` are left as they are; the summary says "skipped: pre-release" for each of those three.

**J-3, a repeat after a failure.** Given J-1's run failed in the marketplace job (the token had lost its access) after npm and the tap succeeded. When the author fixes the token and starts `distribute.yml` from `main` with `tag: v0.9.0`. Then the run's summary says "already published" for each npm package and "tap: already at 0.9.0", with no commit to the tap; the marketplace is written, and `latest` moves.

**J-4, a release that would refuse the previous release's members.** Given `v0.9.0` speaks contract 3, and `v0.10.0` accepts contracts 4 and 5 only. When the author pushes `v0.10.0`. Then npm, the tap and the marketplace are written, `latest` stays on 0.9.0 and the summary says `latest: held: v0.10.0 accepts contract 4 and up; v0.9.0 speaks 3`. When, later, the author starts `distribute.yml` with `tag: v0.10.0` and `release_hold: true`, `latest` moves to 0.10.0 and the summary says the hold was released by hand.

**J-5, a shim meets a newer binary.** Given a plugin staged 0.9.0 in `<data dir>/bin`. When a person runs `npx wizardingcode-mem@0.9.0-rc.1 status` (a shim that carries this item). Then nothing is downloaded, the staged 0.9.0 runs, and one line on standard error says 0.9.0 is in place and this package is 0.9.0-rc.1.

**J-6, a way back.** Given a person staged 0.9.1 and wants 0.9.0 back. When they run a 0.9.0 binary as `wizardingcode-mem install --force`. Then the staged binary is 0.9.0 and the hooks point at it. Without `--force` the same command keeps 0.9.1, says so once, and the staged 0.9.1 carries out the install. The way back is for the binary alone: a plugin still at 0.9.1 stages 0.9.1 again at its next session start, and 0.9.0 refuses a store 0.9.1 has migrated; the runbook says both.

**J-7, an attempt through a branch.** Given a person with write access pushes a branch whose `distribute.yml` prints the environment. When they dispatch the workflow from that branch. Then the jobs that name the environment `release` are refused by the environment's branch rule, and no job outside the environment holds the token or can publish to npm.

**J-8, an attempt through a tag.** Given the ruleset on `v*` tags is missing or was removed, a person with write access pushes `v99.0.0` on a commit of their branch, and that commit's own `release.yml` creates a release with six assets. When `distribute.yml` runs from `main` with that tag. Then `plan` refuses it, since the tag's commit is not on `main`, and no other job starts; and a later real `v0.9.0` is still distributed, because the rules count only tags on `main`. Had the person put the tag on an old commit of `main` instead, `plan` would refuse it because that commit's `package.json` is not at 99.0.0; that stray tag would then block later releases until an admin deleted it, which is why the ruleset on `v*` tags is a mandatory step and not an option.

## Design

### Two workflows

`release.yml` keeps its trigger (a pushed `v*` tag) and its four jobs, with three changes:

- `docker` pushes the version tag only; the `latest` line and the comment that names it go.
- `publish` checks out the full history with tags, and its Changes list starts at the previous plain tag for a plain release (`git describe --tags --abbrev=0 --exclude '*-*'`) and at the nearest tag for a pre-release.
- A new last job `distribute` runs `gh workflow run distribute.yml --ref main -f tag="$GITHUB_REF_NAME"`. It comes after `publish`, runs on `ubuntu-latest` with `permissions: actions: write`, has no checkout, gets `GH_TOKEN` and `GH_REPO` through its `env:`, and its `run:` holds no `${{`.

A `workflow_dispatch` started with the workflow's own token does start a run, unlike a `release` event created with it (GitHub's documentation of `GITHUB_TOKEN`, read on 2026-11-12).

The package versions already equal the tag before anything is published: `build` compares the tag with `package.json` and runs `bun run check`, in which `tests/integration/plugin-script.test.ts:103-114` holds `npm/package.json` and `plugins/opencode/package.json` to the root's version. Nothing is added there.

`distribute.yml` is new. Its only trigger is `workflow_dispatch` with three inputs: `tag` (required), `dry_run` (boolean, default false) and `release_hold` (boolean, default false). It has `run-name: distribute ${{ inputs.tag }}`, one concurrency group `distribute` with `cancel-in-progress: false`, and `permissions: {}` at the top, each job naming what it needs. It is the first workflow of this repository to hold a write token for other repositories and a publish right, and four rules hold for it:

- no `run:` script contains `${{`: every input, every output of another job and every secret reaches a script through the step's `env:`;
- every `uses:` is pinned to a full commit SHA, with the version in a comment;
- every `actions/checkout` has `persist-credentials: false`;
- every job has `timeout-minutes: 15`, so a hung call cannot hold the concurrency group for hours.

Every job runs on `ubuntu-latest`. Bun comes from `oven-sh/setup-bun` with `bun-version-file: .bun-version`, as in `ci.yml`; the scripts under `scripts/release/` use only Bun's and Node's built-ins, so no `bun install` runs. `gh` is on the runner.

| Job | Needs | Environment | Permissions | Runs when |
| :- | :- | :- | :- | :- |
| `plan` | none | none | `contents: read`, `actions: read` | always |
| `npm` | `plan` | `release` | `contents: read`, `id-token: write` | always |
| `tap` | `plan` | `release` | `contents: read` | plain release |
| `marketplace` | `plan` | `release` | `contents: read` | plain release |
| `latest` | `plan`, `npm`, `tap`, `marketplace` | none | `packages: write` | plain release, not held |

`tap`, `marketplace` and `latest` are skipped for a pre-release by `if: needs.plan.outputs.prerelease == 'false'`; `latest` also needs `needs.plan.outputs.held == 'false'`. `tap` and `marketplace` need only `plan`. `latest` is the one job with a status function in its condition (`!cancelled()`): when `npm`, `tap` or `marketplace` did not succeed it still runs, writes `latest: not moved: <job> did not succeed` and fails without moving the tag. A skipped job writes nothing, so `plan` writes the summary lines of every target it causes to be skipped or held.

### The environment `release`, and what it rests on

The token and the publish right sit behind the environment `release`: its deployment rule allows the branch `main` only (the settings page's "Selected branches and tags" holding the one branch `main`; the API's `custom_branch_policies`), it holds the secret `MARKETPLACE_TOKEN`, and the npm trusted publishers name it together with the file `distribute.yml`. Three facts make that a barrier, and a fourth is a hazard with its check:

- `main` accepts changes only by pull request: the ruleset "Protect main" (pull request, three required status checks, no deletion, no force push, no bypass actor; read on 2026-11-12). It requires no approving review, so the barrier is a pull request with green checks: it stops access from a branch or a tag, not a person who can merge to `main` (D-5; today the author is the only one). The runbook has the author check the ruleset and require one approval once a second person has write access.
- A ruleset reserves creating, updating and deleting `v*` tags to repository admins (D-4; none exists on 2026-11-12, so it is a step of the one-time setup). `plan`'s own checks cover part of what the ruleset does: `release.yml` runs from the tagged commit's own copy, so `plan` refuses a tag whose commit is not on `main` (refusal 4 below) and a tag whose version is not its commit's `package.json` version (refusal 5), and its rules count only tags that are on `main`. What only the ruleset stops is in Risks.
- What `plan` judged is what is published: `plan` gives the commit the tag named, the `npm` job checks out that commit and never the tag by name, and the writer to the other repositories refuses when the tag no longer names it.
- GitHub creates an environment a job names when it does not exist, with no rule (GitHub's "Manage environments" page, read on 2026-11-12: "the newly created environment will not have any protection rules or secrets configured"). So no job that names `release` may start before the environment exists with its rule: `plan` reads the environment through the API (`GET /repos/<owner>/<repo>/environments/release` and its `/deployment-branch-policies`, both under the "Actions" read permission, `actions: read` for the run's token) and refuses when it is missing or its rule is anything else (refusal 10). `distribute.yml` therefore never creates the environment; the author does.

What the ancestor check gives is that the npm packages' contents and the commit behind the marketplace's `ref` passed a pull request. It does not cover the release's binaries: see Risks.

### `plan`: what may be distributed

`plan` checks out `main` with the full history and tags and runs `bun scripts/release/plan.ts`, which exits 1 with one sentence naming the refusal, or writes the outputs `version`, `sha` (the commit the tag named when `plan` judged it), `prerelease`, `held` and `latest_line` (the line the `latest` job will write) and its summary lines. Exit statuses of every script under `scripts/release/`: 0 the step did its work or found it done; 1 a refusal or a failure, with one sentence on standard error; nothing else.

The tags the rules read are the repository's `v*` tags that are merged into `main` and match the tag pattern of refusal 2; any other tag (on a branch commit, or not a version) is counted by no rule. `plan` refuses when:

1. the run's ref is not `refs/heads/main`;
2. the tag does not match `^v\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$`;
3. the tag does not exist in the repository;
4. the tag's commit is not an ancestor of `origin/main`;
5. the tag's version is not the `version` of `package.json` at the tag's commit;
6. the tag's tree has no `.github/workflows/distribute.yml` (a release cut before this item: its npm shim still moves binaries back, so it is never published);
7. a plain tag is not the highest plain version among those tags, or a pre-release tag is not the highest version among all of them, by the version order below (so no target ever moves to a lower version, whatever is repeated; a fix `v0.9.1` stays distributable after a `v0.10.0-rc.1` tag exists);
8. the GitHub release for the tag does not exist or is a draft;
9. the release lacks any of the six assets (`wizardingcode-mem-darwin-arm64`, `-darwin-x64`, `-linux-arm64`, `-linux-x64`, `-windows-x64.exe`, `checksums.txt`); the sentence names the missing ones;
10. the environment `release` does not exist, or its deployment rule is not exactly the branch `main`; the sentence says which and points to the runbook.

A pre-release is a version with a hyphen. The decision is a pure function over what the command gathered: the ref, the tag, the tag list, four `git` answers (the tag's commit, whether it is an ancestor of `origin/main`, the `version` of its `package.json`, whether its tree holds `distribute.yml`), the release's JSON from `gh release view`, and the environment's JSON and its branch policies from `gh api`. So every refusal is unit-tested. The command gathers each fact only when every earlier refusal has passed, so a later read that fails never hides an earlier refusal. A read that fails for a reason other than "not found" (a 403, the network) is not a refusal with a guessed cause: `plan` exits 1 saying which read failed and with what.

**The hold (D-2).** `plan` reads `CONTRACT` and `ACCEPTED_CONTRACTS` from `src/team/contract.ts` at the tag's commit, and `CONTRACT` at the previous plain release: the highest plain tag, among the tags above, below the tag. `latest` is held when the lowest contract the tag accepts is above the `CONTRACT` the previous plain release speaks: the new server would refuse members still on the previous release. The window is one release, which is the server's own promise (`ACCEPTED_CONTRACTS` is the current contract and the one before): a member two or more releases behind is refused by any release that drops their contract, with or without the hold. When the file is missing at the previous plain release no client of it syncs, so nothing is held; the same when there is no previous plain release. When the constants cannot be read at the tag, or the file is present at the previous release and cannot be read, `latest` is held and the summary names the read that failed: the rule fails closed. `release_hold: true` releases a hold, and the summary says it was released by hand. For a pre-release the hold is not computed: `latest` is skipped. The parser reads the two declarations as they are written today (`export const CONTRACT = <n>;` and `export const ACCEPTED_CONTRACTS: readonly number[] = [<n>, …];`); a unit test compares its reading of the real file with the constants the file exports, so a change to the declarations fails the suite before a release and a contract bump needs no test edit.

### The summary

One function, `summaryLine(target, outcome)` in `scripts/release/lib.ts`, gives every line the run's summary carries, so the texts are fixed in one place. This is the summary table:

| Target | Outcomes |
| :- | :- |
| `npm` (per package) | `<name> <version>: published (dist-tag <tag>)`; `<name> <version>: already published`; `<name> <version>: would publish (dry run)` |
| `tap` | `tap: written, <version>`; `tap: already at <version>`; `tap: would write <version> (dry run)`; `tap: skipped: pre-release` |
| `marketplace` | `marketplace: written, <version>`; `marketplace: already at <version>`; `marketplace: left alone, the manifest names <higher>`; `marketplace: would write <version> (dry run)`; `marketplace: skipped: pre-release` |
| `token` (per repository) | `MARKETPLACE_TOKEN expires on <date> (<n> days)`; `renew it: MARKETPLACE_TOKEN expires on <date> (<n> days)`; `MARKETPLACE_TOKEN: expiry unknown (no expiration header); check the date noted when it was created` |
| any target | `<target>: failed: <sentence>`, written by the command before it exits 1 |
| `plan` | `distribute: refused: <sentence>` |
| `latest` | `latest: not moved: <job> did not succeed`; `latest: moved to <version>`; `latest: would move to <version> (dry run)`; `latest: held: <tag> accepts contract <n> and up; <previous> speaks <m>`; `latest: held: <which read failed>`; `latest: moved to <version>, the hold released by hand`; `latest: skipped: pre-release` |

`plan` writes the three "skipped: pre-release" lines, the "held" line and its own refusal, and computes the `latest` job's line for a successful run (`latest_line`); each other line is written by the job that did the work.

### `npm`

Checks out `plan`'s `sha` into `release/`, never the tag by name: tags can be moved, and the commit published must be the one `plan` judged to be on `main`. `main` is checked out beside it for the script. The job sets up Node 24 and fails unless `npm --version` is at least 11.5.1 (npm's requirement for trusted publishing; Node 24.5 and later ship it: `nodejs.org/dist/index.json`, read on 2026-11-12). For `release/npm` then `release/plugins/opencode`, `bun scripts/release/npm.ts <dir>`:

- reads the package's name and version; a version that differs from the tag's exits 1;
- runs `npm view <name>@<version> version`: a non-empty answer is "already published" and success; an empty answer, or npm's `E404` (what npm 11.19.0 answered for a missing version on 2026-11-12), is "not published"; any other failure exits 1 with npm's text (a registry error is never read as "not published");
- publishes with `npm publish --access public --ignore-scripts` (no lifecycle script of the tag's tree runs in the job that holds the publish right), adding `--tag next` for a pre-release (npm 11 refuses a pre-release without a tag) and `--dry-run` for a dry run; trusted publishing needs no token;
- a publish refused because the version exists (npm's text holds `cannot publish over` or `EPUBLISHCONFLICT`; `npm view` can answer empty for a version just published, by how long was not measured) is "already published" and success;
- on any other failed publish prints npm's text and, when it carries `ENEEDAUTH`, `E401`, `E403` or `E404`, one more sentence: the trusted publisher for this package may not be registered for `distribute.yml` and the environment `release` (see `docs/runbooks/release.md`).

Two limits: the dist-tag `next` stays on the last pre-release after a plain release supersedes it, since trusted publishing covers `npm publish` only, not `npm dist-tag`; and a version that was published and later unpublished is reported as already published.

### `tap` and `marketplace`

Both run `bun scripts/release/token.ts <owner/repo>` first (below), then `bun scripts/release/push.ts`, the one writer to another repository. It writes to that repository's default branch. Both jobs check out `main` only: the scripts and the formula's template come from `main`, which is never behind the tag being distributed, since `plan` lets only the highest tag through. Before any write it is given `plan`'s `sha` and the tag, and refuses when the tag no longer names that commit (`git ls-remote` on this repository, the peeled commit for an annotated tag): the marketplace's `ref` and the formula's URLs name the tag, so a tag moved since `plan` judged it stops both jobs. Then it clones the other repository into a temporary folder, calls the edit (the formula or the manifests), and:

- when the tree did not change: no commit, the "already at" line, exit 0;
- when it changed: one commit authored as `github-actions[bot]` with the message `wizardingcode-mem <version>`, then a push; a push refused as not fast-forward is retried once after `git pull --rebase`; a second refusal, or a rebase that fails, exits 1 with git's own words; a push that fails for any other reason is not retried and exits 1 with git's words; a push refused for permission, or by a rule on the branch, exits 1 with its own sentence;
- on a dry run: prints the changed and new files and their diff, commits and pushes nothing, the "would write" line.

The token reaches git only through the child process's environment (`GIT_CONFIG_COUNT`, `GIT_CONFIG_KEY_0=http.https://github.com/.extraheader`, `GIT_CONFIG_VALUE_0` the authorization header), on the clone, the pull and the push: never in the remote's URL, in an argument or in a file of the clone. `secrets.MARKETPLACE_TOKEN` appears in `distribute.yml` only in the `env:` of the steps of `tap` and `marketplace` that call these two scripts.

- **`tap`**: the edit is `renderFormula`: `packaging/homebrew/wizardingcode-mem.rb.template` (new; the current formula with `@VERSION@` and four `@SHA256_<OS>_<ARCH>@` marks, and a header saying the file is generated from the template and is not edited in the tap) with the tag's version and the four checksums from the release's `checksums.txt` (downloaded with `gh release download`). A file name missing from `checksums.txt`, or a mark left unreplaced, exits 1 naming it. The result is written to `Formula/wizardingcode-mem.rb`. The rendered `packaging/homebrew/wizardingcode-mem.rb` is deleted from this repository: the tap holds the only rendered formula.
- **`marketplace`**: the edit is `editManifest`: the two manifests as text, replacing only the values of the `wizardingcode-mem` entry (`version` and `source.ref` in `.claude-plugin/marketplace.json`; `source.ref` in `.agents/plugins/marketplace.json`, whose version is its `ref` without the `v`), so every other byte of each file, the other plugins' entries and the marketplace's own `metadata.version` stay as they were. An entry whose `ref` is not a `v<version>` tag, or a manifest with no `wizardingcode-mem` entry, exits 1 naming the file. When either manifest's entry is already at a higher version (another person bumped it by hand), neither file is written and the summary says so.

### `token.ts`: the token's state

One authenticated `GET /repos/<owner>/<repo>`. No token: exit 1, "the secret MARKETPLACE_TOKEN is not set in the environment release". Status 401: exit 1, the token is invalid or expired. Status 403 or 404: exit 1, the token is not granted to this repository, or the organisation has not approved it. Status 200 whose `permissions.push` is false: exit 1, the token cannot push to this repository (an early failure only: GitHub does not document whether that field reflects a fine-grained token's own grant, so a true value proves nothing and a refused push has its own sentence in the writer). Otherwise the header `github-authentication-token-expiration` gives the expiry; fewer than 30 days left prints a `::warning::` and a summary line with the date; no header prints "expiry unknown" as a `::warning::` and passes. GitHub documents the header only in its changelog of 2021-07-26 ("Expiration options for personal access tokens", `github.blog/changelog/2021-07-26-expiration-options-for-personal-access-tokens/`, read on 2026-11-12), which predates fine-grained tokens, so its presence is not relied on: the advance notice is GitHub's own email to the token's owner and the date the runbook has the author note.

### `latest`

Sets up buildx, logs in to `ghcr.io` with the run's token and, unless it is a dry run, runs `docker buildx imagetools create -t ghcr.io/wizardingcode-io/wizardingcode-mem:latest ghcr.io/wizardingcode-io/wizardingcode-mem:<version>`: the manifest list already pushed gets a second tag; nothing is rebuilt. On a dry run the retag step is skipped by its `if:`. Its first step reads the results of `npm`, `tap` and `marketplace` and, when one did not succeed, writes the "not moved" line and fails. Its last step appends `plan`'s `latest_line` to the summary. `distribute.yml` itself never moves `latest` lower: `plan` only lets the highest plain tag through. What else can move it is in Risks.

### One version order

The order is semantic versioning's precedence: numeric fields by number; a pre-release below its release; two pre-releases compared identifier by identifier, numeric ones by number and below alphanumeric ones, a shorter list below a longer one that starts the same. A `have` that is not a version (missing, or text that is not `<n>.<n>.<n>` with an optional pre-release) is older than anything, so a staged file that answers junk is replaced. There are three implementations, held equal by one table:

- TypeScript: `src/util/version.ts`, `olderThan(have, wanted)` over `Bun.semver.order`. Used by `stageBinary` and `scripts/release/`.
- JavaScript: one `older()` source in `scripts/plugins.ts`, exported as the string `OLDER_JS`: the function only, from `function older(` to its closing brace. The generator writes it into `plugins/opencode/binary.js` behind `export `; the CommonJS shim `npm/bin/wizardingcode-mem.js` carries it as it is. A test holds the shim's function byte for byte equal to `OLDER_JS`.
- Shell: the awk `older()` of `scripts/templates/wizardingcode-mem.sh`, copied into `scripts/install.sh`; a test holds the two blocks byte for byte equal.

`tests/fixtures/version-order.ts` is the table of pairs (`have`, `wanted`, `older`), including `0.9.0-rc.9` against `0.9.0-rc.10`, `0.9.0-rc.1` against `0.9.0`, `0.10.0` against `0.9.0`, a missing `have`, a `have` that is not a version, and equal versions. One test runs every pair through each of the three implementations.

### The writers of `<data dir>/bin`

- **The npm shim**: downloads when there is no staged binary or `older(staged, package)`; with a newer staged binary it downloads nothing, runs it, and prints one line on standard error: `wizardingcode-mem: running <staged> already in <path>; this package is <version>`.
- **`stageBinary(source, dataDir, options)`**: `options` is `{ version, force }`, the source's version (the caller passes its own `package.json` version: the source is the running binary) and whether the person asked to replace. It returns `{ path, kept }`, `kept` being the staged version left in place or null. The staged file's version is `<staged> --version` with a 10-second limit; a file that cannot be run, does not exit 0 in time, or prints something that is not a version, is replaced. A staged version above `version` is kept unless `force`; equal or below is replaced (a local build at the same version still replaces, as today).
- **`wizardingcode-mem install`** stages once per run, after the agents are known and before the first is installed, not once per agent. When a newer binary was kept it prints once `A newer wizardingcode-mem (<staged>) is already in <path>; this one is <version> and was not put in its place. wizardingcode-mem install --force replaces it.` and hands over: it runs the staged binary with the same arguments and returns its exit code, so no step of the install runs in the older binary against a store the newer one may have migrated. `--force` is a new flag of `install`, passed to `stageBinary`. With `--binary <path>` nothing is staged, as today.
- **`scripts/install.sh`**: after the checksum, when a staged binary answers `--version` with a version and the download's version is older than it, the download is discarded, one line says the newer version stays, and the script goes on to `install` with the staged binary; `--force` anywhere among the script's arguments replaces it and is passed on to `install` (`--download-only`, when given, is still the first argument, as today). Only the first line of a `--version` answer is read, and it must match the version pattern. A download that does not answer `--version` exits 1 saying the downloaded binary does not run.

### What the author does once

Written in `docs/runbooks/release.md` (new), in this order, with what a run shows, the repeat, the repairs and the way back:

1. Check that the ruleset on `main` requires a pull request and its status checks and has no bypass actor; once a second person has write access, require one approval.
2. Create a ruleset on tags matching `v*` that restricts creations, updates and deletions, with repository admins as its only bypass.
3. Create the environment `release` in this repository, or open it if it already exists and remove any secret found in it; set its deployment branches to "Selected branches and tags" with the one branch `main`, before anything is put in it.
4. Create a fine-grained token for `WizardingCode-io/homebrew-wizardingcode` and `WizardingCode-io/wizardingcode-plugins`, contents read and write, one year; note its expiry date; check that neither repository's default branch requires a pull request from the token's owner; store the token as the environment secret `MARKETPLACE_TOKEN`.
5. On npmjs.com, for `wizardingcode-mem` and `wizardingcode-mem-opencode`: add a trusted publisher, repository `WizardingCode-io/wizardingcode-mem`, workflow `distribute.yml`, environment `release`.

Renaming `distribute.yml` or the environment breaks publishing until the trusted publishers are registered again; a comment at the top of the workflow says so.

### The first release

The first tag that carries this item is pushed after steps 1 and 2 and before step 3, while the environment does not exist: the tag's automatic run stops at `plan`'s refusal 10 and writes nothing. The author then does steps 3 to 5, dispatches `distribute.yml` from `main` with the tag and `dry_run: true`, reads the summary, and dispatches again without it. The dry run proves `plan`, the token's read, the version checks, the render and the edits; it makes none of the four external writes, so the dispatch after it is their first test. From the second release on, the tag's own run distributes.

Until the setup exists `distribute.yml` stops in `plan` (the environment) or fails in the job that lacks its piece (the secret, a trusted publisher), each with its named message, and `latest` stays where it is; the GitHub release is unaffected.

### Alternatives

Copied from the concept brief, with those the reviews added.

- **One `release.yml` with a `plan` job and a dispatch trigger.** Rejected: a job that needs a skipped job is skipped too while the run still reports success, and a dispatch builds the branch it was started on. The author chose the separate file (D-1).
- **`distribute.yml` on the `release: published` event.** Rejected: a release created with the workflow's own token starts no other workflow; a dispatch from `release.yml`'s last job does.
- **The contents API for the other repositories.** Rejected: each write needs the file's sha, a base64 body and a hand-made comparison to know nothing changed, and a stale read ends in a 409; a clone and a push give the same result under git's own conflict rule.
- **The contract rule moved to piece 3.** Not taken: the author kept it in this piece, corrected, with the manual release (D-2), knowing that nothing reads `latest` until piece 3.
- **The contract rule as first worded** (hold on any rise of `CONTRACT`). Rejected by the author: it holds where nobody is refused and releases only with another release.
- **No `latest` at all until piece 3.** Rejected: D-1 of `2026-11-11-004` keeps `latest`, and moving it last stops a failed release from reaching a host that follows it.
- **A hand copy of `older()` in each writer with its own tests.** Rejected: separate copies, each with its own tests, have nothing that holds them equal, and the two that exist already disagree with semver on pre-releases. The chosen design keeps the copies and adds the one table every copy is run against and two byte-for-byte tests.
- **Pre-releases narrowed to `-rc.<n>`** so the copies compare one integer. Rejected: binaries already staged may carry any pre-release, and a rule narrower than `Bun.semver.order` would make the three implementations disagree again.
- **Editing the manifests by parsing and re-serialising the JSON.** Rejected: the agents' manifest holds one-line inline objects, so a re-serialisation rewrites bytes this item must leave alone.
- **No way back at all.** Kept for every automatic channel, which never moves back; rejected for a person, who needs one command when debugging: `install --force`.
- **A weekly scheduled check of the token.** Removed by the author (D-3): the expiry header may be absent for a fine-grained token, GitHub disables a scheduled workflow in a public repository after 60 days without repository activity (its "Events that trigger workflows" page, read on 2026-11-12), and GitHub already emails the owner; the check on the release run stays.
- **Per-target forward-only rules** (npm's dist-tag, the tap's version, each manifest). Rejected: the one highest-tag rule in `plan` covers every target; the marketplace keeps its own check because another person may bump it by hand.
- **Reading the current `latest` image's version label before the retag.** Rejected: a per-platform config lookup on a manifest list, for a guarantee the highest-tag rule already gives inside this workflow.
- **The environment's rule left to the runbook alone.** Rejected: a workflow that names a missing environment would create it with no rule; the check in `plan` costs two API reads.
- **The ruleset on `v*` tags as the only tie between a tag and `main`.** Rejected: a ruleset is a setting outside the repository's files that nothing here can test; the ancestor check is code with a unit test. Both are kept (D-4).

## Acceptance criteria

The numbering starts at AC-57, where this item's counter in the engine stands. "(observed)" marks a criterion a person checks by reading, since no test can fail first.

- AC-57: Every pair of `tests/fixtures/version-order.ts` gets the same answer from `olderThan` (`src/util/version.ts`), from the generated JavaScript `older()` and from the shell `older()`; `0.9.0-rc.9` is older than `0.9.0-rc.10`, and a `have` that is not a version is older, in all three.
- AC-58: The `older()` in `npm/bin/wizardingcode-mem.js` equals `OLDER_JS` byte for byte, and the `older()` block of `scripts/install.sh` equals the one in `scripts/templates/wizardingcode-mem.sh` byte for byte.
- AC-59: The npm shim, with a newer binary staged, downloads nothing, runs the staged binary with the arguments and exit code passed through, and prints the one line on standard error; with an older binary staged it downloads the package's version.
- AC-60: `stageBinary` keeps a staged binary of a higher version and returns it as `kept`; it replaces a staged binary of an equal or lower version, one that cannot be run, one that exits non-zero on `--version`, one whose `--version` output is not a version, and, with `force`, one of a higher version.
- AC-61: `wizardingcode-mem install` with two agents found and a newer binary staged prints the "newer … is already in" line once and hands the install over to the staged binary, which is run once with the same arguments and whose exit code is returned; with `--force` the staged binary is replaced by the running one, the line is absent, and both agents' hooks point at the staged path.
- AC-62: `scripts/install.sh --download-only` with a newer binary staged leaves it in place and says so; `--force` anywhere among the arguments replaces it; a staged file that answers something other than a version is replaced.
- AC-63: The formula rendered from the template with a version and a `checksums.txt` holds that version in every URL and each of the four checksums under its platform's block, and no mark; a `checksums.txt` lacking one of the four names fails, naming it.
- AC-64: The marketplace edit changes, in each manifest's text, only the `wizardingcode-mem` entry's `version` and `ref` values and leaves every other byte equal; when either manifest's entry is at a higher version it writes neither and reports it; it fails for an entry whose `ref` is not a version tag or that is missing.
- AC-65: The plan's decision refuses, each with its sentence: a ref other than `refs/heads/main`; a malformed tag; a tag that does not exist; a tag whose commit is not on `main`; a tag whose version is not its commit's `package.json` version; a tag whose tree lacks `distribute.yml`; a plain tag that is not the highest plain tag, and a pre-release tag that is not the highest tag; a release that does not exist; a draft release; a release that lacks an asset (the sentence names it); an environment `release` that is missing, and one whose rule is not exactly the branch `main`. It accepts a plain `v0.9.1` while a `v0.10.0-rc.1` tag exists, and for an accepted tag gives the version, the tag's commit and whether it is a pre-release. The tag list it is given holds only tags merged into `main` that are version tags: a `v99.0.0` on a branch commit and a `vnext` tag change no decision.
- AC-66: The hold decision is "held" when the tag's lowest accepted contract is above the previous plain release's `CONTRACT`; "not held" when it is not, when there is no previous plain release and when the file is missing at it; "held", naming the read that failed, when the constants cannot be read at the tag and when the file is present but unreadable at the previous plain release; and "not held", marked as released by hand, when it would be held and `release_hold` is true. The parser's reading of the real `src/team/contract.ts` equals the `CONTRACT` and `ACCEPTED_CONTRACTS` the file exports.
- AC-67: The npm decision exits 1 for a package whose version differs from the tag's; reads a non-empty `npm view` answer as published, an empty answer or `E404` as not published and any other failure as an error; builds `npm publish --access public --ignore-scripts`, with `--tag next` for a pre-release and without it for a plain release, and with `--dry-run` on a dry run; reads a publish refused because the version exists as already published; and adds the trusted-publisher sentence to an authentication failure.
- AC-68: The token decision maps no token, 401, 403, 404 and a 200 whose push permission is false each to its failure sentence, 200 with fewer than 30 days left to a warning, and 200 with no expiry header to an "expiry unknown" warning and a pass.
- AC-69: `release.yml`: `docker`'s tags carry no `latest`; `publish` checks out with `fetch-depth: 0`; a job `distribute` needs `publish`, has `actions: write`, runs `gh workflow run distribute.yml --ref main` with the tag, and its `run:` holds no `${{`.
- AC-70: `distribute.yml`: the only trigger is `workflow_dispatch` with `tag`, `dry_run` and `release_hold`; top-level `permissions` is empty; one concurrency group, not cancelled; every job runs on `ubuntu-latest` with `timeout-minutes: 15`; `npm`, `tap` and `marketplace` name the environment `release` and `plan` and `latest` name none; only `npm` has `id-token: write` and only `latest` has `packages: write`; the run is named `distribute <tag>`; `latest` needs `plan`, `npm`, `tap` and `marketplace`; `tap`, `marketplace` and `latest` are conditioned on a plain release, `latest` on no hold and on not being cancelled, with a first step that fails when a needed job did not succeed, and `latest`'s retag step on no dry run; `npm`'s checkout of the release's tree takes its `ref` from `plan`'s `sha` output, and no checkout takes `inputs.tag`.
- AC-71: In `distribute.yml`, no `run:` script contains `${{`; every `uses:` is pinned to a 40-character commit SHA; every `actions/checkout` has `persist-credentials: false`; and `secrets.MARKETPLACE_TOKEN` appears exactly four times, each in the `env:` of a step of the jobs `tap` and `marketplace`.
- AC-72: The writer to another repository, run against a local bare repository: an unchanged tree makes no commit and reports "already at"; a changed tree makes one commit `wizardingcode-mem <version>` and pushes it; a push refused as not fast-forward succeeds after one rebase; a dry run leaves the remote as it was; the git commands and remote URL it builds carry no token, which travels only in the child's environment; and, given a commit the tag no longer names, it refuses before any write, for a lightweight and for an annotated tag.
- AC-73: `summaryLine` gives, for each target and outcome of the summary table, exactly that text, the token's three lines, a failed target's line, the plan's refusal and the "not moved" line included; `plan` writes the three "skipped: pre-release" lines for a pre-release, the "held" line for a hold and its refusal line when it refuses.
- AC-74 (observed): `docs/runbooks/release.md` holds the one-time setup in its order (the ruleset on `main` checked, with one approval to require once a second person has write access; the ruleset on `v*` tags; the environment's rule before the secret and any secret found there removed; the token with its date noted; the two trusted publishers), the first release's order (the refused automatic run, the dry run and what it does not prove, the real dispatch), what a run shows, the repeat, the repairs (a release that lacks an asset; a tag whose release failed, which blocks the repeat of the release before it; each of the four external writes' failure message), the way back (`install --force`; a bad release is fixed by a higher version; do not re-run a run whose write was reverted by hand), the release of a hold, and the limits (a third dispatch replaces a pending one; the dist-tag `next`; shims already published; the release's assets are not tied to the judged commit, with making releases immutable where the repository's settings offer it; `latest` can be moved outside the workflow).
- AC-75 (observed): `docs/runbooks/team-server.md` says `latest` moves last and may be held, and cites the release runbook.
- AC-76 (observed): `docs/adr/0029-release-distribution.md` records the decisions D-1 to D-5 and those carried from `2026-11-11-004`, the alternatives and the limits, including that a staged file answering a very high version is replaced only by `--force`, and that it supersedes the Homebrew row of ADR 0008.
- AC-77 (observed): `CLAUDE.md` names the two workflows, the scripts under `scripts/release/`, the environment, the forward-only rule with `install --force`, the runbook and the ADR.
- AC-78: `tests/unit/release-docs.test.ts` holds the release's documents to the code: the team runbook and `CLAUDE.md` cite `docs/runbooks/release.md`; `CLAUDE.md` names the two workflows, `scripts/release/lib.ts`, ADR 0029, `install --force` and the environment `release`; every `wizardingcode-mem` command the release runbook cites is one the CLI knows, with a flag its module names; every repository file it cites exists; and the lines of its "What a run shows" section are exactly the lines `summaryLine` can write, none left out. It supersedes AC-75 and AC-77 (the gates' second round, 2026-11-12: what a test can check in a document is checked by a test; the sentences of the documents stay for a reader).

## Risks and rollback

- **The first real run is the first exercise of four external calls.** Trusted publishing, the token's writes, the expiry header and the retag cannot run before a tag exists on `main`. The dry run of the first release exercises `plan`, the token's read, the checks, the render and the edits, and none of those four; the first real dispatch is their test. A partial failure there is repaired by repeating the dispatch, each failure has a named message, the pure decisions are unit-tested, and the workflow files are tested by their criteria.
- **A failed target leaves channels divergent.** That is today's state after a forgotten hand step, with two differences: the summary names the failed target, and one dispatch repeats it.
- **A bad write to the tap or the marketplace** is reverted with a commit in that repository; the old run is not re-run afterwards (it would write again). A bad release is fixed by a higher version: npm versions cannot be reused, and no channel moves back by itself.
- **A stolen `MARKETPLACE_TOKEN`** can repoint every plugin in the marketplace. It is an environment secret behind the `main`-only rule, which `plan` checks before any job enters the environment; `main` takes changes only by pull request; the token is used by two jobs, valid one year, and granted two repositories' contents only. Someone who can merge to `main` can change `distribute.yml` itself: the ruleset requires a pull request with green checks and no approval (D-5), which is enough while the author is the only person with write access and must gain a required approval when a second person has it. Someone who can change the environment's settings or the rulesets is a repository admin and is outside this design. The token is one person's: if its owner loses access to the organisation, the tap and marketplace writes stop until another token is stored.
- **The release's binaries are not tied to the judged commit.** Someone with contents write can replace a release's assets and `checksums.txt` between the release and its distribution; the tap would then carry the replaced checksums. This exposure exists today for every channel that downloads from the release; signatures are a non-goal; the runbook has the author make releases immutable if the repository's settings offer it (not checked for this repository).
- **`latest` can be moved outside `distribute.yml`.** A tag on an older commit runs that commit's `release.yml`, which still pushes `latest`; a branch's own workflow can ask for `packages: write` and retag it. The ruleset on `v*` tags (D-4) closes the first for everyone but admins; the second stays. Nothing reads `latest` until piece 3, whose spec must take it up.
- **A bad high version stays.** A staged binary that answers a very high version is kept by every channel until a person runs `install --force`. With the ruleset on `v*` tags only an admin can cut a release that carries one. Detection (`doctor` naming the staged version) is piece 2's.
- **The hold's window is one release.** Members two or more releases behind are refused by a release that drops their contract, and the hold does not see them.
- **A tag whose release failed blocks the one before it.** The highest-tag rule counts tags: when `v0.9.1` is tagged and its `release.yml` fails, a repeat of `v0.9.0` is refused as not the highest and `v0.9.1` is refused for having no release, until that release is completed (re-run `release.yml`) or the tag is deleted by an admin. The rule stays on tags: a tag is the author's statement that a newer version supersedes the older.
- **A stray or hand-made release.** Without the ruleset on `v*` tags a writer could tag a correctly versioned commit of `main`, make a release by hand with their own assets and dispatch the distribution: the tap would carry their checksums. `plan` cannot tell a release made by `release.yml` from one made by hand; the mandatory ruleset (D-4) reserves tags to admins, and Risks' entry on the release's binaries applies.
- **A third dispatch replaces a pending one.** The concurrency group keeps one run in progress and one pending; a third cancels the pending one, which may be a tag's automatic run. The runbook says to wait for a run before starting another.
- **`latest` may lag** when npm, the tap or the marketplace fail, by design: a release that did not reach every channel is not the one a server should follow.
- **The contract parser reads source text.** A change to the declarations makes the unit test fail before a release; at run time an unreadable file holds `latest`.
- **Shims already on machines** (0.4.4) keep replacing on any difference. No mitigation in this item; the first forward-only shim is the release that carries it.
- **The first publish moves unpinned npm users from 0.4.4 in one step** (`npx wizardingcode-mem`, the OpenCode package), across every store migration since; a 0.4.4 shim left on such a machine then meets a store it refuses. The way back is the current package, or a backup. The runbook has the first release go out as a pre-release under `next` first (the gates' fourth round, 2026-11-12).
- **Rollback of this item**: revert the commit. `release.yml` pushes `latest` from `docker` again and the hand procedure applies; the environment, the secret, the rulesets and the trusted publishers stay unused. A staged binary is unaffected.

## Non-Functional Requirements

- **Security**: in `distribute.yml` and in `release.yml`'s `distribute` job nothing reaches a shell by interpolation; the token and the OIDC permission exist only in jobs behind the environment; `plan` refuses a ref other than `main`, a tag that is not on `main` and an environment without its rule before any other job runs; actions are pinned by commit.
- **Rollout**: merged to `main` before the next tag; the first release follows "The first release". Rollback is in the section above.

## Cost and duration

The build is this one item, in six phases, each ending with `bun run check` passing: the version order; the three writers; the release's decisions; their commands; the workflows; the documents. The author's time is the one-time setup (five settings pages) and the first release's two dispatches. Recurring: one token renewal a year. No time estimate is given for the build: it is an agent session whose length gates nothing, and what gates the first release is the author's setup above. The midway checks are each phase's tests and, for what no test reaches, the first release's dry run.
