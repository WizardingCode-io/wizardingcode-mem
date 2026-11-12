# security findings for 2026-11-11-005-share-a-project-without-a-git-remote-tod
reviewer: review-security
read: 6 files, risk areas: public-api, personal-data

## Findings
- F-1 · advisory · src/team/routes.ts:550 · A member who learns a lost name's `id` (from a feed item's `nameId` or from `GET /v1/names/<alias>`) can re-create the name after a restore with `POST /v1/names {alias, id}`. The server does not check that this member created the id before, so teammates' level rows treat the new name as the same one, and the `recreated` check in src/sync/inbound.ts never fires for them. This does not widen what a member can do, because any member can already push under any held name. Carried from rounds 1 and 2, unchanged.
- F-2 · advisory · src/team/store.ts:1023 · `serve purge name` only sets `purged_at`. The alias, `created_by_member` and `created_by_device` stay in `names` (src/team/migrations/0002_team_names.sql:9), and in the change, revision and audit rows, until `team.db` is rebuilt. ADR 0028 states this limit, and only the operator sees these rows. Carried, unchanged.
- F-3 · advisory · src/sync/servers.ts:439 · `lowerContract` still accepts 0 or a negative integer from a hostile server's `/v1/me` or join answer. This fails closed: the next request carries that value, the server answers 409 with nothing acceptable, and the client stops that server as `contract`. A floor of 1 would only harden the client's input check. Carried, unchanged.

## Outside the change
- src/team/feed.ts:55 · Any member may pull any alias, shared names included. The alias filter is minimisation, not a permission (ADR 0026 D-11, which this diff does not change). This is existing debt.

## Not answerable
none

Round 3 check: the round-3 edits touched comments, doc text, dock sentences, the `NAME_PREFIX` literal in ui/src/components/ProjectsView.vue, the runbook's rollback order and one more declared UI state. None of them changes a boundary.

- **Team server:** I re-read the three name routes in /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/team/routes.ts:532-600. Each still runs `requireNames` and then `withCaller` (device token, rate bucket, contract) before any read.
- **Input checks on those routes:** the alias is checked by `isSharedName` and the given id by `NAME_ID`. `after` and `limit` are validated, and `limit` is clamped to 1..200. The by-alias route still gives a single `unknown-name` 404.
- **Viewer:** the routes in /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/ui/server.ts:524-590 (sharing preview, `DELETE …/name`, `GET /api/servers/<id>/names`) are unchanged and sit behind the existing URL-token check.
- **Contract:** `lowerContract` and `spokenAfterMe` (/Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/sync/servers.ts:438-454) are unchanged.
- **Secrets:** no token or invitation literal was added.
- **public-api and personal-data:** the answers from round 2 still hold.
  - The contract is 2, with 1 and 2 accepted, and the result shapes are pinned in the contract fingerprint.
  - `createdBy` goes to the same audience as the feed's `member` field.
  - The creating device is never returned.
  - The client's `names.*` flags are cleared on server removal and on a restore.
