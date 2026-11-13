# ADR 0033 — A team server's host follows signed releases

Date: 2026-11-13 · Status: **draft**. Work item 2026-11-13-002, the last part of piece 3 of 3 of 2026-11-11-004 ("updated everywhere on release"; piece 1 is [ADR 0029](0029-release-distribution.md), piece 2 [ADR 0030](0030-release-notice.md), the restore [ADR 0031](0031-team-server-restore.md), the signature [ADR 0032](0032-signed-images.md)). The operator's procedure is `docs/runbooks/team-server.md`, Upgrade.

## Context

A team server was upgraded by hand: an edit of `.env`, a pull, a restart. Nothing told the operator a release was out. ADR 0032 made an image that may be followed a signed one, with `latest` moved to it last. Nothing on a host used that.

The author decided on 2026-11-13 when a host may act by itself:

- **D-1.** Unattended, a host applies only a release that does not migrate the team schema, and only an image signed from `main` and verified on the host. It goes back by putting the previous image back, touching no data.
- **D-2.** The signature is cosign's, keyless: a host needs no GitHub login.
- **D-4.** An upgrade across a migration is an attended verb. On failure it undoes nothing and names `serve restore`.
- **D-6.** The rule and the commands are a command of the binary, copied out of the running server's image; the host holds a small shell launcher and the systemd units.

A first concept, a shell script copied once that held the whole rule, was attacked twice by readers with no context and returned by five leads. What fell with it: nine verbs and a twelve-row rule, exit codes given once per release, a lock made by `mkdir`, a local retag, a schema read that would have run the candidate, and the copies a script installed once holds of what the repository keeps changing.

## Decision

**Three pieces.** `deploy/upgrade.sh`, a POSIX shell launcher the operator copies beside `compose.yml` with two units (`deploy/wizardingcode-mem-upgrade.service`, a oneshot; `deploy/wizardingcode-mem-upgrade.timer`, hourly and after boot). The tool, `wizardingcode-mem serve host status | follow [--dry-run] | upgrade --dir <folder>`, whose code is `src/host/`. And `src/host/signature.ts`, the leaf that holds the signer's constants (`IMAGE`, `COSIGN_IMAGE`, `SIGNER_IDENTITY`, `OIDC_ISSUER`, `verifyArgs`), which `scripts/release/lib.ts` re-exports.

**Why the tool comes out of the running server's image.** The image that runs is the one image the host already trusts with the data. Its binary holds the rule, the order of versions and the signer's constants, with no copy in shell. Every applied release brings the tool that judges the next one, so a corrected identity or a newer verifier reaches a host with the release that carries it. The launcher takes the binary from the image, by the running container's image id, through a container that is created and never started: never from the running container's filesystem, which an operator's override can make writable. It takes it only from the image of a server that is running and healthy, so a candidate that did not come up does not bring its tool: the tool that applied it also takes it back.

The first tool is trusted on first use: it comes from the image the operator started by hand.

**The rule** is `decide` in `src/host/rule.ts`, a pure function of seventeen rows, the first that applies winning. The tool gathers its facts in the rule's order and stops at the first row that decides, so a run that ends early neither runs the verifier nor downloads an image:

| # | Outcome | When | Exit |
| :- | :- | :- | :- |
| 1 | `cannot-check` | Docker did not answer | 13 |
| 2 | `starting` | the container's health is `starting` | 0 |
| 3 | `down` | the container is absent, not running, or unhealthy | 10 |
| 4 | `env-differs` | `.env` names something else than what runs | 14 |
| 5 | `cannot-check` | the running server's facts could not be read | 13 |
| 6 | `cannot-check` | the registry did not give `latest`'s digest | 13 |
| 7 | `current` | the candidate's digest is the running image's | 0 |
| 8 | `rejected` | unattended, and the digest is on the rejected list | 11 |
| 9 | `cannot-check` | the verifier's run itself failed, or exceeded its bound | 13 |
| 10 | `not-verified` | the verifier ran and did not exit 0 | 12 |
| 11 | `low-disk` | free space on the data volume is under 500 MiB, or unknown | 15 |
| 12 | `cannot-check` | the pull failed, or the candidate's `serve version` was not readable for certain | 13 |
| 13 | `not-higher` | the candidate's version is not higher than the running one | 0 |
| 14 | `waits-migration` | unattended, and the candidate's team schema is not the database's | 14 |
| 15 | `waits-contract` | unattended, and the candidate no longer accepts a contract the running server accepts | 14 |
| 16 | `low-disk` | the candidate migrates, and the volume lacks room for a copy of the database | 15 |
| 17 | `apply` | otherwise | by the apply |

Rows 8, 14 and 15 are the unattended verb's alone. `upgrade` never applies an image that did not verify, that it could not read, or that is not higher. The exit codes are the same at every run while the cause lasts; how often a person is told is their failure handler's business. They are the tool's own, 10 to 15, away from the binary's 1, 2 and 3.

**The facts.** The candidate's digest is asked of the registry by the tool itself, with no login and no image downloaded. A token is asked only of the registry's own host, over https, and no redirect is followed. The verifier is cosign's own image by its index digest (`COSIGN_IMAGE`), run confined, with `verifyArgs`; only its exit status is read, never its words. The candidate is pulled by its digest only after it verified and the volume has its floor of free space, and it is asked what it is (`serve version`) in a confined run whose output is read strictly. The database's schema is the `schema:` line of `serve status`. Every program the tool starts has a time bound, and every Docker child an environment that cannot point Docker or Compose at another project.

**Apply.** The intent (what is about to be applied, and what it leaves) is written into the state before `.env` changes. `.env` then names `<version>@<digest>`, so that Compose resolves the verified image whatever a tag names later. `docker compose up -d --no-deps --pull never --wait` starts it, with the project, the directory and the files of the container's own labels, so an operator's override file stays in force. A container that exited with code 1 may have met a fresh lease (30 s after an unclean stop): the lease's length is waited out and the start tried once more.

**A start that fails, unattended.** The failed container's last 200 log lines are saved before anything stops or recreates it. The database's schema is then read with the previous image's id, never by asking the candidate. When it did not move, `.env`'s line is put back as it was, the previous image is started and checked by its id, and the release's digest goes on the rejected list. When it moved, cannot be read, or the previous image does not come back, nothing more is changed and the run exits 10 with the reason and the runbook's Rollback.

**A start that fails, attended.** Nothing is stopped, put back or rejected. The output names the log and, when the schema moved, `docker compose run --rm server serve restore --to-schema <n>`.

**An interrupted apply.** A run that finds an intent decides by what the container is. A candidate that runs healthy is recorded as applied. The previous image healthy means the run was cut before the start: `.env` is put back and nothing is rejected. With no container, the previous image is started and nothing is rejected, since nothing showed the release to be bad. Only a container of the candidate that was seen failing rejects it. An attended intent is never undone.

**State.** `upgrade-state/state.json` holds what Docker cannot say: the intent, the last change, the last run, the previous image, the rejected list. A release's tool writes it and the next one's reads it, so a tool reads every format up to its own, keeps the keys it does not know, and never replaces a file it cannot read for certain. An intent whose fields are not in the form the tool writes them is refused the same way, since its ids, its volume and its files go to Docker. Files are replaced through a synced temporary file.

**The lock** is `flock`, taken by the launcher, which then sets a marker in the tool's environment (`WIZARDINGCODE_MEM_HOST_LOCKED`). The tool refuses the changing verbs without it. The marker guards against a mistake, the tool typed by hand outside the lock; it is not a security control, and anyone who can run the tool can set it.

**Boundaries.** `src/host/` imports only its own files and `src/util/version.ts`; the lease's length, the runner, `fetch`, the clock and the file writer are handed in by `src/cli/commands/serve.ts`, the one file that loads it, on demand. It reads one environment variable (the marker) and three flags. The repository, the registry and the verifier come from `signature.ts` alone when the command runs: nothing on the command line or in the environment can replace the verification. `tests/unit/host-boundary.test.ts` and `tests/unit/host-signature.test.ts` hold all of this.

**Proof.** The rule and each path of the apply are tested against a scripted Docker on any system. Five scenarios run the two verbs against a real daemon and a local registry with stand-in images (`tests/scenarios/host.test.ts`, on with `WIZARDINGCODE_MEM_HOST_SCENARIOS=1`). CI's `host` job runs them on Linux, has systemd read the two units, and runs the launcher against the image built from the commit's binaries.

## Alternatives

- A shell script copied once that holds the rule (form A). Rejected by the author (D-6): its copies age on every host, and a change of the signing side breaks every host until someone copies a file.
- The shell script shipped inside the image (form C). Rejected by the author (D-6): delivery is solved, the logic stays in shell with its copies.
- The rule asked of the candidate image; the tool driving the rollback across a migration. Rejected in item 2026-11-13-001: the image judged would rule on itself, and the restore's list is text for a person.
- Nine verbs (`pause`, `resume`, `forget`, `back`). Rejected: `pause` is the timer turned off, a rejection kept by digest ends when `latest` names another image, `back` is the runbook's two lines.
- Exit codes given once per release. Rejected: the tool would keep a state of whom it told, and a release that waits for months would show a green unit.
- A lock made by `mkdir` with a pid. Rejected for `flock`: a pid reused after a reboot holds the lock for ever under an exit the unit counts as success.
- A local retag of the verified image. Rejected for the digest in `.env`: a tag is moved by the next hand pull.
- A split of the verifier's failures by cosign's words. Rejected: only the exit status is proven.
- `docker buildx imagetools inspect` for the candidate's digest. Rejected for a request by the tool: one prerequisite fewer on the host.
- A record of the pulled candidate in the state. Rejected: Docker keeps a pulled digest by itself.
- The binary copied from the running container. Rejected for a created, never started container of its image.

## Limits

- A signature says an image may be followed, not that it is the newest. Whoever can write the package can hold `latest` on an older signed image. Hosts then stay where they are, quietly: the outcome is `current` or `not-higher`, exit 0, seen only in `status`. A `latest` moved back to an older signed release is refused the same quiet way. No check of freshness is built.
- Exit 12 does not always mean an unsigned image. A verifier that cannot reach Sigstore or the registry exits non-zero like one that found no signature; the kept lines say which.
- The release before must be able to verify this one. A newer cosign on the signing side, or a corrected `SIGNER_IDENTITY`, must reach hosts one release before the signing side uses it; otherwise every host answers `not-verified` and its operator upgrades by hand once. No test can show a future signature; `docs/runbooks/release.md` carries the rule.
- A release whose `serve host` is broken stops every host that applied it from following: its tool is the one that judges the next release. The way out is the runbook's hand upgrade.
- The launcher is copied once and nothing delivers it. It holds the repository's name, the binary's path in the image, its verbs and the flags it passes; a test holds each against the code, so a change that breaks old launchers fails the suite and is made knowingly.
- A binary taken from the image the server runs is executed on the host as the unit's user, a member of the docker group, which is root in effect. An image that was already compromised gains the host; before, it had the team's data.
- The running server answers for itself. Its version, the database's schema and the contracts it accepts are read inside the running container. A server process that was broken into, on a host whose override made its filesystem writable, can answer falsely. It cannot get an unsigned image applied; it can make a signed release that migrates look like one that does not.
- Health proves little. `/v1/health` answers not ok only for low disk, so a release that starts and breaks sync is kept, on every following host within the hour.
- "Same schema" is not "the older binary reads what the newer one wrote". The way back's read of the schema is the only check.
- The free-space floor measures the data volume. The image store's disk is measured only when it is the same disk.
- Not shown before a real host runs it: Linux engines other than the CI runner's; the classic image store (the runner's first run used the containerd store, where a built image has a digest); the units under a real systemd beyond `systemd-analyze verify`; a real signature verified on a host (none exists before the first release after ADR 0032, and no scenario runs the real verifier); the registry's token flow from a host under rate limits. On Docker Desktop the daemon's loopback does not see a published port, so the scenarios there read the registry through a mirror; on Linux they do not.

## What is not built

A check that `latest` is the newest signed release; a health check that exercises the database; a soak period or a canary; delivering the launcher; a machine-readable `serve restore`; hosts without systemd beyond one cron line, hosts whose C library the binary does not run on, private packages; anything in the viewer.
