# The image a server may follow is signed from `main`

## Problem

A team server may soon apply a release by itself. If nothing proves that an image is the release's, such a server runs, at its next look (the next item's timer looks hourly) and with every team's data, whatever image an account that can write to the repository pushed. So the author decided that a server applies by itself only an image signed from `main` and verified on the host (D-1 and D-2 of this item, 2026-11-13). In plain words, the aim: only an image the release built from `main` can be followed automatically.

Today nothing says an image is the release's:

- The image has no signature. Everyone who can push a tag or a branch to the repository can move the tag `latest` and overwrite a version tag (ADR 0031, Limits): a branch's workflow can ask for the permission to write packages.
- `distribute.yml`'s job `latest` retags by name (`…:latest` from `…:$VERSION`), outside the environment `release`: it moves `latest` to whatever the version tag names at that moment.
- The release's `sign` job is an ad hoc `codesign` of the macOS binaries, required by Apple Silicon; it is not a signature anyone can check an origin with.

This item makes the signature. The host's script and timer that verify it and apply a release are the next item; `probes/returns-for-the-script.md` carries what was left for it, and `probes/spec-first-draft.md` is the first spec, which held both.

The item's id says "the host's side": it was started for the whole of what was left of piece 3 and narrowed to the release's side. The id cannot be changed; ADR 0032 and this spec's title say what it is.

## Goals

1. An image that may be followed carries a signature made by `distribute.yml` at `main`, over the image the release's own build made.
2. A signature means "this release may be followed": a pre-release, a release held by the contract rule and one whose distribution failed are not signed.
3. `latest` moves to the signed digest, not to whatever the version tag names when it is read again.
4. A host, or anyone, can check the signature with no GitHub account, with one command the repository states once.
5. Who can get an image signed is written down, with every setting of the repository it depends on. Of those the workflow can read, the required reviewer of the environment that signs is required: `plan` refuses a distribution without it.
6. The words the restore and the runbook give for an older image's answer are the words that image prints (a correction to item 2026-11-12-009, found while reading for this one; it is small, touches the same runbook, and rides here rather than wait for an item of its own).

## Non-Goals

- The host's script, its units and its tests (the next item).
- Signing the release's binaries, or the images of releases already made. A repeat of an old release's distribution moves nothing and signs nothing (Design, "The job `latest` signs, then moves the tag").
- GitHub artifact attestations (the author chose cosign, D-2).
- Requiring the environment in the verification: no flag for it was found in cosign or in `gh`, and sigstore-go does not read that field of a certificate (`conclave/researcher.md`).

## Open Questions

None. The author answered on 2026-11-13: only a signed image is applied unattended (D-1); the signature is cosign's (D-2); a required reviewer stands before the signing (D-3), and, asked again once the design showed that one environment for all four jobs meant two approvals a release, on the job that signs only, through an environment of its own (D-5): one approval a release. D-4 (an upgrade across a migration is the script's attended verb) governs the next item.

## Terms

- **The index digest**: the digest of a multi-platform image's index; what `docker buildx imagetools inspect` prints as `Digest:` and what the signature is made over.
- **The built digest**: the index digest `release.yml`'s `docker` job pushed for a tag, as that run recorded it.
- **The identity**: `https://github.com/WizardingCode-io/wizardingcode-mem/.github/workflows/distribute.yml@refs/heads/main`, with the issuer `https://token.actions.githubusercontent.com`. What a keyless signature made by a job of `distribute.yml` dispatched on `main` carries, and what a verifier is told to require. One thing about it is not confirmed: the capitals of the owner's name as a real certificate writes them. No certificate of this workflow exists yet to read them from (npm holds no release published by it; `probes/cosign-verify.md`). The first release shows them; see the outcome `unverified` and Risks.

## Critical User Journeys

1. **A release.** Given a tag `v0.9.2` on `main`, when `release.yml` ends and `distribute.yml` runs, then npm, the tap and the marketplace are written as today, and when the three succeeded the author is asked once, for the job `latest`. Before that approval the run's summary names the tag, the release run the digest came from and the digest. After it, the image's index digest carries a signature with the identity, `latest` names that digest, and the summary says both.
2. **Anyone checks.** Given that release, when a person runs the command the runbook gives against `ghcr.io/wizardingcode-io/wizardingcode-mem@sha256:<digest>`, with no login, then cosign exits 0; against any image nobody signed from `main` it exits non-zero.
3. **The version tag was overwritten.** Given someone pushed another image over `…:0.9.2` after the build, when the distribution reaches the signing, then nothing is signed, `latest` does not move, and the summary says the tag no longer names the image the release built.
4. **A held release.** Given a release the contract rule holds, when it is distributed, then npm, the tap and the marketplace are written as today and the image is not signed; a later dispatch with `release_hold` signs it and moves `latest`.
5. **No reviewer.** Given the environment `release-sign` is missing, or allows more than the branch `main`, or has no required reviewer, when a distribution starts, then `plan` refuses it with the sentence that names the runbook's step, before any job runs.
6. **A repeat.** Given a release already signed, when its distribution is started again, then nothing new is signed and `latest` is moved to the same digest.
7. **A dry run.** Given a dispatch with `dry_run`, when it runs, then it too is refused without the reviewer and asks for the approval, and the job `latest` says what it would sign and writes nothing.

## Design

### The built digest leaves the build

`release.yml`'s `docker` job records the digest of the index it pushed: it takes the build step's own `digest` output (never the tag read back after the push, which is the race `tag-moved` exists for), prints it to the job's log, and uploads it as an artifact of the run, named `image-digest`: one file, one line, `sha256:` and 64 hexadecimal digits. The upload sets `overwrite: true`, without which the upload of a re-run of the job fails.

Nothing is passed to `distribute.yml` as an input. A dispatch input is whatever the person who starts the workflow types, and a digest typed by hand is the attack: a branch's workflow overwrites the version tag, then dispatches with its own digest (`conclave/lead-security.md`, R-3).

That makes `release.yml` part of what is signed: the image and its recorded digest come from its jobs. So it is held as `distribute.yml` is, by `tests/unit/deploy-files.test.ts`:

- every action is pinned by a 40-hex commit;
- no `run:` interpolates an expression, and no checkout keeps credentials;
- the workflow starts from no permission, and each job has only what it needs: `build` and `sign` read the contents, `docker` reads them and writes packages, `publish` writes the contents (it creates the release), `distribute` writes actions (it starts the other workflow). Today the whole file has `contents: write`, the job that runs `bun install` and the test suite included.

`plan` finds the built digest itself (`readBuild` gathers the runs, `builtDigest` chooses). It lists the runs of `release.yml` that a push of this tag started at the tag's commit, which `plan` has already required to be on `main`. The workflow file of such a run is the one at the tag's commit: a commit of `main`, not `main`'s newest. A tag at a commit older than this item therefore runs a `release.yml` that records no digest, and that release is never signed. A pre-release reads no run: nothing of it is signed.

For each run it reads whether the job `docker` succeeded, and for those the artifact. Among them it takes the newest: a tag deleted and pushed again at the same commit leaves two runs, and the newest is usually the one that pushed the image the tag names now. Where it is not, or someone moved the tag afterwards, the job `latest` sees it (`tag-moved`, below).

`plan` gives the digest and the run's URL as outputs, empty when there is none, and writes one line to the summary, which is what the author reads before the approval: `image: <tag> built by <run URL> as <digest>`, or `image: no digest: <reason>; latest is not moved`.

No failure of this reading refuses the distribution. A list that cannot be read, a job that did not succeed, no artifact, and a text that is not a digest each give `image: no digest` with its reason. npm, the tap and the marketplace go on. The job `latest` is then skipped, so no approval is asked for a job that could only fail.

One fact under all of this has no proof yet. `distribute.yml` is started by the last job of the release's own run, so `plan` reads that run while it is still in progress. Every release depends on GitHub listing a finished job's conclusion and an uploaded artifact of a run in progress, and on the artifact's download working then.

The build's first task is a probe of exactly that, on a real run of this repository's `ci.yml` (whose `build` job uploads the artifact `binaries` while its `verify` jobs still run), written to `probes/in-progress-run.md` with the commands and their answers (AC-49).

The probe is made as a release will read: by a job of a workflow, with the workflow's own token and exactly the permissions `plan` has (`contents: read`, `actions: read`), reading its own run in progress. A probe made with a person's credentials would show less than it claims.

**If the probe shows the fact does not hold, the build stops there and this spec comes back**: the digest must then leave the build another way, before any code depends on this one.

### The job `latest` signs, then moves the tag

Signing is not a job of its own: a signature means "may be followed", which is exactly when `latest` moves. The job `latest` keeps its place (last, after `npm`, `tap` and `marketplace`) and gains:

- `environment: release-sign`, an environment of its own with the branch rule and a required reviewer (D-5). `npm`, `tap` and `marketplace` stay in `release`, which has no reviewer, so a release asks for one approval, at the job that signs.
- Its condition gains the three jobs' success and a digest that is not empty, beside "not a pre-release, not held unless `release_hold`". Today the job runs even when a target failed, and its first step fails to say so. Inside an environment with a reviewer that would ask the author for an approval whose only effect is a job that reports a failure. So the job is skipped instead, the step that checked is removed, and the summary's outcome `not-moved` goes with it: a skipped `latest` beside a failed target, or under the line `image: no digest`, says the same, and the runbook says so.
- `permissions`: `packages: write`, `id-token: write` and `contents: read`.
- A checkout of the workflow's own ref, which is `main`, with no credentials kept, to run the command below: the code that holds `id-token: write` is `main`'s, never an older tag's, and a repeat of a release made before this item runs today's `sign.ts`, not a tree that has none. Nothing is checked out at the tag's commit: signing needs only the digest.
- cosign, installed by `sigstore/cosign-installer` pinned by commit, at the version the constant `COSIGN_VERSION` of `scripts/release/lib.ts` names (a test holds the workflow's value equal to the constant, since a workflow cannot read a TypeScript file).

Its steps, in this order: the checkout; Bun; `docker/setup-buildx-action`; cosign; the log in to ghcr.io; `bun scripts/release/sign.ts`; and the step that echoes `plan`'s `latest_line`, as today. No step of the workflow names `imagetools create` any more; the job's comment still names the tag it moves.

`scripts/release/sign.ts` takes its programs as an argument, as `push.ts` does, so a test replaces them. It gathers three facts and asks `decideSign`, a pure function:

- `built`: `plan`'s digest;
- `tagged`: the index digest `<repo>:<version>` names now (`docker buildx imagetools inspect`), or that the registry did not answer;
- `signed`: whether `<repo>@<built>` already verifies (the command below). It is asked so that a repeat adds no second signature to the registry and says "already signed" where that is the truth.

| `decideSign` answers | When (the first row that applies) | What the command does |
| :- | :- | :- |
| `no-digest` | `built` is empty | fails; nothing signed, nothing moved |
| `unreadable` | the registry did not say which image the tag names | fails; nothing signed, nothing moved |
| `tag-moved` | `tagged` is not `built` | fails; nothing signed, nothing moved |
| `would-sign` | a dry run | writes nothing, says what it would sign and move |
| `already-signed` | `signed` | signs nothing; moves `latest` to `built` |
| `sign` | otherwise | `cosign sign --yes <repo>@<built>`; verifies it; moves `latest` to `built` |

Moving `latest` is `docker buildx imagetools create -t <repo>:latest <repo>@<built>`: by digest. A probe (`probes/retag-by-digest.md`) shows that this tags the same index and writes no new one, on a local registry with an index that carries no attestations; so the command does not rely on it: after the retag it reads the digest `latest` names and fails when it is not `built`.

The summary's texts stay in the one place that writes them, `summaryLine` in `lib.ts`. `decideSign` says what to do; the summary says what was done. The two sets of names are kept apart on purpose (`sign` is a decision, `signed` an outcome), so that code and tests cannot take one for the other:

| Summary outcome | Its line says |
| :- | :- |
| `signed` | the digest, and the verification command's text |
| `already-signed` | the same |
| `would-sign` | the digest, that it is a dry run, and the command |
| `no-digest` | this release's build recorded no image digest; `latest` is not moved |
| `unreadable` | the registry did not say which image the tag names, with the program's last line |
| `tag-moved` | the tag no longer names the image the release built; nothing is signed |
| `unverified` | the signature made did not verify, with cosign's last line, which names the identity it found |
| `failed` | the signing, the retag (as today), or the check after the retag did not succeed |

`sign.ts` writes one of those lines. The line that says the tag moved is still `plan`'s `latest_line`, echoed by the job's last step after `sign.ts` succeeded: `moved`, `would-move` and `moved-by-hand` (a hold released by `release_hold`) keep their texts. So a release's summary reads, for `latest`, the signing line and then the moving line. Only `not-moved` leaves the outcomes.

A repeat of the distribution of a release made before this item finds no artifact (`no-digest`): `latest` is not moved by it. That is a change from today, made on purpose: nothing moves `latest` to an image whose build left no record.

### The one verification command

`lib.ts` holds cosign's version, `COSIGN_VERSION`, `v3.1.4`: the latest on 2026-11-13, the one `sigstore/cosign-installer` v4.1.3 installs by default, and one that carries the fix for an image index with attestations, which this image is (`conclave/researcher.md`). It holds that version's image by its index digest (`COSIGN_IMAGE`), `ghcr.io/sigstore/cosign/cosign@sha256:0f06154836d2de34f887a5c273506d52ca43edaa1d9e53e6510fa78a48f69c2d`, which the runbook's `docker run` form of the command uses (and the next item's host will). And it holds the identity, the issuer and the one function that gives the arguments, `verifyArgs`:

```sh
cosign verify <reference> --certificate-identity <the identity> --certificate-oidc-issuer <the issuer>
```

`sign.ts` runs cosign with exactly those arguments, before signing (is it already signed) and after (did the signature take). The runbook's command is that text, held equal by a test. The probe (`probes/cosign-verify.md`) ran that form of command with both releases, from cosign's own image and confined, against a public keyless-signed multi-platform image by its index digest: exit 0 with no login, non-zero for another identity.

### Who can get an image signed

A host checks one thing: the identity. A signature with it can only be made by a job of the file `.github/workflows/distribute.yml` in a run whose ref is `main`. So the control is, in full:

1. **What `distribute.yml` on `main` says.** Whoever can change that file on `main` can make any job sign anything. The ruleset on `main` requires a pull request and its checks and has no bypass actor (`docs/runbooks/release.md`, "The one-time setup", step 1); it requires no approving review today, which holds while one person has write access. Before a second person gets write access, it must require one approval, of the most recent push, covering the workflows' folder (a `CODEOWNERS` line). The runbook's step says that the ruleset on `main` is the only control on the file that holds `id-token: write`.
2. **The environments' branch rule.** Only a run on `main` enters `release` or `release-sign`; `plan` requires the rule of both.
3. **A required reviewer on `release-sign`** (D-3, D-5): the job `latest`, the only one in it, waits for the author's approval. `plan` reads the environment's protection rules and refuses a distribution when the environment is missing, when it allows more than the branch `main`, and when it has no required reviewer. An administrator can bypass an environment's rules unless that is forbidden; `plan` says so in its summary when the bypass is allowed, and the runbook says to forbid it. "Prevent self-review" stays off: the author is the only maintainer.
4. **The built digest**, read by `plan` from the release's own run and compared with the tag: an approval cannot be led to sign an image the release did not build. This makes `release.yml`'s jobs, every action they run, and the dependencies its `build` job installs part of the control: the actions are pinned by commit and the jobs' permissions cut to what each needs, as above; the dependencies are the lockfile's, as for the binaries the release already ships.

Three settings outside the workflows are assumed, read on 2026-11-13 and named in the runbook: the repository is public (required reviewers on an environment are not offered to a private repository on every plan, and a keyless signature writes the repository's name into a public log); the image's package is public (an anonymous reader gets the manifests of `0.8.0` and `latest` today), without which the check with no login does not work; and the two environments, of which the repository has neither yet.

Held by tests: `latest` names `release-sign`; no job of `distribute.yml` has `id-token: write` outside the two environments; the workflow has no trigger but `workflow_dispatch` (a `workflow_call` would let a caller on another ref sign with this identity; the assertion exists and stays).

What it does not close, written in ADR 0032:

- an administrator's bypass where it is allowed;
- an approval given without reading. What there is to read: `plan`'s line names the run the digest came from. The approver opens that run and checks that it is the push of this tag, on `main`, and that its `docker` job's record step printed the digest of the line. The digest itself was read by `plan` from that same run, so the check is of the run, not a second source for the digest;
- a compromise of GitHub's OIDC, of Sigstore, or of the author's account;
- a denial: whoever can write the package can delete the signature's object in the registry, after which hosts refuse the image until the distribution is repeated. Such a person cannot forge a signature;
- the identity is a contract with every host that will verify: a rename of `distribute.yml`, of the default branch, or a move of the signing to another workflow makes every host refuse every new image, and no test of the repository would say so.

### The documents

- `docs/adr/0032-signed-images.md`: D-1 to D-3, the design above, the alternatives, the limits, and what is not built (the host's side).
- `docs/runbooks/release.md`:
  - the setup gains the environment `release-sign` (the branch rule, the reviewer, the administrators' bypass forbidden), the sentence on the ruleset of `main`, and that the repository and the image's package stay public;
  - the procedure says that a release asks for one approval, at `latest`, and what to check before giving it (the run the line names);
  - a paragraph says what to do for each way the image is not signed: each reason of `image: no digest`; `unreadable` (the registry or the login failed: repeat the job); `tag-moved` (an incident: someone who can write the package pushed over the version tag; read the package's versions for who and when, re-run the release run's `docker` job, which pushes the image again and records the new digest, then repeat the distribution); a signing or a verification that fails; and a `latest` that was skipped;
  - the artifact of a release's run expires (90 days by default), after which a repeat finds no digest;
  - the workflow's concurrency group keeps one pending run, so a dispatch made while a run waits for its approval replaces any run still queued behind it (a fact of `distribute.yml` as it is, which the approval makes likelier to meet).
- `docs/runbooks/team-server.md`, the image paragraph: from the first release after this change an image that may be followed is signed, with the command that checks it; `latest` is still no proof by itself.
- `docs/adr/0031-team-server-restore.md`, Limits: the sentence on who can move `latest` points to ADR 0032. `docs/adr/0029-release-distribution.md`: `latest` now signs and retags by digest, inside the environment.
- `CLAUDE.md`: the releasing paragraph names `sign.ts`, the built digest and the reviewer.

### The older image's words (Goal 6)

A correction to what item 2026-11-12-009 left. The restore's note for an item (`ITEM_NOTE` in `src/team/restore.ts`, attached to `withdraw`, `reinstate` and `purge`), the runbook's Rollback and ADR 0031's Decision say the older image answers `no such item` for an item that arrived after the copy. No image prints those words.

The proof is what the older images print, read at their tags: at `v0.7.0` and at `v0.8.0`, `unknownItem` is `new HttpError(404, { error: "unknown" })` (`src/team/errors.ts:55` in both), thrown by `withdrawByAdmin`, `reinstateByAdmin` and `purgeItem` for an item the database does not hold, and `exitFor` prints `wizardingcode-mem serve: unknown` and returns 1 (`src/cli/commands/serve.ts:180-181` and `:188-189`).

The note, its test, the runbook's sentence (which names the three verbs) and the ADR's are corrected to that line and that exit. `NAME_NOTE` (`no such name`) is what `serve purge name` prints and stays.

## Alternatives considered

- **A dispatch input carrying the digest.** Rejected: whoever dispatches chooses it (`conclave/lead-security.md`, R-3).
- **A job `sign` of its own, signing every distributed image.** Rejected: a held release and one whose distribution failed would be signed, and a host that follows signed images would apply what the hold exists to keep back (`conclave/lead-security.md`, R-2).
- **A second signature with a "follow" annotation.** Rejected: two signatures and an annotation the host must also require are more to get wrong than one rule, "only what may be followed is signed", which needs no annotation.
- **Signing in `release.yml`.** Rejected: anyone who can create a tag gets a valid signature from their own commit's workflow (`concepts_brief.md`).
- **The digest published on the GitHub release.** Rejected: a tag ruleset does not protect a release's assets (`concepts_brief.md`).
- **GitHub artifact attestations.** The author chose cosign (D-2): `gh attestation verify` needs a GitHub login or token on every host.
- **cosign run from its image inside the workflow.** Rejected for the installer action: the image would need the job's OIDC request variables and the registry login passed in by hand. The host, which only verifies, runs the image (the next item).
- **`plan` refusing when administrators can bypass the environment.** Not taken: the author is the administrator and the only maintainer; it is said in the summary and the runbook.

## Acceptance criteria

The numbers are not contiguous: a criterion replaced during the leads' validation or the spec's review gets a new number from the crew's tool, and the old one is not reused. The live ones are below.

- AC-27: `builtDigest` gives the digest and the run's URL of the newest run of `release.yml` whose `docker` job succeeded, and none, with its reason, for no run, no succeeded job, no artifact on that run, and a text that is not a sha256 digest; with two runs it takes the newest.
- AC-28: `readBuild`, with its programs replaced by scripted answers of `gh`: one passing run with its artifact gives that digest; a run whose `docker` job failed, and one with no artifact, give none; it asks only for runs of `release.yml` with event `push`, the tag as head branch and the tag's commit as head commit. The environment's reading, the same way: with a reviewer, without one, and with the administrators' bypass allowed.
- AC-34: the verification command in `docs/runbooks/team-server.md` is `verifyArgs`' text for the image's reference, with the identity of `distribute.yml` at `refs/heads/main` and the GitHub Actions issuer; `sign.ts` uses the same function.
- AC-36: `serve withdraw`, `serve reinstate` and `serve purge … --yes` of an item the database does not hold each print `wizardingcode-mem serve: unknown` on standard error and exit 1; the restore's note for an item says those words; the runbook's Rollback says them of the three verbs; ADR 0031 no longer says `no such item`.
- AC-43: `decideSign` answers each row of its table with the facts that reach it; and for two facts that would each give a row, the earlier row wins: no digest and an unreadable registry is `no-digest`; an unreadable registry in a dry run is `unreadable`; a moved tag in a dry run is `tag-moved`; a dry run of a signed image is `would-sign`.
- AC-44: `sign.ts`'s body, with its programs replaced: `sign` runs `cosign sign --yes` on the digest reference and never on a tag, then the verification, then the retag by digest, then reads the digest `latest` names; `already-signed` signs nothing and retags; `no-digest`, `unreadable` and `tag-moved` run neither the signing nor the retag and fail; a dry run signs nothing and moves nothing; a verification that fails after signing fails the command before the retag; a `latest` that names another digest after the retag fails. Each outcome writes one summary line through `summaryLine`, with what the Design's table says it carries.
- AC-46: `distribute.yml`'s job `latest` names the environment `release-sign`; its condition requires the success of `npm`, `tap` and `marketplace` and a digest that is not empty; its permissions are `packages: write`, `id-token: write` and `contents: read` and no other; its checkout names no ref and keeps no credentials; it installs cosign by an action pinned by commit with `cosign-release` equal to `COSIGN_VERSION`; it runs `sign.ts` and holds no `imagetools create`; no job of the workflow has `id-token: write` outside `release` and `release-sign`; the workflow's only trigger is `workflow_dispatch`.
- AC-47: `decidePlan` refuses a distribution when the environment `release-sign` is missing, when it allows more than the branch `main`, and when it has no required reviewer, each with its sentence naming the runbook, after the refusals of `release`; with a reviewer it passes; `release` itself needs none.
- AC-48: `docs/runbooks/release.md` has the environment `release-sign` with its reviewer and the administrators' bypass, the ruleset sentence, that the repository and the package stay public, the one approval and what to check before it, and what to do for each way the image is not signed (`tag-moved` and `unreadable` among them) and when the run's artifact has expired; ADR 0032 records D-1 to D-3 and D-5, the four parts of the control with `release.yml`'s jobs among them, and what they do not close, the identity as a contract with every host among them; ADR 0031's and ADR 0029's sentences point to it; `CLAUDE.md` names `sign.ts`.
- AC-49 (observed): a job of a workflow of this repository, with the workflow's own token and the permissions `contents: read` and `actions: read`, reading its own run in progress, gets a finished job's conclusion, the artifact that job uploaded and its download; `probes/in-progress-run.md` holds the job's log lines. Observed, not tested: it is a fact of GitHub's API about a live run, which no test of the suite can produce.
- AC-50: every `uses:` of `release.yml` is pinned to a 40-hex commit, none of its `run:` interpolates an expression and no checkout of it keeps credentials; the workflow's own permissions are empty and each job's are exactly what the Design names; its `docker` job takes the build step's `digest` output, prints it, and uploads it as the artifact `image-digest` with `overwrite: true`.
- AC-51: `plan.ts`, run with stubbed `gh` and `git`: a passing plain release writes the line `image: <tag> built by <run URL> as <digest>` and the outputs `image_digest` and `image_run`; a release whose run has no artifact, and one whose list of runs cannot be read, write `image: no digest: <reason>; latest is not moved` with empty outputs and still pass; a pre-release reads no run; a `release-sign` whose administrators can bypass it adds its line; one with no reviewer is refused.
- AC-52 (preserve): every test of `tests/unit/deploy-files.test.ts`, `tests/unit/release-lib.test.ts`, `tests/unit/release-docs.test.ts`, `tests/integration/release-commands.test.ts`, `tests/unit/team-runbook.test.ts`, `tests/unit/server-restore-docs.test.ts` and `tests/integration/team-restore.test.ts` passes as before, but the assertions this item changes on purpose: the environment of `latest` (it gains one, `release-sign`), `latest`'s permissions and condition, its first step, its retag step and the `not-moved` outcome (all removed), the outcomes of the target `latest` (seven more), `plan`'s outputs and summary (two outputs and the image line more), the environments the stubbed `gh` answers and `passingFacts` holds (a second one, with a reviewer), `release.yml`'s action references, checkouts and permissions, and the restore's note.

What no criterion holds: a real signature, which needs this workflow's OIDC token on `main`; and GitHub's real answers for a release's own run (the field names of a run, a job and an environment, the artifact's download), which the scripted answers of AC-28 and AC-51 only imitate and the probe of AC-49 shows in part: on another workflow's run, and with no environment to read, since the repository has none yet. The runbook's first release begins with a dry run, which reads both for real and writes nothing. The first release after this item is the first proof of both: a reading that fails gives `no digest` or a refusal, the job verifies its own signature before it moves `latest`, and either leaves `latest` where it was and says why.

## Risks and their answers

- **The first real signing fails.** Three causes are known and unshown: cosign 3.1.4 signing a multi-platform index that carries attestations on ghcr.io (the probe verified one, of another project; it never signed); where the registry keeps the signature (`conclave/researcher.md` found the documentation of two minds); and the capitals of the owner's name in the certificate. Answer: the job verifies its own signature before it moves `latest`; when that fails, `latest` stays where it was and the line `unverified` carries cosign's words, the identity found among them. For the capitals the repair is a pull request that corrects the identity, then the distribution repeated. npm, the tap and the marketplace are already written by then, as on any failed `latest` today.
- **Every release now waits for one click**, at the job that signs (D-5). npm, the tap and the marketplace are published before it, without one, as today: a release that the author then declines to sign is already on those three.
- **Sigstore's public services are down at release time.** The signing fails; the same answer as the first risk.
- **The artifact of the release run expires** (90 days by default). A repeat after that finds `no-digest` and moves nothing. Answer: said in the runbook; a release that old is not what `latest` should move to.
- **A second maintainer is added before the ruleset requires a review.** Answer: the runbook's step and ADR 0032; nothing in the repository can test a setting.
- **A dispatch made while a run waits for its approval** replaces a run queued behind it (the workflow's concurrency group, unchanged). Answer: said in the runbook.

### What it costs, and its checks

The build is the seven phases of `plan.md`: about two days of an agent's work with its reviews, on the evidence of the two items before it. Each release then costs the author one approval and one look at a run. The check half way is the probe of AC-49; the final one is the first release, begun with a dry run.

## Non-Functional Requirements

- No `run:` in `distribute.yml` or `release.yml` interpolates an expression; every action in both is pinned by commit; no checkout keeps credentials (held today for the first, extended to the second).
- `sign.ts` takes no destination from its environment but the values `plan` gave: the repository's name is `lib.ts`'s constant.
- Rollback of this change: revert the job `latest` to the retag by name; a signature already made harms nothing. The reviewer is a setting the author removes. `release.yml`'s pins and permissions stand on their own.

# Plan: the image a server may follow is signed from `main`

The spec is `spec.md` beside this file. Its live criteria are AC-27, AC-28, AC-34, AC-36, AC-43, AC-44 and AC-46 to AC-52. The author's decision D-5 (2026-11-13, during the spec's second review round) put the reviewer on the job that signs only, through an environment of its own, `release-sign`; this plan follows it, and that part of it was not read by the spec's reviewers. Seven phases; **each ends with `bun run check` green**, and the order below is what makes that true (a type and its readers change in one phase; an outcome is removed in the phase that removes its last use; a document's text lands with the test that reads it).

How to work:

- A test is written and seen failing before the code of its criterion: `crew tdd red <id> <AC> -- <command>`, then the code, then `crew tdd green <id> <AC> -- <the same command>`. Every red below names the titles its filter selects; a filter that selects no test is a mistake, check the run's count.
- One file: `./node_modules/.bin/bun test <file>`. With a filter: `-t "<regex>"`.
- Lint by name, since the crew's lint gate reads no file inside its worktree: `./node_modules/.bin/biome check src scripts tests npm`, and **create `.crew/work/<id>/probes/lint-by-name.md`** with that run and a run over this item's own `.ts` files, before the gates.
- `<id>` is `2026-11-13-001-the-hosts-side-of-piece-3-of-updated-eve`; the item's folder is `.crew/work/<id>/`.
- `gh` against GitHub: this session runs it as `bun /private/tmp/claude-501/-Users-andreagroferreira-AIProjects-ai-mem/78a01246-ab34-4118-bf23-e9bce000b10c/scratchpad/gh-personal.ts <gh arguments>`, a wrapper outside the repository that runs `gh` as the repository's owner. A builder without it runs plain `gh` authenticated as a person who can read the repository's Actions. Nothing in the repository depends on the wrapper.

## Phase 1: `release.yml` is held like `distribute.yml`, and records the digest (AC-50, and AC-52's `before`)

First, on the untouched tree: `crew tdd before <id> AC-52 -- ./node_modules/.bin/bun test tests/unit/deploy-files.test.ts tests/unit/release-lib.test.ts tests/unit/release-docs.test.ts tests/integration/release-commands.test.ts tests/unit/team-runbook.test.ts tests/unit/server-restore-docs.test.ts tests/integration/team-restore.test.ts`.

**Modify `tests/unit/deploy-files.test.ts`.** Add three tests beside the existing release test:

- `"release.yml: every action is pinned by commit, nothing reaches a shell by interpolation, no checkout keeps credentials"`. For every step of every job of `release.yml`: a `run:` does not contain the file's `OPEN` constant (`${{`); a `uses:` has a 40-hex pin; a `uses:` that starts `actions/checkout@` has `with["persist-credentials"] === false`.
- `"release.yml: it starts from no permission, and each job has only what it needs"`. The workflow's `permissions` equals `{}`; `build` and `sign` equal `{ contents: "read" }`; `docker` equals `{ contents: "read", packages: "write" }`; `publish` equals `{ contents: "write" }`; `distribute` equals `{ actions: "write" }`.
- `"release.yml: docker records its build's digest as the artifact image-digest"`. In the job `docker`: the `docker/build-push-action` step has `id: "build"`; the step after it has `env` exactly `{ DIGEST: "${{ steps.build.outputs.digest }}" }` and a `run` that contains `"$DIGEST"` and `tee image-digest.txt` (the digest is printed to the job's log, which is where the approver reads it); the last step uses `actions/upload-artifact@` with `name: "image-digest"`, `path: "image-digest.txt"`, `"if-no-files-found": "error"` and `overwrite: true`.

Red: `crew tdd red <id> AC-50 -- ./node_modules/.bin/bun test tests/unit/deploy-files.test.ts -t "release.yml: every action|release.yml: it starts from no permission|release.yml: docker records"` (three tests).

**Modify `.github/workflows/release.yml`.**

- Pin every `uses:` to the commit its tag named on 2026-11-13 (`git ls-remote https://github.com/<action> refs/tags/<tag>`), with the version in a trailing comment as `distribute.yml` does. No action's major version changes.

  | Action | Commit | Comment |
  | :- | :- | :- |
  | `actions/checkout` | `3d3c42e5aac5ba805825da76410c181273ba90b1` | `# v7.0.1` |
  | `oven-sh/setup-bun` | `0c5077e51419868618aeaa5fe8019c62421857d6` | `# v2.2.0` |
  | `actions/upload-artifact` | `cf430e030ddbb5b0abf93d22962f4752f3646cd9` | `# v7` |
  | `actions/download-artifact` | `9000827ccba6bdab643e8b6fd33ac0654aef8333` | `# v8` |
  | `docker/setup-qemu-action` | `c7c53464625b32c7a7e944ae62b3e17d2b600130` | `# v3` |
  | `docker/setup-buildx-action` | `8d2750c68a42422c14e847fe6c8ac0403b4cbd6f` | `# v3` |
  | `docker/login-action` | `c94ce9fb468520275223c153574b00df6fe4bcc9` | `# v3` |
  | `docker/metadata-action` | `c299e40c65443455700f0fdfc63efafe5b349051` | `# v5` |
  | `docker/build-push-action` | `10e90e3645eae34f1e60eeb005ba3a3d33f178e8` | `# v6` |

- Every `actions/checkout` step gains `persist-credentials: false` (three: in `build`, `docker`, and `publish` beside its `fetch-depth: 0`).
- The workflow's `permissions: contents: write` becomes `permissions: {}`. `build` and `sign` gain `permissions: contents: read`; `docker` keeps its two; `publish` gains `permissions: contents: write`; `distribute` keeps `actions: write`. (`publish`'s `gh release create` uses `github.token` with `contents: write`, as today.)
- In `docker`: the `docker/build-push-action` step gains `id: build`, and after it:

  ```yaml
  - env:
      DIGEST: ${{ steps.build.outputs.digest }}
    run: printf '%s\n' "$DIGEST" | tee image-digest.txt
  - uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7
    with:
      name: image-digest
      path: image-digest.txt
      if-no-files-found: error
      overwrite: true
  ```
- The header comment gains one sentence: the `docker` job records the digest it pushed, which `distribute.yml` signs (ADR 0032).

The existing release test (`deploy-files.test.ts:197`) finds its steps by `startsWith("<action>@")` and stays green. Two other tests read `release.yml`: `tests/integration/plugin-script.test.ts:157` (the file does not match `/gemini/i`; nothing added does) and `tests/unit/release-docs.test.ts:120` (the job `distribute`'s `timeout-minutes`, unchanged). Run both. Green, `bun run check`, commit.

## Phase 2: the probe (AC-49)

The probe reads as a release will: from a job of a workflow, with the workflow's own token and exactly `plan`'s permissions, on its own run in progress.

1. Add a throwaway job to `.github/workflows/ci.yml`, in a commit of its own titled "probe: remove before review":

   ```yaml
     probe:
       needs: build
       runs-on: ubuntu-latest
       permissions:
         contents: read
         actions: read
       env:
         GH_TOKEN: ${{ github.token }}
         GH_REPO: ${{ github.repository }}
       steps:
         - run: gh run view "$GITHUB_RUN_ID" --json status,jobs
         - run: gh api "repos/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID/artifacts"
         - run: gh run download "$GITHUB_RUN_ID" -n binaries -D out && ls -l out
         - run: gh run list --workflow release.yml --event push --json databaseId,headSha,headBranch,createdAt,url --limit 3
         - run: gh api "repos/$GITHUB_REPOSITORY/environments" || true
   ```

   (`tests/unit/deploy-files.test.ts` holds `ci.yml`'s shape; if the job breaks a test of it, that is expected of this commit, which never reaches review.)
2. Push the branch `feature/server-follow` over SSH and open a draft pull request. `ci.yml` runs; `build` uploads `binaries`; `probe` then runs while the five `verify` jobs still do.
3. Read the job's log (`gh run view <run id> --log --job <probe's id>`). Expect: the first step prints `"status":"in_progress"` and the job `build` with `"conclusion":"success"`; the second lists `binaries`; the third exits 0 and lists the files; the fourth prints rows whose `headBranch` is a tag's name for a past release. The fifth shows what the token may read of the environments (the repository has none yet, read on 2026-11-13, so it shows an empty list or a refusal, and the field names of an environment stay unshown).
4. Read one more answer by hand, for the field names Phase 4 scripts: `gh run view <a past release run's id> --json jobs` (a job's `name` and `conclusion`).
5. **Create `.crew/work/<id>/probes/in-progress-run.md`**: the run's URL, the job's steps with the log lines that matter, the field names read, and what it does not show (a release's own run, read from another workflow's run; an environment's `protection_rules` and `can_admins_bypass` as the workflow's token sees them).
6. Remove the probe job in a commit of its own and push; the pull request stays a draft until the gates.
7. `crew tdd observed <id> AC-49 -- test -s .crew/work/<id>/probes/in-progress-run.md`.

**If the first three steps of the job do not show what step 3 expects, stop.** Write what was seen into the probe file, remove the probe job, close the draft pull request, keep the branch and Phase 1's commit (it stands on its own and can be proposed by itself), and return the spec to the author: the digest must leave the build another way. Nothing of Phases 3 to 7 is written.

If a field name differs from this plan, the probe file is right and the plan's name is replaced everywhere it appears in Phase 4.

## Phase 3: the decisions, and the environment's reviewer (AC-27, AC-43, AC-47)

Everything that changes the type `Environment` and the plan's facts lands here with every reader of them, so the phase ends green. There are two environments (D-5): `release`, as today, for `npm`, `tap` and `marketplace`, which needs no reviewer; and `release-sign`, for `latest`, which needs the branch rule and a reviewer.

**Modify `tests/unit/release-lib.test.ts`.**

- New `describe("the built digest")` with one test, `"the newest run whose docker job succeeded gives the digest, and every other case gives none with its reason"`, over `builtDigest`:
  - one run, `docker: "success"`, a valid digest: `{ digest, run: <url> }`;
  - `[]`: `{ digest: null, reason: "no run of release.yml for this tag's commit" }`;
  - runs with `docker: "failure"` or `null` only: `reason: "no run of release.yml built the image"`;
  - the newest succeeded run with `artifact: null`: `reason: "the release run <url> recorded no image digest"`;
  - an artifact of `sha256:abc`, of `latest`, of a valid digest followed by a space: `reason: "the release run <url> recorded <cleaned text>, which is not a digest"`;
  - two succeeded runs: the one with the later `createdAt`, given in both orders.
- New `describe("what the signing does")` with one test, `"each row, and the earlier row when two apply"`, over `decideSign`: `built: ""` is `no-digest`; `tagged: null` is `unreadable`; `tagged` another digest is `tag-moved`; a dry run is `would-sign`; `signed` is `already-signed`; otherwise `sign`; and: `built: ""` with `tagged: null` is `no-digest`; `tagged: null` in a dry run is `unreadable`; another digest in a dry run is `tag-moved`; `signed` in a dry run is `would-sign`.
- In `describe("what may be distributed")`: the fixture `ready` (line 304) gains `reviewers: 0, adminsBypass: false`, and a second fixture `readyToSign` is `{ ...ready, reviewers: 1 }`; `base` gains `signEnvironment: readyToSign`; the two literals `{ exists: false, policy: null, branches: [] }` (lines 377 and 404) gain `reviewers: 0, adminsBypass: false`. New test `"the environment that signs must exist, allow main alone and have a reviewer"`: `refused({ signEnvironment: <missing> })` is `the environment release-sign does not exist; create it with its rule and its reviewer first (docs/runbooks/release.md)`; `refused({ signEnvironment: { ...readyToSign, branches: [] } })` is `the environment release-sign must allow the branch main only (docs/runbooks/release.md)`; `refused({ signEnvironment: { ...readyToSign, reviewers: 0 } })` is `the environment release-sign has no required reviewer; add one first (docs/runbooks/release.md)`; a `release` that is missing and a `release-sign` with no reviewer is refused with `release`'s sentence (the order); `environmentState(readyToSign, true)` is `ready`, `environmentState(ready, true)` is `unreviewed`, `environmentState(ready)` is `ready`, and an object whose `reviewers` is `undefined` (cast), asked with `true`, is `unreviewed`.
- In `describe("the run's summary")`, the test `"every text of the summary table"` gains the seven new lines of the target `latest` (texts below). `not-moved` stays in it for now.

Reds: `crew tdd red <id> AC-27 -- ./node_modules/.bin/bun test tests/unit/release-lib.test.ts -t "the newest run whose docker job succeeded"`; `AC-43` with `-t "each row, and the earlier row"`; `AC-47` with `-t "the environment that signs must exist"`.

**Modify `scripts/release/lib.ts`.**

- A helper beside `summary`: `export function clean(text: string, max: number): string`: every character matching `/[\u0000-\u001f\u007f-\u009f\p{Cf}]/gu` becomes `?`, then the text is cut to `max` characters, with no ellipsis. The regex needs the line `// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it finds` above it, as `src/team/restore.ts:100` has. It is a copy of that file's rule on purpose: `scripts/release/` imports nothing of the server (`src/team/`), and a one-line class is not worth a shared module; a comment says so. And `export function lastLine(text: string): string`: the last line that is not empty after trimming, or `""`.
- A new section "The image's signature", exported: `IMAGE = "ghcr.io/wizardingcode-io/wizardingcode-mem"`; `COSIGN_VERSION = "v3.1.4"`; `COSIGN_IMAGE = "ghcr.io/sigstore/cosign/cosign@sha256:0f06154836d2de34f887a5c273506d52ca43edaa1d9e53e6510fa78a48f69c2d"`; `SIGNER_IDENTITY = "https://github.com/WizardingCode-io/wizardingcode-mem/.github/workflows/distribute.yml@refs/heads/main"`; `OIDC_ISSUER = "https://token.actions.githubusercontent.com"`; `DIGEST = /^sha256:[0-9a-f]{64}$/`; `verifyArgs(reference: string): string[]` returning `["verify", reference, "--certificate-identity", SIGNER_IDENTITY, "--certificate-oidc-issuer", OIDC_ISSUER]`; `verifyCommand(reference: string): string` returning `["cosign", ...verifyArgs(reference)].join(" ")`.
- `export interface BuildRun { url: string; createdAt: string; docker: string | null; artifact: string | null }` and `export type Built = { digest: string; run: string } | { digest: null; reason: string }` and `export function builtDigest(runs: BuildRun[]): Built` by the cases of the test. The artifact's text loses one trailing `\n` before it is matched against `DIGEST`; in a reason it is `clean(text, 80)`.
- `export type SignDecision = "no-digest" | "unreadable" | "tag-moved" | "would-sign" | "already-signed" | "sign"` and `export function decideSign(facts: { built: string; tagged: string | null; signed: boolean; dryRun: boolean }): SignDecision`, rows in the test's order. `sign` (what to do) and the outcome `signed` (what was done) are two names on purpose; a comment says so.
- `Outcome` gains seven kinds, and `OUTCOMES.latest` gains them (keep `not-moved` for now). Texts of `summaryLine`, with `<v>` standing for `verifyCommand(\`${IMAGE}@${digest}\`)`:

  | Kind and fields | Line |
  | :- | :- |
  | `signed` `{ digest }` | `latest: signed <digest>; check it with: <v>` |
  | `already-signed` `{ digest }` | `latest: already signed <digest>; check it with: <v>` |
  | `would-sign` `{ digest }` | `latest: would sign <digest> (dry run); a signed image is checked with: <v>` |
  | `no-digest` `{}` | `latest: not signed: this release's build recorded no image digest; latest is not moved` |
  | `unreadable` `{ version, said }` | `latest: not signed: the registry did not say which image the tag <version> names: <said>` |
  | `tag-moved` `{ version, built }` | `latest: not signed: the tag <version> no longer names the image the release built (<built>); nothing is signed` |
  | `unverified` `{ digest, said }` | `latest: not moved: the signature of <digest> did not verify: <said>` |

- `Environment` gains `reviewers: number` and `adminsBypass: boolean`. `environmentState(environment: Environment, needsReviewer = false)` returns `"ready" | "missing" | "unruled" | "unreviewed"`: after the `unruled` test, `needsReviewer && !(environment.reviewers >= 1)` gives `unreviewed` (so a missing or non-numeric value is unreviewed). `PlanFacts` gains `signEnvironment: Environment`. `decidePlan`, after the two refusals of `release`, judges `environmentState(facts.signEnvironment, true)` and refuses `missing`, `unruled` and `unreviewed` with the three sentences of the test. `passingFacts` gains `signEnvironment`, the passing environment with `reviewers: 1`; its `environment` gains `reviewers: 0, adminsBypass: false`.
- `export function imageLine(tag: string, built: Built): string`: `image: <tag> built by <run> as <digest>` or `image: no digest: <reason>; latest is not moved`; `export const BYPASS_LINE = "environment release-sign: administrators can bypass its rules; forbid it (docs/runbooks/release.md)"`.

**Modify `scripts/release/plan.ts`**, `readEnvironment` only (it moves in Phase 4): it gains a second parameter, the environment's name, used in both API paths and in its error's sentence, and the returned objects gain the two fields. From the first call's JSON, typed as `{ deployment_branch_policy: …; protection_rules?: Array<{ type?: string; reviewers?: unknown[] }>; can_admins_bypass?: boolean }`: `reviewers` is the number of rules whose `type` is `"required_reviewers"` and whose `reviewers` is a non-empty array; `adminsBypass` is `can_admins_bypass === true`. A missing environment returns `reviewers: 0, adminsBypass: false`. The command fills `facts.environment = readEnvironment(repo, "release")` and, right after it, `facts.signEnvironment = readEnvironment(repo, "release-sign")`.

**Modify `tests/integration/release-commands.test.ts`**, `world()`: the option `environment` keeps replacing the case of `api repos/o/r/environments/release`; a new option `signEnvironment?: string` replaces a new default case, `api repos/o/r/environments/release-sign`, which answers the branch policy, `"protection_rules":[{"type":"required_reviewers","reviewers":[{"type":"User"}]}]` and `"can_admins_bypass":false`; and a new default case answers `api repos/o/r/environments/release-sign/deployment-branch-policies` as the existing one answers `release`'s. Add `"an environment that signs with no required reviewer is refused"`: `world({ signEnvironment: <that case with "protection_rules":[]> })`; exit 1, standard error `release: the environment release-sign has no required reviewer; add one first (docs/runbooks/release.md)\n`, summary `distribute: refused: …`. Every existing case passes unchanged: `release` needs no reviewer.

Green for the three, `bun run check`, commit.

## Phase 4: `plan` reads the build (AC-28, AC-51)

**Create `scripts/release/read.ts`**: what `plan` reads from GitHub, as functions that take a `Runner`, with no top-level effect.

- Move `readEnvironment` here unchanged but for its first parameter: `export function readEnvironment(run: Runner, repo: string): Environment`.
- `export function readBuild(run: Runner, repo: string, tag: string, sha: string, dir: string): BuildRun[] | { unreadable: string }`:
  1. `run(["gh", "run", "list", "--repo", repo, "--workflow", "release.yml", "--event", "push", "--branch", tag, "--json", "databaseId,headSha,headBranch,createdAt,url", "--limit", "50"])`. A non-zero exit, or an answer that `JSON.parse` rejects or that is not an array, returns `{ unreadable: "the runs of release.yml could not be listed: " + clean(lastLine(stderr) || "an answer that is not a list", 200) }`. Keep the rows whose `headSha === sha` and `headBranch === tag`.
  2. For each kept row: `run(["gh", "run", "view", String(databaseId), "--repo", repo, "--json", "jobs"])`. `docker` is the `conclusion` of the job whose `name` is `docker`; a non-zero exit, unparseable JSON, or no such job gives `docker: null`.
  3. For the newest row whose `docker === "success"`, and no other (`builtDigest` reads only that one): `run(["gh", "run", "download", String(databaseId), "--repo", repo, "-n", "image-digest", "-D", join(dir, String(databaseId))])`. Exit 0 and a readable file `image-digest.txt` in that directory give its text as `artifact`; anything else gives `artifact: null`. The other rows have `artifact: null`.

  Nothing in `readBuild` throws: no failure of this reading refuses a distribution (spec, "The built digest leaves the build").

**Create `tests/helpers/scripted-runner.ts`**: `scripted(answers: Array<[pattern: RegExp, answer: Partial<RunResult> & { write?: { file: string; text: string } }]>): { run: Runner; calls: string[] }`. The runner joins the command with spaces, records it, answers with the first pattern that matches (code 0 and empty output by default; no match is code 127), and for an answer with `write` writes `text` to `<the argument after -D>/<file>` first. Both new test files use it.

**Create `tests/integration/release-read.test.ts`**. Where a test calls `builtDigest(readBuild(…))`, it first asserts `Array.isArray` of the reading, which also narrows its type:

- `"one passing run with its artifact gives that digest"`: `builtDigest(readBuild(…))` is the digest and the run's URL; the recorded list call contains `--workflow release.yml`, `--event push` and `--branch v0.9.0`.
- `"a run of another commit or another branch is not read"`: two more rows, one with another `headSha`, one with another `headBranch`; no `run view` is recorded for either.
- `"a docker job that failed, a view that fails, and a run with no artifact give none"`: three cases; in the first two no download is recorded.
- `"a list that fails or is not a list is unreadable, with its reason"`: exit 1 with a last line; exit 0 with `{}`.
- `"the environment's reviewer and the administrators' bypass are read"`: `readEnvironment` with the environment call answering one reviewer rule and `can_admins_bypass: false`; `protection_rules: []`; `can_admins_bypass: true`; and exit 1 with standard error containing `HTTP 404` (missing).

Red: `crew tdd red <id> AC-28 -- ./node_modules/.bin/bun test tests/integration/release-read.test.ts` (five tests; the red is the missing module).

**Modify `tests/integration/release-commands.test.ts`.** `world()` gains three options, `runs?: string`, `view?: string` and `download?: string`, each replacing one default `gh` case of a passing run. The defaults: `"run list "*)` answering one row with `databaseId` 7, `headSha` `SHA`, `headBranch` `v0.9.0`, a `createdAt` and the URL `https://github.com/o/r/actions/runs/7`; `"run view 7 "*)` answering a `docker` job with `success`; `"run download 7 "*)` writing a valid digest to the directory that follows `-D` (in the stub's shell: take the last argument as the directory, `mkdir -p` it, `printf` the digest and a newline into `image-digest.txt`). Then:

- `"an accepted plain release gives its version, its commit and the latest job's line"`: `result.output` gains, after `latest_line=…`, the lines `image_digest=<digest>` and `image_run=https://github.com/o/r/actions/runs/7`; `result.summary` is `image: v0.9.0 built by https://github.com/o/r/actions/runs/7 as <digest>\n`.
- The pre-release case: `result.output` gains `image_digest=\nimage_run=\n`; its summary is unchanged; `log("gh")` contains no `run list`.
- The hold case: both summaries end with the image line, after the hold's line.
- New `"a release whose run recorded no digest, or whose runs cannot be listed, still passes and says so"`: with `download` set to a case that exits 1, exit code 0, outputs `image_digest=` and `image_run=` empty, and summary `image: no digest: the release run https://github.com/o/r/actions/runs/7 recorded no image digest; latest is not moved\n`; with `runs` set to a case that prints `HTTP 502` to standard error and exits 1, summary `image: no digest: the runs of release.yml could not be listed: HTTP 502; latest is not moved\n`.
- New `"administrators who can bypass the environment that signs are named"`: `signEnvironment` set to its default answer with `"can_admins_bypass":true`; the summary's last line is `BYPASS_LINE`.

Red: `crew tdd red <id> AC-51 -- ./node_modules/.bin/bun test tests/integration/release-commands.test.ts -t "accepted plain release|recorded no digest|administrators who can bypass|pre-release writes"` (four tests).

**Modify `scripts/release/plan.ts`.** Import `readEnvironment` and `readBuild` from `./read.ts`, call both with `run`, delete the local `readEnvironment`. After the outputs `held` and `latest_line`, and only for a release that is not a pre-release: `const dir = mkdtempSync(join(tmpdir(), "wcm-build-"))`, `const read = readBuild(run, repo, tag, plan.sha, dir)` inside a `try` whose `finally` removes `dir` (`rmSync` recursive, force), as `push.ts` removes its own; `const built: Built = Array.isArray(read) ? builtDigest(read) : { digest: null, reason: read.unreadable }`. Then, for every release: `output("image_digest", …)` and `output("image_run", …)` (both empty for a pre-release or no digest). The summary's order: `planSummary`'s lines first, as today; then `imageLine(tag, built)` (not for a pre-release); then `BYPASS_LINE` when `facts.signEnvironment.adminsBypass`. The header comment's list of what the command reads gains the release's run.

**Modify `tests/unit/deploy-files.test.ts`**, in `"npm publishes the commit plan judged, never the tag by name"`: `plan`'s `outputs` gain `image_digest: expr("steps.plan.outputs.image_digest")` and `image_run: expr("steps.plan.outputs.image_run")`. **Modify `.github/workflows/distribute.yml`**, the job `plan`: the two outputs.

Green for both, `bun run check`, commit.

## Phase 5: the job `latest` signs, then moves the tag (AC-44, AC-46)

`not-moved` leaves here, with its four uses in code (`lib.ts`, `release-lib.test.ts:90`, `release-docs.test.ts:94`, `deploy-files.test.ts:313`) and its row of the runbook's table, which changes with the test that reads it.

**Create `tests/integration/release-sign.test.ts`**, with `tests/helpers/scripted-runner.ts`, over `signImage`:

- `"sign: the digest is signed, verified, latest moved by digest and read back"`: the calls, in order, are the inspect of `IMAGE:0.9.0`, `cosign verify` (exit 1), `cosign sign --yes IMAGE@<digest>`, `cosign verify` (exit 0), `docker buildx imagetools create -t IMAGE:latest IMAGE@<digest>`, the inspect of `IMAGE:latest` (answering the digest); the only recorded argument that is `IMAGE:0.9.0` is the first inspect's; the outcome is `{ kind: "signed", digest }`.
- `"already signed: nothing is signed, latest is moved"`: no `cosign sign` call; outcome `already-signed`.
- `"no digest, an unreadable registry and a moved tag sign nothing and move nothing"`: three cases; no `cosign sign` and no `imagetools create` call; the outcomes carry their fields (`unreadable`'s `said` is the inspect's last standard-error line, cleaned; an inspect that exits 0 with text that is not a JSON string is `unreadable` with `said` `an answer that is not a digest`).
- `"a dry run signs nothing and moves nothing"`: only the inspect and one verify are called; outcome `would-sign`.
- `"a signature that does not verify does not move latest"`: the second verify exits 1 with a last line; no `imagetools create`; outcome `unverified` with that line.
- `"a signing that fails, a retag that fails, and a latest that names another digest are failures"`: `failed` with `the image's signing did not succeed: <said>`, `the image's retag did not succeed`, `latest names <found> after the retag, not <built>`.
- `"each outcome's line"`: `summaryLine("latest", outcome)` of `signed`, `already-signed` and `would-sign` contains the digest and `verifyCommand(\`${IMAGE}@${digest}\`)`.

Red: `crew tdd red <id> AC-44 -- ./node_modules/.bin/bun test tests/integration/release-sign.test.ts` (seven tests; the red is the missing module).

**Create `scripts/release/sign.ts`.** `export function signImage(options: { run: Runner; version: string; built: string; dryRun: boolean }): Outcome`:

1. `built === ""`: return `no-digest`.
2. `tagged`: `run(["docker", "buildx", "imagetools", "inspect", \`${IMAGE}:${version}\`, "--format", "{{json .Manifest.Digest}}"])` (the format is one argument). Exit 0 and a standard output that `JSON.parse` turns into a string matching `DIGEST` give it; anything else is `tagged: null`, with `said` `clean(lastLine(stderr), 300)` or, for exit 0, `an answer that is not a digest`.
3. `signed`: only when `tagged === built`: `run(["cosign", ...verifyArgs(\`${IMAGE}@${built}\`)]).code === 0`.
4. `decideSign`, then: `no-digest`, `unreadable`, `tag-moved` and `would-sign` return their outcomes. `sign` runs `["cosign", "sign", "--yes", \`${IMAGE}@${built}\`]` (non-zero: `failed`, `the image's signing did not succeed: ` + `clean(lastLine(stderr), 300)`), then the verification again (non-zero: `unverified` with `clean(lastLine(stderr), 300)`).
5. For `sign` and `already-signed`: `["docker", "buildx", "imagetools", "create", "-t", \`${IMAGE}:latest\`, \`${IMAGE}@${built}\`]` (non-zero: `failed`, `the image's retag did not succeed`); then the inspect of `IMAGE:latest` as in step 2 (not `built`: `failed`, `latest names <found or "nothing readable"> after the retag, not <built>`). Then `signed` or `already-signed`.

Under `if (import.meta.main)`: read `VERSION` with a `need()` copied from `push.ts:219` (that one is private to its file; three lines), `IMAGE_DIGEST` as `process.env.IMAGE_DIGEST ?? ""` (it may be empty) and `DRY_RUN === "true"`, call `signImage` with `lib.ts`'s `run`, write `summary(summaryLine("latest", outcome))`, and `process.exit(1)` for `no-digest`, `unreadable`, `tag-moved`, `unverified` and `failed`. Wrap the body in a `try` that turns any thrown error into `summary(summaryLine("latest", { kind: "failed", sentence: clean(String(error), 300) }))` and exit 1.

**Modify `tests/unit/deploy-files.test.ts`**, `describe("distribute.yml")`:

- `"five jobs on ubuntu, each with a time limit; only three enter the environment"` is retitled `"five jobs on ubuntu, each with a time limit; only plan stays outside the environment"`; `jobs.latest?.environment` is `"release-sign"`.
- `"each job has only the permissions it needs"`: `latest` is `{ contents: "read", packages: "write", "id-token": "write" }`; add: every job whose permissions hold `id-token` has an `environment` of `"release"` or `"release-sign"`.
- `"latest comes last, only for a plain release that is not held, and says so when a target failed"` is retitled `"latest comes last, only for a plain release that is not held and whose three targets succeeded"`. Its body after the `needs` assertions is replaced: `latest.if` is `` `\${{ ${PLAIN} && needs.plan.outputs.held == 'false' && needs.plan.outputs.image_digest != '' && needs.npm.result == 'success' && needs.tap.result == 'success' && needs.marketplace.result == 'success' }}` ``; delete the assertions on the first step, its three shell runs, and the three on the retag step (`retag?.if`, `retag?.run`, the failed line: lines 337 to 343); the steps, in order, are a checkout with no `ref` and `persist-credentials: false`; `oven-sh/setup-bun@` with `bun-version-file: .bun-version`; `docker/setup-buildx-action@`; `sigstore/cosign-installer@` whose `with["cosign-release"]` equals `COSIGN_VERSION`; `docker/login-action@` with `registry: "ghcr.io"`; a step whose `run` is `bun scripts/release/sign.ts` and whose `env` is exactly `{ VERSION: expr("needs.plan.outputs.version"), IMAGE_DIGEST: expr("needs.plan.outputs.image_digest"), DRY_RUN: expr("inputs.dry_run") }`; and the last step, `env` `{ LINE: expr("needs.plan.outputs.latest_line") }`, as today. No step's `run` contains `imagetools`. The file's imports follow: after these deletions nothing in the file uses `summaryLine`; remove that import, and `existsSync`, `mkdtempSync` and `tmpdir` where no other test of the file uses them (search before removing); import `COSIGN_VERSION` from `scripts/release/lib.ts`; run Biome on the file.
- `"no workflow but distribute.yml names an image's latest tag"` (line 189) is not changed: it passes because the job's comment names `ghcr.io/wizardingcode-io/wizardingcode-mem:latest` (below). Run it.

Red: `crew tdd red <id> AC-46 -- ./node_modules/.bin/bun test tests/unit/deploy-files.test.ts -t "only plan stays outside|only the permissions it needs|whose three targets succeeded"` (three tests).

**Modify `.github/workflows/distribute.yml`**, the job `latest`:

```yaml
  # The image's latest tag, last: ghcr.io/wizardingcode-io/wizardingcode-mem:latest moves only to
  # the image the release's build recorded, after that image is signed here, from main, and the
  # signature verified (ADR 0032). Skipped when a target failed: a release that did not reach
  # every channel is not the one a server should follow.
  latest:
    needs: [plan, npm, tap, marketplace]
    if: ${{ needs.plan.outputs.prerelease == 'false' && needs.plan.outputs.held == 'false' && needs.plan.outputs.image_digest != '' && needs.npm.result == 'success' && needs.tap.result == 'success' && needs.marketplace.result == 'success' }}
    runs-on: ubuntu-latest
    timeout-minutes: 15
    environment: release-sign
    permissions:
      contents: read
      packages: write
      id-token: write
```

Steps, in this one order (the test's): `actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1` with `persist-credentials: false`; `oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0` with `bun-version-file: .bun-version`; the existing `docker/setup-buildx-action` step; `sigstore/cosign-installer@756fe2d284c7292c4e9b62c8a28f1e5629c59532 # v4.1.3` with `cosign-release: v3.1.4`; the existing `docker/login-action` step, moved after the installer; the `sign.ts` step with its three `env:` values; the existing last step. The workflow's header comment, which says the marketplace token and the right to publish sit behind `release`, gains: the signing sits behind `release-sign`, which has a reviewer. The workflow's header comment gains the signing.

**Modify `scripts/release/lib.ts`**: `Outcome` loses `not-moved`, `OUTCOMES.latest` loses it, `summaryLine` loses its case. **Modify `tests/unit/release-lib.test.ts`**: in `"every text of the summary table"`, delete the `not-moved` pair (line 90).

**Modify `tests/unit/release-docs.test.ts`**, the hand-written `lines` array of the test at line 68: delete the row `["latest", { kind: "not-moved", job: "<job>" }]`; add, with these exact placeholders, `["latest", { kind: "signed", digest: "<digest>" }]`, `["latest", { kind: "already-signed", digest: "<digest>" }]`, `["latest", { kind: "would-sign", digest: "<digest>" }]`, `["latest", { kind: "no-digest" }]`, `["latest", { kind: "unreadable", version: "<version>", said: "<what the registry said>" }]`, `["latest", { kind: "tag-moved", version: "<version>", built: "<digest>" }]`, `["latest", { kind: "unverified", digest: "<digest>", said: "<cosign's last line>" }]`.

**Modify `docs/runbooks/release.md`**, the section "What a run shows", the row of `latest`: remove the backticked `latest: not moved: <job> did not succeed`; add the seven new lines, each in backticks and exactly `summaryLine`'s output for the placeholders above (print them once with a throwaway `bun -e` that imports `summaryLine`, and paste). After the table, one sentence without backticks around any line: a `latest` shown as skipped beside a failed target means the tag did not move. That test reads every backticked span of this section as a summary line, so put no other backticked text in it.

Green for both, the whole of `tests/unit/release-docs.test.ts`, `bun run check`, commit.

## Phase 6: the older image's words (AC-36)

**Modify `tests/integration/team-serve-cli.test.ts`.** Add `"an item the database does not hold is answered unknown, exit 1"`: with the file's `team()` helper, through `cli()`: `withdraw entry shared:<a fresh uuid>`, `reinstate entry shared:<the same>`, `purge entry shared:<the same> --yes`; each has exit code 1 and a standard error that ends `wizardingcode-mem serve: unknown\n`. This one passes at once: it proves what the binary prints, and is not part of the red.

**Modify `tests/integration/team-restore.test.ts`**: the constant `ITEM_NOTE` (line 43) becomes `"  note: the older image answers \"wizardingcode-mem serve: unknown\" and exits 1 if the item arrived after the copy"`. It is read by `"a purge is always printed, of an entry that was in the copy too"` and `"a withdrawal, a reinstatement and a name's purge always carry their command"`.

**Modify `tests/unit/server-restore-docs.test.ts`**, the test `"ADR 0031 names the decision, the commands and the open"`: the ADR contains `wizardingcode-mem serve: unknown` and does not contain `no such item`. **Modify `tests/unit/team-runbook.test.ts`**, the test `"the rollback is the restore command, and every named command comes before the start"`: the section contains `wizardingcode-mem serve: unknown` and `serve reinstate`, and does not contain `no such item`.

Red: `crew tdd red <id> AC-36 -- ./node_modules/.bin/bun test tests/integration/team-restore.test.ts tests/unit/server-restore-docs.test.ts tests/unit/team-runbook.test.ts -t "a purge is always printed|always carry their command|ADR 0031 names the decision|the rollback is the restore command"` (four tests).

**Modify `src/team/restore.ts`**: `ITEM_NOTE` becomes `the older image answers "wizardingcode-mem serve: unknown" and exits 1 if the item arrived after the copy`. `NAME_NOTE` is unchanged. **Modify `docs/runbooks/team-server.md`**, Rollback, step 6's second bullet: the sentence on a purge becomes: A `serve withdraw`, `serve reinstate` or `serve purge` of an item that arrived after the copy is answered "wizardingcode-mem serve: unknown", exit 1, by the older image, and that answer is fine. The words are in double quotes and not in backticks: `tests/unit/team-runbook.test.ts:45` reads every backticked text that begins `wizardingcode-mem` as a command the CLI must know, and `serve:` is not one. **Modify `docs/adr/0031-team-server-restore.md`**, Decision, "What is lost": "the older image answers "wizardingcode-mem serve: unknown" where there is nothing to do" (double quotes, for the same reason should a test ever read that file the same way).

Green with the same command plus the CLI test's file and the whole of `tests/unit/team-runbook.test.ts` (its `"every wizardingcode-mem command it cites is one the CLI knows"` among them), `bun run check`, commit.

## Phase 7: the documents (AC-34, AC-48)

**Modify `tests/unit/team-runbook.test.ts`.** Add `"the image's signature is checked with the one command"`: the section `Before the first start, once` contains `verifyCommand(\`${IMAGE}@sha256:<digest>\`)` from `scripts/release/lib.ts`; contains `distribute.yml@refs/heads/main`; contains `COSIGN_IMAGE` in a line that begins `docker run`; and still contains `everyone who can push a tag or a branch` (an existing assertion of this file and of ADR 0031's test: the rewrite keeps the phrase). Red: `crew tdd red <id> AC-34 -- ./node_modules/.bin/bun test tests/unit/team-runbook.test.ts -t "checked with the one command"`.

**Modify `tests/unit/release-docs.test.ts`.** Add `"the runbook has the signing's setup, the one approval and what to do when the image is not signed"`: `docs/runbooks/release.md` contains `release-sign`, `Required reviewers`, `Allow administrators to bypass`, `covering the workflows' folder`, `one approval`, `image: <tag> built by`, `image: no digest`, each of `builtDigest`'s reasons as fixed text (`no run of release.yml`, `built the image`, `recorded no image digest`, `is not a digest`, `could not be listed`), `no longer names`, `did not say which image`, `90 days`, `public`, and `replaces a run`. Write each of these in the runbook as plain text exactly as here, with no backticks inside the phrase, so that the test's `includes` matches. Add `"ADR 0032 records the decisions, the control and what is not built"`: `docs/adr/0032-signed-images.md` contains `D-1`, `D-2`, `D-3`, `D-5`, `cosign`, `distribute.yml@refs/heads/main`, `release.yml`, `release-sign`, `required reviewer`, `administrator`, `image-digest`, `contract with every host` and `not built`; `docs/adr/0031-team-server-restore.md` and `docs/adr/0029-release-distribution.md` each contain `ADR 0032`; `CLAUDE.md` contains `scripts/release/sign.ts` and `scripts/release/read.ts`. Red: `crew tdd red <id> AC-48 -- ./node_modules/.bin/bun test tests/unit/release-docs.test.ts -t "signing's setup|ADR 0032 records"`.

**Modify `docs/runbooks/release.md`** (its sections are "Cutting a release", "The one-time setup", "The first release", "What a run shows", "Repeating a target", "Repairs", "A bad release", "A person's way back", "Releasing a hold", "Limits"):

- "The one-time setup", step 1: the ruleset on `main` is the only control on the file that holds `id-token: write`; before a second person gets write access, require one approval, of the most recent push, covering the workflows' folder (a `CODEOWNERS` line for `.github/workflows/`).
- "The one-time setup", a new step after the environment `release`: create a second environment, `release-sign`, with "Selected branches and tags" and the one branch `main`; under "Required reviewers" add yourself, with "Prevent self-review" off; turn off "Allow administrators to bypass configured protection rules". `distribute.yml` refuses a distribution while it is missing, allows another branch or has no reviewer, and says in its summary when the bypass is allowed. `release` itself keeps no reviewer. Also here: the repository and the image's package stay public (the check of a signature with no login, and the reviewer on a free plan, depend on it).
- "Cutting a release": a release asks for one approval, when `npm`, `tap` and `marketplace` succeeded, for the job `latest`. Before giving it: read the summary's line `image: <tag> built by <run URL> as <digest>`; open that run; check that it is the push of this tag, on `main`, and that the record step of its `docker` job printed that digest. The check is of the run: the digest of the line was read from that same run. A dry run asks for the approval too.
- "The first release": its list of writes gains the signature (the item's first proof), and what to read after it: the `latest` lines of the summary, and the runbook's command run by hand against the new digest. Its dry run is also the first real reading of the two environments by the workflow's token.
- A new section before "Repeating a target", **"The image line"** (outside "What a run shows", since that section's backticked text is read as summary lines): the two forms of `plan`'s line; one line per reason of `image: no digest` with what to do (wait for the release run's `docker` job and start the distribution again; re-run that job; a release made before ADR 0032 is not signed and `latest` does not move to it; a list that could not be read is repeated); the administrators' bypass line.
- "Repairs": "The image's retag fails" becomes five bullets: the signing fails (cosign's words are in the line; repeat the job); the signature does not verify (the identity found is in the line; if only capitals differ, correct `SIGNER_IDENTITY` by a pull request and repeat); the retag or the check after it fails (repeat the job); the registry did not say which image the tag names (the registry or the login failed; repeat the job); and the tag no longer names the image the release built, which is an incident: someone who can write the package pushed over the version tag. Read the package's versions on GitHub for who and when; re-run the release run's `docker` job, which pushes the image again and records the new digest; then start the distribution again.
- "Repeating a target": a dispatch made while a run waits for its approval replaces a run still queued behind it; and the artifact of a release's run expires after 90 days by default, after which a repeat finds no digest and moves nothing.
- "Limits": no test makes a real signature; the reviewer and the rulesets are settings nothing in the repository reads but the reviewer.

**Modify `docs/runbooks/team-server.md`**, "Before the first start, once", the image bullet: keep its sentences, the phrase `everyone who can push a tag or a branch` among them, and add: from the first release after ADR 0032 the image `latest` names is signed by `distribute.yml` at `main`; the command in a `sh` code block, as `cosign verify …` and as `docker run --rm <COSIGN_IMAGE> verify …`, for `ghcr.io/wizardingcode-io/wizardingcode-mem@sha256:<digest>`; `latest` is not a proof by itself, the signature is.

**Create `docs/adr/0032-signed-images.md`**, in ADR 0031's form: status draft; context (D-1's condition; who can move a tag today; the first concept, the six readers, the leads' returns that narrowed the item to the release's side); decision (the built digest and why not an input; signing inside `latest` and why not a job of its own; the one verification command and cosign 3.1.4; the four parts of the control, with `release.yml`'s jobs, pins and permissions; the reviewer on `release-sign` alone (D-5) and `plan`'s refusals; the one approval); alternatives (the spec's eight); limits (no real signature before the first release, with its three unshown causes; GitHub's real answers imitated, the probe's one showing; an administrator's bypass; an approval without reading; a second maintainer before the ruleset changes; the signature's object can be deleted by whoever writes the package; the artifact's 90 days; a repeat of an old release no longer moves `latest`); what is not built (the host's script and timer, the next item, with `probes/returns-for-the-script.md`). Among the limits, in these words: the identity is a contract with every host that will verify, so a rename of `distribute.yml` or of the default branch, or a move of the signing to another workflow, makes every host refuse every new image.

**Modify `docs/adr/0031-team-server-restore.md`**, Limits, the first bullet: add "[ADR 0032](0032-signed-images.md) signs the image `latest` names and says who can get one signed." **Modify `docs/adr/0029-release-distribution.md`**, Limits: one bullet, "Since ADR 0032 the job `latest` runs inside the environment, signs the digest the release's build recorded and retags by digest." **Modify `CLAUDE.md`**, the Releasing bullet: `latest` signs the digest the release's build recorded (`image-digest`, read by `plan` through `scripts/release/read.ts`), then moves the tag by digest (`scripts/release/sign.ts`; cosign keyless, the identity and `verifyArgs` in `lib.ts`); the job that signs sits in the environment `release-sign`, which needs a required reviewer (`plan` refuses without it); `release.yml` is held like `distribute.yml`. **Modify `docs/real-use/findings.md`**: one row, `| 2026-11-13 | signed images, item 2026-11-13-001 (ADR 0032) | … | deferred |`, placed beside the team server's rows, not at the file's end (a row at the end conflicts with every other open branch; `tests/unit/release-docs.test.ts` filters rows by the prefix `| 2026-11-12 | release distribution`, which this row does not have): the host's script is not built; the first real signing is unproven; the settings no test reads.

Green for both, `bun run check`, commit.

## Verify

`crew tdd after <id> AC-52 -- <the command of its before>`. Then the lint by name, recorded in `probes/lint-by-name.md`; then `crew gate run <id>`.

---

Published by `crew learn` from item `2026-11-13-001-the-hosts-side-of-piece-3-of-updated-eve`, reviewed before the code (ADR 0019).
