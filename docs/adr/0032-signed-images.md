# ADR 0032 — The image a server may follow is signed from `main`

Date: 2026-11-13 · Status: **draft**. Work item 2026-11-13-001, the release's side of what was left of piece 3 of 3 of 2026-11-11-004 ("updated everywhere on release"; piece 1 is [ADR 0029](0029-release-distribution.md), piece 2 [ADR 0030](0030-release-notice.md), the first half of piece 3 [ADR 0031](0031-team-server-restore.md)). The item's id says "the host's side": it was started for the whole of what was left and narrowed to the signature. The author's procedure is `docs/runbooks/release.md`; the command that checks a signature is in `docs/runbooks/team-server.md`.

## Context

A team server is to apply a release by itself. The author decided under which condition (D-1, 2026-11-13): unattended, a server applies only a release that does not migrate, and only an image signed from `main` and verified on the host. The signature is cosign's, keyless, so that a host needs no GitHub login to check it (D-2).

Before this item nothing said an image is the release's:

- The image had no signature. Everyone who can push a tag or a branch to the repository can move the tag `latest` and overwrite a version tag (ADR 0031, Limits): a branch's workflow can ask for the permission to write packages.
- `distribute.yml`'s job `latest` retagged by name, outside the environment `release`: it moved `latest` to whatever the version tag named at that moment.
- `release.yml`'s `sign` job is an ad hoc `codesign` of the macOS binaries, which Apple Silicon requires. It proves no origin.

The first concept held the signature and the host's script and timer together. Six readers with no context attacked it, and five leads returned its spec with 22 points, most of them on the host's script. The item was narrowed to the release's side, which the script cannot be reviewed without. What was left for the script is in the item's `probes/returns-for-the-script.md`.

## Decision

**The built digest leaves the build.** `release.yml`'s `docker` job takes the build step's own `digest` output (never the tag read back after the push), prints it to the job's log and uploads it as the artifact `image-digest`: one file, one line. `plan`, the first job of `distribute.yml`, lists the runs of `release.yml` that a push of the tag started at the tag's commit, reads what each one's `docker` job concluded, and downloads the artifact of the newest one that built (`readBuild` in `scripts/release/read.ts`, `builtDigest` in `scripts/release/lib.ts`). It gives the digest and the run's URL as outputs and writes one line to the summary, which is what the person who approves reads: the tag, the run and the digest, or that there is no digest and why.

The digest is not a dispatch input. An input is whatever the person who starts the workflow types, and a digest typed by hand is the attack: a branch's workflow overwrites the version tag, then dispatches with its own digest.

No failure of that reading refuses a distribution. With no digest, npm, the tap and the marketplace go on, the job `latest` is skipped and nothing is signed. A release made before this item recorded no digest, so a repeat of its distribution no longer moves `latest`: on purpose, since nothing should move `latest` to an image whose build left no record.

`distribute.yml` is started by the last job of the release's own run, so `plan` reads that run while it is in progress. A probe on a real run of this repository's `ci.yml`, made by a job with the workflow's own token and exactly `plan`'s permissions (`contents: read`, `actions: read`), showed that a job of a run in progress gets a finished job's conclusion, the artifact that job uploaded and its download. The run's own status is no guide (it read `queued` while jobs ran); nothing reads it.

**`release.yml` is held like `distribute.yml`.** The image and its recorded digest come from its jobs, so it is part of what is signed. `tests/unit/deploy-files.test.ts` holds that every action is pinned by a 40-hex commit, that no `run:` interpolates an expression, that no checkout keeps credentials, and that the workflow starts from no permission: `build` and `sign` read the contents, `docker` reads them and writes packages, `publish` writes the contents, `distribute` writes actions. Before, the whole file had `contents: write`, the job that runs `bun install` and the test suite included.

**The job `latest` signs, then moves the tag.** Signing is not a job of its own: a signature means "this release may be followed", which is exactly when `latest` moves. So a pre-release, a release the contract rule holds and one whose distribution failed are not signed. The job runs `scripts/release/sign.ts` from the workflow's own commit on `main`, never from the tag's tree. It gathers three facts and asks `decideSign`, a pure function whose first matching row wins:

| `decideSign` | When | What happens |
| :- | :- | :- |
| `no-digest` | `plan` read no digest | fails; nothing signed, nothing moved |
| `unreadable` | the registry did not say which image the version tag names | fails; nothing signed, nothing moved |
| `tag-moved` | the version tag names another image than the one built | fails; nothing signed, nothing moved |
| `would-sign` | a dry run | writes nothing |
| `already-signed` | the built digest already verifies | signs nothing; moves `latest` |
| `sign` | otherwise | `cosign sign --yes <image>@<digest>`, verifies, moves `latest` |

The signature is verified as a host will verify it, before anything follows it: a signature that does not verify leaves `latest` where it was. `latest` moves by digest (`docker buildx imagetools create -t <image>:latest <image>@<digest>`), and the job then reads which digest `latest` names and fails when it is not the built one. The version tag is read once and is never what gets signed or retagged.

The job is skipped when npm, the tap or the marketplace did not succeed, and when there is no digest. Before, it ran in order to say that it did not move; inside an environment with a reviewer that would ask for an approval whose only effect is a job that reports a failure. The summary's outcome `not-moved` is gone: a skipped `latest` beside a failed target says the same.

**One verification command.** `lib.ts` holds cosign's version (`COSIGN_VERSION`, v3.1.4, the one `sigstore/cosign-installer` v4.1.3 installs and one that carries the fix for an image index with attestations), that version's image by its index digest (`COSIGN_IMAGE`), the identity, the issuer and the one function that gives the arguments, `verifyArgs`:

```sh
cosign verify <image>@<digest> --certificate-identity https://github.com/WizardingCode-io/wizardingcode-mem/.github/workflows/distribute.yml@refs/heads/main --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

`sign.ts` runs cosign with exactly those arguments, and a test holds the team runbook's command equal to them. A probe ran that form of command, from cosign's own image and with no login, against a public keyless-signed multi-platform image by its index digest: exit 0, and non-zero for another identity.

**Who can get an image signed.** A host checks one thing, the identity, and a signature with it can only be made by a job of the file `.github/workflows/distribute.yml` in a run whose ref is `main`. The control has four parts:

1. *What `distribute.yml` on `main` says.* Whoever can change that file on `main` can make any job sign anything. The ruleset on `main` requires a pull request and its checks and has no bypass actor; it requires no approving review, which holds while one person has write access.
2. *The environments' branch rule.* Only a run on `main` enters `release` or `release-sign`; `plan` requires the rule of both. A test holds that no job has `id-token: write` outside the two, and that the workflow has no trigger but `workflow_dispatch`.
3. *A required reviewer on `release-sign`* (D-3). The author first agreed to a required reviewer before the signing. Asked again once the design showed that one environment for all four jobs meant several approvals a release, the author put it on the job that signs only, in an environment of its own (D-5): one approval a release, and npm, the tap and the marketplace publish without one, as before. `plan` reads the environment and refuses a distribution when it is missing, when it allows more than the branch `main`, and when it has no required reviewer that names someone. When an administrator can bypass its rules, `plan` says so in the summary and refuses nothing: the author is the administrator and the only maintainer.
4. *The built digest*, read by `plan` from the release's own run and compared with the tag by the job: an approval cannot be led to sign an image the release did not build.

**The older image's words.** A correction to ADR 0031's item rides here. The restore's note, the runbook and ADR 0031 said an older image answers `no such item` for an item that arrived after the copy. No image prints that: at the tags `v0.7.0` and `v0.8.0`, `serve withdraw`, `serve reinstate` and `serve purge` of an item the database does not hold print "wizardingcode-mem serve: unknown" and exit 1. The three texts now say so, and a test of the CLI holds the words.

## Alternatives

- A dispatch input carrying the digest. Rejected: whoever dispatches chooses it.
- A job `sign` of its own, signing every distributed image. Rejected: a held release and one whose distribution failed would be signed, and a host that follows signed images would apply what the hold exists to keep back.
- A second signature with a "follow" annotation. Rejected: two signatures and an annotation the host must also require are more to get wrong than one rule, "only what may be followed is signed".
- Signing in `release.yml`. Rejected: anyone who can create a tag gets a valid signature from their own commit's workflow.
- The digest published on the GitHub release. Rejected: a tag ruleset does not protect a release's assets.
- GitHub artifact attestations. The author chose cosign (D-2): `gh attestation verify` needs a GitHub login or token on every host.
- cosign run from its image inside the workflow. Rejected for the installer action: the image would need the job's OIDC request variables and the registry login passed in by hand. A host, which only verifies, runs the image.
- `plan` refusing when administrators can bypass the environment. Not taken: said in the summary and in the runbook.
- One environment with a reviewer for all four jobs. Rejected by the author (D-5): several approvals for each release.

## Limits

- No real signature exists before the first plain release after this item: a signature needs this workflow's OIDC token on `main`, which no pull request has. Three causes of a first failure are known and unshown: cosign 3.1.4 signing a multi-platform index that carries attestations on ghcr.io (the probe verified one, of another project; it never signed); where the registry keeps the signature; and the capitals of the owner's name as a certificate writes them. The job verifies its own signature before it moves `latest`, so each of them leaves `latest` where it was, with cosign's words in the summary. For the capitals the repair is a pull request that corrects `SIGNER_IDENTITY`.
- GitHub's real answers are imitated by the tests. The probe showed them once, on another workflow's run and with no environment to read, since the repository had none: a release's own run read from a run of `distribute.yml`, and an environment's reviewer and bypass as the workflow's token sees them, are first read for real by the first release's dry run.
- The identity is a contract with every host that will verify: a rename of `distribute.yml` or of the default branch, or a move of the signing to another workflow, makes every host refuse every new image, and no test of the repository would say so.
- An administrator can bypass an environment's rules where that is allowed. `plan` says so and does not refuse.
- An approval can be given without reading. What there is to read is the run the summary's line names; the digest of the line was read from that same run, so the check is of the run, not a second source.
- A second maintainer added before the ruleset on `main` requires an approval covering the workflows' folder can change the file that signs. Nothing in the repository can test a setting; the runbook's first step says it.
- Whoever can write the package can delete a signature's object in the registry. Hosts then refuse the image until the distribution is repeated; such a person cannot forge a signature.
- A compromise of GitHub's OIDC, of Sigstore or of the author's account is outside this control. Sigstore's public services being down at release time fails the signing; the distribution is repeated.
- The artifact of a release's run expires, after 90 days by default. A repeat after that finds no digest and moves nothing.
- A repeat of the distribution of a release made before this item no longer moves `latest`.
- The repository and the image's package must stay public: the check with no login needs it, and a signature writes the repository's name into a public log.
- npm, the tap and the marketplace are published before the approval. A release the author then declines to sign is already on those three.
- A signature is never withdrawn. A signed image that should not be followed is answered by a higher version.

## What is not built

The host's side: the script and the timer that verify the signature on the host and apply a release, the attended upgrade across a migration (D-4), their units and their tests. It is the next item, and it starts from the item's `probes/returns-for-the-script.md`. Until then nothing verifies a signature by itself: the team runbook gives the command and still pins a version. The release's binaries are not signed by this item either, nor are the images of releases already made.
