# A team server's host follows signed releases

## Problem

A team server is upgraded by hand: the operator edits `WIZARDINGCODE_MEM_VERSION` in `.env`, pulls and restarts (`docs/runbooks/team-server.md`, Upgrade). Nothing tells them a release is out, so a server stays behind until a member's client stops with "stopped (contract)".

A release's image is now signed, and the tag `latest` moves to it last (ADR 0032). Nothing on a host uses that yet: nothing checks a signature, applies a release, waits for it or goes back.

## Decisions this design is given

The author decided on 2026-11-13 under which conditions a host acts by itself:

- **D-1.** Unattended, a host applies only a release that does not migrate the team schema, and only an image signed from `main` and verified on the host. It goes back by putting the previous image back, touching no data.
- **D-2.** The signature is cosign's, keyless: a host needs no GitHub login.
- **D-4.** An upgrade across a migration is an attended verb. On failure it undoes nothing and names `serve restore`.
- **D-6.** The rule and the commands are a command of the binary, copied out of the running server's image; the host holds a small shell launcher and the systemd units (form B of `concepts_brief.md`).

D-3 and D-5 concern the release's side and are built (ADR 0032).

Six readers attacked a first concept of this item (`concepts_brief.md`). What fell: nine verbs with a twelve-row rule; exit codes given only once per release, kept by a state of their own; a lock made by `mkdir`; a local retag; a schema read that would have run the candidate; and a shell script copied once that holds copies of what the repository keeps changing. The item's request names `serve upgrade-plan`, a rule asked of the candidate image; item 2026-11-13-001's readers had already rejected it, because the image judged would rule on itself, and nothing here builds it.

## Goals

1. Unattended, a host applies only an image that verifies as signed from `main`, of the database's team schema, of a higher version than what runs, and that still accepts every contract the running server accepts. Anything else changes nothing and says why, with an exit code that names the kind of outcome, the same at every run.
2. When an applied release does not come up and the schema did not move, the previous image runs again, checked by its recorded id; the failed release's own output is kept; that digest is not tried again unattended.
3. `upgrade` is the attended verb, across a migration too. On failure it undoes nothing and names `serve restore --to-schema <n>` and the runbook.
4. `status` says what runs, the last change and the last run, and what to do next.
5. A kill or a reboot at any step leaves a state the next run reads right, and a run shortly after boot looks at it.
6. The rule, the order of versions and the signer's constants arrive on a host with each release it applies. The launcher does not: it is copied once (Risks).
7. The path runs against a real Docker daemon in CI.

## Non-Goals

- Driving `serve restore` or the list it prints; a rule asked of the candidate image (both rejected in item 2026-11-13-001).
- `pause`, `resume`, `forget`, `back` and `upgrade <version>` as verbs; exit codes given once per release.
- A check that `latest` is the newest signed release (a limit, in Risks).
- A health check that exercises the database: a release that starts and breaks sync is kept. Its own item.
- A soak period or a canary; telling members of an upgrade.
- Delivering the launcher to a host; a machine-readable `serve restore`; the viewer.
- Hosts without systemd beyond one cron line in the runbook; hosts whose libc the binary does not run on (Alpine); Windows and macOS hosts; private packages; a project started with `--env-file`, or whose Compose files have a comma in their path, or whose data is not a volume at `/data`.
- Servers older than the first release that carries `serve host`: they are upgraded to it by hand, once.

## Open Questions

None. The author answered D-6 on 2026-11-13.

## Terms

- **The tool**: `wizardingcode-mem serve host <verb>`, run on the host from a copy of the binary taken out of the running server's image.
- **The launcher**: `deploy/upgrade.sh`, the shell script the operator and the unit call.
- **The folder**: the directory that holds the operator's `compose.yml`, `.env` and the launcher.
- **The candidate**: the image the tag `latest` names when the tool looks, known from then on by its index digest (`<image>@sha256:…`), never by a tag.
- **Verified**: `cosign verify` of the candidate's index digest exited 0 with `verifyArgs`' arguments.
- **Unattended**: the verb `follow`, which the timer runs. **Attended**: the verb `upgrade`, typed by the operator.
- **The database's schema**: the `schema:` line of `serve status`, read from `team.db`. Not the image's `team_schema`, which `serve version` prints.
- **The intent**: the record, written into the state before `.env` changes, of what an apply is about to do and what it leaves.
- **The way back**: starting the previous image again after a failed start, with `.env`'s line put back.
- **The rejected list**: the digests of releases that failed to start on this host; unattended runs skip them.
- **The floor**: 500 MiB free on the data volume, under which nothing is pulled or applied.
- **The lock's marker**: the environment variable `WIZARDINGCODE_MEM_HOST_LOCKED=1`, which the launcher sets under its lock. The tool refuses `follow` and `upgrade` without it. It guards against a mistake (the tool typed by hand); it is no security control.
- **The contract rule**: the release side's hold of `latest` when a release stops accepting a contract (ADR 0029).

## Critical User Journeys

1. **A patch release, nobody present.** Given a server at 0.9.1 with the timer on, when 0.9.2 (same team schema) is signed and `latest` names it, then within the hour plus the timer's delay the server runs 0.9.2, `.env` names `0.9.2@sha256:<its index digest>`, and `status` says "applied 0.9.2" with the time.
2. **A patch release that does not start.** Given the same, when 0.9.2 exits at start or stays unhealthy, then the server runs 0.9.1 again, the failed container's last 200 log lines are in a file, the run exits 11, and every later run exits 11 without touching anything while `latest` still names that digest.
3. **An image nobody signed.** Given `latest` moved to an image with no signature from `main`, when the timer runs, then no container, no `.env` and no image of the server changes, the output has the verifier's last lines, and the run exits 12 at every run while it lasts.
4. **A release that migrates.** Given a database at schema 2, when 0.10.0 brings schema 3, then `follow` changes nothing, says the release waits and names `upgrade.sh upgrade`, and exits 14 at every run until someone upgrades.
5. **The operator upgrades across a migration.** Given journey 4, when they run `upgrade.sh upgrade`, then the image is verified, the free space checked against the database's size, and the server runs 0.10.0. If it does not come up, nothing is undone: the output says what runs, where the log is, and `docker compose run --rm server serve restore --to-schema 2` with the runbook's Rollback.
6. **A reboot in the middle of an unattended apply.** Given `follow` killed after `.env` was rewritten, when the host comes back, then the run after boot (3 to 13 minutes after it) reads the intent: if the old image runs healthy, `.env` is put back; if there is no container or a stopped one and the schema did not move, the previous image is started. In neither case is the release rejected: nothing showed it to be bad, and the next run tries it again.
7. **Six months later.** Given an operator who forgot the timer exists, when the runbook's "Upgrade" sends them to `upgrade.sh status`, then they read what runs, when it last changed and why, whether a release waits, and the one command to run next.
8. **A hung registry or a hung Docker.** Given a registry or a daemon that never answers, when the timer runs, then the run ends within its bounds with exit 13 and the next run starts clean.

## Design

### The pieces

| Piece | Where | What it is |
| :- | :- | :- |
| The launcher | `deploy/upgrade.sh` | POSIX shell. Finds the server's container, keeps the tool in step with its image, takes the lock, runs the tool |
| The units | `deploy/wizardingcode-mem-upgrade.service`, `.timer` | A oneshot that runs `upgrade.sh follow`; hourly and shortly after boot |
| The tool | `src/host/`, reached as `wizardingcode-mem serve host status \| follow [--dry-run] \| upgrade` | The rule, the facts, the apply, the way back, the state |
| The signature's constants | `src/host/signature.ts` | `IMAGE`, `COSIGN_VERSION`, `COSIGN_IMAGE`, `SIGNER_IDENTITY`, `OIDC_ISSUER`, `DIGEST`, `verifyArgs`, moved from `scripts/release/lib.ts`, which re-exports them |

The operator copies the three files of `deploy/` beside their `compose.yml` once and enables the timer; that is the opt-in. The hand upgrade of the runbook stays valid on a host whose timer is off.

### Why the tool comes out of the running server's image

The image that runs is the one image the host already trusts with the data. Its binary holds the rule, the order of versions (`src/util/version.ts`) and the signer's constants, with no copy in shell. Every applied release brings the tool that judges the next one, so a corrected identity or a newer verifier reaches a host with the release that carries it. What the repository must keep is one step: the release before must be able to verify this one (Risks).

The binary is taken from the image, by the running container's image id, through a container that is created and never started (`probes/form-b.md` shows the copy). It is never taken from the running container's filesystem: an operator's override file can drop `read_only`, and a server process that was broken into must not be able to hand the host a binary.

A tool is taken only from the image of a container that is running and healthy. A candidate that is unhealthy or restarting does not bring its tool: the tool that applied it, the previous release's, also takes it back.

### Boundaries in the code

- `src/host/signature.ts` has no imports. Of `src/`, `scripts/release/` reaches only `src/host/signature.ts` and `src/util/version.ts` (which it imports today and which has no imports either); a test walks the imports of `scripts/release/` and of the two files.
- `src/host/` imports only its own files and `src/util/version.ts`. A test walks its imports transitively, as `tests/unit/update-boundary.test.ts` does for `src/update/`. What it needs from `src/team/` is handed in by `src/cli/commands/serve.ts`, which already imports it: the lease's length (`SERVE_TTL_MS`), with the tool's version and the environment. The real runner, `fetch`, clock, sleep and file writer are built in `src/host/deps.ts` from Bun's and Node's built-ins, and tests replace them through `Deps`.
- `src/host/` is imported by one file, `src/cli/commands/serve.ts`, through `await import()` in the `host` case, so the long-running server never loads it and no hook path reaches it. The same test holds that.
- `src/host/` reads one environment variable, the lock's marker, and `serve host` takes three flags: `--dir <folder>`, `--dry-run`, and `--lock held|free`, which only `status` reads and which decides nothing. The repository, the registry's address and the verifier come from `signature.ts` alone when the command runs; they are parameters of the functions only so that tests can pass others. A test holds that no other environment variable and no other flag is read in `src/host/` and in the command's entry.

### The runner

`src/host/` has its own runner type: a command, an environment and a time bound in, and an exit code, the two outputs and "the bound was exceeded" out. Every program the tool starts goes through it with a bound. Every `docker` child gets the environment without `WIZARDINGCODE_MEM_VERSION`, `COMPOSE_FILE`, `COMPOSE_PROJECT_NAME`, `DOCKER_HOST` and `DOCKER_CONTEXT`, each of which would make Docker or Compose address something else than the folder's project. A new test helper records each call's command, environment and bound and answers from a script. The release's runner (`scripts/release/lib.ts`) and its helper stay as they are: they have no bound, and changing them would change tests this item preserves.

Nothing read from a child or from the registry is evaluated. Every such text the tool prints or stores (the verifier's lines, Docker's errors, a candidate's output) first has each control and format character replaced by `?` and is then truncated at 500 characters. It is the rule the release's scripts apply with `clean` (`serve restore`'s `shown` has the same character class and a rule of its own for the arrows of its lines, and is not exported). The tool has its own copy because `src/host/` reaches nothing outside itself but `src/util/version.ts`, and one test runs the tool's cleaner and `clean` on the same table so that they cannot drift.

### The launcher

`deploy/upgrade.sh <verb> [--dry-run]`, in this order:

1. It accepts `status`, `follow`, `follow --dry-run` and `upgrade`, and nothing else: anything else is its own usage text and exit 64, with no tool run.
2. Prerequisites, each named when missing (exit 69): `docker`, `flock`, `awk`, `timeout`. Every `docker` call the launcher makes runs under `timeout`: 30 s, and 120 s for the copy. A call that fails or exceeds its bound is "Docker did not answer", exit 13, never "no container".
3. The folder is the directory of the script itself, never the working directory. It is known in two forms, the logical and the physical one, since Compose records the folder as it was reached when `up` was typed.
4. It refuses (exit 69) when the user running it is not the owner of the folder, naming the owner: an attended run as root would leave files the unit's user cannot write.
5. Its files live in `<folder>/upgrade-state/` (0700): `tool/wizardingcode-mem`, `tool/image` (the image id the tool was copied from), `lock`, `lock.info`, and the tool's own files. It refuses (exit 69, naming the path) when `upgrade-state`, `tool`, `tool/wizardingcode-mem`, `lock` or `.env` is a symbolic link, and when an existing `upgrade-state` or `tool` is not the user's own or can be written by the group or by others.
6. `follow` and `upgrade` run themselves again under `flock` without waiting, so the steps below run under the lock; a run that does not get it prints "another run holds the lock; see `upgrade.sh status`" and exits 75. Under the lock the launcher writes `lock.info` (the verb, its pid, the UTC time) and removes it when it ends. `status` takes no lock: it asks `flock` whether the lock is free and tells the tool with `--lock held` or `--lock free`.
7. It finds the server's container by the two Compose labels (the service `server`, the project's working directory in either form of the folder). More than one container: exit 69, naming them. None under the folder while a `server` container exists under another directory: exit 69, naming that directory.
8. With a container that is running and healthy and whose image id is not the one in `tool/image`: the container's image reference must be of the repository the launcher names (one line, `IMAGE=…`, held equal to `signature.ts` by a test), else exit 69. Then a container is created from that image id with a label of the launcher's (any earlier container with that label is removed first, in case a run was killed here), the binary is copied out of it to a temporary name in `tool/`, the created container is removed, the file is renamed, and `tool/image` is written. In every other case the launcher uses the tool it has; with no tool it exits 69: "no healthy server in <folder> and no tool yet; start the server by the runbook first".
9. It runs `tool/wizardingcode-mem serve host <verb> --dir <folder> [--dry-run] [--lock …]`, with the lock's marker under the lock, and exits with its code. A tool that answers exit 64 gets this sentence and exit 69: "the tool does not know this command: either the running server is older than the first release with `serve host` (upgrade to it by hand once, the runbook's Upgrade), or this launcher is older than the tool (copy `deploy/upgrade.sh` again)". A tool that cannot be executed gets exit 69 and "the server's binary does not run on this host (for example another C library)".

### The tool's facts

- **Docker and Compose**: before anything else a changing verb reads `docker compose version --short`; the first `<a>.<b>.<c>` in the answer is the version. No answer or no version is `cannot-check`. A version under 2.20.0, by `src/util/version.ts`'s order, is refused with exit 69 and nothing changed, so that no intent is written on a host whose Compose lacks the flags the apply uses. 2.20.0 is a conservative floor, not the first release with `up --wait-timeout` [source?]; the one version a probe shows is v5.7.0 on Engine 29.9.3, and the `host` job prints the runner's.
- **The container**: found as the launcher finds it, stopped ones included. A `docker ps` or `docker inspect` that fails or exceeds its bound is "Docker did not answer", never "no container". More than one container, an image reference that is not of `IMAGE`, and a container with no volume at `/data` are refused (exit 69). From `docker inspect`: its image id, its image reference, state, exit code, health, the volume mounted at `/data`, and the labels `com.docker.compose.project`, `…project.config_files` (split at commas) and `…project.working_dir`. Every `docker compose` call names them: `--project-directory`, `-p`, and one `-f` per file, so an operator's override file stays in force.
- **What `.env` names**: the one line `WIZARDINGCODE_MEM_VERSION=<a>.<b>.<c>` or `…=<a>.<b>.<c>@sha256:<64 hex>`, quotes and CRLF tolerated; anything else is refused with the line to write. It differs from what runs when the container's image reference does not end with it. A `.env` or a `state.json` that is a symbolic link is refused (exit 69).
- **The running server**: with the container running, `docker exec <container> wizardingcode-mem serve status` gives `version:`, `schema:`, `freeBytes:` and, new in this item, `dbBytes:` (the size of `team.db` with its `-wal`), and `docker exec <container> wizardingcode-mem serve version` gives `accepts=`, the contracts the running server accepts. A call that fails, or an answer without `version:` or `schema:`, is `cannot-check`; a `freeBytes:` or `dbBytes:` of `unknown` is "unknown", which the disk rows read. The tool's own version is never used for a decision. These answers come from the running server: Risks says what a server that was broken into can do with them.
- **The database's schema with an image named**: `docker run --rm --network none --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges:true -v <volume>:/data <image id> serve status`. It reads through the read-only open, with or without a server running. A `schema:` line is the schema; exit 3 means the database is at a newer schema than that image reads; anything else means it cannot be read.
- **The candidate's digest**: asked of the registry directly by the tool (`fetch`), with no image downloaded: a `HEAD` of `/v2/<repository>/manifests/latest` with the `Accept` header naming the image-index and manifest-list types (and the two single-manifest types, so that a registry holding a one-platform image answers too); on a 401 with a `Bearer` challenge whose realm is an `https` URL on the registry's own host, the token from that realm, then the `HEAD` again. No redirect is followed. The answer must be 200 with a `docker-content-digest` that matches `DIGEST`. `probes/form-b.md` shows it on ghcr.io with no login. Each request has its own bound.
- **Verified**: `docker run --rm --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges:true -e HOME=/tmp -e DOCKER_CONFIG=/tmp/none <COSIGN_IMAGE> <verifyArgs(IMAGE@digest)>`, as item 2026-11-13-001's probe ran it. Exit 0 is verified. Exit 125, 126 or 127 (Docker's own codes: the run itself failed) and a bound exceeded are `cannot-check`. Any other exit is `not-verified`, with the last three lines of its output kept. cosign's words are never read. An image that is the wrong one and a verifier that could not reach Sigstore both exit non-zero and cannot be told apart by the exit; the kept lines say which (Risks).
- **The candidate itself**, only after it verified and the data volume has the floor free: `docker pull IMAGE@<digest>` (no download when the host has it); its id from `docker image inspect`; then `serve version` in a confined run by that id (`--network none --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges:true --user 10001:10001`, no volume, no environment). Its output is untrusted: `version` must be a plain `<a>.<b>.<c>`, `team_schema` and `contract` integers, `accepts` a comma list of integers; anything else is `cannot-check`. After a pull, the images of `IMAGE` that are neither the running one, the previous one nor this candidate are removed, so a host keeps at most three; nothing about a pulled candidate is written into the state.

### The rule

`decide(facts)` is a pure function. The tool gathers the facts in the rule's order and stops at the first row that decides: a later fact is read only when every earlier row let the run pass. A run that ends at row 8 or earlier does not run the verifier, and one that ends at row 11 or earlier pulls nothing.

| # | Outcome | When | Exit |
| :- | :- | :- | :- |
| 1 | `cannot-check` | Docker did not answer | 13 |
| 2 | `starting` | the container's health is `starting` | 0 |
| 3 | `down` | the container is absent, not running, or unhealthy | 10 |
| 4 | `env-differs` | `.env` names something else than what runs | 14 |
| 5 | `cannot-check` | the running server's facts could not be read | 13 |
| 6 | `cannot-check` | the registry did not give `latest`'s digest | 13 |
| 7 | `current` | the candidate's digest is the running image's | 0 |
| 8 | `rejected` | unattended, and the candidate's digest is on the rejected list | 11 |
| 9 | `cannot-check` | the verifier's run itself failed, or exceeded its bound | 13 |
| 10 | `not-verified` | the verifier ran and did not exit 0 | 12 |
| 11 | `low-disk` | `freeBytes` is under the floor, or unknown | 15 |
| 12 | `cannot-check` | the pull failed, or the candidate's `serve version` did not pass the strict reading | 13 |
| 13 | `not-higher` | the candidate's version is not higher than the running one | 0 |
| 14 | `waits-migration` | unattended, and the candidate's `team_schema` is not the database's schema | 14 |
| 15 | `waits-contract` | unattended, and the candidate's `accepts` lacks a contract the running server accepts | 14 |
| 16 | `low-disk` | the candidate migrates, and `freeBytes` is under the floor plus `dbBytes`, or `dbBytes` is unknown | 15 |
| 17 | `apply` | otherwise | by the apply |

Every row holds for both verbs but rows 8, 14 and 15, which are the unattended verb's alone: `upgrade` never applies an image that did not verify, that it could not read, or that is not higher.

The running digest is the entry of `IMAGE` in the running image's `RepoDigests`; row 7 comes before the verification, so an image that already runs is never a reason to fail. Row 11 comes before the pull: the pull is what fills a disk. It measures the data volume; the image store's disk is measured only when it is the same disk, which it is on a one-disk host. `not-higher` exits 0 and `status` says it: a signed image of a lower version is refused and harms nothing, and a host upgraded by hand past a `latest` the contract rule holds is in that state by design.

The exits are the same at every run: how often a person is told is their handler's business. The exit codes 10 to 15 are the tool's own, away from the binary's 1, 2 and 3: 10 the server needs a person now, 11 a release was rejected here, 12 an image did not verify, 13 the tool could not check, 14 something waits for the operator, 15 the disk. 64 is usage, 69 a refusal before anything was changed, 75 the lock. Outcomes of one kind share a code, and three outcomes that need nobody exit 0.

### Apply

1. The intent is written into the state: the candidate's digest, id and version; the running image's id and `.env`'s present line; the database's schema; the project's name, directory and files; attended or not; the time.
2. `.env`'s line is rewritten to `<version>@<digest>`, every other line byte for byte.
3. `docker compose … up -d --no-deps --pull never --wait --wait-timeout <t> server`; `<t>` is 300 s unattended and 1800 s attended.
4. The container is read again: running, healthy, its image id the candidate's. Then the state records the change (`applied`, from, to, when) and the previous image, clears the intent, and removes the images of `IMAGE` that are neither the running one nor the previous one (without force; a refusal is logged and ignored).

A failed wait is not yet a failed release. A container that exited or is restarting with exit code 1 may have met a fresh lease, which lasts 30 s after an unclean stop (`SERVE_TTL_MS` in `src/team/lease.ts`, handed to the tool). The tool then waits the lease's length plus 5 s and waits for health once more. This holds for every start the tool makes. A second failure is a failure.

**A failed start, unattended.**

1. The failed container's last 200 log lines are saved to `upgrade-state/logs/<utc time>-<version>.log` (0600), before anything stops or recreates it. The ten newest files are kept.
2. A container that is not running is stopped, so that the restart loop writes nothing more. One that runs, unhealthy, is left running.
3. The database's schema is read with the previous image's id, never by asking the candidate.
4. The schema is the intent's: `.env`'s line is put back as it was, `up` as above, and the container must run the previous image's id, healthy. The candidate's digest goes on the rejected list (the ten newest are kept) with its version, the reason and the log's name. The intent is cleared. Exit 11.
5. The schema moved (a candidate that said it would not migrate did), or cannot be read, or is another schema than the intent's, or the previous image, started by step 4, does not come back healthy: `.env` is left as it is at that point (naming the candidate in the first three cases, the previous version in the last), nothing more is started or stopped, the intent is cleared, the state records the last change as `down` with the reason, the output names the runbook's Rollback. Exit 10. Later runs find a server that is not healthy and answer by row 3, printing the recorded reason; they save, stop and read nothing again, so the failure's log is not rotated away.

**A failed start, attended.** The log is saved; nothing is stopped, put back or rejected. The schema is read with the previous image's id, beside whatever runs. The output says what runs and its state and the log's name. When the schema moved (exit 3): `docker compose run --rm server serve restore --to-schema <the intent's schema>` and the runbook's Rollback. When it cannot be read: the same command, given as "if `serve status` shows a schema above <the intent's schema>". The intent is cleared and the state records the last change as `upgrade-failed`. Exit 10.

`upgrade` ignores the rejected list, the migration row and the contract row: an operator who types it wants that release tried.

### An intent found at the start of a run

An attended run clears its intent on every path, so an intent found at the start of a run means a run was interrupted: killed, or cut off by a reboot.

| What the container is | An unattended intent | An attended intent |
| :- | :- | :- |
| runs the candidate's id, healthy | the apply is recorded; the run goes on | the same |
| runs the previous id, healthy | `.env`'s line is put back, nothing is rejected; the run goes on | the same |
| runs any other image, healthy | the intent is cleared with a line in the history; the run goes on (row 4 answers if `.env` differs) | the same |
| `starting`, and the intent is younger than 15 minutes | `starting`, exit 0 | the same |
| a container of the candidate that exited, is restarting or is unhealthy | the failed start's steps 1 to 5: the release is rejected when the way back succeeds | nothing is changed; exit 10 with the attended failure's words; the intent stays until the server is healthy |
| no container, or a stopped one that is not the candidate's | the failed start's steps 3 to 5 with the project the intent names, and nothing is rejected: the previous image is started when the schema is the intent's | nothing is changed; exit 10; the intent stays until the server is healthy |

No state lasts for ever: every row either ends the intent or waits for a healthy server, which the operator's own repair gives.

### State

`upgrade-state/state.json` (0600), one JSON object with `"format": 1`: the intent, the last change, the last run (verb, outcome, exit, when, and the candidate's version and digest when one was read), the previous image, the rejected list. With no file, the state is empty; nothing in it copies what Docker can say.

Under form B a state is written by one release's tool and read by the next one's, and by the previous one's after a way back. So: a tool reads every format up to its own; keys it does not know are kept when it rewrites the file; a key is only ever added within a format. A file of a higher format, and one that does not parse, is never replaced: the tool refuses with exit 69 and names it. A release that must change the format's number ships the reading of the new one a release before it writes it; the release runbook carries that rule beside the verifier's.

The state, `.env` and the history are replaced through one function whose steps go through an injected writer: write a temporary file in the same directory with the mode wanted (for `.env`, the mode it has), sync it, rename it, sync the directory. `src/util/atomic-write.ts` is not used: it does not sync, and the order of the four steps is what a test must see, which needs the writer injected.

`upgrade-state/history.log` gets one line per run that changed something or failed (time, verb, outcome, exit, the versions); the 200 newest lines are kept. It exists because the state holds only the last run and the last change, and a host's journal is often kept in memory only and lost at a reboot.

### `status` and the dry run

`status` reads the container, `.env`, the state and `lock.info`, writes nothing, and prints in this order: what runs (version, digest when the image has one, health) and since when; what `.env` names when that differs; the database's schema; the last change and the last run with their ages; an intent that was interrupted; each rejected release with its reason and log; a release that waits (from the last run) and the command for it; whether a run holds the lock and, from `lock.info`, which verb and since when; the tool's version. Its last line is one next command, or "nothing to do". It exits 0 unless it cannot read (13 or 69).

`follow --dry-run` is not a run that touches nothing. It takes the lock, may download the candidate and remove an earlier candidate's image, and prints the outcome `follow` would reach. What it leaves alone: every container, `.env`, the state and the history. Its first output line says so, and so does the runbook.

### Bounds

| Call | Bound |
| :- | :- |
| each request to the registry | 60 s |
| the verifier | 180 s |
| the pull | 600 s |
| `docker compose version`, `ps`, `inspect`, `exec`, `image inspect`, `image ls`, `image rm`, `logs`, each confined run | 30 s |
| `stop` | 60 s |
| `up`: the runner's bound | its `--wait-timeout` (300 s unattended, 1800 s attended) plus 120 s, so that Compose reports before the runner would kill it |
| the launcher's `docker` calls | 30 s, and 120 s for the copy |

The worst unattended run counts every call of the run, the launcher's included, with two waits and a lease for the apply and the same for the way back. A test that reads the constants and the unit holds that sum under the unit's `TimeoutStartSec`. The unattended wait is held at or above the `Dockerfile`'s start period plus interval times retries plus 60 s by a test that reads the `Dockerfile`.

### The units

`wizardingcode-mem-upgrade.service`: `Type=oneshot`, `ExecStart=` the launcher with `follow`, `SuccessExitStatus=75` (only an attended run can hold the lock against the timer), `TimeoutStartSec=75min`, `After=` and `Wants=` `network-online.target` and `docker.service`, with `User=` and the launcher's path as the two lines the operator fills in. `wizardingcode-mem-upgrade.timer`: `OnBootSec=3min`, `OnCalendar=hourly`, `RandomizedDelaySec=10min`, `Persistent=true`. The random delay applies to every trigger, so the run after boot comes between 3 and 13 minutes after it [source?: systemd's documentation of `RandomizedDelaySec`; no probe ran the units]. A Docker that is not up yet at that run is `cannot-check`, exit 13, and the next run is at most an hour later. Every exit from 10 to 15 fails the unit. What is wired to a failure (`OnFailure=`) is the operator's; the runbook gives an example and says that nothing tells anyone by default.

### Tests

- The rule, the registry look, the file replacement, the state and each path of the apply are tested on any OS with the new runner helper, an injected `fetch`, clock, sleep and writer, and a temporary folder.
- The launcher is run by the suite under `sh` with stub `docker`, `flock` and `timeout` programs on `PATH`.
- Scenarios against a real daemon, in `tests/scenarios/host.test.ts`, which runs only when `WIZARDINGCODE_MEM_HOST_SCENARIOS=1` and says so when it is skipped: a throwaway Compose project and a registry pinned by digest, with small images the test builds (a shell script named `wizardingcode-mem` that answers `serve version`, `serve status`, `serve health` and `serve`). The repository, the registry's address, the verifier and the bounds are parameters of the tool's functions, which the scenarios call directly. The proof of this item's scenario criterion is the command `WIZARDINGCODE_MEM_HOST_SCENARIOS=1 ./node_modules/.bin/bun test tests/scenarios/host.test.ts`, seen failing and passing on the author's machine (Docker Engine 29.9.3 on macOS, the containerd store), and the pull request's `host` job on Linux.
- CI: a job `host` on `ubuntu-latest`, after `build`, with a `timeout-minutes`. It prints `docker version`, `docker compose version` and the storage driver of `docker info`, so the run names what it proved; runs the scenarios; runs `systemd-analyze verify` on the two units; and, with the image built from the `build` job's `binaries` artifact and tagged locally under `IMAGE`, starts the server from the shipped `compose.yml`, runs the launcher's `status` (exit 0, the running version on its output), stops the server and reads the schema with the image's id as the way back does. That step is the first to show the image's binary running on a host outside its container. The workflow's text never names a `…:latest` reference, which `tests/unit/deploy-files.test.ts` refuses outside `distribute.yml`.

### Documents

`docs/adr/0033-host-follows-releases.md`; the team runbook's Upgrade (where to look first, the install, a first `follow --dry-run` with what it downloads, the verbs, the exit codes, what exit 12 can mean, the hand upgrade with the timer off, the timer's `OnCalendar` as the window, the failure handler, a cron line) and Rollback (turn the timer off first, with the section's present words left in place); the release runbook's two rules, on the verifier's version and on the state's format; `CLAUDE.md`.

## Alternatives considered

Carried from `concepts_brief.md`:

- **Nine verbs, a twelve-row rule, fifteen keys.** Rejected for the three verbs the decisions need: `pause` is the timer turned off, a rejection kept by digest ends by itself, `back` is the runbook's two lines, `drift` existed only because the state copied what Docker says.
- **Exit codes given once per release.** Rejected: the tool would keep a state of whom it told, and a release that waits for months would show a green unit.
- **A `mkdir` lock with a pid.** Rejected for `flock`: a pid reused after a reboot holds the lock for ever under an exit the unit counts as success, and `kill -0` across users reads a live holder as dead.
- **A local retag to `<repo>:<version>`.** Rejected for `<version>@sha256:<index>` in `.env`: a tag is moved by the next hand pull.
- **A split of the verifier's failures by cosign's words.** Rejected: only the exit status is proven.
- **`df` inside the container, `DockerRootDir`.** Rejected for `serve status`'s `freeBytes:`; with the containerd store the images are not under `DockerRootDir`, so the image store's disk is not measured and a failed pull is `cannot-check`.
- **The rule asked of the candidate, the tool driving the rollback across a migration, a protocol number.** Rejected in item 2026-11-13-001.
- **Watchtower, Diun, a registry webhook.** Rejected in the parent item: they do not read the schema.
- **A. A shell script copied once.** Rejected by the author (D-6): its copies age on every host and a change of the signing side breaks every host until someone copies a file.
- **C. The shell script shipped inside the image.** Rejected by the author (D-6): delivery is solved, the logic stays in shell with its copies.

Decided while drafting and in review, each with one defensible answer:

- **`docker buildx imagetools inspect` for the candidate's digest.** Rejected for a request by the tool: one prerequisite fewer on the host, and no output of a plugin to parse.
- **A lock taken by the tool.** Rejected for `flock` in the launcher: Bun has no `flock`, and the copy of the tool needs the same lock.
- **A record of the pulled candidate in the state.** Rejected: Docker keeps a pulled digest by itself, and the record would copy what the image says.
- **The binary copied from the running container.** Rejected for a created, never started container of its image: an override can make the running filesystem writable.
- **One shared leaf for the text cleaners, one runner for the release and the host.** Not taken: each would change files and tests this item preserves; a test holds the tool's cleaner equal to the release's instead.

## Cost and checkpoints

This is the larger of the three forms to build, which the author chose knowing it. Its parts: about a dozen files under `src/host/`, a launcher of about 150 lines of shell, two units, about fifteen test files, a scenario suite that needs a Docker daemon, a CI job, an ADR and two runbooks; 24 criteria. No estimate in days is given: the item is built in one continuing session, and its size is what the phases below divide.

The plan's six phases are the checkpoints, each ending with the suite passing: (1) the leaves, with the rule proven row by row; (2) the apply and its failures against a scripted Docker, and the first scenario against a real one; (3) `status` and the command; (4) the launcher and the units; (5) the scenarios and CI; (6) the documents. If the scenarios of phase 2 show that Compose or the registry does not behave as the probes say, the design is corrected before phases 3 to 6 are built.

What it costs a host each hour: two or three requests to the registry; when `latest` names an image that does not run and is not rejected (a release that waits, for example), one run of the verifier, which asks Sigstore; one image kept on disk beside the running and the previous one.

## Acceptance criteria

The numbers are the work item's and are not consecutive: a criterion that changed in review got a new number.

- AC-22 (preserve): the tests of `tests/unit/deploy-files.test.ts`, `tests/unit/team-runbook.test.ts`, `tests/unit/release-lib.test.ts`, `tests/unit/release-docs.test.ts`, `tests/integration/release-sign.test.ts` and `tests/integration/release-commands.test.ts` pass as before.
- AC-24: `follow` with a verified, higher candidate of the same schema leaves `.env`'s line as `<version>@<digest>` and every other line unchanged, runs `up` with `--no-deps --pull never --wait` and the project, directory and files of the container's labels, records the change and the previous image, removes the other images of `IMAGE`, and exits 0; the verifier runs before the pull, the pull before any run of the candidate, and the intent is in the state before `.env` changes.
- AC-25: After a start that fails twice with the schema unchanged, the failed container's log was saved at mode 0600 before any `stop` or `up`, the schema was read by a run of the previous image's id, `.env` is byte for byte what it was, the container runs the previous id, the digest is on the rejected list, and the exit is 11; this holds too when the candidate runs unhealthy and its own `serve status` cannot run; a later `follow` with the same `latest` exits 11 and runs neither the verifier, nor a pull, nor `up`.
- AC-55 (it replaced AC-26, whose words said `.env` is not put back in a case where the design's step 4 has already put it back): After a failed start that the previous image cannot undo, the run exits 10, nothing is rejected, no intent is left, the state holds the reason and the output names the runbook's Rollback: when the schema moved, when it cannot be read, and when the previous image reads a schema that is not the one before the apply (the reason then names both schemas), `.env` is left naming the candidate; when the previous image was started and did not come back healthy, `.env` names the previous version again, every other line as it was.
- AC-27: A container that exited with code 1 after the first wait is waited for once more after the lease's length, and when it is then healthy the release is applied and not rejected.
- AC-30: `upgrade` applies a verified candidate of another schema when `freeBytes` covers the floor plus `dbBytes`, one whose digest is on the rejected list, and one whose `accepts` lacks the running contract; with a candidate the verifier refuses it exits 12 with no pull, no `up` and `.env` unchanged; when the start fails it stops nothing, leaves `.env` naming the candidate, saves the log, rejects nothing, reads the schema by a run of the previous image's id and exits 10, with `serve restore --to-schema <n>` (the schema read before the apply) on its output when the schema moved, and the same command given conditionally when the schema cannot be read.
- AC-32: A `state.json` that does not parse or has a higher `format` is left as it is and refused with exit 69; a key the tool does not know is still in the file after the tool rewrites it; `replaceFile` writes a temporary file in the same directory with the mode wanted, syncs it, renames it and syncs the directory, in that order, and leaves no temporary file; the state is at mode 0600 and `.env` at the mode it had; at most ten rejected digests, ten log files and 200 history lines are kept.
- AC-33: The tool refuses, with exit 69 and nothing changed: `follow` or `upgrade` without the lock's marker, a Compose under 2.20.0, a server whose image is not of `IMAGE`, a `.env` line that is neither a version nor a version with a digest, and a `.env` or `state.json` that is a symbolic link.
- AC-34: `status` writes nothing and prints what runs (with no digest when the image has none), what `.env` names when it differs, the database's schema, the last change and the last run with their ages, a cut intent, the rejected releases with their logs, a waiting candidate with its command, whether the lock is held and by which verb since when, the tool's version, and one next command as its last line.
- AC-37: The units' text: a oneshot that runs the launcher's `follow` with `SuccessExitStatus=75`; a timer with `OnBootSec=3min`, hourly, `RandomizedDelaySec=10min`, persistent. The worst unattended run's bounds sum to less than the unit's `TimeoutStartSec`, and the unattended wait is at least the `Dockerfile`'s start period plus interval times retries plus 60 s.
- AC-39: `src/host/` imports, transitively, only its own files and `src/util/version.ts`; it is imported only by `src/cli/commands/serve.ts`, through `await import()`; it reads no environment variable but `WIZARDINGCODE_MEM_HOST_LOCKED`, and `serve host` takes no flag but `--dir`, `--dry-run` and `--lock`.
- AC-40: `serve status` prints `dbBytes:`, the size of `team.db` with its write-ahead log.
- AC-41: Against a real daemon and a local registry (`WIZARDINGCODE_MEM_HOST_SCENARIOS=1 ./node_modules/.bin/bun test tests/scenarios/host.test.ts`): a verified higher image of the same schema ends running, healthy, with `.env` naming its digest; an image that exits at start and one that stays unhealthy each end with the previous image running healthy and exit 11; an image the verifier refuses changes nothing and exits 12; an image of another schema waits (14) under `follow` and runs after `upgrade`.
- AC-42: `ci.yml` has a job `host` on `ubuntu-latest`, after `build`, with a `timeout-minutes`, that prints Docker's and Compose's versions and the storage driver, runs the scenarios with `WIZARDINGCODE_MEM_HOST_SCENARIOS=1`, runs `systemd-analyze verify` on the two units, and runs the launcher's `status` against the image built from the `binaries` artifact; its actions are pinned as the file's others are, and the scenarios' registry image is pinned by digest.
- AC-43: The team runbook's Upgrade names the launcher's three verbs, the two units, `upgrade-state/`, every exit code of the tool with the meaning the code gives it, and `journalctl -u wizardingcode-mem-upgrade.service`; its Rollback says to turn the timer off first; every path it cites under `deploy/` exists.
- AC-44: `docs/adr/0033-host-follows-releases.md` exists and names D-1, D-2, D-4 and D-6; ADR 0032's "What is not built" cites it; `CLAUDE.md` names `src/host/`, `deploy/upgrade.sh` and the three verbs; the release runbook names the two rules (the verifier's version, the state's format).
- AC-54 (it replaced AC-45, which was recorded as observed although a test can check it): ADR 0033 states why the tool comes out of the running server's image and never out of the running container, that the first tool is trusted on first use of the image the operator started by hand, that the lock's marker guards against a mistake and is not a security control, and, under Limits, each limit of the spec's Risks: no check of freshness, exit 12 that can be the network, the release before, a broken `serve host`, the launcher copied once, the binary run on the host, the running server answering for itself, health, same schema, and what is not shown (other engines, the classic image store, the units, a real signature, the token flow).
- AC-46: `scripts/release/lib.ts` exports the same `IMAGE`, `COSIGN_VERSION`, `COSIGN_IMAGE`, `SIGNER_IDENTITY`, `OIDC_ISSUER`, `DIGEST` and `verifyArgs` as `src/host/signature.ts`; of `src/`, `scripts/release/` reaches only `src/host/signature.ts` and `src/util/version.ts`, neither of which has imports; the tool's verifier command is `docker run` of `COSIGN_IMAGE`, confined, with `HOME` and `DOCKER_CONFIG` on the tmpfs and `verifyArgs`' arguments.
- AC-47: `decide` gives, for each of the rule's seventeen rows, that outcome and exit for facts that reach it, and for each adjacent pair of rows the first; attended or not, it never gives `apply` when the verifier's run failed, when it did not exit 0, when the candidate could not be read, when its version is not higher, or when `freeBytes` is under the floor or unknown; unattended it never gives `apply` when the candidate's `team_schema` is not the database's schema or when its `accepts` lacks a contract the running server accepts.
- AC-53: Each of `cannot-check` (Docker did not answer, the running server's facts, the registry, a verifier whose run failed or exceeded its bound, a failed pull, untrusted `serve version` output), `starting`, `down`, `env-differs`, `current`, `not-verified`, `low-disk`, `not-higher`, `waits-migration` and `waits-contract` ends `follow` with its exit code and with no `up`, no `stop` and `.env` unchanged; a run that ends at row 8 or earlier does not run the verifier, and one that ends at row 11 or earlier pulls nothing; `not-verified` keeps the verifier's last lines with each control character replaced by `?` and truncated at 500 characters, and the tool's cleaner and the release's `clean` give the same answer on one table of texts; every call the tool makes carries a time bound, `up`'s being its wait-timeout plus 120 s, and every `docker` child runs without the five environment variables.
- AC-49: `follow --dry-run` reaches the outcome `follow` would, says in its first line what it may download and remove, starts, stops and recreates nothing, and writes neither `.env`, nor the state, nor the history; after any pull, the images of `IMAGE` that are neither the running one, the previous one nor the candidate are removed.
- AC-50: An intent found at the start is handled by its row: the candidate healthy records the apply; the previous image healthy puts `.env` back and rejects nothing; another image healthy clears the intent; `starting` under 15 minutes exits 0 and keeps the intent; an unattended intent over a failed container of the candidate goes the failed start's way and rejects the release; an unattended intent over no container, or a stopped one that is not the candidate's, starts the previous image with the project the intent names and rejects nothing; an attended intent over a server that is not healthy changes nothing, exits 10 and stays; a failed start that ends at exit 10 and an attended failure each leave no intent, and the run after one saves no log, stops nothing and reads no schema.
- AC-51: The registry look sends an `Accept` header with the image-index, the manifest-list and the two single-manifest types, and gives the digest after a 401 with a `Bearer` challenge, a token from the challenge's realm and a second `HEAD`; a status other than 200, a header that is no digest, a challenge whose realm is not `https`, a redirect and a bound exceeded each give "no digest".
- AC-52: The launcher accepts only `status`, `follow`, `follow --dry-run` and `upgrade` (anything else is its usage and exit 64, with no tool run); names a missing `docker`, `flock`, `awk` or `timeout`; runs every `docker` call under `timeout` and answers exit 13 when one fails or exceeds its bound; refuses a user who is not the folder's owner; refuses a symbolic link at `upgrade-state`, `tool`, the tool, the lock or `.env`, and an `upgrade-state` or a `tool` that is not the user's own, group-writable or writable by others; finds the container by the two labels under the logical or the physical form of the folder; names the other directory when a `server` container exists only elsewhere; refuses an image that is not of its `IMAGE`, which equals `signature.ts`'s; copies the binary from a created, never started, labelled container of the running image's id, only when the container is healthy and that id is not the recorded one, removing an earlier labelled container first; keeps the tool it has when the container is not healthy; runs `follow` and `upgrade` under `flock` without waiting, exit 75 when held, with `lock.info` written and removed, and `status` without the lock but with `--lock held` or `--lock free`; says to start the server when there is neither a healthy container nor a tool; turns the tool's exit 64 into the sentence that names both causes, and a tool that cannot be executed into its sentence.

## Risks and rollback

- **A signature says an image may be followed, not that it is the newest.** Whoever can write the package can hold `latest` on an older signed image (hosts stay where they are, silently: `current` or `not-higher`, exit 0, seen only in `status`) or move it between signed releases; a lower version is refused, and ten rejected digests answer two bad releases alternated. No check of freshness is built; ADR 0033 says so.
- **Exit 12 does not always mean an unsigned image.** A verifier that cannot reach Sigstore or the registry exits non-zero like one that found no signature. The kept lines say which, and the runbook says to read them before treating 12 as an attack.
- **The release before must be able to verify this one.** A newer cosign on the signing side, or a corrected `SIGNER_IDENTITY`, must reach hosts one release before the signing side uses it; otherwise every host answers `not-verified` and its operator upgrades by hand once. No test of the repository can show a future signature; the release runbook carries the rule.
- **A release whose `serve host` is broken** stops every host that applied it from following: its tool is the one that judges the next release. The way out is the runbook's hand upgrade. The scenarios and the `host` job are what stands against shipping one.
- **The launcher is copied once.** It holds four things of its own: the repository's name, the binary's path in the image, its verbs and the flags it passes. A test holds each against the code, so a change that breaks old launchers fails the suite and is made knowingly; a host with an old launcher then reads the sentence that says to copy it again. Nothing delivers it.
- **A binary run on the host.** The launcher runs, as the unit's user (a member of the docker group, which is root in effect), a binary taken from the image the server runs. An image that was already compromised gains the host; before this item it had the team's data. The first tool is trusted on first use of the image the operator started by hand. ADR 0033 says so.
- **The running server answers for itself.** The version, the schema and the accepted contracts are read by `docker exec` in the running container. A server process that was broken into, on a host whose override made its filesystem writable, can answer falsely. It cannot get an unsigned image applied; it can make a signed release that migrates look like one that does not. ADR 0033 says so.
- **Health proves little.** A release that starts and breaks sync is kept, on every following host within the hour (Non-Goals).
- **"Same schema" is not "the older binary reads what the newer wrote".** The way back's read of the schema is the only check; ADR 0033 says so.
- **Not shown before a real host runs it:** Linux engines other than the CI runner's, the classic image store if the runner uses containerd's (the job prints which), the units under a real systemd beyond `systemd-analyze verify`, a real signature verified on a host (none exists before the first release after ADR 0032; no scenario runs the real `COSIGN_IMAGE`), ghcr.io's token flow from a host under rate limits.
- **Rollback of this item.** Nothing runs on a host until an operator copies three files and enables a timer. Turning it off is `systemctl disable --now wizardingcode-mem-upgrade.timer`; removing it is deleting the three files and `upgrade-state/`. The repository's side is a revert: the changes to what exists are one more line in `serve status`, the constants' new home, and one more job on every pull request.

## Non-Functional Requirements

- Neither the tool nor the launcher starts a program without a time bound.
- The tool reads no secret. It writes one kind of file that can hold one: the saved logs, which can carry the server's bootstrap code (the runbook says so). They are 0600 and the ten newest are kept.
- `src/host/` is reached only through `serve host`: no hook path imports it.

# Plan: a team server's host follows signed releases

The design is `spec.md` in this folder; this plan says which files change, in which order, and which test proves each criterion. Each phase leaves `bun run typecheck`, the lint and the suite passing. Tests are written and seen failing first (`crew tdd red`), per criterion.

Conventions that bind every file: imports with an explicit `.ts` extension; no new dependency; `src/host/` imports only its own files and `src/util/version.ts`; everything else it needs arrives in a `Deps` object. Every file below is marked Create or Modify, test files included.

## The shapes every phase uses

`src/host/run.ts`:

```ts
export type RunResult = { code: number; stdout: string; stderr: string; timedOut: boolean };
export type Run = (cmd: string[], options: { env?: Record<string, string | undefined>; timeoutMs: number }) => RunResult;
export const SCRUBBED = ["WIZARDINGCODE_MEM_VERSION", "COMPOSE_FILE", "COMPOSE_PROJECT_NAME", "DOCKER_HOST", "DOCKER_CONTEXT"] as const;
export function dockerEnv(env: Record<string, string | undefined>): Record<string, string | undefined>; // env without SCRUBBED
export const realRun: Run; // Bun.spawnSync with `timeout`; a killed child answers timedOut: true, code 124; a program that cannot start answers code 127
export function shownText(text: string, max = 500): string; // each control and format character replaced by "?", then truncated: the regular expression of scripts/release/lib.ts's UNPRINTABLE, copied
```

`src/host/bounds.ts`:

```ts
export type Bounds = { registry: number; verifier: number; pull: number; quick: number; stop: number; waitUnattended: number; waitAttended: number; upMargin: number; intentStarting: number; leaseMargin: number };
export const BOUNDS: Bounds = { registry: 60_000, verifier: 180_000, pull: 600_000, quick: 30_000, stop: 60_000, waitUnattended: 300_000, waitAttended: 1_800_000, upMargin: 120_000, intentStarting: 900_000, leaseMargin: 5_000 };
export const LAUNCHER_MS = 30_000 * 6 + 120_000; // ps (twice, the two forms), inspect, the removal of an earlier labelled container, create, rm, and the copy
export const MIN_COMPOSE = "2.20.0";
export const FLOOR_BYTES = 500 * 1024 * 1024;
export function worstUnattendedMs(bounds: Bounds, leaseMs: number): number;
```

`worstUnattendedMs` is the sum, in the run's order, of: `LAUNCHER_MS`; quick × 7 (compose version, ps, inspect, exec status, exec version, the running image's inspect, the image list); registry × 3; verifier; pull; quick × 2 (the candidate's inspect, its confined version); quick × 3 (up to three `image rm` after the pull); the apply: 2 × (waitUnattended + upMargin) + leaseMs + leaseMargin + quick (inspect); the failed start: quick (logs) + stop + quick (the schema read) + 2 × (waitUnattended + upMargin) + leaseMs + leaseMargin + quick (inspect). With the defaults and a 30 s lease that is 3550 s, under the unit's 4500 s (75 minutes).

`src/host/deps.ts`:

```ts
export type Writer = { write(path: string, text: string, mode: number): void; sync(path: string): void; rename(from: string, to: string): void; syncDir(dir: string): void };
export type Target = { image: string; registry: string; cosignImage: string; verifyArgs: (reference: string) => string[] };
export type Deps = { run: Run; fetch: typeof fetch; now: () => number; sleep: (ms: number) => void; writer: Writer; env: Record<string, string | undefined>; leaseMs: number; bounds: Bounds; target: Target; out: (line: string) => void; err: (line: string) => void; version: string };
export const realTarget: Target; // image: IMAGE; registry: "https://" + the part of IMAGE before its first "/"; cosignImage: COSIGN_IMAGE; verifyArgs
export function realDeps(given: { leaseMs: number; version: string; env: Record<string, string | undefined>; bounds?: Bounds; target?: Target }): Deps; // realRun, globalThis.fetch, Date.now, Bun.sleepSync, realWriter, BOUNDS and realTarget unless given, process.stdout and process.stderr
```

The repository's path in the registry is `target.image` without its first segment (`ghcr.io/a/b` gives `a/b`; `localhost:5001/wcm` gives `wcm`).

`src/host/rule.ts`:

```ts
export const EXIT = { ok: 0, down: 10, rejected: 11, notVerified: 12, cannotCheck: 13, waits: 14, lowDisk: 15, usage: 64, unavailable: 69, locked: 75 } as const;
export type Outcome = "cannot-check" | "starting" | "down" | "env-differs" | "current" | "rejected" | "not-verified" | "low-disk" | "not-higher" | "waits-migration" | "waits-contract" | "apply";
export type FactName = "docker" | "container" | "envMatches" | "running" | "candidateDigest" | "verification" | "candidate";
export type Facts = {
  attended: boolean;
  rejected: readonly string[];
  floorBytes: number;
  docker?: "ok" | "silent";
  container?: "starting" | "healthy" | "other";        // "other": absent, not running, unhealthy
  envMatches?: boolean;
  running?: "unreadable" | { version: string; schema: number; accepts: readonly number[]; freeBytes: number | null; dbBytes: number | null; digest: string | null };
  candidateDigest?: string | null;                      // null: the registry gave none
  verification?: "verified" | "could-not" | "not-verified";
  candidate?: null | { version: string; teamSchema: number; contract: number; accepts: readonly number[] }; // null: the pull failed or the output was not readable
};
export type Decision = { outcome: Outcome; exit: number; row: number };
export function decide(facts: Facts): Decision | { need: FactName };
```

`decide` is total. It walks the seventeen rows in order; at each row, when the fact that row reads is `undefined` it returns `{ need: <that fact> }`, otherwise it evaluates the row. Rows and the fact each reads: 1 `docker`; 2, 3 `container`; 4 `envMatches`; 5 `running`; 6, 7, 8 `candidateDigest` (7 also `running.digest`, 8 `rejected`); 9, 10 `verification`; 11 `running.freeBytes`; 12, 13, 14, 15, 16 `candidate`; 17 nothing more. The gathering loop in `follow.ts` is therefore one loop: call `decide`; on `{ need }` gather that one fact and call again; on a decision stop. The order in which facts are gathered is the order of `FactName` above, and a test asserts it from the recorded calls.

`src/host/state.ts`:

```ts
export const FORMAT = 1;
export type Intent = { digest: string; id: string; version: string; fromId: string; fromEnvLine: string; fromVersion: string; schema: number; project: string; directory: string; files: string[]; volume: string; attended: boolean; at: number };
export type State = { format: number; intent?: Intent; lastChange?: { kind: "applied" | "rejected" | "down" | "upgrade-failed"; from: string; to: string; at: number; reason?: string; log?: string }; lastRun?: { verb: string; outcome: string; exit: number; at: number; candidate?: { version: string; digest: string } }; previous?: { id: string; version: string; envLine: string }; rejected?: Array<{ digest: string; version: string; at: number; reason: string; log?: string }>; [unknown: string]: unknown };
```

`stateDir(folder)` is `<folder>/upgrade-state`; every function of `state.ts` takes the folder.

## What the tool prints

Each line goes through `deps.out`; refusals and failures through `deps.err`. `<age>` is `<n>s`, `<n>m`, `<n>h` or `<n>d`, the largest unit that gives at least 1. Times are ISO 8601 UTC with seconds.

`follow` and `upgrade` end with one line `<outcome>: <sentence>`:

| Outcome | Sentence |
| :- | :- |
| `cannot-check` | one of: `Docker did not answer`; `the running server did not answer serve status`; `the registry did not give the digest of latest`; `the verifier could not run`; `the image could not be pulled or read: <shown text>` |
| `starting` | `the server is starting; nothing was looked at` |
| `down` | `the server is not running healthy` then, when the state's last change is `down`, `: <its reason>; see Rollback in docs/runbooks/team-server.md` |
| `env-differs` | `.env names <value> and <running reference> runs; settle that first` |
| `current` | `<version> is what latest names` |
| `rejected` | `<version> (<digest>) failed to start here on <time>; log <name>` |
| `not-verified` | `<digest> did not verify as signed by distribute.yml at main; the verifier said: <shown lines>` |
| `low-disk` | `<free> MiB free on the data volume, <needed> MiB needed` |
| `not-higher` | `latest names <version>, which is not higher than <running version>` |
| `waits-migration` | `<version> migrates the team schema (<from> to <to>); run <folder>/upgrade.sh upgrade` |
| `waits-contract` | `<version> no longer accepts contract <n>; run <folder>/upgrade.sh upgrade` |
| `apply`, done | `applied: <from> -> <to>` |
| `apply`, way back done | `rejected: <to> did not start; <from> runs again; log <name>` |
| `apply`, down | `down: <reason>; see Rollback in docs/runbooks/team-server.md` |
| `upgrade`, failed start | `upgrade-failed: <state of the container>; log <name>` then the restore line of the spec, plain or conditional |

`follow --dry-run` prints first `dry run: may download the candidate and remove an older candidate's image; changes no container, .env or state`, and its last line is `would: <outcome>: <sentence>`.

`status` prints, in this order, one line each, a line being absent when its fact is:

```
runs: <version> (<digest> | no digest), <health>, since <time>
.env: names <value>, which is not what runs
schema: <n>
last change: <kind> <from> -> <to>, <age> ago[: <reason>]      (or "last change: none")
last run: <verb> <outcome> (exit <n>), <age> ago                (or "last run: none")
interrupted: an <attended|unattended> apply of <version> begun <age> ago
rejected: <version> <digest>, <age> ago: <reason> (log <name>)
waits: <version> (<outcome>); run <folder>/upgrade.sh upgrade
lock: held by <verb> since <time>                               (or "lock: held", "lock: free")
tool: <version>
next: <command>                                                 (or "next: nothing to do")
```

`next` is the first that applies: an interrupted intent (`<folder>/upgrade.sh follow`, or `upgrade` for an attended one); a server that is not healthy (`see Rollback in docs/runbooks/team-server.md`); `.env` differing (`docker compose up -d server, or put .env back`); a waiting release (`<folder>/upgrade.sh upgrade`); a rejected release named by `latest` (`<folder>/upgrade.sh upgrade, to try <version> again`).

`lock.info` is three lines: the verb, the pid, the time. A log is `upgrade-state/logs/<YYYYMMDDTHHMMSSZ>-<version>.log`. A history line is `<time>\t<verb>\t<outcome>\t<exit>\t<from>\t<to>`.

## Phase 1: the leaves

| File | Action | What and why |
| :- | :- | :- |
| `src/host/signature.ts` | Create | The six constants and `verifyArgs`, moved verbatim (comments too) from `scripts/release/lib.ts:559-587`. No imports |
| `scripts/release/lib.ts` | Modify | The block becomes an import of the seven names from `../../src/host/signature.ts` and an `export { … }` of them; `verifyCommand` stays |
| `src/host/run.ts`, `src/host/bounds.ts` | Create | As above |
| `src/host/rule.ts` | Create | `EXIT`, `decide` |
| `src/host/registry.ts` | Create | `latestDigest(deps): Promise<string \| null>`: `HEAD <registry>/v2/<path>/manifests/latest` with `redirect: "manual"`, `signal: AbortSignal.timeout(bounds.registry)` on each request, and `Accept: application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json`; on 401, parse `Bearer realm="…",service="…",scope="…"`; the realm must parse as an `https:` URL; `GET <realm>?service=…&scope=…`, read `token`; `HEAD` again with `Authorization: Bearer`. Any other status, a 3xx, a header that fails `DIGEST`, a thrown `fetch` gives `null` |
| `src/host/files.ts` | Create | `replaceFile(writer, path, text, mode)`: `write(<dir>/.<name>.<pid>.tmp, text, mode)`, `sync`, `rename`, `syncDir`; `realWriter` (`openSync`, `writeSync`, `fsyncSync`, `renameSync`); `isLink(path)` (`lstatSync`); `modeOf(path)` (`statSync(path).mode & 0o777`); `readEnvLine(text)` returning `{ value, version, digest } \| null` for the one `WIZARDINGCODE_MEM_VERSION=` line (quotes and `\r` tolerated; two such lines is `null`); `withEnvLine(text, value)` replacing that line only and keeping its line ending |
| `src/host/state.ts` | Create | `readState(folder)`: no file gives `{ format: 1 }`; a link, a parse failure, a non-object, a `format` that is not an integer from 1 to `FORMAT` throw `StateRefused(path, why)`. `writeState(deps, folder, state)` through `replaceFile` at 0600, the whole object written back so unknown keys stay. `pushRejected` (ten newest), `appendHistory` (200 newest lines, through `replaceFile`), `pruneLogs` (ten newest by name, which the name's time orders) |
| `src/team/status.ts` | Modify | `TeamStatus.dbBytes: number \| null` (`statSync` of `team.db` plus `team.db-wal` when present, `null` when it cannot be read); `renderStatus` prints `dbBytes: <n \| unknown>` after `freeBytes:`. `serve status --json` gains the key, since it serialises `TeamStatus` whole |
| `tests/helpers/host-runner.ts` | Create | `hostRunner(answers)`: like `scripted`, but each recorded call is `{ line, cmd, env, timeoutMs }` and an answer may set `timedOut` |

Tests, in this order:

- `tests/unit/host-signature.test.ts`, Create (AC-46, first half): each export of `lib.ts` is identical (`toBe`) to `signature.ts`'s; `signature.ts` and `src/util/version.ts` have no import statement; the import closure of every file of `scripts/release/` (followed through `scripts/build.ts`, which `lib.ts` imports) contains, under `src/`, exactly those two files.
- `tests/unit/host-rule.test.ts`, Create (AC-47): a table of seventeen fact records, one per row, each asserting `outcome`, `exit` and `row`; for each adjacent pair `(n, n+1)` a record that satisfies both and gets row `n`; a record with only `attended`, `rejected` and `floorBytes` gets `{ need: "docker" }`, and feeding the facts one by one in `FactName`'s order reaches row 17; the invariants as loops over generated facts (attended and not): no `apply` unless `verification === "verified"`, `candidate !== null`, the version is higher and `freeBytes` is a number at or above the floor; unattended, no `apply` when the schemas differ or `accepts` lacks one of `running.accepts`; attended facts pass rows 8, 14 and 15.
- `tests/unit/host-registry.test.ts`, Create (AC-51): a `fetch` stub that records requests. Cases: the `Accept` header of the first request has the four types; 401 then token then 200 with a digest; 200 at once; 404; 200 with `docker-content-digest: latest`; a challenge with `realm="http://…"`; a 302; a `fetch` that rejects with a timeout.
- `tests/unit/host-files.test.ts`, Create (AC-32, the writer's half): a recording writer sees `write`, `sync`, `rename`, `syncDir` in that order, the temporary path in the target's directory; with `realWriter` in a temporary folder no `.tmp` is left and the mode is the one asked; `readEnvLine` and `withEnvLine` on a plain version, a version with a digest, quotes, CRLF, a second line, garbage.
- `tests/unit/host-state.test.ts`, Create (AC-32, the state's half): unparseable and `format: 2` throw and leave the bytes; an unknown key survives `writeState`; mode 0600; eleven rejected keep ten; 201 history lines keep 200; eleven logs keep ten.
- `tests/unit/host-shown.test.ts`, Create (AC-53, the cleaner's half): one table of texts (an escape sequence, a zero-width character, a newline, 2000 characters) through `shownText` and `clean` of `scripts/release/lib.ts`, each at 500: the two answers are equal (`shown` of `src/team/restore.ts` is not exported and replaces its arrows too).
- `tests/integration/team-serve-cli.test.ts`, Modify (AC-40): the case that reads `serve status`'s lines gains `dbBytes:` equal to the size of `team.db` plus its `-wal`.

## Phase 2: the facts, the apply, and the scenarios

The order inside the phase: `deps.ts` and a `follow.ts` whose `follow` and `upgrade` return 69; the scenario files and their test, seen failing (`crew tdd red` for AC-41: the first scenario expects exit 0 and a running image and gets 69); then `docker.ts`, `apply.ts` and the real `follow.ts`, one criterion at a time against the scripted world; the scenarios are the phase's last green.

| File | Action | What |
| :- | :- | :- |
| `src/host/deps.ts` | Create | As above |
| `src/host/docker.ts` | Create | Every call through `deps.run` with `dockerEnv(deps.env)` and a bound from `deps.bounds`. `composeVersion()`: the first match of `/(\d+)\.(\d+)\.(\d+)/` in `docker compose version --short`, or `null`. `findContainer(folder)` returns `{ kind: "silent" } \| { kind: "none" } \| { kind: "many", names } \| { kind: "one", container }` with `id, imageId, imageRef, state, exitCode, health, startedAt, volume, project, directory, files` (the files label split at `,`). `composeArgs(container \| intent)`. `runningFacts(container)`: two `docker exec`; a failed call or an answer without `version:` or `schema:` gives `"unreadable"`; `freeBytes: unknown` and `dbBytes: unknown` give `null`; with `digest` from `docker image inspect` of the container's image id (`RepoDigests`' entry of `target.image`, or `null`). `schemaWith(imageId, volume)` gives `{ schema } \| "newer" \| "unreadable"`. `verify(digest)` gives `"verified" \| "could-not" \| { notVerified: lines }`. `pullCandidate(digest, keepIds)`: pull, `image inspect`, confined `serve version`, strict parse, then `removeOtherImages`; `null` on a failed pull, inspect or parse. `removeOtherImages(keepIds)`: `docker image ls --no-trunc --format '{{.ID}}' <image>`, then `docker image rm <id>` for each id not kept, failures ignored. `saveLogs(container, version)`. `upWait(args, waitMs)` runs `up -d --no-deps --pull never --wait --wait-timeout <waitMs / 1000> server` with `timeoutMs: waitMs + bounds.upMargin` |
| `src/host/apply.ts` | Create | `apply(ctx, candidate, attended)`, `waitHealthy(ctx, waitMs)` (`upWait`, then the lease rule once), `failedStartUnattended(ctx, intent, { reject })`, `failedStartAttended(ctx, intent)`, `reconcile(ctx, state)` returning `{ goOn: true } \| { exit, outcome }` by the spec's table |
| `src/host/follow.ts` | Create | `follow(deps, folder, { dryRun })` and `upgrade(deps, folder)`. One order for both: (1) the lock's marker, else 69; (2) a link at `.env` or `state.json`, else 69; (3) `composeVersion`: `null` is `cannot-check`, under `MIN_COMPOSE` is 69; (4) `findContainer`: `silent` is `cannot-check`, `many` is 69; with one, an image not of `target.image` or no volume at `/data` is 69; (5) `.env`'s line, else 69 with the line to write; (6) `readState`, a `StateRefused` is 69; (7) an intent: `reconcile` (with `none` and an intent, the reconcile uses the intent's project); (8) the gathering loop over `decide`; (9) `apply` on row 17 unless `dryRun`; (10) unless `dryRun`: `lastRun` written, and a history line when something changed or the exit is not 0; (11) the output line |
| `tests/helpers/host-world.ts` | Create | `hostWorld(options)`: a temporary folder with `compose.yml`, `.env` and `upgrade-state/`; a `hostRunner` whose answers model one container (image id, health, exit code, labels) and react to `up`, `stop` and `pull` by a small state object the test sets (`afterUp: "healthy" \| "exit1-then-healthy" \| "unhealthy" \| "exited"`, `schemaWithPrevious`, `verifier`, `candidate`, `images`); a `fetch` that answers the digest; a fake clock and a `sleep` that advances it; a recording writer over the real one; `deps` with `BOUNDS` |
| `tests/scenarios/host/Dockerfile`, `wizardingcode-mem.sh`, `compose.yml` | Create | A `busybox` image (pinned by digest) with `/usr/local/bin/wizardingcode-mem` the shell script, `RUN mkdir /data && chown 10001:10001 /data`, `USER 10001`, `ENTRYPOINT ["wizardingcode-mem"]`, `CMD ["serve"]`, `HEALTHCHECK --interval=1s --timeout=2s --retries=3 --start-period=1s CMD ["wizardingcode-mem","serve","health"]`. The script: `serve version` prints the four `key=value` lines from build arguments; `serve status` prints `version:`, `schema:` (the content of `/data/schema`, 2 when absent; exit 3 when it is above the image's schema), `freeBytes: 9000000000`, `dbBytes: 1000`; `serve health` exits by a build argument; `serve` writes its schema to `/data/schema` when it is higher than the file's, then exits 1 or sleeps, by a build argument. The compose file: `image: ${SCENARIO_IMAGE}:${WIZARDINGCODE_MEM_VERSION}`, the volume `data:/data`, `SCENARIO_IMAGE` in the project's `.env` |
| `tests/scenarios/host.test.ts` | Create | `describe.skipIf(process.env.WIZARDINGCODE_MEM_HOST_SCENARIOS !== "1")`, with one always-run test that prints why it skipped. `beforeAll`: `docker run -d -p 127.0.0.1::5000 registry:2@sha256:<digest>`, the port read with `docker port`; five images built with `docker build --build-arg … -t localhost:<port>/wcm:<version>` and pushed with `docker push` (0.9.1 schema 2; 0.9.2 healthy; 0.9.3 exits; 0.9.4 unhealthy; 0.10.0 schema 3); the project started on 0.9.1 after a `docker pull` of it by tag. Each scenario moves `latest` with `docker tag` and `docker push`, then calls `follow` or `upgrade` with `realDeps({ …, target: { image: "localhost:<port>/wcm", registry: "http://localhost:<port>", cosignImage: "busybox@sha256:<digest>", verifyArgs: () => ["true"] \| ["false"] }, bounds: { …BOUNDS, waitUnattended: 20_000, waitAttended: 20_000 }, leaseMs: 1000 })` and the lock's marker in `env`. `afterAll` removes the project with its volume, the registry and the images |

Tests (`tests/integration/`, each Create), one file per criterion so a red is readable:

- `host-follow-apply.test.ts` (AC-24): the `.env` text before and after; the `up` call's exact arguments (`--project-directory`, `-p`, one `-f` per label file, `up -d --no-deps --pull never --wait --wait-timeout 300 server`); the verifier's call before the pull's, the pull's before the confined run's; the intent is on disk when `.env`'s write begins (the recording writer notes the order); `image rm` of a third image and not of the running or previous one; exit 0; the calls for the facts come in `FactName`'s order.
- `host-follow-failed.test.ts` (AC-25, AC-26, AC-27): exited twice with the schema unchanged (log saved at 0600 before `stop`; the schema read is a `docker run` naming the previous id and the volume; `.env` bytes equal; rejected list; exit 11; then a second `follow` records no verifier, pull or `up`); the unhealthy-running variant (no `stop` before the read; the candidate's `exec` is never asked for the schema); schema `newer`, `unreadable`, and previous image unhealthy (exit 10, `.env` still the candidate's, the reason in the state, "Rollback" on the output); `exit1-then-healthy` (one sleep of `leaseMs + 5000`, applied, nothing rejected).
- `host-follow-outcomes.test.ts` (AC-53): one case per cause listed in the criterion, each asserting the exit, the absence of `up`, `stop` and of any writer call on `.env`; for the outcomes of rows 1 to 8 the absence of the verifier's call, and for rows 1 to 11 the absence of the pull's; `not-verified` with `\u001b[31m` and 2000 characters in the verifier's stderr (the output has `?` for the escape and at most 500 characters of it); a loop over every recorded call asserting `timeoutMs > 0`, that the `up` call's is `300_000 + 120_000`, and that `env` has none of `SCRUBBED` when `cmd[0] === "docker"`, with the five variables set in `deps.env`.
- `host-dry-run.test.ts` (AC-49): `--dry-run` over an applicable candidate prints the `dry run:` line first and `would: apply` last, records no `up` or `stop`, and the recording writer saw no call at all; with a third image of the repository present, the pull is followed by its `image rm` and by none of the running, previous or candidate ids.
- `host-upgrade.test.ts` (AC-30): another schema with enough space applies; with `freeBytes` under floor plus `dbBytes` exits 15; a rejected digest applies; `accepts` lacking a running contract applies; a refused verification exits 12 with no pull, no `up`; a failed start over a moved schema (no `stop`, `.env` names the candidate, the log saved, nothing rejected, the output has `serve restore --to-schema 2`, exit 10) and over an unreadable one (the conditional sentence).
- `host-intent.test.ts` (AC-50): one case per row and column of the spec's table that differs, eight in all; after a `down` and after an attended failure the state has no intent, and a further `follow` records no `logs`, no `stop` and no schema read.
- `host-refusals.test.ts` (AC-33): each refusal's exit 69, with no writer call and no `docker` call after the refusing one.
- AC-41: `crew tdd red` at the phase's start and `green` at its end, each with `-- env WIZARDINGCODE_MEM_HOST_SCENARIOS=1 ./node_modules/.bin/bun test tests/scenarios/host.test.ts`.

## Phase 3: `status`, the command, the boundary

| File | Action | What |
| :- | :- | :- |
| `src/host/status.ts` | Create | `status(deps, folder, lock: "held" \| "free" \| undefined)`: reads only; the lines of "What the tool prints" |
| `src/host/command.ts` | Create | `hostCommand(argv, deps): Promise<number>`: `status \| follow \| upgrade`, `--dir <folder>` required, `--dry-run` (follow only), `--lock held\|free` (status only); anything else is usage on standard error and 64 |
| `src/cli/commands/serve.ts` | Modify | The import from `../../team/lease.ts` gains `SERVE_TTL_MS`. Before `takeData`: `if (argv[0] === "host") { const [{ hostCommand }, { realDeps }] = await Promise.all([import("../../host/command.ts"), import("../../host/deps.ts")]); return hostCommand(argv.slice(1), realDeps({ leaseMs: SERVE_TTL_MS, version: pkg.version, env: process.env })); }`. `USAGE` gains: `  wizardingcode-mem serve host status \| follow [--dry-run] \| upgrade --dir <folder>   the host's side of a team server; run through deploy/upgrade.sh` |

Tests:

- `tests/integration/host-status.test.ts`, Create (AC-34): a world with every part present; the output equals the block of "What the tool prints", line for line; no writer call; an image with no `RepoDigests` prints `no digest`; `--lock held` with a `lock.info` prints the verb and the time.
- `tests/unit/host-boundary.test.ts`, Create (AC-39): the import closure of `src/host/*.ts` is inside `src/host/` plus `src/util/version.ts`; a walk of every `.ts` under `src/` finds `host/` imported only by `src/cli/commands/serve.ts`, and there not in a static import; `process.env` appears in no file of `src/host/` but `deps.ts`'s `realDeps` (its two writers); the `WIZARDINGCODE_MEM_` names in `src/host/` are exactly `WIZARDINGCODE_MEM_HOST_LOCKED` and `WIZARDINGCODE_MEM_VERSION`; the flags `command.ts` matches are exactly `--dir`, `--dry-run` and `--lock`.
- `tests/integration/host-command.test.ts`, Create (part of AC-33 and AC-39): `serve host` through `tests/helpers/cli.ts` with no arguments and with `--bogus` exits 64; `follow --dir <tmp>` without the marker exits 69.

## Phase 4: the launcher and the units

| File | Action | What |
| :- | :- | :- |
| `deploy/upgrade.sh` | Create | POSIX shell, `set -eu`, the nine steps of the spec, committed executable (`git update-index --chmod=+x deploy/upgrade.sh`). `IMAGE=ghcr.io/wizardingcode-io/wizardingcode-mem` and `TOOL_PATH=/usr/local/bin/wizardingcode-mem` on one line each. The owner is read with `ls -ldn "$dir" \| awk '{print $3}'` against `id -u`; the permissions from the same `ls -ldn` line's first field. The two forms of the folder: `cd "$(dirname "$0")" && pwd -L` and `pwd -P`. The lock: `exec flock -n -E 75 "$state/lock" "$0" "$@"` with `WIZARDINGCODE_MEM_HOST_LOCKED=1` exported, guarded by that variable; `status` asks `flock -n "$state/lock" true`. `lock.info` is written under the lock and removed by a `trap … EXIT`. The created container carries `--label io.wizardingcode.mem.upgrade=tool`; `docker ps -aq --filter label=io.wizardingcode.mem.upgrade=tool` is removed first. Every `docker` call is `timeout 30 docker …`, the copy `timeout 120`; a non-zero `docker ps` or `inspect` prints `Docker did not answer` and exits 13 |
| `deploy/wizardingcode-mem-upgrade.service`, `.timer` | Create | As the spec's units; the operator's two lines are `User=CHANGE-ME` and `ExecStart=/CHANGE/ME/upgrade.sh follow`, each with a comment line above |

Tests:

- `tests/integration/host-launcher.test.ts`, Create (AC-52): a temporary folder with a copy of the launcher; a `bin/` first on `PATH` with `docker`, `flock`, `timeout` and, where a case needs it, `ls`, written by the test (shell scripts that append their arguments to a log and answer from files the case sets; `timeout` drops its first argument and runs the rest, or exits 124 when the case says so; `flock` runs the command it is given, or exits 75 when the case says held); the stub `docker cp` writes a small shell script as the tool, which records its arguments and environment and exits by a file. One `test` per clause of the criterion, each named after it; the permission cases are `upgrade-state` and `tool`, each not the user's own (the stub `ls`), `chmod 770` and `chmod 707`. Each case runs under `sh`, and under `/bin/dash` too where that exists.
- `tests/unit/host-units.test.ts`, Create (AC-37): the two files' keys by regular expression; `TimeoutStartSec` in seconds above `worstUnattendedMs(BOUNDS, SERVE_TTL_MS) / 1000`; `BOUNDS.waitUnattended / 1000 >= start + interval × retries + 60` parsed from the `Dockerfile`'s `HEALTHCHECK`; the launcher's `IMAGE=` equals `signature.ts`'s and its `TOOL_PATH=` is the path the `Dockerfile` copies the binary to; `shellcheck deploy/upgrade.sh` exits 0 when `shellcheck` is on `PATH` (skipped by name otherwise); the file's git mode is 100755 (`git ls-files -s`).

## Phase 5: CI

| File | Action | What |
| :- | :- | :- |
| `.github/workflows/ci.yml` | Modify | A job `host`: `needs: build`, `runs-on: ubuntu-latest`, `timeout-minutes: 20`. Steps: checkout; Bun (as the file's other jobs); `bun install --frozen-lockfile`; "what this run proves" (`docker version`, `docker compose version`, `docker info --format '{{.Driver}}'`); the scenarios (`WIZARDINGCODE_MEM_HOST_SCENARIOS: "1"`, `bun test tests/scenarios/host.test.ts`); the units (a folder `/tmp/wcm-host` gets `compose.yml`, `Caddyfile`, `deploy/upgrade.sh` and the two units; `sed -i "s#^User=.*#User=$(id -un)#; s#^ExecStart=.*#ExecStart=/tmp/wcm-host/upgrade.sh follow#"` on the service; `systemd-analyze verify /tmp/wcm-host/wizardingcode-mem-upgrade.service /tmp/wcm-host/wizardingcode-mem-upgrade.timer`); the artifact download into `dist/`; the launcher (`docker build -t wcm:ci .`; the version read from `package.json`; `docker tag wcm:ci ghcr.io/wizardingcode-io/wizardingcode-mem:$version`; `/tmp/wcm-host/.env` with `SERVER_DOMAIN=localhost` and the version; `docker compose up -d --pull never server` in that folder; a loop until healthy; `./upgrade.sh status` whose output must hold `runs: $version`; `docker compose stop server`; `docker run --rm --network none --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges:true -v <volume>:/data <image id> serve status` whose output must hold `schema:`). The actions are the ones the file already names |

Tests:

- `tests/unit/deploy-files.test.ts`, Modify (AC-42): a new `describe` reads `ci.yml`: the job's `needs`, runner, `timeout-minutes`, the step texts for the three version commands, the environment variable, `systemd-analyze verify`, `upgrade.sh status`; every `uses:` of the job is one the file already uses; `tests/scenarios/host.test.ts` names its registry image and its busybox with `@sha256:`.

## Phase 6: the documents

| File | Action |
| :- | :- |
| `docs/adr/0033-host-follows-releases.md` | Create |
| `docs/adr/0032-signed-images.md` | Modify: "What is not built" points to 0033 |
| `docs/runbooks/team-server.md` | Modify: Upgrade and Rollback, the Rollback's present sentences untouched |
| `docs/runbooks/release.md` | Modify: the two rules |
| `CLAUDE.md` | Modify: the team server paragraph and Releasing |
| `tests/unit/team-runbook.test.ts` | Modify: the path test's prefix list gains `deploy/` |
| `tests/unit/host-docs.test.ts` | Create (AC-43, AC-44): the runbook's Upgrade section holds the three verbs, the two unit names, `upgrade-state/`, `journalctl -u wizardingcode-mem-upgrade.service`, and a table whose rows are exactly `EXIT`'s codes 10 to 15, 64, 69, 75; Rollback holds `systemctl disable --now wizardingcode-mem-upgrade.timer`; ADR 0033 exists and holds `D-1`, `D-2`, `D-4`, `D-6`; ADR 0032 holds `0033`; `CLAUDE.md` holds `src/host/`, `deploy/upgrade.sh`, `serve host`; `release.md` holds the two rules' key phrases |

AC-45 is recorded with `crew tdd observed` and its reason after the ADR is read against the spec's Risks. AC-22 is closed with `crew tdd after` on the six files.

## Verification

- `./node_modules/.bin/bun run typecheck`
- `./node_modules/.bin/biome check src scripts tests npm` and the item's changed files by name, recorded in `probes/lint-by-name.md` on the delivered HEAD (the crew's lint gate reads no file inside this worktree)
- `bun run test`
- `WIZARDINGCODE_MEM_HOST_SCENARIOS=1 ./node_modules/.bin/bun test tests/scenarios/host.test.ts`
- `shellcheck deploy/upgrade.sh`
- `crew gate run <id>` with the machine's load under 3

---

Published by `crew learn` from item `2026-11-13-002-the-hosts-script-and-timer-of-piece-3-of`, reviewed before the code (ADR 0019).
