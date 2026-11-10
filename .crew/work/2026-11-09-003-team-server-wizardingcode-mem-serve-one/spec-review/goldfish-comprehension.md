```
mode: brainstorm

# comprehension findings for 2026-11-09-003-team-server-wizardingcode-mem-serve-one
reviewer: goldfish-comprehension
read: .crew/work/2026-11-09-003-team-server-wizardingcode-mem-serve-one/concept.md (whole), .crew/work/2026-11-09-003-team-server-wizardingcode-mem-serve-one/brief.md (whole), .crew/work/2026-11-09-002-sharing-policy-per-project-local-only-kn/spec.md (whole), .crew/work/2026-11-08-003-knowledge-store-entries-as-markdown-with/spec.md (whole), CLAUDE.md, README.md, src/ui/server.ts; no standard (brainstorm mode); lens: usability and developer ergonomics

## Findings
**What this proposes**
The existing binary gets a `wizardingcode-mem serve` command. It runs a long-lived HTTP server over its own data directory: a `team.db` SQLite database, plus one git repository per server scope under `repos/`. Admins invite people with single-use codes. A person uses a code to join from one machine and gets a device token, and every later request must carry that token. The sync client (part 6) gets two main calls. A push sends a batch of entry and memory items, each answered on its own as applied, stale, refused or withdrawn. A pull returns the changes after a sequence cursor. A shared entry sent on an out-of-date base version is refused, and the answer carries the server's current version and hash. Deployment is one Docker image plus a compose file, with Caddy in front handling TLS. There are CLI subcommands for invitations, members, revoking a device, status and backups.

**How the existing system works, per this document**
Today the only server is the viewer. It listens on loopback only, checks a random token in the URL and the Host header, and stops when idle. Nothing listens on a network. Part 1 keeps knowledge as Markdown entries with frontmatter, in one git repository per scope, written through an isolated git runner and indexed in SQLite from the files. Part 4 fixed what the sync works against: `decide`, the payload types `OutgoingEntry` and `OutgoingMemory`, uids for entries and memories, `redactForSend`, and a `sharing_ledger` that the client writes, all for the single destination `team`. The release builds five binaries and ships no Docker image.

- F-1 · Blocker · Members, devices (join) · `POST /v1/join` carries only `member: { name }`, so a second machine's join cannot be tied to an existing member. A builder would create a duplicate member for each device, which contradicts "a member may join from several machines".
- F-2 · Blocker · Assumptions vs Members, devices · The Assumptions say tokens are stored as a "salted SHA-256", but the design stores `sha256(token)` and looks a device up by that hash. A salted hash cannot be looked up that way. A reader cannot tell which one to build.
- F-3 · Major · Members, devices · "The device id is the token's first 8 characters of hash" leaves the alphabet and collision handling undefined. It also puts part of the secret's hash into `serve revoke <device id>` and into every pull item's `device`. And it does not say what the "constant time" comparison compares once the lookup is by hash.
- F-4 · Major · Sync API (push, memory) · Part 4 says the server scopes a memory uid by the device token (device, then generation, then row id). The concept instead keys memories by a bare uid and refuses another device's push of the same uid. It does not say whether the server prefixes the uid, or which uid the pull hands back for part 4's `remote:<server uid>`.
- F-5 · Major · Sync API (push, memory) · A memory belongs to one device, so a revoked device that rejoins, or a replaced laptop, can never update or withdraw its old memories. Nothing says how those memories are reclaimed or orphaned.
- F-6 · Major · Sync API (push) · `epoch` is required in the push body, but nothing says what the server does with it: store it, compare it, or refuse on it.
- F-7 · Major · Sync API (push, entry) · The text does not settle the rules for `baseVersion` and `baseHash` when only one is sent, when both are sent but disagree, or whether a memory `send` carries either one.
- F-8 · Major · Storage on the server · Nothing says whether the server's entry `version` is the payload's `version` or the server's own count. It also does not say whether the server writes the client's frontmatter bytes verbatim, which decides whether part 1's byte hash still matches what the client sent.
- F-9 · Major · Storage on the server · Shared workspace entries go to `members/<member id>/`, yet every member pulls every item. Nothing says where member B's improved copy of member A's workspace entry is written, or how B's client files A's entries.
- F-10 · Major · Storage on the server · The server validates an entry's `area` with part 1's format, but nothing names the taxonomy each server repository checks against, or who maintains it.
- F-11 · Major · Sync API (push) · The meaning of the `withdrawn` result is ambiguous. It could be the outcome of a `withdraw` op, or the answer to a `send` on an item that is already tombstoned. What a re-send after an admin's withdraw does is also unstated.
- F-12 · Major · Sync API (push) · Only one `refused` reason (`shape`) is named. Without the list of reason codes, the client cannot turn a refusal into something a person can act on.
- F-13 · Major · Sync API (pull) · Tombstones are kept for 90 days, but a client whose cursor is older than that silently misses withdrawals. No signal tells it to do a full pull, and nothing says how a client knows it has reached the last page.
- F-14 · Major · Sync API (push) and Storage · Each item gets its own transaction plus its own git commit, so one push can be 200 git commits with a 15 s timeout each. Nothing covers request latency, or what happens when the commit succeeds and the database row does not (or the other way round). Part 1's failure rule is not carried over explicitly.
- F-15 · Major · Sync API · The 1 MiB body cap sits alongside 200 items per push and entries of up to 256 KiB. The status code for an oversized body is not given, and neither is the rule that the client must size batches by bytes and not by item count.
- F-16 · Major · Members, devices (auth) · No error shape or status codes are given for a revoked device, a disabled member or a wrong token. The sync client cannot tell the person "this machine was revoked" apart from a typo.
- F-17 · Major · Bootstrap · Nothing says whether the first-admin invitation expires (the default is 72 h). If it expires unused, nothing explains how to recover. The code also stays in the container logs after use.
- F-18 · Major · The command (subcommands) · "Run on the host or in the container" assumes the binary is installed on the host, the volume's path is reachable from the host, and file ownership matches the container's non-root user. The exact `docker compose exec` / `run` line is never given.
- F-19 · Major · Deployment (Dockerfile) · `HEALTHCHECK on /v1/health` in an image with only git and ca-certificates has no HTTP client to call it with. Nothing says the binary checks its own health.
- F-20 · Major · The command · `--host 0.0.0.0` is the default only "inside the container". The default outside is unstated, so running `serve` on a bare host could expose plain HTTP on every interface.
- F-21 · Nit · The command · "Server scope" is used before the Storage list defines it, and `projects/<hash of the remote alias>/` does not say the algorithm or length (part 1 uses the first 16 hex of SHA-256).
- F-22 · Nit · The command · `serve backup` is described under Backups but missing from the list of subcommands. `serve status` also shares a name with the top-level `status`.
- F-23 · Nit · Members, devices · `invitations.created_by` has no value for an invitation made from the CLI. "Demoted" is protected against, but no route changes a role.
- F-24 · Nit · The command · `WIZARDINGCODE_TEAM_DATA` breaks the `WIZARDINGCODE_<THING>_*` convention (it should be `WIZARDINGCODE_MEM_…`). Whether the server reads a `<data>/env` settings file is unsaid.
- F-25 · Nit · Storage on the server · "Rebuilt from the files on start when their heads differ" does not say where the server records the head it compares against. It also does not say whether `team.db` carries a `meta` table for part 1's leases.
- F-26 · Nit · Sync API · `/v1/health` returns a `version`, but nothing says what a client does on a client/server version mismatch.
- F-27 · Nit · Sync API (pull) · The form of `member` and `device` in pull items (id, name or label) is unspecified.

## Not answerable
- Part 6's conflict handling and part 7's runbook · not written yet; the concept defers to them, so whether the stale answer carries enough for the client to resolve a conflict cannot be checked.
- `src/store/db.ts`, `scripts/build.ts`, the release workflow · not on the reading list; the concept's facts about them were taken as stated.
```
