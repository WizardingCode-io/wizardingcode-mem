# Concept: the team server (part 5)

Mode: brainstorm

## Hypothesis

The team server is the same binary with one more command, `wizardingcode-mem serve`, that keeps the team's shared knowledge and memories in its own SQLite database and in git repositories under a data directory, authenticates every request with a device token an admin's invitation created, and offers part 6's sync client two operations, push a batch of items and pull what changed since a cursor, where a stale entry version is refused with the server's current one. One Docker image and a compose file with a TLS-terminating reverse proxy are the whole deployment.

## What exists today (facts from the repository)

- The viewer's server (`src/ui/server.ts`): `Bun.serve` over the person's database, loopback only, a random token in the URL checked on every request, a Host check, JSON helpers (`json`, `problem`), `jsonObject`, a CSP for the page; it stops when idle. Nothing listens on a network interface.
- The store (`src/store/db.ts`): `openDb` with core migrations under `user_version` and, from part 1, module migrations under `module_migrations`; `withWrite`; leases in `meta` (`src/store/meta.ts`).
- Part 1's knowledge repositories: one git repository per scope under `<data dir>/knowledge/`, entries as Markdown with frontmatter (`id`, `version`, `author`, `status`, `area`, …), a git runner isolated from the person's configuration (`runGit`, `gitEnv`, no hooks, no signing, a ceiling directory), an index rebuilt from the files (`rebuildRepo`, `ensureFresh`), a lease per repository, a failure rule that restores from HEAD.
- Part 4's contract: `decide` (`send` | `withdraw` | `keep`, a reason, the epoch), `OutgoingEntry` and `OutgoingMemory`, `entryUid` and `memoryUid`, `sharing_ledger` (destination, kind, uid, direction, version, hash, epoch, times) written by the client, `redactForSend`, the destination `team`.
- Memories (`src/store/migrations/0001_init.sql`): `memories` with kind, title, body, importance, status, origin (`distilled`, `manual`, `imported`), judge; `insertMemory` in `src/store/memories.ts`.
- Builds: `scripts/build.ts` compiles five binaries (macOS, Linux x64 and arm64, Windows) with `bun build --compile`; the release workflow publishes them with checksums. No `Dockerfile`, no compose file.
- Settings: `<data dir>/env` (0600) read by `loadSettings`; `resolvePaths()` gives the data directory and the store directory.

## Design sketch

### The command and the data directory

`wizardingcode-mem serve [--data <dir>] [--port <n>] [--host <addr>]`: a long-running HTTP server (Bun.serve) over `<data>/team.db` (its own SQLite database, its own migrations, never a client's store) and `<data>/repos/` (git repositories per server scope). Defaults: `--data` from `WIZARDINGCODE_TEAM_DATA` or `/data`; `--port 8787`; `--host 0.0.0.0` inside the container. Plain HTTP: TLS is the reverse proxy's. Subcommands on the same data directory, run on the host or in the container: `serve invite --role admin|member [--expires 72h]` (prints an invitation code once), `serve members` (list members and devices), `serve revoke <device id>`, `serve status`.

### Members, devices, invitations, roles

- A member is a person; a device is one machine of a member holding one token. `members(id, name, role admin|member, created_at, disabled_at)`, `devices(id, member_id, token_hash, label, created_at, last_seen_at, revoked_at)`, `invitations(id, code_hash, role, created_by, expires_at, used_at, used_by_device)`.
- Bootstrap: on the first start with an empty database the server mints one admin invitation, prints its code to standard output once (and writes it to `<data>/first-admin.txt`, mode 0600, deleted when used) and logs that it is waiting for the first admin; nothing else is reachable until it is used.
- An invitation is a single-use code (26 base32 characters, 128 bits), with a role and an expiry (default 72 hours), created by an admin through the API or the CLI. `POST /v1/join { code, member: { name }, device: { label } }` (unauthenticated) exchanges it for a device token: 32 random bytes, base64url, shown once in the answer; the server keeps `sha256(token)` only; the device id is the token's first 8 characters of hash, for lookup. One join per code; a member may join from several machines through several invitations, each a device.
- Every other request carries `Authorization: Bearer <token>`; the server hashes it, looks the device up, checks `revoked_at` and the member's `disabled_at`, and compares in constant time. Roles: an admin may do everything a member may, plus invitations, listing and revoking devices and members, and withdrawing any item; the last active admin cannot be revoked or demoted.

### The sync API (what part 6 calls)

Versioned under `/v1/`, JSON only, bodies capped at 1 MiB, 200 items per push, a rate limit per device (600 requests a minute, 429 with `Retry-After`).

- `GET /v1/health` (no token): `{ ok: true, version }`, nothing else.
- `GET /v1/me`: the member, the device, the role, the server's time and version.
- `POST /v1/push { epoch, items: [ { op: "send" | "withdraw", kind: "entry" | "memory", uid, baseVersion?, baseHash?, payload? } ] }`: applied one by one in the order given, each in its own transaction, answering per item `{ uid, result: "applied" | "stale" | "refused" | "withdrawn", current?: { version, hash }, reason? }`. An entry `send` with a `baseVersion` that is not the server's current version (or a `baseHash` that differs) is `stale` with the current version and hash; a first send of an entry the server does not know needs `baseVersion` 0. A memory `send` from the device that owns the uid replaces the server's row (a memory is one device's; another device's push of the same uid is `refused`). `withdraw` tombstones the item (kept 90 days, so pulls learn of it). The payloads are part 4's `OutgoingEntry` and `OutgoingMemory` and nothing else; a payload with an unknown field is `refused` (`shape`).
- `GET /v1/pull?since=<seq>&limit=<n>`: the changes after `seq` as `{ next, items: [ { seq, kind, uid, op: "upsert" | "tombstone", version, hash, payload?, member, device, at } ] }`, the device's own items included (so a second device of the same member sees them), at most 500 per page; `since=0` is a full pull. A member sees every item of the destination `team`; this part has one destination per server.
- Admin routes: `POST /v1/invitations { role, expiresInHours? }`, `GET /v1/members`, `GET /v1/devices`, `POST /v1/devices/<id>/revoke`, `POST /v1/members/<id>/disable`, `POST /v1/items/<kind>/<uid>/withdraw`.

### Storage on the server

- `team.db`: the tables above plus `entries(uid, scope, slug, remote_alias, version, hash, member_id, device_id, updated_at, withdrawn_at)`, `memories(uid, remote_alias, payload JSON, version, hash, member_id, device_id, updated_at, withdrawn_at)`, `changes(seq INTEGER PRIMARY KEY, kind, uid, op, version, hash, member_id, device_id, at)` (the pull feed), `audit(id, at, device_id, action, target, detail)`.
- Entries are also files: one git repository per server scope under `<data>/repos/` (`shared/`, `projects/<hash of the remote alias>/`, `members/<member id>/` for workspace entries), written with part 1's entry format and git runner (author the member's name at a `.invalid` address, committer the server), one commit per applied item; the index (`entries`) is rebuilt from the files on start when their heads differ, as part 1's client index is. The repositories are the team's version history: a person can clone them read-only from the volume.
- Backups: the volume holds `team.db` and `repos/`; `serve backup` copies both into one archive (`VACUUM INTO` for the database, `git bundle` per repository) under `<data>/backups/`; a restore is a documented manual step in the runbook (part 7).

### Deployment

- `Dockerfile`: `debian:bookworm-slim` with `git` and `ca-certificates`, the Linux binary for the image's architecture (x64 and arm64 through `docker buildx`), a non-root user, `VOLUME /data`, `EXPOSE 8787`, `HEALTHCHECK` on `/v1/health`, `ENTRYPOINT ["wizardingcode-mem", "serve"]`.
- `compose.yml`: the server and Caddy as the reverse proxy with automatic TLS (`SERVER_DOMAIN` in `.env`), Caddy's data on its own volume, the server not published outside the compose network; `docker compose logs server` shows the first admin invitation.
- The image is built by the release workflow and pushed to the GitHub container registry with the version tag; the runbook (part 7) names the two files to copy and the three commands to run.

### Not in this part

The sync client (join, status, leave, push on write, pull at session start, conflicts kept for a person): part 6. The runbook and the README section: part 7. A second destination per server, teams within a server, a web page on the server, e-mail invitations, SSO.

## Assumptions (what would have been asked)

- The server has its own schema and data directory; it never reads a client's database.
- Device tokens are high-entropy random secrets, so a salted SHA-256 at rest is enough; no password-hashing function is needed.
- The first admin is created by a one-time invitation printed at first start, not by a command-line flag with a secret.
- TLS is the reverse proxy's; the binary never holds a certificate.
- Memories are one device's: no two devices write the same memory uid, so memories have no version conflicts; entries do.
