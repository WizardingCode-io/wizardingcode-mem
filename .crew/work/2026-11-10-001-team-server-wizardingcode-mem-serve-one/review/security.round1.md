# security findings for 2026-11-10-001-team-server-wizardingcode-mem-serve-one
reviewer: review-security
read: 17 files, risk areas: auth, personal-data, public-api, data-migration, infra

## Findings
- F-1 · defect · src/team/members.ts:320 · An admin who is demoted keeps every open invitation their devices minted while they were admin. Neither `setRole` nor the `/v1/members/:id/role` route (src/team/routes.ts:467) calls `revokeInvitationsOfDevice`, although `revokeDevice` and `disableMember` both do. So a demoted member, holding an unused `role: "admin"` code minted just before the demotion, can `POST /v1/join` with it and get a new admin member and token. This breaks the auth rule that a token must be revoked when the permission it vouches for changes.
- F-2 · advisory · src/team/routes.ts:200 · Only `/v1/join` is rate-limited per address. A request with a missing or wrong bearer token fails in `authenticate` before any bucket is taken, so unauthenticated token guessing or load on every authenticated route has no server-side limit. Brute force is still infeasible at 256 bits; behind Caddy, the proxy's own limits are the only remedy.
- F-3 · advisory · src/team/validate.ts:105 · A memory's `uid` is checked only as a string, never against part 4's `<generation>:<row id>` grammar or a length. It becomes part of the stored key and the feed uid, and it is echoed in the request log's `refusals`. A member can therefore put arbitrary text, up to the item cap, into keys and log lines.
- F-4 · advisory · src/store/db.ts:74 · `team.db`'s upgrade copies under `/data/backups` (src/team/db.ts:41) hold items that a later `serve purge` erases from the live database and the mirror. The copies are dropped only once two newer upgrades rotate them out, so erasure is complete only after the operator also removes those files. Neither `purge` nor the ADR's Purge section says this.
- F-5 · advisory · src/team/feed.ts:180 · A held pull counts once against the device's 600 requests a minute and can last 25 s. One device can therefore keep hundreds of concurrent held requests open against a single process. Bounding open waits per device would close it.

## Outside the change
- none

## Not answerable
- infra: does the image pushed to ghcr.io carry only the signed binaries? · The `docker` job downloads the `binaries` artifact after `sign` (.github/workflows/release.yml:61-72), but the diff does not show whether that artifact is the signed set or the unsigned build output. The `sign` job's upload was not in the diff.
