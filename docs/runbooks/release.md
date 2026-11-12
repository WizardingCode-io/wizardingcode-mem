# Releasing wizardingcode-mem

For the author. A pushed tag `v<version>` builds the release and carries it to every place people install from: the GitHub release, the team server's image, npm (two packages), the Homebrew tap and the plugin marketplace. The reasons for this shape are in [ADR 0029](../adr/0029-release-distribution.md).

## Cutting a release

1. Bring the version to `<version>` in `package.json`, `npm/package.json` and `.env.example`, run `bun run plugins`, and merge that to `main` by a pull request.
2. Tag the merge commit and push the tag: `git tag -a v<version> <sha> -m "wizardingcode-mem <version>"`, then `git push origin v<version>`.
3. `.github/workflows/release.yml` checks, builds five binaries, signs the macOS ones, pushes the image with the version as its tag, creates the GitHub release with `checksums.txt`, and starts `.github/workflows/distribute.yml` from `main` with the tag.
4. `distribute.yml` publishes `wizardingcode-mem` and `wizardingcode-mem-opencode` to npm, writes the formula to `WizardingCode-io/homebrew-wizardingcode`, writes the plugin's entry to `WizardingCode-io/wizardingcode-plugins`, and then tags the image `latest`. It is a run of its own: `release.yml` turns green as soon as that run is started, whatever becomes of it. Open the run named `distribute v<version>` under Actions and read its summary; a release is distributed when that run is green, not when `release.yml` is.

A tag with a hyphen (`v0.9.0-rc.1`) is a pre-release: the two npm packages go out under the dist-tag `next`, and the tap, the marketplace and `latest` are left as they are.

## The one-time setup

In this order. Until it is done `distribute.yml` stops with a sentence that names the missing piece, and the GitHub release itself is unaffected.

1. **The ruleset on `main`.** Check that it requires a pull request and its status checks and has no bypass actor. It requires no approving review today, which is enough while one person has write access: the distribution trusts whatever is on `main`, so once a second person can write, require one approval.
2. **A ruleset on tags.** Create one that targets tags matching `v*` and restricts creations, updates and deletions, with repository admins as its only bypass. Without it, anyone with write access can push a `v*` tag: the workflow refuses a tag that is not on `main` or whose version is not its commit's, but a stray tag on `main` blocks later releases until it is deleted, and a tag on an old commit runs that commit's own `release.yml`.
3. **The environment `release`.** Create it in this repository's settings; if it already exists, open it and remove any secret found in it. Set "Deployment branches and tags" to "Selected branches and tags" with the one branch `main`, before anything is put in it. `distribute.yml` reads this rule and refuses to run without it.
4. **The token.** Create a fine-grained personal access token for the two repositories `WizardingCode-io/homebrew-wizardingcode` and `WizardingCode-io/wizardingcode-plugins`, with "Contents: read and write", valid one year. Note its expiry date where you will see it: GitHub emails the owner before it expires, and a release run warns within thirty days only when GitHub returns the expiry. Check that neither repository's default branch requires a pull request from you. Store the token in the environment `release` as the secret `MARKETPLACE_TOKEN`.
5. **npm.** On npmjs.com, for each of `wizardingcode-mem` and `wizardingcode-mem-opencode`, add a trusted publisher: repository `WizardingCode-io/wizardingcode-mem`, workflow `distribute.yml`, environment `release`. Renaming the workflow file or the environment breaks publishing until both are registered again.

If the repository's settings offer immutable releases, turn them on: a release's binaries and `checksums.txt` can otherwise be replaced by anyone with write access after the release is made.

## The first release

The first tag that carries this procedure is pushed after steps 1 and 2 and before step 3, while the environment does not exist:

1. Push the tag. `release.yml` makes the release; the run of `distribute.yml` it starts stops in `plan` with "the environment release does not exist" and writes nothing.
2. Do steps 3 to 5 of the setup.
3. Start `distribute.yml` from `main` (Actions, "distribute", "Run workflow") with the tag and `dry_run` on. Read the summary: it says what each target would write. A dry run proves the checks, the token's read, the formula and the manifests' edits. It makes none of the four writes to the outside (the npm publish, the two pushes, the image's retag), so it cannot show that they will succeed.
4. Start it again with `dry_run` off. This is the first test of those four writes. If one fails, fix its cause and start the workflow again: what already succeeded is found done and is not written twice.

From the second release on, the tag's own run distributes.

## What a run shows

One line per target in the run's summary, in these words:

| Target | Lines |
| :- | :- |
| npm, per package | `<name> <version>: published (dist-tag <dist-tag>)`; `<name> <version>: already published`; `<name> <version>: would publish (dry run)` |
| the token, per repository | `MARKETPLACE_TOKEN expires on <date> (<n> days)`; `renew it: MARKETPLACE_TOKEN expires on <date> (<n> days)`; `MARKETPLACE_TOKEN: expiry unknown (no expiration header); check the date noted when it was created` |
| tap | `tap: written, <version>`; `tap: already at <version>`; `tap: would write <version> (dry run)`; `tap: skipped: pre-release` |
| marketplace | `marketplace: written, <version>`; `marketplace: already at <version>`; `marketplace: left alone, the manifest names <higher>`; `marketplace: would write <version> (dry run)`; `marketplace: skipped: pre-release` |
| latest | `latest: moved to <version>`; `latest: would move to <version> (dry run)`; `latest: held: <tag> accepts contract <n> and up; <previous> speaks <n>`; `latest: held: <the read that failed>`; `latest: moved to <version>, the hold released by hand`; `latest: not moved: <job> did not succeed`; `latest: skipped: pre-release` |
| a failure | `tap: failed: <sentence>`, and the same with the name of any other target; `distribute: refused: <sentence>` when the first job refuses the tag |

The dist-tag is "latest" for a plain release and "next" for a pre-release.

The image's latest tag moves last, and only when npm, the tap and the marketplace all succeeded.

## Repeating a target

Start `distribute.yml` from `main` with the same tag. Every target checks what is there first: a package already on npm, a formula or a manifest already at the version, is reported and left alone. Only the highest release can be repeated: an older tag is refused, so no channel is ever moved back.

Wait for a run to end before starting another. The workflow runs one at a time and keeps one waiting; a third started meanwhile replaces the one that waits.

## Repairs

- **`distribute: refused: the GitHub release <tag> lacks: …`** The release was created and an upload failed. Upload the missing files with `gh release upload <tag> <files>` if you still have the run's artifacts, or delete the release and the tag (an admin's act) and tag again.
- **A tag whose release failed.** If `v0.9.1` is tagged and its `release.yml` fails, `v0.9.1` has no release and `v0.9.0` is no longer the highest, so neither can be distributed. Re-run the failed jobs of `v0.9.1`'s `release.yml`, or delete the `v0.9.1` tag.
- **npm fails with the sentence about the trusted publisher.** Step 5 of the setup is missing for that package, or names another workflow or environment.
- **`MARKETPLACE_TOKEN is not granted to <repository>, or the organisation has not approved it`.** The token does not cover that repository, or the organisation requires approval for fine-grained tokens and has not given it.
- **`the push to <repository> was refused: MARKETPLACE_TOKEN may lack contents write there`.** The token reads but cannot write: give it "Contents: read and write", or lift a rule on that repository's default branch that stops a direct push.
- **`the push to <repository> was refused by a rule on its branch`.** That repository's default branch does not take a direct push from the token's owner (step 4 of the setup), whether by a branch protection or by a ruleset: lift the rule for that person, then start the workflow again.
- **`<tag> no longer names the commit that was judged`.** The tag was moved while the run was going. Find out who moved it and why before anything else.
- **The image's retag fails.** The version's image is missing from `ghcr.io/wizardingcode-io/wizardingcode-mem` (look at `release.yml`'s `docker` job), or the package's settings do not let this repository's workflows write to it.

## A bad release

A release that should not have gone out is fixed by a higher version. npm versions cannot be reused, and nothing moves a channel back by itself: the plugins, the npm package, the curl script and `wizardingcode-mem install` all keep a newer binary that is already on a machine.

A wrong write to the tap or the marketplace is reverted with a commit in that repository. Do not start `distribute.yml` again for that tag afterwards: it would write it again.

The image's `latest` is moved back by hand, since the workflow only ever distributes the highest release: `docker buildx imagetools create -t ghcr.io/wizardingcode-io/wizardingcode-mem:latest ghcr.io/wizardingcode-io/wizardingcode-mem:<previous version>`, logged in to `ghcr.io` with an account that can write the package.

## A person's way back

On one machine, to put an older binary in place of a newer one: run the older binary as `wizardingcode-mem install --force`. With the curl script, pass `--force` among its arguments. Without it, an older binary says that a newer one is in place and hands the install over to it.

Two things limit it. An agent's plugin that is still at the newer version puts the newer binary back at its next session start, so the plugin has to go back too (or be removed) for the older binary to stay. And an older binary refuses a store the newer one has already migrated (`SchemaTooNewError`): going back across a schema change also means restoring the store from a backup made before it (`wizardingcode-mem backup --list`).

## Releasing a hold

`latest` is held when the new release's server would refuse the members still on the previous release: its lowest accepted contract is above the contract the previous release speaks. The summary says `latest: held: <tag> accepts contract <n> and up; <previous> speaks <n>`, each `<n>` being that release's own contract number. When those members have updated, start `distribute.yml` with the tag and `release_hold` on.

The rule looks one release back, which is what the server promises (it accepts its own contract and the one before). A member two or more releases behind is refused by a release that drops their contract whether `latest` is held or not.

A hold that names a file (`latest: held: src/team/contract.ts at <tag>`) means the rule could not read the contract there and held to be safe.

## Limits

- The dist-tag `next` on npm stays on the last pre-release after a plain release supersedes it.
- A version published to npm and later unpublished is reported as already published.
- Copies of the npm package from before this procedure (0.4.4) still replace a newer binary with their own older one. They cannot be changed; installing the current package removes the problem.
- The release's binaries and image were built when the tag was pushed. `checksums.txt` ties them to the release, not to the commit the distribution judged.
- `latest` can still be moved by a workflow outside `distribute.yml`: a tag on an old commit runs that commit's `release.yml`, which pushed `latest` itself. The ruleset on tags closes that for everyone but admins. Nothing reads `latest` yet; the team runbook pins a version.
- The token belongs to one person. If that person loses access to the organisation, the tap and marketplace writes fail until another token is stored.
