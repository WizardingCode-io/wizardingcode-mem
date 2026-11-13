# Running a team server, and joining one

The team server ([ADR 0026](../adr/0026-team-server.md)) is one container on a host the team owns; each member's `wizardingcode-mem` keeps it in step through the sync ([ADR 0027](../adr/0027-sync-client.md)). This page is the runbook for both sides: what to type, what to look for, and what to do when something goes wrong. Every command here is `wizardingcode-mem`'s own; its usage text is the reference when an option is in doubt.

## The operator's side

### Before the first start, once

- **The image.** `ghcr.io/wizardingcode-io/wizardingcode-mem`, pushed by the release with the version as its tag (`0.7.0`, say). `latest` is moved last by the release's distribution, after npm, the Homebrew tap and the marketplace succeeded, and stays on the previous release when the new one would refuse that release's clients (`docs/runbooks/release.md`). Up to and including 0.8.0, `latest` was pushed at build time, before any of that; it no longer is (ADR 0031). It is still no proof of a release: everyone who can push a tag or a branch to the repository can move it, so pin a version in `.env`, as `.env.example` does. From the first release after ADR 0032 the image `latest` names is signed by the release's own workflow, `distribute.yml@refs/heads/main`, after a person approved it; a pre-release, a held release and every release up to 0.8.0 are not signed. The tag is not a proof by itself, the signature is. Anyone checks it with no login, by the digest (`docker buildx imagetools inspect ghcr.io/wizardingcode-io/wizardingcode-mem:<tag>` prints it as `Digest:`), with cosign 3.1.4 installed or from cosign's own image:

  ```sh
  cosign verify ghcr.io/wizardingcode-io/wizardingcode-mem@sha256:<digest> --certificate-identity https://github.com/WizardingCode-io/wizardingcode-mem/.github/workflows/distribute.yml@refs/heads/main --certificate-oidc-issuer https://token.actions.githubusercontent.com
  docker run --rm ghcr.io/sigstore/cosign/cosign@sha256:0f06154836d2de34f887a5c273506d52ca43edaa1d9e53e6510fa78a48f69c2d verify ghcr.io/wizardingcode-io/wizardingcode-mem@sha256:<digest> --certificate-identity https://github.com/WizardingCode-io/wizardingcode-mem/.github/workflows/distribute.yml@refs/heads/main --certificate-oidc-issuer https://token.actions.githubusercontent.com
  ```

  Exit 0 means that digest was signed by that workflow on `main`; anything else means do not run it. `docker run --rm ghcr.io/wizardingcode-io/wizardingcode-mem:<tag> serve version` prints what an image is before it runs against your data: its `version`, its `team_schema`, the `contract` it speaks and the ones it `accepts`. The package on the GitHub container registry starts private: make it public once in the organisation's package settings, or run `docker login ghcr.io` on the host with a token that reads packages before the first `docker compose pull`.
- **The host.** DNS for the team's domain pointing at it, ports 80 and 443 open. Nothing else is published: Caddy is the only way in, and the server's own port (8787) stays inside the compose network.
- **The files.** Copy `compose.yml`, `Caddyfile` and `.env.example` from the repository to one folder on the host; copy `.env.example` to `.env` and set `SERVER_DOMAIN` and `WIZARDINGCODE_MEM_VERSION` (the tag, without its `v`).

### The first start, and the bootstrap code

```sh
docker compose up -d
docker compose logs server
```

The log is JSON lines on the container's standard output. The first line to look for is `event: "listening"`. On a first start with no members, the server mints the first admin's invitation and logs it once, `event: "bootstrap"` with the code and `validHours: 24`: that line is the only secret the log ever carries. Copy the code and use it within 24 hours from your own machine:

```sh
wizardingcode-mem share server add https://team.example.com --code <code> --name "Your name"
```

That join makes you the admin. A spent or expired bootstrap code is minted again at the next start only while the server still has no member and no open admin invitation.

Health: the image checks itself every 60 seconds with `wizardingcode-mem serve health`, which asks `/v1/health` and exits 0 on `ok: true`; `docker compose ps` shows the service `healthy`. From the host, `docker compose exec server wizardingcode-mem serve health` prints the same answer.

### Invitations, members and devices

The admin's subcommands run inside the container, against the same data directory (`WIZARDINGCODE_MEM_TEAM_DATA`, `/data` in the image), while the server runs:

```sh
docker compose exec server wizardingcode-mem serve invite --role member --name "Ana"
docker compose exec server wizardingcode-mem serve invite --role admin --name "Bruno"
docker compose exec server wizardingcode-mem serve invite --for <member id>
docker compose exec server wizardingcode-mem serve invitations
docker compose exec server wizardingcode-mem serve invitation revoke <id>
docker compose exec server wizardingcode-mem serve members
docker compose exec server wizardingcode-mem serve role <member id> admin
docker compose exec server wizardingcode-mem serve revoke <device id>
docker compose exec server wizardingcode-mem serve disable <member id> --withdraw
docker compose exec server wizardingcode-mem serve enable <member id>
docker compose exec server wizardingcode-mem serve status
docker compose exec server wizardingcode-mem serve audit --limit 50
```

An invitation's code is printed once, on the subcommand's standard output, and is used once; `--expires <hours>` bounds it. `invite --for <member id>` is how a member gets a second machine: the code joins a new device of the same member. `revoke <device id>` ends one device (its next request answers 401 and its sync stops with the remedy `share server rejoin`); `disable <member id>` ends every device of a member, and `--withdraw` takes back what they sent. `status` and `audit` are the operator's view of the data directory; `status --json` for a script. `status` prints `names: <n>`, the shared names the registry holds ([ADR 0028](../adr/0028-shared-names.md)).

### Erasing a shared name

A shared name a member created (a typo, a person's name, a project that should not be on the server) is erased in three steps, the name first:

```sh
docker compose exec server wizardingcode-mem serve purge name <alias> --yes
```

The alias is the full one, `name:<slug>`. From that moment the name is out of every member's list, a push under it is refused (`name-purged`), a create of the same name is refused, and the members bound to it read `removed by the operator` in their dock and in `wizardingcode-mem status`; nothing of theirs is withdrawn by itself, they set the project to Nothing when they are ready. The command prints how many entries and memories are still under the name: purge them one by one at leisure, with `wizardingcode-mem serve purge entry <uuid> --yes` and `wizardingcode-mem serve purge memory <key> --yes`, in any order. Until you run the first step a name stays readable by every member, with its creator and its counts. The third step is the mirror: `docker compose exec server wizardingcode-mem serve mirror --rebuild`, once the items are purged, because the export under `repos/` keeps the name's repository (`repos/projects/<slug>-<8 hex>`, its `knowledge.json` naming the alias and its init commit) after its items are gone, and a restore of `team.db` does not touch `repos/`. The limit: the string stays in the marked registry row, in the feed's `changes` rows, in the withdrawn rows and in the audit rows until `team.db` is restored or rebuilt, and in the mirror until that rebuild. A member creates at most 10 names an hour.

### Upgrade

Set `WIZARDINGCODE_MEM_VERSION` in `.env` to the new tag, then:

```sh
docker compose pull server
docker compose up -d server
```

Across a schema bump the new binary copies `team.db` first, to `/data/backups/team-<ms>-v<n>-<pid>.db`, and migrates in place; 0.8.0 is such a bump (team schema 2: the registry of shared names and the renamed alias columns). Upgrade the server before members name projects: a 0.8.0 client against a 0.7.0 server holds its shared names (`wizardingcode-mem status` ends the server line `names held (server at contract 1)`, `doctor` warns, the Servers page says it) and refuses to create or join one until the server speaks contract 2; the hold ends within a minute of the upgrade while the sync runs, or at the member's next dock or CLI action. A member whose client is older than the server's contract sees the server `stopped (contract)` in `wizardingcode-mem status`, with the remedy `upgrade wizardingcode-mem`; nothing of theirs is lost, the sync resumes after the upgrade.

### Rollback

There are two cases, told apart by the team schema of the two images: `docker run --rm ghcr.io/wizardingcode-io/wizardingcode-mem:<tag> serve version` prints `team_schema=<n>` for each. An image that answers `unknown subcommand "version"` is 0.8.0 or older: 0.8.0 runs team schema 2, 0.7.0 schema 1.

**To a release of the same team schema.** Set `WIZARDINGCODE_MEM_VERSION` back to the previous tag and `docker compose up -d server`. Nothing is restored, and `serve restore` refuses this case (`nothing to go back to`).

**Across a migration.** A previous image exits 3 against a newer `team.db`, and `restart: unless-stopped` would loop on it, so the copy the upgrade made is put back first, by the newer image, with the server stopped. In this order:

1. Check that the older tag is still on the host (`docker image ls`), or pull it now.
2. `docker compose stop server`. From here to the last step, run no `docker compose up` at all, of any service: `caddy` depends on the server, so `up -d caddy` starts the server too. `docker compose restart caddy` restarts Caddy alone. `docker compose exec` does not work while the server is stopped; do not start the server to make it work: every command below is a `docker compose run --rm`.
3. Read what the restore would do, with `<n>` the older image's team schema:

   ```sh
   docker compose run --rm server serve restore --to-schema <n>
   ```

   It changes nothing. It prints the upgrade copy it would put back (`would_restore=`), when that copy was made (`copied_at=`), what was written since and would be lost (`lost.entries_created`, `lost.entries_revised`, `lost.memories`, `lost.names`, `lost.members`, `lost.devices`, `lost.withdrawn`, `lost.changes`), and the commands to run afterwards. It refuses, with exit 1 and the reason, while a server's lease is fresh (up to 30 seconds after a kill), when the copy is not what its name says, or when the disk has less free than the copy's size and 1 GiB.
4. The same with `--yes`. The present `team.db` is moved, whole, to `/data/backups/team-before-rollback-<ms>.db` (`aside=` names it) and the upgrade copy takes its place. Keep the output: it is the list for step 6. While it copies, the restore holds the server's lease for up to 15 minutes; if it is killed during the copy, the next run is refused with `an earlier restore holds serve.lease until <time>`, and so is a server start: wait for that time and run it again.
5. Set `WIZARDINGCODE_MEM_VERSION` back to the previous tag in `.env`.
6. Run every command the restore printed, in the order printed, with the older image (`docker compose run --rm server …` now runs it):
   - first `serve instance renew`, as many times as it was printed (once, unless a million changes were written since the copy): every client then pulls from zero. It must come first: any other command of the older image rewrites `feed.seq` and hides the restore from the server, which would then serve the copy's own instance, and the clients would miss what the copy lacks;
   - then each repeated action, the lines ending `-> docker compose run --rm server serve …`: a device revoked since the copy (`serve revoke`), a member disabled or enabled, a role, a withdrawal (`serve withdraw`), an invitation used or revoked since the copy (`serve invitation revoke`), and every erasure (`serve purge … --yes`). Each command pastes whole as printed: what it takes from the database is quoted for the shell, and a line that says `lost with the restore` has no command. A `note:` line under a command says what to expect. A `serve withdraw`, `serve reinstate` or `serve purge` of an item that arrived after the copy is answered "wizardingcode-mem serve: unknown", exit 1, by the older image, and that answer is fine. A device whose token was rotated since the copy is revoked, since the copy holds its old token: its person joins again with a new invitation. An item its own member stopped sharing since the copy (`withdrawn since the copy`, counted by `lost.withdrawn`) is live again in the copy: its `serve withdraw` keeps it withdrawn, as the operator's withdrawal, so its member sends it again only after `serve reinstate`;
   - last `serve mirror --rebuild`, which writes the repositories under `repos/` again from the restored database.
7. Only then `docker compose up -d server`.

The order matters because the restored file holds tokens and rows as they were at the copy: once the server is up, a device revoked since authenticates again, and every restored row, an erased one included, goes to every member who pulls.

If the older image answers `unknown subcommand` to one of the printed commands, that action cannot be kept across this rollback. Leave the server stopped and go forward again: set `.env` to the newer tag, put the aside file back, and start:

```sh
docker compose run --rm --entrypoint sh server -c 'cd /data && kept="backups/team-restored-copy-$(date +%s).db" && for s in "" -wal -shm; do if [ -e "team.db$s" ]; then mv "team.db$s" "$kept$s"; fi; done && for s in "" -wal -shm; do if [ -e "backups/team-before-rollback-<ms>.db$s" ]; then mv "backups/team-before-rollback-<ms>.db$s" "team.db$s"; fi; done'
docker compose up -d server
```

The first loop keeps the restored copy, with its log, under a name of its own (`backups/team-restored-copy-<seconds>.db`); the second puts the aside file back with its side files. The kept copy holds erased rows like every file under `backups/`, and is deleted by hand once settled.

The same two moves are the way back when `serve restore --yes` ends saying that `team.db` is the upgrade copy but failed its check. A restore killed during its swap leaves no `team.db`: run the same `serve restore --to-schema <n> --yes` again before anything else, and it finishes the swap (`finished=`). Going forward after the older image's renewal, the newer server finds `feed.seq` ahead of its file at start, logs `event: "restore-detected"` and renews its instance: every client pulls from zero once more, and loses nothing.

What members meet afterwards. A device enrolled since the copy reads `revoked`, and its person needs a new invitation (`lost.members` and `lost.devices` count them). A client keeps as sent what the server lost and does not send it again by itself: entries and memories written since the copy are on the members' machines and in the aside file, and nowhere on the server. Across the 0.8.0 bump the shared names created since the copy are gone (`lost.names`): while the 0.7.0 image runs, every member's client speaks contract 1 and holds its shared names (`names held (server at contract 1)` in `wizardingcode-mem status`); once the server is upgraded again, a project bound to a lost name reads `missing` as soon as it has something to send, and nothing of it is sent until its person sets the level again, which re-creates the name with the id their machine holds. Tell those creators which names to re-create, so each acts once; `wizardingcode-mem share names`, asked of a member before the stop, lists the names the server held.

When the restore refuses with `no upgrade copy` (two later migrations pruned it: the folder keeps the newest two), there is no way back by this command. The choice is a restore of the whole volume from your own backup (below), or forward.

The aside file and the upgrade copies hold everything as it was, erased rows included. No purge reaches them, and they count against the disk. Nothing prunes an aside file: once the rollback is settled, delete it by hand, `docker compose run --rm --entrypoint sh server -c 'rm /data/backups/team-before-rollback-<ms>.db*'`.

### A restore of the volume

The server detects a restored database by itself when `feed.seq` is ahead of it: it renews the instance, moves the feed's sequence a million past the greater mark, logs `event: "restore-detected"` and carries on. The one case it cannot see is a restore of the whole volume, when `feed.seq` came back with the copy. Then, with the server stopped, renew by hand before anyone pulls:

```sh
docker compose stop server
docker compose run --rm server serve instance renew
docker compose up -d server
```

(the `Dockerfile`'s entrypoint is `wizardingcode-mem`, so `serve instance renew` is the whole command). A client that pulls between such a restore and the renewal reads rows under reused numbers and misses what the restore lost until the renewal makes it pull from zero; the renewal makes every client take a fresh snapshot.

Back up the volume whole: `team.db`, `feed.seq`, the mirror under `repos/` and `backups/`. The mirror is an export the server rewrites hourly and a quiet minute after a push; it is never read back.

### The lease's 30 seconds

One process serves one data directory, under `serve.lease`. After a kill (not a clean stop) the old lease stays fresh for up to 30 seconds: a restarted container exits 1 naming the lease, and `restart: unless-stopped` tries again until it expires; `serve instance renew` refuses for as long. A clean `docker compose stop server` releases it at once (the service has a 30-second grace). A server that loses its lease to another process logs `event: "lease-lost"` and exits.

### The log's events

`docker compose logs server` (or `docker compose logs -f server`), one JSON object per line, `at`, `level` and `event` on each:

| Event | What it says |
|---|---|
| `event: "listening"` | the server is up on its host and port; `version` is the release that runs and `teamSchema` the schema of `team.db` that release writes |
| `event: "bootstrap"` | the first admin's code and its validity, once |
| `event: "request"` | one request: id, device, route, status, time, address; a held pull's time; a pull's cursor and counts; a push's counts and the refused uids with their reasons |
| `event: "error"` | an error with its scope, name and message, and the request id when there was one; every `logError` of the process ends here |
| `event: "restore-detected"` | the database was behind `feed.seq`: the instance was renewed |
| `event: "lease-lost"` | another process holds the lease: this one exits |
| `event: "plain-http"` | the server listens on a non-loopback address without `--trust-proxy`: not the compose layout, which sets `WIZARDINGCODE_MEM_TEAM_TRUST_PROXY` |
| `event: "wal-checkpoint"` | the write-ahead log could not be checkpointed in time (a reader held it); it is tried again |
| `event: "mirror-exit"` | the hourly mirror child ended, with its code |

A thrown error answers the client `internal error` with the request id, which is the key to the `event: "error"` line. Requests with a missing or wrong token count against their source address (60 a minute, then 429), so a flood of 401 lines from one address is a guess at a token, not a member.

## The member's side

### Joining from a fresh machine

1. Install for your agents as usual (`wizardingcode-mem install`); memory works alone, with no server.
2. Ask an admin for an invitation code (`serve invite --role member --name …`; for your second machine, `serve invite --for <member id>`, which keeps your identity).
3. Join:

   ```sh
   wizardingcode-mem share server add https://team.example.com --code <code> --name "Your name" --label laptop
   ```

   Without `--code` the code is asked on the terminal with no echo, which keeps it out of the shell's history. The command prints `joined <host>: <name> (<role>)` and what would leave now (knowledge entries and memories, per project), then asks `Share with <host> as listed above?`; `--yes` answers for you. The device token goes to `~/.wizardingcode/mem/servers.json` (mode 0600) and the server's row stays `pending` until the yes; nothing leaves before it. The viewer does the same under Settings → Servers.
4. Choose what leaves. In each project's folder, `wizardingcode-mem share project knowledge` (or `all` for memories too, or `receive` to take the team's items without sending); a project with no git remote on a host takes a shared name first (Naming a project, below); `wizardingcode-mem share roots workspace,shared` and `wizardingcode-mem share areas workspace:sales,…` for the knowledge roots and areas; `wizardingcode-mem share status` to see what would leave. Nothing leaves until a level is set.

### The first run, and status

The sync starts by itself with your next agent session (the session-start and prompt hooks start `wizardingcode-mem sync --auto`, one per data directory) and with the viewer; to run it now, `wizardingcode-mem sync --once`. The first sweep sends what the policy allows in batches (200 items, 900 KiB); the first pull of each server is a snapshot. Then:

```sh
wizardingcode-mem status
wizardingcode-mem share server list
```

`status` has a `sync` line (`running (pid), idle since …`, `not running …`, `stopped by …`, `start failed: …; next try …`) and one `server` line per server: name, host, member and role, the state with its remedy, cursor, last push and pull, backlog, dirty paths, pending rows, open conflicts and a held withdrawal; under it one `name` line per shared name bound to the server (what was received under it, and `missing`, `re-created` or `removed` when so), and `names held (server at contract 1)` on the server line while the server speaks the old contract. The state is `ok`, `pending` (join not confirmed: `share server add` again), `token missing` (`share server rejoin`) or `stopped` with one of four remedies: `contract` (upgrade wizardingcode-mem), `unauthorized` (this device was revoked), `rejoin` (the server was rebuilt), `disabled` (the member was disabled; ask an admin). What arrives lives under `knowledge/received/<server>/`, read-only; `wizardingcode-mem knowledge take <server>:<slug>--<8 hex> --scope shared` copies an entry into your own repository.

### Naming a project

A project that is not a git repository on a host (a folder of notes, a Claude Desktop project, a tool with no remote) is matched by a shared name instead of a remote ([ADR 0028](../adr/0028-shared-names.md)). In the viewer, the project's dock shows a Shared name field prefilled with the project's slug and, under it, whether the name is new (`New: you create …`) or one a teammate created (`Joins … · created by …`); choosing a level asks `Create … on <server>, visible to every member, …?` or `Join …, created by …?` with what would leave, and the action creates or joins and sets the level in one step. From a shell, in the project's folder:

```sh
wizardingcode-mem share project all --as "Brand strategy" --create
wizardingcode-mem share names
```

`--as` is slugged (`brand-strategy`); `--create` creates the name, without it the name must already be on the server; the question is asked before anything reaches the server, and `--yes` answers it. `share names` lists every name the server holds, the ones this machine is bound under marked `*`. Once bound the dock reads `` Shared as `brand-strategy` ``; `wizardingcode-mem share status` adds `shared as brand-strategy`. A project with a git remote on a host keeps matching by the remote, and is refused a name while it has no name yet (`has-remote`); a project that took a name and later gained a remote keeps the name until you leave it. Setting Nothing leaves the name: what the project sent is withdrawn, the project keeps the name, and `wizardingcode-mem share name forget` in its folder removes it. The imported memories (claude-mem's) never leave; the dock and `share project` say how many stay. A project known by its folder alone becomes a new project when its folder is moved or renamed, and the name stays on the old one: set the old one to Nothing, forget its name, then share the new one under the same name.

### Joining a shared name

A teammate joins a name with a project of theirs that has no git remote on a host: the dock's field lists the server's names with their creator and counts; picking one and choosing a level (Receive only, to take the team's items without sending) asks `Join …, created by …, and receive it into <project>?` and binds on the yes. From a shell, `wizardingcode-mem share project receive --as brand-strategy` in the folder. A name another project on this machine already carries is refused (`name-taken`); a project already shared under one name must be set to Nothing before it takes another (`renamed`). Two members who type the same name for two unrelated projects are told apart by the registry: the second sees `Joins`, not `New`, and the join question names the creator.

### A name missing, re-created or removed

Three states a bound name can read, in the dock, in `wizardingcode-mem status` and in `doctor`:

- `missing`: the server no longer holds the name (a restore to a copy older than it); nothing of the project is sent until you set its level again, which re-creates the name with the id your machine holds, so your teammates stay bound.
- `re-created`: the name was removed and created again for something else; the items under it are skipped and nothing of yours is sent until you decide: set the level again to join the new name (confirmed again, the new creator named), or set Nothing to leave it.
- `removed`: the operator purged the name; nothing is sent under it again; set Nothing to leave it and, if you wish, forget it.

### The token file and your backups

`~/.wizardingcode/mem/servers.json` holds the device token and nothing else does: it is outside the store on purpose, so `wizardingcode-mem backup` (a folder or a bucket) never carries it, and neither does a copy of the database. If a machine backup tool copies `~/.wizardingcode/mem`, exclude `servers.json` or treat the backup as a credential. A machine restored without the file shows the server `token missing` with the remedy `share server rejoin`; `wizardingcode-mem doctor` says the same, and warns when the file's mode is not 0600 or holds a token for a server no longer listed.

### A revoked device

An admin's `serve revoke <device id>` makes your next request a 401: the server reads `stopped (unauthorized)` in `status`, with the remedy `this device was revoked; ask an admin for a code, then share server rejoin`. With a new code (`serve invite --for <member id>` keeps you the same member):

```sh
wizardingcode-mem share server rejoin team.example.com --code <code>
```

prints `rejoined <id>: <name> (<role>); the sync starts with the next session`. What was sent stays on record; the levels and the ledger are untouched.

### A client restore, and the hold

`wizardingcode-mem backup --restore <name>` stops the sync, carries the listed servers' ledgers into the restored copy (so no refused item is sent again and the old generation's memories can still be withdrawn), resets every project's level to Nothing, and puts a hold on withdrawals per server; it says so: `backup: N team servers carried; withdrawals are held until wizardingcode-mem share server resume`. The servers the copy named but you no longer list are dropped, and their received copies are deleted at the sync's next start. Then, in this order:

1. Set the levels again (`wizardingcode-mem share project <level>` in each project, or the viewer), since a reset level is Nothing.
2. `wizardingcode-mem sync --once`: the start's steps (an unlisted server's copies erased, the received folders re-indexed), then a snapshot per server. With no server listed it runs the start's steps alone and exits 0.
3. `wizardingcode-mem share server resume team.example.com`: it lists what the next sweep would withdraw, per project, and releases the hold on your yes (`--yes` answers it); until then the sweep withdraws nothing, whatever the reset levels say.

The same hold is set on its own when one sweep would withdraw more than 20 items or more than half of what a server holds from you for no action of yours; `status` names the count, `doctor` warns, `share server resume` is the answer.

### When the server was rebuilt or restored

A server whose instance was renewed makes your client take a fresh snapshot by itself; `status` shows the cursor back at zero for a moment. A server rebuilt from nothing answers 410 to a cursor it never issued: the client reads `stopped (rejoin)` with the remedy `the server was rebuilt; ask an admin for a code, then share server rejoin`.

### What `doctor` watches

`wizardingcode-mem doctor`'s `sync` line warns for: the token file's mode, a token for no listed server, a confirmed server with no token, a server URL that is not https (loopback http is allowed), a stopped server with its remedy, a sync lease held by a process that is gone, a stop flag older than ten minutes, a start that failed and when it is tried again, a server with no successful push or pull in 24 hours while sessions ran, open conflicts (`wizardingcode-mem knowledge accept` or `reject` decides them), rows set aside after failed applies, and a held withdrawal. It asks the network nothing.

### Leaving a server

```sh
wizardingcode-mem share server remove team.example.com --withdraw --yes
```

`--withdraw` takes back what this device sent first; without `--yes` open conflicts refuse the removal. It stops the sync, deletes everything the server left here (received files, rows and memories, levels, ledger, token) and forgets the server. The device stays listed on the server until an admin runs `serve revoke <device id>`.

### The client's log

The sync writes errors only, one line per distinct message per server and operation, to `~/.wizardingcode/mem/logs/wizardingcode-mem.log` under the scope `sync.<serverId>.<operation>`, with how many repeats the previous line stood for; never a token, a code or a payload. The same message is `status`'s last error for the server. `WIZARDINGCODE_MEM_SYNC=off` keeps the sync from starting at all; `wizardingcode-mem sync stop` asks a running one to leave and waits up to 30 seconds.
