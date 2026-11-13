# Releasing wizardingcode-mem

For the author. A pushed tag `v<version>` builds the release and carries it to every place people install from: the GitHub release, the team server's image, npm (two packages), the Homebrew tap and the plugin marketplace. The reasons for this shape are in [ADR 0029](../adr/0029-release-distribution.md).

## Cutting a release

1. Bring the version to `<version>` in `package.json`, `npm/package.json` and `.env.example`, run `bun run plugins`, and merge that to `main` by a pull request.
2. Tag the merge commit and push the tag: `git tag -a v<version> <sha> -m "wizardingcode-mem <version>"`, then `git push origin v<version>`.
3. `.github/workflows/release.yml` checks, builds five binaries, signs the macOS ones, pushes the image with the version as its tag, creates the GitHub release with `checksums.txt`, and starts `.github/workflows/distribute.yml` from `main` with the tag.
4. `distribute.yml` publishes `wizardingcode-mem` and `wizardingcode-mem-opencode` to npm, writes the formula to `WizardingCode-io/homebrew-wizardingcode`, writes the plugin's entry to `WizardingCode-io/wizardingcode-plugins`, and then signs the image and tags it `latest`. It is a run of its own: `release.yml` turns green as soon as that run is started, whatever becomes of it. Open the run named `distribute v<version>` under Actions and read its summary; a release is distributed when that run is green, not when `release.yml` is. Clients are told from the GitHub release, not from the end of this run (ADR 0030): while it is stopped, failed or held, `status` and `doctor` already say the version is out, and the Homebrew, npm and plugin commands find nothing newer; only the curl script does.
5. A release asks for one approval. When `npm`, `tap` and `marketplace` succeeded, the job `latest` waits for you: it signs the image and moves the image's `latest` tag, and it sits in the environment `release-sign`, which has a required reviewer. Before approving, read the line that begins "image:" in the run's summary (see "The image line"). It names the tag, the release run that built the image and the digest. Open that run and check three things: it is the push of this tag, it is on `main`, and the step of its `docker` job that records the digest printed the digest of the line. The check is of the run: the digest of the line was read from that same run, so it is no second source. A dry run asks for the approval too.

A tag with a hyphen (`v0.9.0-rc.1`) is a pre-release: the two npm packages go out under the dist-tag `next`, and the tap, the marketplace and `latest` are left as they are. Its image is not signed, and no approval is asked.

## The one-time setup

In this order. Until it is done `distribute.yml` stops with a sentence that names the missing piece, and the GitHub release itself is unaffected.

1. **The ruleset on `main`.** Check that it requires a pull request and its status checks and has no bypass actor. It requires no approving review today, which is enough while one person has write access: the distribution trusts whatever is on `main`, so once a second person can write, require one approval. That ruleset is also the only control on the file that holds `id-token: write`, the permission a signature is made with: whoever can change `distribute.yml` on `main` can get any image signed. Before a second person gets write access, require one approval, of the most recent push, covering the workflows' folder (a `CODEOWNERS` line for `.github/workflows/`).
2. **A ruleset on tags.** Create one that targets tags matching `v*` and restricts creations, updates and deletions, with repository admins as its only bypass. Without it, anyone with write access can push a `v*` tag: the workflow refuses a tag that is not on `main` or whose version is not its commit's, but a stray tag on `main` blocks later releases until it is deleted, and a tag on an old commit runs that commit's own `release.yml`.
3. **The environment `release`.** Create it in this repository's settings; if it already exists, open it and remove any secret found in it. Set "Deployment branches and tags" to "Selected branches and tags" with the one branch `main`, before anything is put in it. `distribute.yml` reads this rule and refuses to run without it. This environment keeps no reviewer: npm, the tap and the marketplace are published without an approval.
4. **The environment `release-sign`.** Create a second environment with that name, for the one job that signs the image. Set "Deployment branches and tags" to "Selected branches and tags" with the one branch `main`. Under "Required reviewers" add yourself, and leave "Prevent self-review" off: you are the only maintainer. Turn off "Allow administrators to bypass configured protection rules". Put no secret in it. `distribute.yml` refuses a distribution while this environment is missing, allows another branch or has no required reviewer, and says so in its summary when administrators can bypass its rules.
5. **Public, both.** Keep the repository and the image's package public. Checking a signature with no login needs a public package; a required reviewer on an environment is not offered to a private repository on every plan; and a signature writes the repository's name into Sigstore's public log.
6. **The token.** Create a fine-grained personal access token for the two repositories `WizardingCode-io/homebrew-wizardingcode` and `WizardingCode-io/wizardingcode-plugins`, with "Contents: read and write", valid one year. Note its expiry date where you will see it: GitHub emails the owner before it expires, and a release run warns within thirty days only when GitHub returns the expiry. Check that neither repository's default branch requires a pull request from you. Store the token in the environment `release` as the secret `MARKETPLACE_TOKEN`.
7. **npm.** On npmjs.com, for each of `wizardingcode-mem` and `wizardingcode-mem-opencode`, add a trusted publisher: repository `WizardingCode-io/wizardingcode-mem`, workflow `distribute.yml`, environment `release`. Renaming the workflow file or the environment breaks publishing until both are registered again. Renaming the workflow file or the default branch also breaks every signature check: the name of both is what a host verifies (ADR 0032).

If the repository's settings offer immutable releases, turn them on: a release's binaries and `checksums.txt` can otherwise be replaced by anyone with write access after the release is made.

## The first release

Make the first tag a pre-release (`v<version>-rc.1`). A pre-release publishes the two npm packages under `next`, where nobody who did not ask for it gets it, and leaves the tap, the marketplace and `latest` alone: trusted publishing gets its first real test with the smallest audience. The plain tag follows once that worked, and then tests the two pushes, the image's signature and the retag.

That first plain publish also takes every npm user who pinned no version from 0.4.4 to the current version in one step, across every store change since. Say so in the release's notes.

The first tag that carries this procedure is pushed after steps 1 and 2 and before step 3, while the environment does not exist:

1. Push the tag. `release.yml` makes the release; the run of `distribute.yml` it starts stops in `plan` with "the environment release does not exist" and writes nothing.
2. Do steps 3 to 7 of the setup.
3. Start `distribute.yml` from `main` (Actions, "distribute", "Run workflow") with the tag and `dry_run` on. Read the summary: it says what each target would write. A dry run proves the checks, the token's read, the formula and the manifests' edits. It makes none of the five writes to the outside (the npm publish, the two pushes, the image's signature, the image's retag), so it cannot show that they will succeed. For a plain tag it asks for the approval of `latest` as a real run does, and it is the first time the workflow's own token reads the two environments and the release run's recorded digest: a refusal or a line that begins "image: no digest" here is found before anything is written.
4. Start it again with `dry_run` off. This is the first test of the writes that tag makes: for a pre-release, the npm publish alone; for a plain tag, all five. The signature of the first plain release is the first one ever made by this workflow: no test makes a real one. After it, read the two `latest` lines of the summary, and run the command the first of them gives, by hand, against the new digest: it must exit 0 with no login. If one fails, fix its cause and start the workflow again: what already succeeded is found done and is not written twice.

From the second release on, the tag's own run distributes.

## What a run shows

One line per target in the run's summary, in these words:

| Target | Lines |
| :- | :- |
| npm, per package | `<name> <version>: published (dist-tag <dist-tag>)`; `<name> <version>: already published`; `<name> <version>: would publish (dry run)` |
| the token, per repository | `MARKETPLACE_TOKEN expires on <date> (<n> days)`; `renew it: MARKETPLACE_TOKEN expires on <date> (<n> days)`; `MARKETPLACE_TOKEN: expiry unknown (no expiration header); check the date noted when it was created` |
| tap | `tap: written, <version>`; `tap: already at <version>`; `tap: would write <version> (dry run)`; `tap: skipped: pre-release` |
| marketplace | `marketplace: written, <version>`; `marketplace: already at <version>`; `marketplace: left alone, the manifest names <higher>`; `marketplace: would write <version> (dry run)`; `marketplace: skipped: pre-release` |
| latest | `latest: moved to <version>`; `latest: would move to <version> (dry run)`; `latest: held: <tag> accepts contract <n> and up; <previous> speaks <n>`; `latest: held: <the read that failed>`; `latest: moved to <version>, the hold released by hand`; `latest: skipped: pre-release` |
| latest, the signing | `latest: signed <digest>; check it with: cosign verify ghcr.io/wizardingcode-io/wizardingcode-mem@<digest> --certificate-identity https://github.com/WizardingCode-io/wizardingcode-mem/.github/workflows/distribute.yml@refs/heads/main --certificate-oidc-issuer https://token.actions.githubusercontent.com`; `latest: already signed <digest>; check it with: cosign verify ghcr.io/wizardingcode-io/wizardingcode-mem@<digest> --certificate-identity https://github.com/WizardingCode-io/wizardingcode-mem/.github/workflows/distribute.yml@refs/heads/main --certificate-oidc-issuer https://token.actions.githubusercontent.com`; `latest: would sign <digest> (dry run); a signed image is checked with: cosign verify ghcr.io/wizardingcode-io/wizardingcode-mem@<digest> --certificate-identity https://github.com/WizardingCode-io/wizardingcode-mem/.github/workflows/distribute.yml@refs/heads/main --certificate-oidc-issuer https://token.actions.githubusercontent.com`; `latest: not signed: this release's build recorded no image digest; latest is not moved`; `latest: not signed: the registry did not say which image the tag <version> names: <what the registry said>`; `latest: not signed: the tag <version> no longer names the image the release built (<digest>); nothing is signed`; `latest: not moved: the signature of <digest> did not verify: <cosign's last line>` |
| a failure | `tap: failed: <sentence>`, and the same with the name of any other target; `distribute: refused: <sentence>` when the first job refuses the tag |

The dist-tag is "latest" for a plain release and "next" for a pre-release.

The image's latest tag moves last, and only when npm, the tap and the marketplace all succeeded: the job that signs is skipped when one of them failed, so a latest job shown as skipped beside a failed target means the tag did not move. The job writes two lines: the signing's, then the move's.

## The image line

The first job writes one more line, about the image, for a release that is not a pre-release. It is what you read before the approval. It has two forms:

```text
image: <tag> built by <run URL> as <digest>
image: no digest: <reason>; latest is not moved
```

With the second form npm, the tap and the marketplace go on as usual, the job `latest` is skipped, no approval is asked, and nothing is signed. What to do depends on the reason:

- **no run of release.yml for this tag's commit.** The tag's push started no release run at that commit, or the run was deleted. A release made by hand has no build to sign.
- **no run of release.yml built the image.** The `docker` job of the release run has not finished, or it failed. Wait for it, or re-run that job, then start the distribution again.
- **the release run … recorded no image digest.** The release was made before ADR 0032, by a `release.yml` that recorded none, or its artifact has expired. Such a release is not signed and `latest` does not move to it.
- **the release run … recorded … which is not a digest.** The artifact was written by something other than the build. Treat it as an incident and read that run before anything else.
- **the runs of release.yml could not be listed.** GitHub did not answer. Start the distribution again.

A last line, about the environment release-sign, appears when administrators can bypass its rules: turn that off (step 4 of the setup).

## Repeating a target

Start `distribute.yml` from `main` with the same tag. Every target checks what is there first: a package already on npm, a formula or a manifest already at the version, is reported and left alone. Only the highest release can be repeated: an older tag is refused, so no channel is ever moved back.

Wait for a run to end before starting another. The workflow runs one at a time and keeps one waiting; a third started meanwhile replaces the one that waits. A run that waits for its approval counts as running: a dispatch made meanwhile waits behind it, and a second one replaces a run still queued there.

The digest a release's run recorded is an artifact of that run, and GitHub keeps an artifact 90 days by default. A repeat made after that finds no digest: it moves nothing and signs nothing.

The job of `release.yml` that starts the distribution is cut after 5 minutes, and GitHub then shows it as cancelled or failed. The distribution may have started all the same. Look for the tag's run with `gh run list --workflow distribute.yml` (it is named `distribute <tag>`), and look again after a minute, since a dispatch accepted just before the cut appears late. If the run is there, the distribution is under way and nothing is to be started. If it is not, re-run the failed job of `release.yml`, or start `distribute.yml` from `main` with the tag. A second run for the same tag writes nothing the first already wrote, and writes what the first had not reached: npm answers `already published`, the tap and the marketplace answer `already at <version>`, and `latest`, after its approval, finds the image already signed, signs nothing, is tagged again onto the same digest and answers `latest: moved to <version>` again. The one exception is in "A bad release": after a tap or marketplace write was reverted by hand, or `latest` was moved back by hand, a second run writes it again.

## Repairs

- **`distribute: refused: the GitHub release <tag> lacks: …`** The release was created and an upload failed. Upload the missing files with `gh release upload <tag> <files>` if you still have the run's artifacts, or delete the release and the tag (an admin's act) and tag again.
- **A tag whose release failed.** If `v0.9.1` is tagged and its `release.yml` fails, `v0.9.1` has no release and `v0.9.0` is no longer the highest, so neither can be distributed. Re-run the failed jobs of `v0.9.1`'s `release.yml`, or delete the `v0.9.1` tag.
- **npm fails with the sentence about the trusted publisher.** Step 7 of the setup is missing for that package, or names another workflow or environment.
- **`MARKETPLACE_TOKEN is not granted to <repository>, or the organisation has not approved it`.** The token does not cover that repository, or the organisation requires approval for fine-grained tokens and has not given it.
- **`the push to <repository> was refused: MARKETPLACE_TOKEN may lack contents write there`.** The token reads but cannot write: give it "Contents: read and write", or lift a rule on that repository's default branch that stops a direct push.
- **`the push to <repository> was refused by a rule on its branch`.** That repository's default branch does not take a direct push from the token's owner (step 6 of the setup), whether by a branch protection or by a ruleset: lift the rule for that person, then start the workflow again.
- **`<tag> no longer names the commit that was judged`.** The tag was moved while the run was going. Find out who moved it and why before anything else.
- **The image's signing fails** (`latest: failed: the image's signing did not succeed: …`). cosign's own words end the line. Sigstore's public services may be down, or the job lacks its OIDC token. Start the workflow again: nothing was signed and `latest` did not move.
- **The signature does not verify** (the line begins "latest: not moved: the signature of"). cosign's last line names the identity it found. If it differs from the expected one only in capitals, correct `SIGNER_IDENTITY` in `scripts/release/lib.ts` by a pull request and start the workflow again. `latest` did not move.
- **The image's retag fails** (`latest: failed: the image's retag did not succeed`). The package's settings do not let this repository's workflows write to it, or the registry failed. `latest` did not move. Start the workflow again: the image is found already signed and only the tag is moved.
- **The check after the retag fails** (the line says "latest names … after the retag, not …"). The retag was accepted and `latest` then named another digest than the signed one, or could not be read: `latest` may have moved, to an image nobody signed. A host that verifies refuses it. Do not start the workflow again first, since it would repeat the same retag. Read what `latest` names (`docker buildx imagetools inspect ghcr.io/wizardingcode-io/wizardingcode-mem:latest`), move it back by hand to the previous release's signed digest as "A bad release" says, and report the retag before the next release.
- **The registry did not say which image the tag names.** The registry or the login failed. Start the workflow again.
- **The tag no longer names the image the release built.** This is an incident: someone who can write the package pushed another image over the version tag after the build. Nothing was signed. Read the package's versions on GitHub for who and when. Then re-run the release run's `docker` job, which pushes the image again and records the new digest, and start the distribution again.

## A bad release

A release that should not have gone out is fixed by a higher version. npm versions cannot be reused, and nothing moves a channel back by itself: the plugins, the npm package, the curl script and `wizardingcode-mem install` all keep a newer binary that is already on a machine.

The notice of a release (ADR 0030) reaches a client at its next successful check: about a day for a machine in use. To withdraw it before a higher version exists, move GitHub's latest back: `gh release edit <previous tag> --latest`. That also moves what `scripts/install.sh` downloads. A client that already runs the bad version then reads that it is ahead of the latest release. This procedure has not been run yet: check it on the first real release, with `wizardingcode-mem update` on a client. A plain tag cut on an older line can become GitHub's latest by itself; it is corrected with the same command on the right tag.

A wrong write to the tap or the marketplace is reverted with a commit in that repository. Do not start `distribute.yml` again for that tag afterwards: it would write it again.

The image's `latest` is moved back by hand, since the workflow only ever distributes the highest release: `docker buildx imagetools create -t ghcr.io/wizardingcode-io/wizardingcode-mem:latest ghcr.io/wizardingcode-io/wizardingcode-mem@<the previous release's digest>`, logged in to `ghcr.io` with an account that can write the package. Move it by digest, never by the version's tag, which anyone who can write the package can push over: the digest is in the previous release's distribution summary, on the line that begins "latest: signed", and the command of that line checks it first. For a release older than ADR 0032 there is no signed digest; its version tag is all there is. A host that verifies refuses such an unsigned image. A signature already made is never withdrawn, and a signed image that should not be followed is answered by a higher version.

## A person's way back

On one machine, to put an older binary in place of a newer one: run the older binary as `wizardingcode-mem install --force`. With the curl script, pass `--force` among its arguments. Without it, an older binary says that a newer one is in place and hands the install over to it.

Two things limit it. An agent's plugin that is still at the newer version puts the newer binary back at its next session start, so the plugin has to go back too (or be removed) for the older binary to stay. And an older binary refuses a store the newer one has already migrated (`SchemaTooNewError`): going back across a schema change also means restoring the store from a backup made before it (`wizardingcode-mem backup --list`).

## Releasing a hold

`latest` is held when the new release's server would refuse the members still on the previous release: its lowest accepted contract is above the contract the previous release speaks. The summary says `latest: held: <tag> accepts contract <n> and up; <previous> speaks <n>`, each `<n>` being that release's own contract number. When those members have updated, start `distribute.yml` with the tag and `release_hold` on.

The rule looks one release back, which is what the server promises (it accepts its own contract and the one before). A member two or more releases behind is refused by a release that drops their contract whether `latest` is held or not.

A hold that names a file (`latest: held: src/team/contract.ts at <tag>`) means the rule could not read the contract there and held to be safe.

## What a release keeps for the hosts

A team server's host that follows releases (ADR 0033, `docs/runbooks/team-server.md`, Upgrade) judges each release with the tool of the release it runs. Two rules follow, and no test of the repository can hold either, because both are about a release that does not exist yet:

- **The release before must be able to verify this one.** A host verifies with `COSIGN_IMAGE` and `SIGNER_IDENTITY` as the release it runs has them. So a newer cosign on the signing side (`COSIGN_VERSION`, the installer's pin in `distribute.yml`), or a corrected `SIGNER_IDENTITY`, ships in two steps: first a release whose `COSIGN_IMAGE` (or identity) is the new one while the signing side stays as it was, then, once that release is out, the signing side's change. Done in one step, every host answers `not-verified` (exit 12) and its operator upgrades by hand once.
- **The state's format is read a release before it is written.** `upgrade-state/state.json` is written by one release's tool and read by the next one's, and by the previous one's after a way back. A key is only ever added. A release that must raise `FORMAT` in `src/host/state.ts` ships the reading of the new format a release before it writes it.

The launcher, `deploy/upgrade.sh`, is not delivered to hosts: an operator copies it once. A change to the binary's path in the image, to the repository's name, or to the verbs and flags of `serve host` breaks the launchers already copied; `tests/unit/host-units.test.ts` fails on such a change, and the release's notes then say to copy the launcher again.

## Limits

- The dist-tag `next` on npm stays on the last pre-release after a plain release supersedes it.
- A version published to npm and later unpublished is reported as already published.
- Copies of the npm package from before this procedure (0.4.4) still replace a newer binary with their own older one. They cannot be changed; installing the current package removes the problem.
- The release's binaries and image were built when the tag was pushed. `checksums.txt` ties them to the release, not to the commit the distribution judged.
- `latest` can still be moved by a workflow outside `distribute.yml`: a tag on an old commit runs that commit's `release.yml`, which pushed `latest` itself, and a branch's workflow can ask to write packages. The ruleset on tags closes the first for everyone but admins. The tag is therefore no proof: the signature is, and only `distribute.yml` on `main` can make one (ADR 0032). Nothing reads `latest` yet, and nothing verifies a signature by itself: the team runbook gives the command and pins a version.
- No test makes a real signature: that needs this workflow's own token on `main`. The first plain release after ADR 0032 is its first proof.
- The required reviewer, the administrators' bypass and the rulesets are settings. The workflow reads the reviewer and the bypass of release-sign; nothing in the repository reads the rulesets.
- Whoever can write the package can delete a signature from the registry. Hosts then refuse that image until the distribution is repeated; nobody can forge one that way.
- The token belongs to one person. If that person loses access to the organisation, the tap and marketplace writes fail until another token is stored.
