# security findings for 2026-11-11-005-share-a-project-without-a-git-remote-tod
reviewer: review-security
read: 13 files, risk areas: public-api, personal-data

## Findings
- F-1 · advisory · src/team/routes.ts:551 · A member who learns a lost name's `id` (from a feed item's `nameId` or from `GET /v1/names/<alias>`) can re-create the name with `POST /v1/names {alias, id}` after a restore. The server does not check that this member created the id before, so teammates whose level row holds that id treat the new creator's name as the same name, and the `recreated` check in src/sync/inbound.ts:1946 never fires for them. This does not widen what a member can do: any member could already push under any held name, and before contract 2 under any host-led remote. Carried from round 1, unchanged.
- F-2 · advisory · src/team/store.ts:1023 · `serve purge name` only sets `purged_at`. The alias, `created_by_member` and `created_by_device` stay in `names` (src/team/migrations/0002_team_names.sql:9), and in the `changes`, revisions and audit rows, until `team.db` is rebuilt. Erasure can still be done item by item, but the record of who created a name stays on the server. ADR 0028 ("The erasure of a name, and its limit") states this, and only the operator sees it. Carried from round 1.
- F-3 · advisory · src/sync/servers.ts:439 · Round 1's F-3 is fixed. `lowerContract` now turns away a non-integer contract answer from `/v1/me` (through `spokenAfterMe`, used by run.ts:102 and binding.ts:203) and from the join (join.ts:165). On a 409, `acceptableContract` filters the accepted list to integers. It still takes 0 or a negative integer from a hostile server. That value goes into `sharing_servers.contract`, the next request's header carries it, and the server's 409 leaves no acceptable value, so the server stops as `contract`. This fails closed. A floor of 1 would only harden input at the client's boundary.

## Outside the change
- src/team/feed.ts:55 · Any member may pull any alias, shared names included. The alias filter is minimisation, not a permission (ADR 0026 D-11, unchanged by this diff), so every member can read a name's entries and memories until the operator purges them. This is existing debt, now also covering the new alias kind.

## Not answerable
none

How I cleared the other areas (round 2):
- Boundary:
  - The three team routes (`POST /v1/names`, `GET /v1/names`, `GET /v1/names/:alias`, src/team/routes.ts:532-600) run `requireNames`, then `withCaller` (device token, devices bucket, `checkContract` against `ctx.contract.accepted`), before any read.
  - The alias goes through `isSharedName` before any SQL. A given id must match `^[0-9a-f]{16}$`, and the server ignores it when any row, purged ones included, holds that id. `after` is grammar-checked. `limit` must be an integer and is clamped to 1..200.
  - Creating a name takes the per-member `names` bucket (10 an hour). It runs after the `exists` and `purged` checks; those answers reveal no more than `GET /v1/names/:alias`, which every member can call.
  - The by-alias route gives one 404, `unknown-name`, for a remote, an unheld name, a purged name and a malformed alias.
  - Push and pull accept a `name:` alias only through `isTeamAlias` and `nameRefusal`, inside the item's transaction.
- The viewer's new routes (`POST /api/projects/<id>/sharing/preview`, `DELETE /api/projects/<id>/name`, `GET /api/servers/<id>/names`, src/ui/server.ts:524-581) sit behind the existing URL-token check. `serverNamesView` answers no token. `commitBinding` returns `needs-confirm` before any server request.
- Secrets: the diff has no token or invitation literal. The client sends the token only in its header, and no UI or CLI answer carries it.
- public-api:
  - `CONTRACT` is now 2 and `ACCEPTED_CONTRACTS` is `[1, 2]`.
  - `RESULT_SHAPES` now pins `contractRefusal` (`accepted`), `nameConflict` (`name`), `nameItem` and `namesPage`, and the fingerprint is repinned (src/team/contract.ts:108-113, :161).
  - `retryAfterSec` leaves `RefusalShape`; it was never sent in a body (it travels in `Retry-After`).
  - `nameId` is an added feed key. The names routes answer the route table's 404 below contract 2, and the client reads that answer as `oldServer`.
- personal-data:
  - `nameItem.createdBy` gives the creator's member id and name to every member, the same audience as the feed's existing `member` field. The creating device is stored but never returned.
  - The audit rows (`name created`) follow the existing pattern.
  - On the client, the creator's name goes only into the local `names.recreated:*` meta flag. `clearServerLedger` now removes these flags (src/sync/ledger.ts:841).
