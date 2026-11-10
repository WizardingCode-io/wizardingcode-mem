# The team server: `wizardingcode-mem serve`

Part 5 of the knowledge and team work (journey 2026-11-08-001). Sources: the mission's third goal ("a team server: the same binary with a serve command, in one Docker image; SQLite and the repositories on volumes; TLS by a reverse proxy in the compose file; invitations by an admin, one device token per machine, roles admin and member, every request authenticated; … conflicts are resolved by versions, never by a silent overwrite"; "as secure as possible"; the pilots are the WizardingCode team); part 4's spec, `.crew/work/2026-11-09-002-sharing-policy-per-project-local-only-kn/spec.md` (the contract the server consumes: `OutgoingEntry`, `OutgoingMemory`, `entryUid`, `memoryUid`, `memoryHash`, the ledger, the destination `team`; merged into `main` in PR #28 on 2026-11-10); part 1's spec and plan, `.crew/work/2026-11-08-003-knowledge-store-entries-as-markdown-with/` (the entry format, `parseFrontmatter`, `checkSlug`, `fileHash`, the author rule, the git runner); `concepts_brief.md` in this folder (the concept after the six brainstorm reviewers; where `concept.md` and the brief differ, the brief and this spec rule); the decisions D-1 to D-22 in `work.json` (D-1, D-6, D-21 and D-22 answered by the person on 2026-11-10: SQLite behind one store boundary, several servers per person, a pull that waits for the next change), summarised in the Decisions table, which is the binding text for the ADR; the plan is `plan.md`.

Terms used throughout: the person is the owner of a machine running wizardingcode-mem; a member is a person the team server knows; a device is one of a member's machines, holding one token; an admin is a member who may invite, list, revoke, withdraw and purge; the sync client is part 6's code on a device, which pushes items and pulls changes; an item is one knowledge entry or one memory as part 4's payload types shape it; a revision is the server's counter of an entry's applied versions (the client's frontmatter `version` is another number, local to one machine, and stays in the file bytes); the mirror is the set of git repositories the server writes after each applied item; the feed is the server's ordered log of changes a device pulls from; the runbook is part 7's document for operating a VPS.

## Problem

Part 4 lets a person say what may leave their machine, and part 6 will move it. Nothing receives it yet. The team needs one place that holds what members share, tells who may read and write it, keeps every revision so an agent's or a person's change never silently overwrites another's, and gives each machine what changed since it last looked, for the projects it works on. Today nothing in the product listens on a network: the viewer's server is loopback-only with a token in the URL. The release builds five binaries and no image, so a VPS deploy has nothing to run.

Success is visible when:

- `wizardingcode-mem serve` starts over an empty data directory, prints one admin invitation, and refuses every request but health and join without a valid device token;
- an admin invites by name, a member joins from two machines as one member, and an admin can list, revoke and disable;
- a device pushes entries and memories shaped by part 4's types, a stale base is answered with the server's current revision and hash, a retry of an applied item is idempotent, a payload whose hash does not match its bytes or that carries a recognisable secret is refused, and a withdraw becomes a tombstone the others pull;
- a device pulls the changes since its cursor for the projects it names, a cursor older than the feed is told to pull from zero, and a restored database is detected and announced through a new instance id;
- the mirror on the volume holds one commit per applied revision, by the member, and `serve repair` rebuilds it with its history from the database;
- the image runs as a non-root user behind Caddy from one compose file, and the release publishes it.

## Goals

- The command `serve` with its subcommands, its own database (`team.db`) and migrations behind one store module, and the git mirror under one data directory (D-1, D-10, D-17).
- Members, devices, invitations, roles, bootstrap, rotation and revocation as D-2, D-3, D-4, D-5, D-9, D-14 and D-19 rule, with the refinements below (admin-only invitations that carry the member's name; a two-phase rotation; a device alias members see).
- The sync API under `/v1/`: `health`, `me`, `join`, `push`, `pull`, the admin routes; revisions decide conflicts; the server recomputes every hash and refuses recognisable secrets (D-6, D-7, D-8, D-11, D-12, D-13, D-18, D-20).
- Every revision kept (`entry_revisions`), so an admin can reinstate an earlier one and the mirror can be rebuilt with its history; `serve purge` for the one thing a withdraw cannot do.
- One server is one destination: it knows nothing of the other servers a device joins, and the client binds each project to one server (D-21); a pull may wait for the next change, so a change reaches the other machines within seconds (D-22).
- The limits, the quotas and the rate limits (D-15); JSON logs with a request id, `serve status`, `serve audit`, the audit table (D-17).
- The Dockerfile, the compose file with Caddy, the release and CI steps (D-16).
- A `redact` rule for device tokens and invitation codes (D-14).
- `docs/adr/0026-team-server.md`.

## Non-Goals

- The sync client: join, status and leave on a machine, push on write, pull at session start, conflicts kept for a person, the full pull after a new instance (part 6).
- The runbook and the README section (part 7); off-site backups beyond `serve backup` writing one consistent copy where it is told.
- A second destination per server, teams within a server, a web page on the server, e-mail invitations, SSO, a server-side taxonomy.
- The client's list of servers, the binding of a project to one of them and its roots and areas per server (part 6, D-21); another database engine (D-1 keeps the one boundary that would admit it).
- Any change to the hook path or to a client's store.

## Open Questions

None open. Three defaults the person may want to look at: D-11 (a device pulls project items only for the remote aliases it names; this keeps machines small and is not a permission: any member may read any item of the server), D-12 as refined here (a shared or project entry is the team's, any member may push a revision on the current base, and a withdraw needs the entry's creator or an admin), and the decision below to make invitations admin-only, which narrows D-9's "or the member from a device they already hold".

## Decisions

| Id | Question | Answer taken | Clause superseded by a later decision |
| :- | :- | :- | :- |
| D-1 | Where the server keeps its data | Its own: `team.db` (SQLite) with its own migrations and one git repository per server scope under the data directory; never a client's store. Every SQL statement of the server lives in `src/team/store.ts`, the one module another engine would reimplement (the person's answer of 2026-11-10: SQLite, behind a boundary that admits Postgres later). | |
| D-2 | Device tokens | 32 random bytes, shown once, stored as a SHA-256 digest that is the lookup key, compared with `timingSafeEqual`; revocation sets a time and deletes nothing. | "salted" in the concept's assumptions: no salt. |
| D-3 | The first admin | A one-time admin invitation minted at the first start with no members, printed once to standard output, valid 24 hours; a restart within them prints nothing; expired or lost, `serve invite --role admin` mints another. | "written to a 0600 file": no file. |
| D-4 | Invitations | Single-use codes of 130 bits with a role, the member's name and a 72-hour expiry, made by an admin through the API or the CLI, stored hashed; no open sign-up, no e-mail. | |
| D-5 | Roles | Member: push, pull, rotate, see the destination's items; admin: also invitations, members, devices, revocation, disabling, roles, withdrawing, reinstating and purging any item; the last active admin cannot be revoked, disabled or demoted. | |
| D-6 | The API's shape | JSON over HTTP under `/v1/`; push answers per item; pull by a monotonic cursor with the next cursor, and it may `wait` for the next change (D-22); caps and rate limits; a request id on every answer. | |
| D-7 | Conflicts | An entry push carries the revision and hash it was built on; both must equal the current ones, else `stale` with the current ones; a first send carries revision 0; a memory belongs to the device that first sent it. | |
| D-8 | What is stored | Exactly part 4's payload types plus member, device, revision, hash and times, every revision kept; the payload checked against part 4's pinned key lists and its hash recomputed. | |
| D-9 | One member, several machines | An invitation may be bound to a member, so a join with it adds a device; a device id is random and independent of the token. | "or the member makes one from a device they already hold": invitations are admin-only (this spec, Members). |
| D-10 | The authority | The database; the mirror is written after the commit by one queue, pending rows mirrored at start; the sync never reads the mirror. | |
| D-11 | What a device pulls | The shared and the members' workspace entries always; project items only for the remote aliases it names; one current row per uid since the cursor; 500 items or 2 MiB per page. | |
| D-12 | Who writes and withdraws | Shared and project entries are the team's (any member on the current base; the last writer recorded); workspace entries by their member's devices; memories by the device that first sent them, applied when `updatedAt` is not older; a withdraw from the entry's creator's member or an admin, else `refused not-owner`; an admin's withdraw locks until reinstated; an owner's re-send after its own withdraw is a new revision on the tombstone's base. | "the last writer's member" for a withdraw: the creator's member (this spec, Push), since any member can become the last writer. |
| D-13 | Tombstones, cursors, restores | Tombstones and superseded rows kept 90 days; `AUTOINCREMENT`; a cursor older than the feed is 410, pull from zero; every answer carries the instance id, renewed by the server itself when it detects a restored database and by `serve instance renew`; withdrawn text stays in the mirror's history unless purged. | |
| D-14 | Token and invitation life | Prefixes `wcm1_` and `wci1_` that `redact` recognises; a device rotates its own token in two phases and keeps its id; admins list and revoke invitations; revoking a device cancels its unused invitations; join is rate-limited per source address, the forwarded address trusted only with `--trust-proxy`. | |
| D-15 | Limits | 1 MiB body (413), 200 items per push (400), 256 KiB per entry (`refused size`), 500 items or 2 MiB per pull page, 600 requests a minute per device and 10 joins a minute per address (429), 20,000 applied items per device per day and 1 GiB of payload per member (`refused quota`), 507 when the disk is nearly full; published in `/v1/me`. | "5,000 applied items": 20,000, so a first sync of a large store takes days, not weeks. |
| D-16 | Deployment | One image on debian bookworm-slim with git and tini, the Linux binary per architecture, user 10001, a named volume on `/data`, health through the binary's own probe, the host set by the image's environment; the binary defaults to loopback; Caddy terminates TLS in the compose file; the release pushes the image to the GitHub container registry. | |
| D-17 | Database, process, logs | The core migration runner takes a file name and a list; `serve` joins the lazy command table, skips the legacy migration, handles SIGTERM and SIGINT, logs JSON lines to standard output without tokens, codes or payloads; idle timeout 120 s. | |
| D-18 | Compatibility | The client names its contract in a header; the server accepts contract 1 and, from the next bump on, the one before it; another is 409; an unknown payload field is `refused shape`; the server upgrades first. | |
| D-19 | Departed members | Disabling revokes every device and keeps the items attributed; the admin may withdraw them all in the same call; nothing is deleted by a withdraw; `serve purge` is the erasure path. | |
| D-20 | Server-side validation | The frontmatter parsed; `id` equal to the uid's UUID; the scope agreeing with the uid's prefix; the slug checked before any path; 256 KiB; the pinned keys; the hash recomputed; recognisable secrets refused; `author` informational; `area` by pattern only; the server never redacts and never calls `decide`. | |
| D-21 | One server or several | Several (the person, 2026-11-10): each server is one destination, independent of every other (its own members, devices, tokens, instance and contract) and knowing nothing of them; the client (part 6) holds its servers with their URLs and tokens, binds a project to one server at most and chooses roots and areas per server (ADR 0025 D-9 keys the policy by `(project, destination)`). The server needs nothing for it beyond this independence. | |
| D-22 | How fast a change travels | Within seconds while both machines are online (the person, 2026-11-10): `GET /v1/pull` takes `wait` (0 to 25 seconds); with nothing visible after `since`, the server holds the request until a change lands (one in-process signal after each applied, withdrawn, tombstoned or purged item) or the wait ends, then answers; the client (part 6) keeps one such pull open while a session or the viewer is active and pushes right after each local change the policy allows, never on a hook path. | |

## Cost and time

- **Effort.** Eight to ten hours of one journey session, the gates and the reviewers included, for the ten phases of `plan.md`: 0 the baseline; A the database, the migrations runner, the HTTP helpers and the log sink; B members, devices, invitations, join and auth; C push, revisions, the stale, idempotency and hash rules; D pull, the feed, tombstones, the instance; E the mirror queue, repair and purge; F the command, its subcommands, the lock, signals and logs; G the limits and the `redact` rule; H the Dockerfile, the compose file, the release and CI steps; I the ADR. The basis: the viewer's server (`src/ui/server.ts`, 700 lines with forty routes) took about a day; this server has fifteen routes, a queue and a CLI, and borrows the viewer's patterns.
- **Duration.** One session of about ten hours; it builds on part 4's types and part 1's runner and format, so it starts when parts 1 and 4 are merged into the journey branch.
- **Midway checks.** Phase C green (join, auth and push with the stale, idempotency and hash rules: AC-2, AC-3, AC-4) and Phase E green (the mirror: AC-6). The overrun limit: more than five hours spent before Phase C is green; then the image and the release steps become their own item.

## Critical User Journeys

1. **First start.** Given an empty data directory, when `wizardingcode-mem serve --data <dir>` starts, then it prints one line with an admin invitation code beginning `wci1_`, `GET /v1/health` answers `{ ok: true }` without a token, and `GET /v1/me` answers 401 without one; when `POST /v1/join` is called with that code and a device label, then it answers a device token beginning `wcm1_` once, the member is an admin named as the bootstrap named it (`admin`), and the code is spent.
2. **Two machines, one member.** Given an admin's device, when it calls `POST /v1/invitations { role: "member", name: "Ana Lopes" }`, then it gets a code; when a person joins with it and a label, then a member `Ana Lopes` and a device exist; when the admin calls `POST /v1/invitations { forMember: <Ana's id> }` and Ana joins from a second machine with the code, then the second device belongs to the same member and `GET /v1/me` on both shows one member id.
3. **A push that applies, a push that is stale, a retry that was applied.** Given an entry uid `shared:<uuid>` unknown to the server, when a device pushes it with `baseRevision` 0 and the payload, then the answer is `applied` with `revision` 1 and the hash of the payload bytes; when another device pushes a new version of it with `baseRevision` 1 and the current hash, then `applied` with `revision` 2; when the first device pushes again with `baseRevision` 1, then `stale` with `current: { revision: 2, hash }`; when the second device retries its own push (the same hash as the current), then `applied` with `revision` 2 and nothing changes; when a device retries a push whose answer it lost after a third member pushed on top, then `stale` with `current` and `appliedAs: 2`, so the client records its ledger and takes revision 3 as received.
4. **A memory and its owner.** Given a device pushing a memory uid `<generation>:<row id>` with a payload whose hash the server recomputes, when it pushes again with a later `updatedAt`, then `applied`; with an older `updatedAt`, then `stale`; when another device pushes the same uid, then a second row exists and both pull as `remote:<alias>:<uid>` with each device's alias; when the owning device pushes `op: "withdraw"`, then `withdrawn`, and the feed carries a tombstone the others pull.
5. **A pull for one machine's projects.** Given shared entries, a member's workspace entries, and project entries and memories for two remote aliases, when a device pulls with `since` 0 and `projects` naming one alias, then it gets the shared and workspace entries and only that alias's project items, `snapshot: true`, `next` and `more`; when it pulls again with `since` set to `next`, then it gets nothing new until a push lands; when its cursor is older than the feed's retention, then 410 and `fullPull: true`.
6. **Revocation and the last admin.** Given two admins, when one revokes the other's device, then that device's requests are 401 with `error: "device revoked"` and its unused invitations are cancelled; when the remaining admin tries to disable themself, then 409 "the last admin stays"; when an admin disables a member with `withdraw: true`, then every item of that member is tombstoned in the feed and their devices are revoked.
7. **Stop, restart, restore.** Given a push whose database commit landed and whose mirror commit had not run, when the server receives SIGTERM, then it stops accepting, drains the queue for at most 20 seconds, and exits 0; when it starts again, then the pending row is mirrored, `serve status` prints a backlog of 0, and the repository's HEAD holds the commit by the member with a `Revision:` trailer; when an older `team.db` is put in place of the current one and the server starts, then it sees the feed's high-water file ahead of the database, renews the instance id, logs and audits it, and every pull answers the new id.
8. **Deploy.** Given the compose file with a domain in `.env`, when `docker compose up -d` runs, then Caddy obtains a certificate and proxies to the server, the server runs as user 10001 on the named volume, `docker compose logs server` shows the admin invitation, and `docker compose exec server wizardingcode-mem serve status` prints the state.

## Design

### The command and the data directory

`wizardingcode-mem serve [--data <dir>] [--host <addr>] [--port <n>] [--trust-proxy]` is a long-running process. `--data` defaults to `WIZARDINGCODE_MEM_TEAM_DATA` or, absent, `<data dir>/team` under the product's data directory; the image sets `/data`. `--host` defaults to `WIZARDINGCODE_MEM_TEAM_HOST` or, absent, `127.0.0.1`; the image sets `0.0.0.0`; `Bun.serve` always receives the hostname explicitly (left out, it would listen everywhere). `--port` defaults to `WIZARDINGCODE_MEM_TEAM_PORT` or 8787. `--trust-proxy` (or `WIZARDINGCODE_MEM_TEAM_TRUST_PROXY=on`) makes the server read the client address from the last hop of `X-Forwarded-For` for the join rate limit and the audit, and refuse an authenticated request whose `X-Forwarded-Proto` is not `https` with 400 `https required`; without it, the socket's address is used and the header ignored. `serve` joins `COMMANDS` as a lazy import; `main.ts` gains `SKIPS_LEGACY = new Set(["serve"])` so `serve` and its subcommands never run `applyLegacyEnv` or `migrateLegacyData`; `run` resolves only on a signal, with no top-level await. The data directory holds `team.db` (plus `-wal` and `-shm`), `repos/` (the mirror and, inside it, `.feed`, the high-water file, and `.support/` for the runner), `backups/` (the migration runner's upgrade copies, prefixed `team-`), and `serve.lock`.

**One instance.** At start the server writes `serve.lock` (`{ pid, startedAt }`) with `O_EXCL`; when the file exists and its pid is alive, the start fails with exit 1 and `another serve holds <dir>`; a stale lock (a dead pid) is replaced. Subcommands that only read (`status`, `members`, `audit`, `health`) run beside a server; `invite`, `revoke`, `disable`, `role` write through SQLite's lock and are safe beside it; `repair`, `purge`, `backup` and `instance renew` refuse while the lock is held by a live pid ("stop the server first"). The one form the runbook teaches is `docker compose exec server wizardingcode-mem serve <sub>`, which runs as the image's user on the same volume.

Subcommands, each recording itself in the audit with source `cli`:

- `serve invite --role admin|member --name <name> [--expires <hours>]` (a new member; the name validated by part 1's author rule: 1 to 80 characters, no newline, not starting with `agent:`) or `serve invite --for <member id> [--expires <hours>]` (a device for an existing member): prints the code once.
- `serve members`: one line per member (id, name, role, state, devices, last seen) and one indented line per device (id, alias, label, created, last seen, revoked).
- `serve revoke <device id>`; `serve disable <member id> [--withdraw]`; `serve role <member id> admin|member`.
- `serve status [--json]`: the binary's version, the team schema version, the instance id, members and devices (active and revoked), a pending first admin, the last feed sequence, the feed horizon, the mirror backlog (pending rows) with the last mirror error and its time, the heads of the repositories, free disk at the data directory. Exit 0; 1 when the database cannot be opened.
- `serve audit [--limit <n>]`: the last audit rows, newest first.
- `serve repair`: rebuilds every repository from `entry_revisions` (one commit per revision, in order), then prints the heads; the server must be stopped.
- `serve purge <uid> --yes`: removes the entry's current row, its revisions and its payload from every feed row, writes a tombstone feed row with `op: purge`, and rebuilds the entry's repository without it; the server must be stopped; the audit records it.
- `serve backup <path>`: `VACUUM INTO` of `team.db` to `<path>/team-<time>.db` and a sidecar `team-<time>.json` with the instance id and the last `seq` (the mirror is derived and is not copied); the runbook names the restore steps.
- `serve instance renew`: a new instance id (the runbook's step after a restore of the whole volume, when the high-water file was restored too).
- `serve health [--url <origin>]`: fetches `/v1/health` (default `http://127.0.0.1:<port>`), exits 0 on `ok: true` within 3 seconds, 1 otherwise; the image's `HEALTHCHECK`.

### The team database (D-1, D-17)

`src/team/db.ts`: `openTeamDb(dir, busyTimeoutMs)` and `openTeamExisting(dir)` over the core runner, which gains a file name, a backup prefix and a migration list: `migrate` in `src/store/db.ts` becomes the exported `migrateFile(db, path, dir, { migrations, backupPrefix }, busyTimeoutMs)`, and the body of `openDb` (the directory, the connection, the three pragmas, the migration, the 0600 modes) becomes `openFile({ dir, file, backupPrefix, migrations, busyTimeoutMs })`; `openDb` calls it with `DB_FILE`, `wizardingcode-mem` and `MIGRATIONS` and then what part 1 runs after the core migrations (no behaviour change), the team opener with `team.db`, `team` and `TEAM_MIGRATIONS` (`user_version` its own; `SchemaTooNewError` for a newer file, which `serve` turns into exit 3 and the log line `team.db was written by a newer wizardingcode-mem; upgrade the image`). The opener writes `meta.team.schema = "team"` in migration 1 and refuses a file without it ("not a team database"), so a client store is never opened as one. Migration 1, `team_init`:

```sql
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
  -- team.schema, server.instance, server.created_at, feed.horizon
CREATE TABLE members (
  id TEXT PRIMARY KEY,                 -- 12 base32 characters, random
  name TEXT NOT NULL,                  -- part 1's author rule
  role TEXT NOT NULL CHECK (role IN ('admin','member')),
  created_at INTEGER NOT NULL,
  disabled_at INTEGER
);
CREATE TABLE devices (
  id TEXT PRIMARY KEY,                 -- 12 base32 characters, random; admins see it
  alias TEXT NOT NULL UNIQUE,          -- 8 base32 characters, random; members see it in memory uids
  member_id TEXT NOT NULL REFERENCES members(id),
  token_hash TEXT NOT NULL UNIQUE,     -- SHA-256 of the token, hex
  previous_hash TEXT,                  -- the hash of the token being rotated out
  previous_until INTEGER,              -- it is accepted until then, or until the new one is first used
  label TEXT NOT NULL,                 -- at most 80 characters
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER,
  revoked_at INTEGER
);
CREATE TABLE invitations (
  id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('admin','member')),
  name TEXT,                           -- the new member's name; null for a device invitation
  for_member TEXT REFERENCES members(id),  -- null: a new member
  created_by_device TEXT REFERENCES devices(id),  -- null: the CLI or the bootstrap
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  used_by_device TEXT REFERENCES devices(id),
  revoked_at INTEGER
);
CREATE TABLE entries (
  uid TEXT PRIMARY KEY,                -- entryUid: workspace:<uuid> | shared:<uuid> | project:<remote alias>:<uuid>
  scope TEXT NOT NULL,
  slug TEXT NOT NULL,
  remote_alias TEXT,
  created_by_member TEXT NOT NULL REFERENCES members(id),
  revision INTEGER NOT NULL,           -- the server's counter
  hash TEXT NOT NULL,                  -- recomputed from the payload bytes
  bytes INTEGER NOT NULL,
  writer_member TEXT NOT NULL REFERENCES members(id),
  writer_device TEXT NOT NULL REFERENCES devices(id),
  updated_at INTEGER NOT NULL,
  withdrawn_at INTEGER,
  locked_by_admin INTEGER NOT NULL DEFAULT 0,
  mirror_revision INTEGER NOT NULL DEFAULT 0   -- the last revision the mirror committed; pending while < revision
);
CREATE TABLE entry_revisions (
  uid TEXT NOT NULL REFERENCES entries(uid),
  revision INTEGER NOT NULL,
  op TEXT NOT NULL CHECK (op IN ('send','withdraw')),
  frontmatter TEXT NOT NULL,           -- the payload bytes, verbatim ('' for a withdraw)
  body TEXT NOT NULL,
  hash TEXT NOT NULL,
  writer_member TEXT NOT NULL,
  writer_device TEXT NOT NULL,
  client_epoch INTEGER,
  at INTEGER NOT NULL,
  PRIMARY KEY (uid, revision)
) WITHOUT ROWID;
CREATE INDEX entry_revisions_hash ON entry_revisions(uid, hash);
CREATE TABLE memories (
  device_id TEXT NOT NULL REFERENCES devices(id),
  uid TEXT NOT NULL,                   -- the client's memoryUid
  remote_alias TEXT NOT NULL,
  payload TEXT NOT NULL,               -- OutgoingMemory as JSON, verbatim
  hash TEXT NOT NULL,                  -- recomputed with part 4's memoryHash
  bytes INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,         -- the payload's updatedAt
  member_id TEXT NOT NULL REFERENCES members(id),
  received_at INTEGER NOT NULL,
  withdrawn_at INTEGER,
  locked_by_admin INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (device_id, uid)
) WITHOUT ROWID;
CREATE TABLE changes (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('entry','memory')),
  uid TEXT NOT NULL,                   -- an entry's uid; a memory's remote:<device alias>:<uid>
  op TEXT NOT NULL CHECK (op IN ('upsert','tombstone','purge')),
  scope TEXT NOT NULL,
  remote_alias TEXT,
  revision INTEGER NOT NULL,
  hash TEXT NOT NULL,
  member_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  client_epoch INTEGER,
  at INTEGER NOT NULL
);
CREATE INDEX changes_uid ON changes(uid, seq);
CREATE INDEX changes_scope ON changes(scope, remote_alias, seq);
CREATE TABLE audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  source TEXT NOT NULL,                -- api | cli | bootstrap | system
  device_id TEXT,
  address TEXT,
  action TEXT NOT NULL,
  target TEXT,
  detail TEXT NOT NULL DEFAULT ''
);
CREATE TABLE quota (device_id TEXT NOT NULL, day TEXT NOT NULL, applied INTEGER NOT NULL, PRIMARY KEY (device_id, day)) WITHOUT ROWID;
CREATE TABLE member_bytes (member_id TEXT PRIMARY KEY, bytes INTEGER NOT NULL) WITHOUT ROWID;
CREATE TABLE mirror_files (folder TEXT NOT NULL, file TEXT NOT NULL, uid TEXT NOT NULL, PRIMARY KEY (folder, file)) WITHOUT ROWID;
  -- which uid holds which file in each mirror repository (the slug collision rule)
```

The migration's `run` step mints `server.instance` (16 hex), `server.created_at` and `team.schema`. Every write is one `withWrite`. The server is one process; its single connection serialises writes, and the mirror queue runs in the same process. `entry_revisions` keeps every revision (knowledge is small; the quota bounds it), which is what `appliedAs`, `reinstate`, `repair` and `purge` read.

**One store boundary (D-1).** Every SQL statement the server runs lives in `src/team/store.ts`: one exported function per query or write (members, devices, invitations, entries and their revisions, memories, changes, audit, quota, member bytes, mirror files, the team's meta), each taking the `Db` and plain values and returning plain rows. `members.ts`, `auth.ts`, `audit.ts`, `push.ts`, `feed.ts`, `instance.ts`, `mirror.ts`, `repair.ts`, `status.ts` and the routes call those functions and hold no SQL: `tests/unit/team-store-boundary.test.ts` reads every file under `src/team/` but `store.ts` and `db.ts` and fails on `db.query`, `db.run`, `db.prepare`, `withWrite` or a template string that starts with an SQL keyword. The schema and the migration stay in `db.ts`. Another engine would be a second `store.ts` behind the same signatures; this part ships SQLite alone.

### Members, devices, invitations, roles (D-2, D-3, D-4, D-5, D-9, D-14, D-19)

- **Bootstrap.** At start, when `members` is empty and no unexpired, unused admin invitation exists, the server mints one (`wci1_` plus 26 base32 characters of 130 random bits, hashed at rest, role admin, name `admin`, expiry 24 hours), prints `wizardingcode-mem serve: first admin invitation: <code> (valid 24 hours)` once to standard output, and audits `bootstrap`; a restart within the 24 hours prints nothing and keeps the pending one (a lost code waits for the expiry or `serve invite --role admin --name <name>`). Until a member exists, every route but `/v1/health` and `/v1/join` is 401. The code stays in the container's log until the log rotates; the runbook says so and tells the operator to rotate the admin's device token after joining.
- **Invitations are admin-only.** `POST /v1/invitations { role, name }` makes a new-member code (the name validated by part 1's author rule, 400 otherwise); `POST /v1/invitations { forMember }` makes a device code for an existing member; both answer the code once; `expiresInHours` optional (1 to 720, default 72). `GET /v1/invitations` lists the unused ones (id, role, name or member, creator, expiry); `POST /v1/invitations/<id>/revoke`. Revoking a device revokes every unused invitation it created. A member cannot mint invitations: a stolen member token cannot add devices.
- **Join.** `POST /v1/join { code, label }` (no token; 10 a minute per source address; a failure audited with the address and never the code): the code's hash must match an unused, unexpired, unrevoked invitation; a device invitation adds a device to its member; a member invitation creates the member with the invitation's name and role; the device gets an `id`, an `alias` and `wcm1_` plus 43 base64url characters of 32 random bytes, stored as its SHA-256 hex; the answer is `{ token, deviceId, deviceAlias, memberId, name, role, contract: 1, instance }`, the token's only appearance; `used_at` and `used_by_device` are set in the same transaction. Errors: 400 for a malformed body or a label over 80 characters, 404 `invitation unknown`, 410 `invitation expired`, `invitation used` or `invitation revoked`, 429 over the limit.
- **Authentication.** Every other route reads `Authorization: Bearer <token>`, hashes it, loads the device by `token_hash` or by `previous_hash` while `previous_until` has not passed, compares the stored hash and the computed one with `timingSafeEqual`, and refuses with 401 `missing or wrong token`, 401 `device revoked`, or 403 `member disabled`; `last_seen_at` is written at most once a minute per device. The header `X-WCM-Contract` names the client's contract (D-18): absent or `1` is accepted; another value is 409 `contract` with `{ error, accepted: [1] }`.
- **Roles.** A member calls `me`, `push`, `pull`, `rotate`; an admin also calls the invitation and admin routes. The last active admin (the only admin with `disabled_at` null and an unrevoked device) cannot be disabled, have its last device revoked, or be demoted: 409 `the last admin stays`.
- **Rotation.** `POST /v1/devices/me/rotate`: a new token for the calling device, answered once; the old token's hash moves to `previous_hash` with `previous_until` ten minutes ahead and stays valid until the new token is first used or that time passes; the id and the alias are unchanged.
- **Admin routes.** `GET /v1/members`, `GET /v1/devices` (ids, aliases, labels, times), `POST /v1/devices/<id>/revoke`, `POST /v1/members/<id>/disable { withdraw?: boolean }` (revokes every device of the member; with `withdraw` true, tombstones every item of the member in one transaction, one feed row each), `POST /v1/members/<id>/role { role }`, `POST /v1/items/<kind>/<uid>/withdraw` (sets `withdrawn_at` and `locked_by_admin`), `POST /v1/items/entry/<uid>/reinstate { revision? }` (clears the lock; with `revision` given, writes that revision's bytes back as a new revision on top, so a vandalised entry is rolled back; without it, the item stays withdrawn until its owner re-sends), `GET /v1/audit?limit=`.
- **`GET /v1/me`**: `{ member: { id, name, role }, device: { id, alias, label }, instance, contract: 1, now, limits: { bodyBytes, itemsPerPush, entryBytes, pullItems, pullBytes, pullWaitSeconds, requestsPerMinute, itemsPerDay, memberBytes } }`.

### Push (D-6, D-7, D-8, D-12, D-15, D-18, D-20)

`POST /v1/push { epoch, items: [ { op: "send" | "withdraw", kind: "entry" | "memory", uid, baseRevision?, baseHash?, payload? } ] }`, at most 200 items, the body at most 1 MiB (`Bun.serve`'s `maxRequestBodySize`, answered 413 before parsing; the authentication runs before the body is read). Items are applied one by one in the order given, each in its own `withWrite`, and the answer lists one result per item in the same order: `{ uid, result, revision?, hash?, current?: { revision, hash }, appliedAs?, reason? }`. Before any item, the server checks free disk at the data directory: under 1 GiB, the whole push is 507 `insufficient storage`.

For an entry `send`, in this order:

1. The payload must be an `OutgoingEntry` by part 4's pinned key list (`OUTGOING_ENTRY_KEYS`), with `uid` equal to the item's, else `refused shape`; its bytes (`frontmatter` plus `body`, in that order, the frontmatter block ending with its closing `---` line and newline, which is the file's text and part 1's hash input) at most 256 KiB, else `refused size`.
2. The hash is recomputed with part 1's `fileHash` over those bytes; a `payload.hash` that differs is `refused hash`.
3. The frontmatter is parsed with part 1's `parseFrontmatter`; `id` must equal the uid's UUID, `scope` must agree with the uid's prefix (`workspace:`, `shared:`, `project:<remote alias>:`), the slug must pass part 1's `checkSlug`, `area` must match part 1's id pattern; else `refused shape` (`slug` when the slug fails). `author` is informational.
4. `findSecrets` from `src/core/redact.ts` runs over the bytes with an empty environment; a match is `refused secret` naming the rule, since one old client must not leak to the team.
5. The write rule (D-12): a `workspace:` uid belongs to the member who created it; another member's push is `refused not-owner`. A `shared:` or `project:` uid is the team's.
6. An item locked by an admin is `refused withdrawn-by-admin`.
7. The member's `member_bytes` plus the payload's bytes over 1 GiB, or the device's `quota` for the UTC day at 20,000, is `refused quota`.
8. The stale rule (D-7): with no row, `baseRevision` must be 0 and `baseHash` empty, else `stale` with `current: { revision: 0, hash: "" }`; with a row, `baseRevision` must equal `revision` and `baseHash` must equal `hash`, else `stale` with the current ones and, when the payload's hash equals the hash of an earlier revision of this uid (`entry_revisions`), `appliedAs: <that revision>` so the client learns its earlier push applied. A row withdrawn by its owner counts as current at its last revision, so a re-send after its own withdraw carries the tombstone's revision and reinstates the entry as a new revision.
9. Idempotency: when the payload's hash equals the current row's hash and the row is not withdrawn, the answer is `applied` with the current revision and nothing changes.
10. Otherwise the row is written (`revision + 1`, the hash, the bytes, the writer, `withdrawn_at` null), the revision row with the payload and `client_epoch`, a `changes` row `upsert`, the quota and the member's bytes counted, and `applied` with the new revision and hash answered; the mirror queue is nudged.

For a memory `send`: the payload must be an `OutgoingMemory` by `OUTGOING_MEMORY_KEYS` with `uid` equal to the item's, else `refused shape`; its hash is recomputed with part 4's `memoryHash` over the payload fields and a differing `payload.hash` is `refused hash`; `findSecrets` runs over title and body (`refused secret`); the row is keyed `(device, uid)`: another device's row with the same uid is another row; the device's own row is replaced when the payload's `updatedAt` is not older than the stored one, else `stale` with the stored `updatedAt` as `current.revision`; the same hash is `applied` and unchanged; the quota and the member's bytes are counted; the feed row's uid is `remote:<device alias>:<uid>`.

For a `withdraw`: an entry whose `created_by_member` is the caller's member, or any item for an admin, is tombstoned (`withdrawn_at`, a revision row `withdraw`, a `changes` row `tombstone`) and answered `withdrawn`; a memory of another device is `refused not-owner` unless the caller is an admin or another device of the same member; an item already withdrawn is `withdrawn` again with nothing changed; an unknown uid is `refused unknown`.

The reason codes, a fixed list: `shape`, `size`, `hash`, `slug`, `secret`, `not-owner`, `withdrawn-by-admin`, `unknown`, `quota`. The server never calls `decide`; `epoch` is stored with the revision and feed rows for the audit.

### Pull, the feed, tombstones, the instance (D-11, D-13)

`GET /v1/pull?since=<seq>&limit=<n>&projects=<comma list of remote aliases>`: the changes with `seq` greater than `since`, one current row per uid (the newest `changes` row per uid in that range), for the scopes `shared`, `workspace` (every member's) and `project` rows whose `remote_alias` is in `projects` (none when `projects` is empty), in `seq` order, at most `limit` (default and maximum 500) items or 2 MiB of payload (a page stops before the item that would cross it; a single item larger than the cap is sent alone), as `{ instance, next, more, snapshot, items: [ { seq, kind, uid, op, scope, remoteAlias, revision, hash, payload?, member: { id, name }, at } ] }`; an `upsert` carries the current payload (`frontmatter` and `body`, or the memory's JSON), a `tombstone` or `purge` none; a member's view carries the writer's member and no device id (the memory uid's alias is opaque); an admin's view adds `device`. The alias filter keeps a machine small; it is not a permission: any member may name any alias, and the ADR says so. `snapshot` is true when `since` was 0: the client treats a uid absent from a snapshot as gone. The feed's retention: a `changes` row is pruned when it is older than 90 days and a newer row for its uid exists, a tombstone 90 days after it was written; `meta.feed.horizon` is set to the highest `seq` pruned; the pruning runs once an hour in the server (with the weekly `git gc`). A `since` below the horizon is 410 `{ error: "cursor too old", fullPull: true }`. `instance` is `server.instance`; a client that sees a new value pulls from zero and reconciles its ledger (part 6's rule, named here).

**Waiting for the next change (D-22).** `wait=<seconds>` (0 to 25; absent is 0; above 25 is clamped to 25) makes an otherwise empty answer wait: when no row visible to the caller has `seq` greater than `since`, the handler subscribes to the server's change signal (`ChangeSignal` in `src/team/feed.ts`, fired by `writeChange` after each applied, withdrawn, tombstoned or purged item, so also by `disable` with `withdraw`) and answers as soon as the signal fires with a row the caller can see, or with `{ items: [], next: since, more: false }` when the wait ends. A pull that finds rows answers at once, `wait` or not. A held request counts once for the device's rate limit; the server's `idleTimeout` (120 s) is above the longest wait; `stop()` answers every held pull with the empty page before the drain, so a deploy never leaves a client waiting; the proxy adds nothing (Caddy neither buffers nor times out a 25-second answer). `GET /v1/me` publishes `pullWaitSeconds: 25` among the limits. The client's side, one open pull per device while a session or the viewer is active and a push right after each local change, is part 6's.

**Restore detection.** After every applied item the mirror queue writes the item's `seq` to `repos/.feed` (the high-water file, outside the database). At start the server compares it with `MAX(seq)` of `changes`: a file ahead of the database means the database was restored from an older copy; the server renews `server.instance`, logs and audits `restore detected`, and carries on. `serve instance renew` covers a restore of the whole volume, when the file came back too.

### The mirror (D-10)

`src/team/mirror.ts`: one in-process queue; after each push the queue is nudged and, at start, every row with `mirror_revision < revision` is queued. For each pending entry, in `seq` order, one repository at a time: the repository for its scope is `repos/shared/`, `repos/projects/<first 16 hex of SHA-256 of the remote alias>/` or `repos/members/<member id>/`, created on first use with `knowledge.json` (`format: 1`, the server scope) and `entries/` (no `proposals/`, no `taxonomy.md`); the file is `entries/<slug>.md`, or `entries/<slug>--<first 8 hex of the UUID>.md` when another uid already holds `<slug>` in that repository; the payload bytes are written verbatim; a withdrawn entry's file is removed; the commit message is `team: <send|withdraw> <uid>` with the trailers `Revision: <n>` and `Uid: <uid>`; the author is the member (`<name> <<member id>@members.wizardingcode.invalid>`), the committer the server (`wizardingcode-mem serve <server@team.wizardingcode.invalid>`). Before committing, the queue reads HEAD's trailers: a commit already carrying this uid and revision means the crash happened after the commit, so the row is marked without a second commit. Part 1's runner is used with its root given (`repos/` with `.support/` beside the repositories, instead of `knowledge/`), its author and committer given apart (`commitPaths` and `gitEnv` gain a `committer`), `-c safe.directory=* -c gc.auto=0` for a volume owned by another user and a bounded object store, and git run asynchronously (`runGitAsync`, a twin of `runGit` on `Bun.spawn` with the same isolation and timeout). The row's `mirror_revision` is set after the commit; a failed commit leaves it pending, logs the error (also kept in memory for `serve status`), and is retried on the next nudge with a backoff of one minute, then five, then an hour; an item still failing after a day is logged at `error` once a day and never blocks the other repositories. The mirror never answers a request; `serve repair` rebuilds every repository from `entry_revisions` with one commit per revision; `serve purge` rebuilds one repository without the purged uid; the weekly maintenance runs `git gc --quiet` per repository.

### Limits, rate limits, logs (D-15, D-17)

The rate limiter is in memory per process (a token bucket per device id and per source address, reset on restart), answers 429 with `Retry-After` in seconds; `/v1/health` is not limited. The daily item quota and the member's bytes are in the database. Logs are JSON lines on standard output: `{ at, level, event, requestId, deviceId?, memberId?, route, status, ms, address?, items?: { applied, stale, refused, withdrawn } }`; `src/util/log.ts` gains `setLogSink(fn)`, which `serve` sets so every `logError` in the process (the runner's included) becomes such a line instead of a file write; the first-admin code is the only secret ever printed, once; tokens, codes and payloads never appear; a 500 answers `{ error: "internal error", requestId }` and the log line carries the message; every answer carries `X-Request-Id`. `Bun.serve` runs with `idleTimeout: 120` and `maxRequestBodySize: 1_048_576`. SIGTERM and SIGINT: `server.stop()` without force (no new requests, the item in flight finishes), the mirror queue drains for at most 20 seconds, the database closes, the lock file is removed, exit 0 (a client whose push was cut retries, and every applied item answers `applied` by the idempotency rule).

### Deployment (D-16)

- `Dockerfile` (at the repository root): `FROM debian:bookworm-slim@<digest>`, `apt-get install -y --no-install-recommends git ca-certificates tini`, `ARG TARGETARCH`, the binary copied from `dist/wizardingcode-mem-linux-x64` for `amd64` and `dist/wizardingcode-mem-linux-arm64` for `arm64` into `/usr/local/bin/wizardingcode-mem`, `useradd --uid 10001 --no-create-home team`, `mkdir /data && chown 10001:10001 /data`, `USER 10001`, `ENV WIZARDINGCODE_MEM_TEAM_DATA=/data WIZARDINGCODE_MEM_TEAM_HOST=0.0.0.0 WIZARDINGCODE_MEM_TEAM_TRUST_PROXY=on WIZARDINGCODE_MEM_MIGRATE=off WIZARDINGCODE_HOME=/data/home`, `VOLUME /data`, `EXPOSE 8787`, `HEALTHCHECK --interval=30s --timeout=5s CMD wizardingcode-mem serve health`, `ENTRYPOINT ["tini", "--", "wizardingcode-mem"]`, `CMD ["serve"]`.
- `compose.yml`: `server` (the image by `${WIZARDINGCODE_MEM_VERSION}` from `.env`, `volumes: [team-data:/data]`, `init: true`, `stop_grace_period: 30s`, `restart: unless-stopped`, `read_only: true` with `tmpfs: [/tmp]`, `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`, no published port) and `caddy` (`caddy:2@<digest>`, ports 80 and 443, `volumes: [caddy-data:/data, caddy-config:/config, ./Caddyfile:/etc/caddy/Caddyfile:ro]`, `restart: unless-stopped`); `Caddyfile`: `{$SERVER_DOMAIN} { request_body { max_size 1MB } reverse_proxy server:8787 }` (Caddy's automatic HTTPS and HSTS; no access log); `.env.example` with `SERVER_DOMAIN=` and `WIZARDINGCODE_MEM_VERSION=`. The runbook (part 7) says DNS must point at the host, ports 80 and 443 be open, and never to publish 8787.
- `.github/workflows/release.yml`: a `docker` job after `sign` with `permissions: { contents: read, packages: write }`, `docker/setup-qemu-action`, `docker/setup-buildx-action`, `docker/login-action` to `ghcr.io`, `docker/build-push-action` for `linux/amd64,linux/arm64` from the `binaries` artefact, tags `ghcr.io/wizardingcode-io/wizardingcode-mem:<version>` and, for a tag without `-`, `:latest`; the package is made public once (a runbook step). `ci.yml`'s `build` job gains a step that builds the image for the runner's architecture from `dist/`, runs `docker run --rm <image> --version`, then starts a container with a temporary volume, runs `serve health` inside it, and stops it.

### Redaction of tokens and codes (D-14)

`src/core/redact.ts` gains the rules `team-token` (`wcm1_[A-Za-z0-9_-]{43}`) and `team-invitation` (`wci1_[A-Z2-7]{26}`) before `auth-header` in `PATTERNS`, so a bare token or code is `[REDACTED:team-token]` or `[REDACTED:team-invitation]` and a `Bearer wcm1_…` stays caught by whichever rule matches first (the test pins `team-token`); the redact tests gain the cases.

### Tests in-process

`startTeamServer({ dataDir, host, port: 0, now, trustProxy, onBootstrap, env, git })` returns `{ origin, port, stop, instance, mirrorIdle(): Promise<void>, options }`; `onBootstrap(code)` hands the test the first admin code; `now` drives expiries, rate limits, quotas and the pruning; `mirrorIdle` resolves when the queue is empty; `git` lets a test point part 1's `stubGit` at the mirror; `options` exposes the `Bun.serve` settings. The CLI subcommands are tested through `runCliWith` with `WIZARDINGCODE_MEM_TEAM_DATA`.

## Alternatives rejected

- **Git repositories as the server's source of truth.** Rejected: three stores cannot share one transaction, and the feed cannot be rebuilt from files (D-10).
- **No git on the server.** Rejected: the mission names repositories on volumes; a mirror written by one queue costs little and gives the team a readable history (D-10).
- **Last write wins for entries.** Rejected: the mission says versions decide, never a silent overwrite (D-7).
- **The payload's `version` as the server's.** Rejected: part 1's counter is local to one machine; the server owns a revision and keeps the payload bytes verbatim so the client's hash stays the judge (D-7).
- **Trusting the client's hash.** Rejected: a wrong hash would make every other client's `decide` see `received-same`; the server recomputes with the same functions (D-8).
- **Only the current payload kept.** Rejected: an admin could not roll back a vandalised entry, a retry whose answer was lost could not be recognised, and `repair` would destroy the history the mission keeps the mirror for.
- **Memories keyed by the client's uid alone.** Rejected: a copied store would be refused forever; the device scopes it (D-12).
- **A member per join; a member minting their own device invitations.** Rejected: one person has several machines, and a stolen member token must not add devices; admins invite, by name (D-9).
- **Every device pulls everything.** Rejected: ADR 0018's worst case across people; a device names the projects it works on (D-11).
- **A password hash for device tokens.** Rejected: 256-bit random secrets need no slow hash; the digest is the lookup key (D-2).
- **The first admin's code in a file on the volume.** Rejected: a second copy of a secret where backups go; standard output is enough (D-3).
- **A manual instance renewal as the only restore signal.** Rejected: a forgotten step makes every client miss changes; the high-water file detects a restored database (D-13).
- **Health through curl in the image.** Rejected: the binary probes itself (D-16).
- **`0.0.0.0` as the binary's default.** Rejected: loopback by default; the image sets the host (D-16).
- **Synchronous git inside a request.** Rejected: 200 commits would stall every device and the health probe; the mirror queue runs after the answer (D-10).
- **A rate limit at the proxy only.** Rejected: the server also runs without the proxy in tests and on a bare host; the limits are small and in memory (D-15).
- **Postgres.** Rejected for this part: a second service with its secret, its backups and a CI service, for a load the limits keep far below SQLite's in one process; the store boundary keeps the option (D-1, the person's answer of 2026-11-10).
- **Polling on a timer as the only way to learn of a change.** Rejected: the person asked that a change reach the other machines within seconds; a pull that waits costs one idle connection per device and no second route or transport (D-22).
- **One server for everything a person shares.** Rejected: a person works for several teams; each server is a destination of its own and the client binds a project to one (D-21).

## Acceptance criteria

- AC-1 (behavior): `openTeamDb` on an empty directory creates `team.db` at team schema 1 with the tables above, mints `server.instance`, `server.created_at` and `team.schema`, and a second open changes nothing; a file at a newer team version is refused with `SchemaTooNewError`; a client store's file renamed `team.db` is refused as "not a team database"; `openDb` on a client store still applies `MIGRATIONS` and the module schemas as before (the runner's split changes no behaviour); the viewer's `json`, `problem` and `jsonObject` live in `src/http/respond.ts` and the viewer's tests pass unchanged; `setLogSink` routes `logError` to the sink and, unset, to the file as before.
- AC-2 (behavior): a first start with no members prints one line with a `wci1_` code, audits `bootstrap` and hands the code to `onBootstrap`; a second start within 24 hours prints nothing; `/v1/health` is 200 `{ ok: true }` without a token, carries no version, and is 503 when free disk is under 100 MiB; every other route is 401 without a token, 401 `device revoked` after a revoke, 403 `member disabled` after a disable; `join` with the bootstrap code makes an admin named `admin` and answers a `wcm1_` token once with the device's id and alias, and the same code again is 410 `invitation used`; `join` with an unknown, expired or revoked code is 404 or 410 and audited with the address and without the code; a label over 80 characters is 400; the eleventh join from one address in a minute is 429 with `Retry-After`; with `trustProxy` the address is the last `X-Forwarded-For` hop and an authenticated request without `X-Forwarded-Proto: https` is 400; a token's hash is in `devices.token_hash` and the token itself nowhere in the database or the logs; `rotate` answers a new token, the old one stays valid until the new one is first used or ten minutes pass and is then 401, and the id and alias are unchanged; `X-WCM-Contract: 2` is 409 `contract` with `accepted: [1]`; `GET /v1/me` answers the member, the device with its alias, `instance`, `contract: 1` and the limits; every answer carries `X-Request-Id` and a thrown error answers `{ error: "internal error", requestId }`.
- AC-3 (behavior): an admin's `POST /v1/invitations { role: "member", name: "Ana Lopes" }` makes a code a new member joins with, and a name of 81 characters or beginning `agent:` is 400; `{ forMember }` makes a code that adds a device to that member and `GET /v1/me` on both devices shows one member id; a member calling any invitation route is 403; `GET /v1/invitations` lists unused ones; `POST /v1/invitations/<id>/revoke` makes the code 410 `invitation revoked`; revoking a device cancels its unused invitations; the last active admin's disable, device revoke or demotion is 409 `the last admin stays`; `POST /v1/members/<id>/role { role: "admin" }` promotes; `POST /v1/members/<id>/disable { withdraw: true }` revokes the member's devices and tombstones every item of theirs with one feed row each; `POST /v1/items/entry/<uid>/reinstate { revision: 1 }` writes revision 1's bytes as a new revision and unlocks; the admin routes are 403 for a member; every admin action and every CLI subcommand writes an audit row (`source` `api` or `cli`).
- AC-4 (behavior): `push` applies an entry `send` with `baseRevision` 0 as revision 1 with the recomputed hash; a second device's send on base 1 with the current hash is revision 2; a send on base 1 after that is `stale` with `current { revision: 2, hash }`; a retry whose payload hash equals the current one is `applied` with the current revision and changes nothing; a retry whose hash equals revision 1's hash after a third push is `stale` with `appliedAs: 1`; a payload with an extra or missing key, a frontmatter `id` other than the uid's UUID, a scope that disagrees with the uid's prefix, or a slug that fails part 1's rule is `refused shape` (or `slug`); a `payload.hash` that is not the hash of the bytes is `refused hash`; a payload over 256 KiB is `refused size`; a payload carrying `sk-ant-api03-` and 40 letters is `refused secret`; a `workspace:` entry pushed by another member is `refused not-owner`; a `shared:` entry pushed by another member on the current base is `applied`; an item locked by an admin is `refused withdrawn-by-admin` until reinstated; an owner's send after its own withdraw with the tombstone's revision reinstates the entry; 201 items is 400; a 1.1 MiB body is 413 before parsing; the 20,001st applied item of a device in a UTC day is `refused quota`, and a member at 1 GiB of payload bytes is `refused quota`; with free disk under 1 GiB (injected) the push is 507; results come back in the order given and each item is its own transaction (a refused item leaves the applied ones).
- AC-5 (behavior): a memory `send` from its device is `applied` with the recomputed hash, a wrong `payload.hash` is `refused hash`, a later `updatedAt` replaces, an older one is `stale`, the same hash is `applied` unchanged, a body carrying a recognisable key is `refused secret`, another device's send of the same uid is a second row (not refused) and both pull as `remote:<alias>:<uid>` with each device's alias; `withdraw` by the owning device, by another device of the same member, or by an admin tombstones it and answers `withdrawn`; by another member it is `refused not-owner`; a `withdraw` of an unknown uid is `refused unknown`; a second withdraw is `withdrawn` with nothing changed.
- AC-6 (behavior): after an applied entry, `mirrorIdle` resolves and `repos/<scope path>/entries/<slug>.md` holds the payload bytes verbatim, HEAD's commit has the member as author, the server as committer and the trailers `Revision: 1` and `Uid: <uid>`, and the row's `mirror_revision` is 1; a second uid with the same slug gets `<slug>--<8 hex>.md`; a withdrawn entry's file is removed in a commit; a project repository's folder is the first 16 hex of the SHA-256 of the remote alias; with `stubGit` failing `commit` once, the row stays pending, the error is logged and shown by `serve status`, and the next nudge mirrors it; a row whose commit landed but whose `mirror_revision` was not written (set back by hand) is marked without a second commit at the next start; a server started with pending rows mirrors them; `serve repair` on a repository deleted by hand rewrites it with one commit per revision in order and the same files; `serve purge <uid> --yes` removes the row, its revisions and the payload from the feed rows, writes a `purge` feed row, and the repository no longer holds the file in any commit; the repository has no hooks, no signing and no user config applied, `gc.auto` is 0 and `safe.directory` passed; `repos/.feed` holds the last mirrored `seq`; no request waits on git.
- AC-7 (behavior): `pull` with `since` 0 and `projects` naming one alias answers the shared entries, every member's workspace entries and only that alias's project entries and memories, one current row per uid, `snapshot: true`, `next` the last `seq` and `more` false; a second pull with `since` = `next` answers no items until a push lands; `limit` above 500 is clamped and a page over 2 MiB of payload stops early with `more` true; a tombstone carries no payload; a member's view carries `member { id, name }` and no device id, an admin's view carries `device`; after the hourly pruning with a clock 91 days ahead, `meta.feed.horizon` is set and a cursor below it is 410 `{ fullPull: true }`; `instance` equals `server.instance`, changes after `serve instance renew`, and changes at a start whose `repos/.feed` is ahead of `MAX(seq)` (a restored copy), with an audit row `restore detected`; `AUTOINCREMENT` keeps `seq` from reusing a pruned number; `pull` with `wait=5` and nothing new answers within 1 s of a push that lands 200 ms later, with that item; with `wait=1` and no push it answers after about a second with no items and `next` equal to `since`; `wait=30` is clamped to 25 and `me.limits.pullWaitSeconds` is 25; a pull that finds rows answers at once whatever `wait`; a held pull counts once in the device's bucket; `stop()` answers a held pull with the empty page before draining.
- AC-8 (behavior): with no flag and no environment `serve` listens on `127.0.0.1:8787`; with the environment host set it listens there; a second `serve` on the same directory exits 1 naming the lock and a stale lock is replaced; SIGTERM with a pending mirror row drains the queue (the commit lands) and exits 0 within 20 seconds, removing the lock; SIGTERM with a mirror stuck on a `stubGit` sleep exits 0 after 20 seconds with the row pending; the logs are JSON lines with the fields of the design and never contain a token, a code (after the bootstrap line) or a payload; `options` shows `idleTimeout` 120 and `maxRequestBodySize` 1,048,576; `serve` and `serve health` skip the legacy data migration (a `WIZARDINGCODE_MEM_MIGRATE` unset and a seeded legacy home are untouched); a newer `team.db` makes `serve` exit 3 with the message.
- AC-9 (behavior): the CLI subcommands against `WIZARDINGCODE_MEM_TEAM_DATA`: `serve invite --role member --name Ana` prints a `wci1_` code usable by `join`, `--for <id>` binds it, and a bad name exits 64; `serve members` lists members and devices with aliases; `serve revoke <device id>` makes the device 401; `serve disable <member id> --withdraw` tombstones; `serve role <id> admin` promotes; `serve status` prints the fields of the design and `--json` the same as JSON, exit 0, and exit 1 with a message when the directory has no database; `serve audit --limit 5` prints the last five rows newest first; `serve health --url <origin>` exits 0 against a running server and 1 against a closed port; `serve instance renew` prints the new id; `serve repair`, `serve purge`, `serve backup` and `serve instance renew` exit 1 with "stop the server first" while a live lock is held; `serve backup <dir>` writes `team-<time>.db` (a sound database with the same rows) and the sidecar JSON; `serve nonsense` exits 64 with the usage.
- AC-10 (behavior): `redact("token wcm1_" + 43 base64url characters)` is `[REDACTED:team-token]`, `redact("code wci1_" + 26 base32 characters)` is `[REDACTED:team-invitation]`, `redact("Bearer wcm1_…")` names `team-token`, and the existing redact cases pass unchanged.
- AC-11 (observed): the `Dockerfile` builds on the CI runner's architecture from `dist/`, `docker run --rm <image> --version` prints the version, the container runs as uid 10001 with a read-only root filesystem, `serve health` inside a started container exits 0 and `docker stop` exits the container with 0 within the grace period; `compose.yml`, `Caddyfile` and `.env.example` are as the design states; the release workflow's `docker` job depends on `sign`, has `packages: write`, buildx for the two platforms, the two tags, and `latest` only for a tag without `-`.
- AC-12 (preserve): `tests/unit/hook-snapshots.test.ts`, `tests/unit/mcp-tools-list.test.ts` and `tests/perf/budgets.test.ts` pass unchanged; the viewer's tests pass after the HTTP helpers move; the core store tests pass after the runner's split; the redact tests pass with the two rules added.
- AC-13 (observed): `docs/adr/0026-team-server.md` (status draft, part 5 of the journey) records D-1 to D-22 as rulings with the superseded clauses, the store boundary (D-1), the data model with every revision kept, the API with its results and reason codes, the hash recomputation and the secret check, the write rules (the creator withdraws), the alias filter as minimisation and not permission, the feed, its retention and horizon, the instance id and the restore detection, the mirror and its limits (history keeps withdrawn text unless purged; one repository per member's workspace), `repair` and `purge`, the limits and quotas, the logs and the request id, the image and the compose file, the upgrade order (server first) and the contract header, the boundary (the volume, the container's log, the host), and what parts 6 and 7 must do with it (several servers, a project bound to one, roots and areas per server, the open pull and the push on change: D-21, D-22); `CLAUDE.md` gains a bullet naming `src/team/`, `serve` and the deployment files.
- AC-14 (behavior): `tests/unit/team-store-boundary.test.ts` reads every file under `src/team/` but `store.ts` and `db.ts` and finds no `db.query`, `db.run`, `db.prepare`, `withWrite` and no template string that starts with an SQL keyword; `src/team/store.ts` exists, exports one function per statement and imports nothing from `src/team/` but `db.ts` and `errors.ts`.

## Risks and rollback

- **Withdrawn text stays in the mirror's history and in `entry_revisions`.** A withdraw removes the file in a commit and keeps the revisions; `serve purge` is the erasure path (the server stopped) and the ADR and the runbook say when to use it; clones of the volume are the operator's.
- **A leaked device token.** It is `wcm1_`-prefixed, so `redact` catches a pasted one; a device rotates it; an admin revokes it, and revocation cancels the invitations it made. A leaked admin token before revocation can mint members: the audit shows them and an admin disables them.
- **The first admin's code is in the container's log.** It is single-use and expires in 24 hours; the runbook says to rotate the first admin's token after joining and how to rotate Docker's logs.
- **A copied store sends twice.** Two machines with the same generation are two devices on the server; their memories are two rows; a teammate's agent sees duplicates until part 6 dedupes by content. Named in the ADR.
- **Clock skew.** Memories use the client's `updatedAt` to order a device's own replaces only; the feed uses the server's `seq`; expiries use the server's clock.
- **A full disk.** Push is 507 under 1 GiB free, health fails under 100 MiB, `serve status` prints the figure; the quotas bound a device's day and a member's total; the mirror retries with a backoff and `gc.auto` is off.
- **A restore.** A restored database is detected by the high-water file and the instance renewed; a restore of the whole volume needs `serve instance renew`, which the runbook says in bold; after a new instance every client pulls from zero and reconciles (part 6).
- **The alias filter is not a permission.** Any member may read any item of the server; the Sharing page already says a shared item reaches the team. Named in the ADR.
- **A held pull and a restart.** `stop()` answers every held pull before the drain, so a deploy never leaves a client waiting the full 25 seconds; a client whose connection drops retries from the same cursor.
- **Rollback.** The server is new code behind a new command; a client without part 6 never calls it. The image can be replaced by a previous tag; a newer `team.db` makes an older binary exit 3 with a message.

## Non-Functional Requirements

- **Hook path.** Untouched: no hook imports `src/team/`; the runner's split, the HTTP helpers' move and the log sink change no behaviour (the pinned snapshots and the perf budgets hold).
- **Latency.** A push of 200 items applies in under 2 s on the gate machine (no git on the request path; one `findSecrets` pass per item); a pull page of 500 rows in under 500 ms; a change pushed by one device is in another device's held pull within 1 s (D-22); measured by the gate and recorded, not pinned.
- **Security and privacy.** Every route but health and join authenticated; tokens hashed at rest and compared in constant time; invitations admin-only; roles enforced on the server; the last admin protected; bodies capped before parsing; hashes recomputed; recognisable secrets refused; no version on the unauthenticated route; the binary loopback by default; the image non-root with a read-only root, no capabilities and no new privileges; TLS at the proxy and `https` required behind it; tokens and codes redacted by the client's store; nothing but the payload types stored; the pull feed shows members' names and times, not device ids.
- **Operability.** JSON logs with request ids; `serve status`, `serve audit`, `serve repair`, `serve purge`, `serve backup`; the mirror's backlog and last error visible; the instance id in every answer; restore detected.
- **Rollout.** The release publishes the image with the version tag; the runbook (part 7) names the files to copy and the commands to run; the upgrade order is the server first; a client names its contract in a header.
