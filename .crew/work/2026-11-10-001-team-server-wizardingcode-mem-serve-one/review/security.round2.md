# security findings for 2026-11-10-001-team-server-wizardingcode-mem-serve-one
reviewer: review-security
read: 25 files, risk areas: auth, personal-data, public-api, data-migration, infra

## Round 1, upheld defect
- Round 1's F-1 (src/team/members.ts:320, a demoted admin keeps their open invitations) is fixed. `setRole` (src/team/members.ts:314-325) now calls `revokeInvitationsOfDevice` for every device of the member on an admin-to-member change, in the same transaction that changes the role. `revokeDevice` (line 285) and `disableMember` (line 298) already did the same. An unused `role: admin` code minted before the demotion now answers 410 `invitation revoked` at `POST /v1/join`.
- Round 1's advisories have also been dealt with:
  - F-2: a missing or wrong token now counts against the `auth` bucket per address (src/team/routes.ts:166-183).
  - F-3: a memory uid must now match `MEMORY_UID` (src/team/ids.ts:56, src/team/validate.ts:183). A remainder is listed below as F-1.
  - F-4: ADR 0026's Purge section now says the upgrade copies are outside a purge.
  - F-5: held pulls are capped per device (src/team/feed.ts:198-200).
- Round 1's "not answerable" is now answered. The `sign` job uploads the whole `dist/` as `binaries` (.github/workflows/release.yml:54-58). The `docker` job builds from that artifact. `.dockerignore` lets in only `dist/wizardingcode-mem-linux-*`, so the image carries the release's Linux bytes and nothing else from the context: no `.env` and no source.

## Findings
- F-1 · advisory · src/team/push.ts:534 · `summarizePush` puts each refused item's raw envelope `uid` into the request log line's `refusals`. `parseItem` (push.ts:77) only checks that the uid is a non-empty string, so an authenticated member can put up to about a body's worth of arbitrary text into the operator's log through `shape` refusals. That text is JSON-escaped, so it cannot forge a line, but nothing caps its length. Clipping a refused uid in the log line would close it.
- F-2 · advisory · src/team/members.ts:228 · No path erases a member's name. The name is stored in `members` and is the git author of every mirror commit of their revisions. It also appears in the folder name `repos/members/<id>-<slug of the name>`. `disable` keeps the row, and `serve purge` reaches items, not members. A departed member who asks for their name to be erased can only be served by the operator editing `team.db` by hand and running `serve mirror --rebuild`. ADR 0026 says this for the audit address but not for the name.

## Outside the change
- none

## Not answerable
- none
