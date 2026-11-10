# Conclave: the team server

Checklists read: `endpoint` (the `/v1/` routes and the `serve` subcommands), `auth` (device tokens, invitations, roles, the last admin), `migration-or-restore` (`team.db` with its own migrations; a restored database detected; `serve backup`), `deletion` (a withdraw as a tombstone, revocation and disabling that delete nothing, `serve purge` as the one erasure) and `sync` (the server is one side of the product's own sync between a person's machines; the third-party checklist read for its truth-per-field and ledger rules). The change is not a payment, an upload (the push is bounded JSON, read under `endpoint`), a redirect, a merge or a screen.

## Assumed by good practice

- Every route but `/v1/health` and `/v1/join` authenticated with a device token hashed at rest and compared in constant time; roles enforced on the server, in one place (`authenticate`, `requireAdmin`), never only in a client; the last active admin cannot be revoked, disabled or demoted; a failed join audited with the address and never the code (AC-45, AC-46).
- Every list bounded and every input validated at the boundary: a pull page of 500 items or 2 MiB, the audit 1 to 1000 rows, a push of 200 items in a 1 MiB body refused before parsing, payloads checked against part 4's pinned key lists and part 1's rules with the hash recomputed; errors in the server's problem shape with a request id, never a stack (AC-45, AC-47, AC-50).
- Rate limits in the server, not only at the proxy: 600 requests a minute per device, 10 joins a minute per address, health unlimited (AC-45).
- The schema is new and its own: `team.db`, its migrations, upgrade copies with the `team-` prefix; nothing copied, moved or dropped, so no step is destructive; a client store is never opened as a team database and a too-new file is refused (AC-44). A restore re-creates nothing by hand: a database restored from an older copy is detected (the high-water file ahead of it) and the instance id renewed so every client pulls from zero; `serve backup` is one consistent `VACUUM INTO` with a sidecar naming the instance and the last sequence (AC-50, AC-52).
- Deletion is soft everywhere: a withdraw is a tombstone, revocation and disabling set a time, nothing is deleted; the one hard path is `serve purge`, the server stopped, audited and named as erasure (AC-46, AC-48, AC-49; D-24 says what it covers).
- The sync's truth per field: the server's revision and hash are the truth for an entry and a stale base is refused with them; the device that first sent a memory is its truth; an echo is never new information (a push whose hash equals the current one is `applied` and changes nothing; `appliedAs` names an earlier revision); every applied item is one row of the `changes` feed and every admin act one audit row (AC-47, AC-48, AC-50).
- The hook path untouched; nothing leaves a machine from this part (the server only receives); product text in English; clean room (AC-55).
- Every SQL statement behind `src/team/store.ts`, so another engine is a second module behind the same signatures (D-1 as the person answered it; AC-57).
- The pull waits for the next change instead of the client polling (D-22; AC-50); a held pull is answered before a stop.
- A retry of an applied item always succeeds: idempotency is the first rule of the push after the shape, size, hash and secret checks, before ownership, the lock, the base and the disk (AC-47, AC-48).
- A withdraw carries its base and is stale-checked like a send, so nobody tombstones a revision they have not seen (AC-47).
- One running server per data directory by a lease with an expiry, never a pid; the stopped-server subcommands name the compose form in their refusal (AC-51, AC-52).

## Decisions only the user can make

Recorded on the item; the person answered D-1 to D-26 on 2026-11-10 (D-1, D-6, D-21, D-22, D-25 and D-26 with their own words, D-23 and D-24 with "sim" to the checklists' defaults, the rest "o resto concordo com tudo"); the item was reopened at the current HEAD and the answers relayed with a note naming the first opening:

- D-1: where the data lives (SQLite, `team.db`, behind one store boundary that admits Postgres later).
- D-2: device tokens (32 random bytes, a SHA-256 digest at rest, constant-time compare; revocation deletes nothing).
- D-3: the first admin (a one-time invitation printed at the first start, 24 hours).
- D-4: invitations (single-use codes with a role, a name and a 72-hour expiry, admin-only; no sign-up, no e-mail).
- D-5: roles (member and admin; the last admin stays).
- D-6: the API's shape (JSON over HTTP under `/v1/`, push per item, pull by cursor, with `wait`).
- D-7: conflicts (revision and hash of the base; a memory belongs to the device that first sent it).
- D-8: what is stored (part 4's payload types, the member, the device, the revision, the hash, the times; every revision).
- D-9: one member, several machines (an invitation bound to a member; a random device id).
- D-10: the authority (the database; the mirror after the commit).
- D-11: what a device pulls (shared and workspace always; project items for the aliases it names).
- D-12: who writes and withdraws (shared and project entries are the team's; workspace by its member; the creator or an admin withdraws).
- D-13: tombstones, cursors, restores (90 days; 410 below the horizon; the instance id).
- D-14: token and invitation life (the `wcm1_` and `wci1_` prefixes; rotation; cancelled invitations; join rate-limited).
- D-15: limits (1 MiB, 200 items, 256 KiB, 500 items or 2 MiB, 600 a minute, 10 joins a minute, 20,000 a day, 1 GiB a member).
- D-16: deployment (debian bookworm-slim, user 10001, `/data`, Caddy for TLS, GHCR).
- D-17: database, process, logs (the core runner with a file name; signals; JSON lines; idle 120 s).
- D-18: compatibility (a contract header; the server upgrades first).
- D-19: departed members (disabled, devices revoked, items attributed; an optional withdraw of all).
- D-20: server-side validation (frontmatter, id, scope, slug, size, keys, hash, secrets).
- D-21: one server or several (several; each a destination of its own; the client binds a project to one).
- D-22: how fast a change travels (within seconds: a pull that waits, a push on change).
- D-23: token expiry, second factor, an admin acting as a member (default: no expiry, rotation and revocation; no second factor; an admin never acts as a member).
- D-24: what may be erased, by whom (default: `serve purge <entry|memory> <uid> --yes` by the operator with the server stopped; no API route erases).
- D-25: the first slice after the brainstorm's second round (the person, 2026-11-10: quotas, pruning and horizon, two-phase rotation, reinstate to a revision and `serve backup` deferred to named follow-ups; purge deletes rows and rebuilds the repository).
- D-26: the repositories on the volume as an export from the database (`serve mirror`, hourly and on demand, rebuildable), not a live mirror (the person, 2026-11-10).

The endpoint checklist's "who may call it": a member or an admin by their device token, as the role table says; the "fields exposed": the pull feed shows every member the writer's name and id and the times, never a device id (an admin's view adds it), decided under D-11 and D-12 and named in the ADR. The sync checklist's "first full run and who pays": a device's first pull is a snapshot paged at 500 items, and D-15's daily quota bounds a first push of a large store; the server is the team's own, nothing is metered.

## Proposals

- A server `name` in `GET /v1/me`, so the client labels its servers by something better than a URL (part 6 can start with the URL; a later item).
- `serve members --json` and `serve audit --json` for scripts (a later item).
- An events route (server-sent events) as a second way to learn of changes, if the waiting pull proves costly behind some proxy (a later item; D-22 chose the wait).
- Expiry of a token unused for a long time, if the team wants it after D-23 (a later item).

## Warnings

- The pull's alias filter is minimisation, not permission: any member reads any item of the server, the shared entries, every member's workspace entries and any project's items. A person who does not want their workspace knowledge read by the team keeps the workspace root off (part 4's roots). The ADR says it; the Sharing page already says a shared item reaches the team. Recorded as an advisory objection.
- The first admin's code is printed to the container's log and stays there until the log rotates. It is single-use and expires in 24 hours; the runbook says to rotate the first admin's token after joining and how to rotate Docker's logs. Recorded as an advisory objection.
- Withdrawn text stays in `entry_revisions` and in the mirror's history until purged; a tombstone keeps a memory's bytes. `serve purge` is the erasure path (D-24) and the ADR says when to use it. Recorded as an advisory objection.
- Any member may push a new revision of any shared or project entry (D-12). A vandalised entry is rolled back by an admin's reinstate of an earlier revision, and the last writer is recorded. Recorded as an advisory objection.
- Memories hold personal data (a developer's titles and bodies name people and projects): the server stores them verbatim for a project set to Knowledge and memories, redaction is the client's edge, and the server refuses recognisable secrets only. The ADR names the boundary, as part 4's did. Recorded as an advisory objection.
- A waiting pull is one open connection per device; at the team's scale it is nothing, and a proxy with a short response timeout would cut it (Caddy's default has none). The runbook names it. Recorded as an advisory objection.
