# Brief

## Request

Team server: wizardingcode-mem serve, one Docker image with SQLite and the repositories on volumes, every request authenticated by a device token, invitations by an admin, one token per machine, roles admin and member, a sync API for knowledge versions and shared memories that refuses a stale version; a compose file with TLS by a reverse proxy; ADR 0026.

## Goal

The same binary, started as `wizardingcode-mem serve`, is the team's server: it keeps what members share (knowledge entries, versioned; memories of projects a member set to Knowledge and memories) in its own SQLite database and in git repositories on a volume, answers only to devices that hold a token an admin's invitation created, tells admins from members, and offers the sync client of part 6 an API to push items and pull what changed since its last look. A push of an entry whose base version is not the server's current version is refused with the current one, never overwritten. One Docker image and a compose file with a reverse proxy that terminates TLS make a VPS deploy a copy of two files. ADR 0026 records the decisions.

## Context

Part 4 fixed the sharing policy and the contract the sync builds against: `decide` with `send`, `withdraw` or `keep`; the payload types `OutgoingEntry` and `OutgoingMemory`; uids scoped by repository (entries) and by the store's generation (memories); `redactForSend` at the edge; a `sharing_ledger` the client writes. Part 1 keeps knowledge as Markdown with frontmatter in a git repository per scope, with a git runner isolated from the person's configuration. The mission (part 3 of the goal): "the same binary with a serve command, in one Docker image; SQLite and the repositories on volumes; TLS by a reverse proxy in the compose file; invitations by an admin, one device token per machine, roles admin and member, every request authenticated; … conflicts are resolved by versions, never by a silent overwrite"; "as secure as possible"; the pilots are the WizardingCode team. The viewer's server (`src/ui/server.ts`) is loopback-only with a token in the URL; nothing in the product listens on a network today. The release builds five binaries (`scripts/build.ts`, `.github/workflows/release.yml`); no Docker image exists.

## Constraints

- Every request authenticated by a device token; one token per machine; the token shown once and stored hashed; roles admin and member; an admin invites.
- Versions decide conflicts: a stale base is refused with the server's current version and hash; nothing is overwritten silently.
- The server stores exactly the payload types of part 4 and the metadata the sync needs (member, device, times, version, hash); nothing else leaves a machine, and the server never asks for more.
- The sync client (part 6) never waits on the network inside a hook; the server's API must let it push in the background and pull since a cursor.
- One Docker image, the data on volumes, TLS by a reverse proxy in the compose file; the binary itself speaks plain HTTP inside the compose network.
- Clean room: nothing from claude-mem. Product text in English. The binary keeps its name.

## Acceptance

- `wizardingcode-mem serve` starts an HTTP server over its own database and repositories under a data directory, prints a one-time admin invitation on the first start, and answers `/v1/health` without a token and every other route with 401 without a valid device token.
- An admin creates invitations (role, single use, expiry) and lists and revokes devices and members; a member joins with an invitation and receives a device token once; the last admin cannot be revoked.
- `POST /v1/push` takes a batch of items shaped by part 4's payload types with each item's base version and the client's policy epoch, applies them one by one, answers per item `applied`, `stale` (with the server's current version and hash), `refused` (with a reason), or `withdrawn`; `GET /v1/pull?since=<seq>` returns the items changed since that sequence for the destination the device may read, with the next cursor.
- Knowledge entries are stored as files in a git repository per server scope with a commit per applied item (author the member, committer the server), and in an index the server rebuilds from the files; memories in the database, one row per uid, owned by the device that sent them.
- A `Dockerfile` builds one image from the Linux binary with git, running as a non-root user with `/data` as the volume; a `compose.yml` runs it behind a reverse proxy that terminates TLS for a configured domain; `docs/adr/0026-team-server.md` records the decisions.

## Assumptions

- Part 6 (the sync client) is the only consumer of the API; this part ships the server, its CLI subcommands and the deployment files, with tests that drive the API over HTTP in-process.
- The server's data lives apart from any client's store: its own database file and its own repositories under its data directory; it never opens a client's `wizardingcode-mem.db`.
