# security findings for 2026-11-11-005-share-a-project-without-a-git-remote-tod
reviewer: review-security
read: 14 files, risk areas: public-api, personal-data

## Findings
- F-1 · advisory · src/team/routes.ts:550 · Any member can re-create a lost name (one missing from the registry after a restore) using an `id` they learned from a feed item's `nameId` or from `GET /v1/names/<alias>`. The server never checks that the caller first created that id, so teammates whose level row holds the old id take the new creator's name as the same one. The `recreated` check in src/sync/inbound.ts:174 never fires for them. This is not a widening: any member could already push under any held name, and before contract 2 under any host-led remote.
- F-2 · advisory · src/team/store.ts:1019 · `serve purge name` marks the row and keeps `created_by_member`, `created_by_device` and the alias string in `names`, `changes`, revisions and audit until `team.db` is rebuilt. Erasure is satisfiable item by item, but a name's creator stays in the server's records. ADR 0028 ("The erasure of a name, and its limit") states this, and the audience is the operator, so it is advisory.
- F-3 · advisory · src/sync/binding.ts:207 · The contract a server answers in `/v1/me` (also src/sync/run.ts:103) and at join (src/sync/join.ts:164) goes through `Math.min` and into `sharing_servers.contract` without an integer check. A broken or hostile server's non-number stores `NaN` and stops its own sync as `contract`. Names are not held in that state, but the 409 fires before anything is sent, so the failure is closed. The check only hardens input at the client's boundary.

## Outside the change
- src/team/feed.ts:55 · Any member may pull any alias, shared names included. The alias filter is minimisation, not a permission (ADR 0026 D-11, unchanged here), so a name's entries and memories are readable by every member until the operator purges them. This is debt carried over to the new alias kind.

## Not answerable
none

Basis for the clean areas, briefly:
- Boundary:
  - The three new team routes run `withCaller` (device token, devices bucket, contract check) before reading anything.
  - The alias is checked with `isSharedName` before any SQL. `after` and `limit` are checked, with the page capped at 200. A given id must match `^[0-9a-f]{16}$` and is ignored when any row (purged included) holds it.
  - The by-alias route answers one 404 `unknown-name` for a remote, a purged name, an unheld name and a malformed alias, so it cannot probe for a remote.
  - Pushes and pulls accept a `name:` alias only through `isTeamAlias`. The received folder still goes through `checkComponent` as `<slug>-<8 hex>`.
  - The viewer's new routes (`POST /api/projects/<id>/sharing/preview`, `DELETE /api/projects/<id>/name`, `GET /api/servers/<id>/names`) sit behind the existing URL-token check (src/ui/server.ts:284). `as` goes through `sharedNameOf`, and create or join needs `confirm` before any server request (`commitBinding`).
- Secrets: no token or invitation literal in the diff. The new UI answers carry no token.
- public-api:
  - The contract moves to 2 with `ACCEPTED_CONTRACTS` `[1, 2]` and the fingerprint repinned (tests/unit/team-contract.test.ts).
  - The names routes answer the route table's own 404 below contract 2. `nameId` is an added key, and the client reads feed items without an exact-key check.
  - The wire key `remoteAlias` is kept. `name` and `name-purged` are added to `PUSH_REASONS`.
- personal-data: `nameItem.createdBy` returns the member's id and name to every member, the same audience as the existing feed's `member` field. The device id is stored but never returned. The new audit rows (`name created`, `name purged`) follow the module's existing pattern, and the client stores the member's name in its local `meta` flag only.
