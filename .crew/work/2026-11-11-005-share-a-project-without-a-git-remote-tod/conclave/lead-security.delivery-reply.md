# security lead's validation of 2026-11-11-005-share-a-project-without-a-git-remote-tod: delivery
verdict: validated
## Returns
none
## Notes
- **R-1 (round 1) is applied at docs/runbooks/team-server.md:53-59.**
  - The section now says "erased in three steps" (:53).
  - The third step is `docker compose exec server wizardingcode-mem serve mirror --rebuild`, run once the items are purged (:59).
  - The section names what stays in the mirror: `repos/projects/<slug>-<8 hex>`, its `knowledge.json` naming the alias, and its init commit.
  - It says a restore of `team.db` does not touch `repos/`.
  - The limit now reads "and in the mirror until that rebuild".
  - This matches the code. `replayFolders` leaves the folder with its init commit (`src/team/mirror.ts:533-536`), and `ensureMirrorRepo` writes the alias into the manifest (`:145-166`). A rebuild removes the whole root and replays only the revisions that remain (`:433-436`). The command exists (`src/cli/commands/serve.ts:62`).
- **R-2 (round 1) is applied at docs/adr/0028-shared-names.md:65 and :80.**
  - The erasure paragraph names the mirror repository, its manifest and its init commit as what stays.
  - It says a `team.db` restore does not reach them, and gives `serve mirror --rebuild` as "the erasure's third step".
  - "Known limits" (:80) now says the string stays "in the server's own records and in the mirror after that (the erasure section above, with its three steps)".
- **The architects' change holds on the security side, and closes a gap in confirmation by name.**
  - `setProjectSharing` (`src/ui/api.ts:1283-1324`) now sends every `PUT /api/projects/<id>/sharing` through `prepareBinding` and then `commitBinding`, with or without `as`.
  - A project at Nothing that carries a name is therefore confirmed by name at Receive only too. `commitBinding` answers `needs-confirm` before any request (`src/sync/binding.ts:357`). The project is then bound with the registry's id.
  - `tests/integration/ui-sharing.test.ts:1065-1089` pins the order:
    - 400 `needs-confirm` with no `POST /v1/names` and no row written (:1075-1080);
    - then 200 with `joined: true` (:1081-1086);
    - and the row's `nameId` equal to the registry's (:1087).
  - Refusals still go through `statusOf` in the `{ error, reason }` shape (:1306, :1308).
- **Gates and judgement.** `report.md:8` reads Proven. Secrets, build, test, lint and typecheck pass (`report.md:53-59`). The security gate is proven (`report.md:68`).
- **The three security advisories are accepted as advisory and deferred.** None widens what a member can do:
  - F-1: an id re-created after a restore without proof of the creator. Any member can already push under a held name; the alias filter is minimisation, ADR 0026 D-11.
  - F-2: the alias and creator columns are kept. This is stated at ADR 0028:65.
  - F-3: `lowerContract` has no floor at 1. It fails closed, stopping that server as `contract`.
- **Earlier checks are unchanged.** The by-alias route's single 404 (`src/team/routes.ts:593-600`), the grammar checks before SQL (`:536-540`, `:577-584`), the device token and rate buckets on the three names routes, and the registry check inside the push transaction (`src/team/push.ts:184-194`) all still hold.

Files read:
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/docs/runbooks/team-server.md
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/docs/adr/0028-shared-names.md
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/ui/api.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/integration/ui-sharing.test.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.crew/work/2026-11-11-005-share-a-project-without-a-git-remote-tod/report.md
