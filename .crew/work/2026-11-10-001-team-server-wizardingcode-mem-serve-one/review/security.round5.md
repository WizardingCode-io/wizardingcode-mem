# security findings for 2026-11-10-001-team-server-wizardingcode-mem-serve-one
reviewer: review-security
read: 7 files, risk areas: auth, personal-data, public-api, data-migration, infra

## Findings
none

None of the round-4 fixes (commit 3361487) opens a path a caller could take:
- **Hourly checkpoint (personal-data):** `checkpointWal(db, waitMs?)` is at src/team/store.ts:637-648. It sets `PRAGMA busy_timeout` to the wait, then puts back the earlier value inside a `finally`.
  - Both values are numbers that only the server sets: the `CHECKPOINT_WAIT_MS` constant and the integer the database itself reports. No caller input reaches the PRAGMA text.
  - The server tick at src/team/server.ts:221-229 still runs only while no export child runs. A log still held by a reader is reported as `{event:"wal-checkpoint", busy:true}`. A throw goes to `log.error("team.checkpoint", …)`, which writes the scope and the error's name and message (src/team/log.ts:40-48). Neither line carries a payload or any member data.
  - The purge still cuts the log twice (src/team/mirror.ts:698 and 717), so purged frames still leave the write-ahead log.
- **Pending key without its row (personal-data):** this is now a thrown error (src/team/mirror.ts:369). Its message names only the item's uuid and revision number, never its text.
  - `underMirrorLease` records it as a `(run)` failure in `meta.mirror.last` (mirror.ts:437-442). Only the operator's `serve status` reads that key, and neither `GET /v1/health` nor any member route does.
- **Purge state from the transaction (personal-data):** `touched` and `owed` are now built inside the transaction and returned from it (mirror.ts:681-696). The erasure, the owed-replay note and the audit row therefore still commit together. The replay runs after the commit, so a purged text cannot be left in a repository.
- **Synchronous `mirror` and `purge` wrappers (src/cli/commands/serve.ts:475-514):** these are operator subcommands with no network surface.
  - `purge` still requires `--yes` (line 498), and `db.close()` now runs in a `finally` only after the work is done.
  - `exitFor` (serve.ts:171-197) prints only the error's message to the operator's standard error.

The rest of the change still matches round 4:
- **Auth:** every route but `health` and `join` goes through the device-token check, and invitations are admin-only. Demoting or revoking a member revokes their invitations.
- **Personal data:** log lines carry no payload, and erasure remains possible through `serve purge … --yes`.
- **Public API:** the error shapes are unchanged.
- **Data migration:** the migration creates a new database file, `team.db`.
- **Infra:** the image runs as user 10001 with a read-only root, no capabilities and no published port, behind Caddy.

## Outside the change
none

## Not answerable
none
