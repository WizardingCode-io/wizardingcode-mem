# security findings for 2026-11-10-001-team-server-wizardingcode-mem-serve-one
reviewer: review-security
read: 9 files, risk areas: auth, personal-data, public-api, data-migration, infra

## Round 2 advisories
Both advisories from round 2 are answered.
- Round 2's F-1 (an unbounded refused uid in the log line) is closed. `summarizePush` (src/team/push.ts:539-553) cuts each refused uid to `LOGGED_UID_MAX` (256 characters, line 536) before it goes into `refusals`. So a member's push can add at most 256 characters per refused item to the operator's log, and the item count per push is already capped. The cut counts UTF-16 units, so it can split a surrogate pair. The JSON encoder escapes a lone half, so a log line cannot be broken that way.
- Round 2's F-2 (no path erases a member's name) is answered in the design record. ADR 0026's "The boundary" (docs/adr/0026-team-server.md:94) now names the three places a name is held: the `members` row, the commit author, and the `repos/members/` folder name. It says no command erases a name and gives the remedy: the operator, from a shell, changes the row and runs `serve mirror --rebuild`. "Follow-ups" (line 114) lists `serve forget <member id>`. Leaving this as a written operator step and a follow-up is acceptable for an advisory.
- The purge changes in the same commit hold up on the personal-data side:
  - The folders still owed a replay are recorded in `meta` `mirror.replay` in the same transaction as the erasure (src/team/mirror.ts:648-662). `runMirror` replays them before it exports anything (mirror.ts:437-438), and `--rebuild` clears the record (line 434). So a purge interrupted between the erasure and the replay can no longer leave the purged text in a repository.
  - `checkpointWal` (src/team/store.ts:633-636) runs `PRAGMA wal_checkpoint(TRUNCATE)` twice: once after the erasure and again after the lease is released (mirror.ts:664 and 681). With `secure_delete = ON` (src/team/db.ts:74), the erased bytes leave the log as well as the pages.
  - The result reports `wal: busy` when a reader held the log, and the ADR's Purge section (line 78) says so. That is honest reporting, not a gap.
  - The new `meta` record holds only folder names, and those come from ids, hashes and slugs. It holds no item text, and it is cleared once the replay finishes.

## Findings
none

I reviewed the whole change again on these points and found nothing new:
- **Auth:** the routes call `withCaller` with the admin flag on every admin route. Only `health` and `join` are unauthenticated. A 401 counts against the address bucket. A demotion or revocation revokes that member's invitations.
- **Personal data:** the device id goes only into an admin's view of the feed (src/team/feed.ts:131). The log line carries no payload. A refused join is audited with the address and never the code.
- **Public API:** the contract fingerprint and the 409 with the accepted list are unchanged since round 2.
- **Data migration:** the migration is new, on a new database file. Upgrade copies are kept and pruned by prefix.
- **Infra:** the image runs as user 10001 with a read-only root, no capabilities and no published port. The image carries only the release's Linux binaries.

## Outside the change
none

## Not answerable
none
