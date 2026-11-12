# security findings for 2026-11-11-005-share-a-project-without-a-git-remote-tod
reviewer: review-security
read: 8 files, risk areas: public-api, personal-data

## Findings
- F-1 · advisory · src/team/routes.ts:550 · A member who learns a lost name's `id` (from a feed item's `nameId` or from `GET /v1/names/<alias>`) can re-create the name after a restore with `POST /v1/names {alias, id}`. The server does not check that this member created the id before, so teammates' `recreated` detection in src/sync/inbound.ts never fires. Any member can already push under any held name, so this widens nothing. Carried from rounds 1 to 3, unchanged.
- F-2 · advisory · src/team/store.ts:1023 · `serve purge name` only sets `purged_at`. The alias, `created_by_member` and `created_by_device` stay in `names` and in the change, revision and audit rows, and the mirror repository `repos/projects/<slug>-<8 hex>` stays too. Only the operator sees these. ADR 0028 and the runbook now state the limit and give `serve mirror --rebuild` as the third step. Carried, unchanged.
- F-3 · advisory · src/sync/servers.ts:439 · `lowerContract` still accepts 0 or a negative integer from a hostile server. This fails closed: the next request gets a 409 and the client stops that server as `contract`. A floor of 1 would only harden the input check. Carried, unchanged.

## Outside the change
- src/team/feed.ts:55 · Any member may pull any alias, shared names included. The alias filter is minimisation, not a permission (ADR 0026 D-11). This is existing debt.

## Not answerable
none

Round 4 check, on what changed since round 3:
- **`setProjectSharing` in src/ui/api.ts:1287-1330.** Every `PUT /api/projects/<id>/sharing` now runs `prepareBinding` then `commitBinding`, with or without `as`. This closes the gap you described.
  - Before, a project at Nothing that still carried a name could be re-bound with `name_id` NULL and no confirmation.
  - `prepareBinding` (src/sync/binding.ts:261-321) uses `setLevel` with `dryRun`, so the same refusals apply.
  - When the project is not already bound by that name, or the name was lost or re-created, it reads the registry on the server.
  - `commitBinding` then needs `confirm` and stores the server's id (src/sync/binding.ts:351-385). The viewer path now matches the CLI.
  - The case where the project is already bound by the same name writes with the stored id and the caller's `confirm`, as before. Nothing widens.
- **Caller and input.** The route stays behind the viewer's URL-token check. `projectRoute` and `aliasFrom` validate `level`, `server` and `as` before the bind. The request's clock is injected by the route. The answer carries no token, and `boundAlias` and `sharedName` are the project's own data.
- **Server calls.** The only calls are `nameByAlias` and `createName`, as the CLI makes them. A hostile server's answer is mapped to typed refusals. An old server lowers the contract and is refused.
- **Docs and tests.** The runbook, the ADR text and the lint record add no behaviour. I found no token or invitation literal in them.
- **Not changed.** The name routes in src/team/routes.ts, the personal-data answers (`createdBy` goes to the same audience as the feed's `member` field, the creating device is never returned) and the client flags (cleared on server removal and on restore) are unchanged from round 3.
