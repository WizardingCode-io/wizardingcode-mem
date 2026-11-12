# security lead's validation of 2026-11-11-005-share-a-project-without-a-git-remote-tod: delivery
verdict: returned
## Returns
- R-1 · docs/runbooks/team-server.md:59 · The runbook says what stays after a shared name is erased, but it misses one place: the mirror. It says the string stays "in the marked registry row, in the feed's `changes` rows, in the withdrawn rows and in the audit rows until `team.db` is restored or rebuilt". The mirror keeps it too, so that remedy does not erase it. Here is the proof:
  - A revision under `name:<slug>` is placed at `repoFolder("project", revision.project_alias, null)`, i.e. `repos/projects/<slug>-<8 hex>`, with the meta `remoteAlias: revision.project_alias` (`src/team/mirror.ts:187-188`).
  - `ensureMirrorRepo` writes that alias into `knowledge.json` and commits it as `team: init project` (`src/team/mirror.ts:145-166`).
  - When the operator purges the items one by one, `replayFolders` removes the folder (`:503`) and then makes it again with the same meta: "A repository the purged entry alone had filled stays, with its init commit and nothing else" (`:533-536`).
  - So once every item is purged, the slug is still in the folder's name, and `name:<slug>` is still in `knowledge.json` and in the init commit, under `repos/`.
  - A restore of `team.db` does not touch `repos/`; the runbook itself lists the mirror apart from `team.db` (`docs/runbooks/team-server.md:95`). Only `serve mirror --rebuild` removes it: `src/team/mirror.ts:433-436` deletes the whole root and replays only the revisions that remain (`src/cli/commands/serve.ts:62`).
  - This section is the one an operator follows to remove "a person's name" (`:53`).

  What must change:
  - Add the mirror folder, its `knowledge.json` and its init commit to the list of what stays.
  - Add a third step to the order: after the items are purged, run `wizardingcode-mem serve mirror --rebuild`.
  - State that the folder and its manifest stay until that step runs.

  `tests/unit/team-runbook.test.ts` must still pass. The command is already in the code (`serve.ts:62`).
- R-2 · docs/adr/0028-shared-names.md:65 · "The erasure of a name, and its limit" has the same gap. It lists what stays as the `names` row, the `changes` rows, the withdrawn rows, the revisions and the audit rows "until `team.db` is restored or rebuilt". It leaves out the mirror repository `repos/projects/<slug>-<8 hex>`: its folder name, its `knowledge.json` with `remoteAlias: "name:<slug>"`, and its init commit (`src/team/mirror.ts:145-166`, `:533-536`). A `team.db` restore does not remove that repository; `serve mirror --rebuild` does (`src/team/mirror.ts:433-436`).

  What must change:
  - Add the mirror to what stays, and give `serve mirror --rebuild` as its remedy.
  - Line 80 under "Known limits" says "the string stays in the server's own records after that (above)". It should point to the corrected paragraph.

  These two returns are wording only. The code behaves as the spec says; the spec at `.crew/work/2026-11-11-005-share-a-project-without-a-git-remote-tod/spec.md:178` has the same omission, which my spec validation did not catch.
## Notes
- My earlier spec returns are carried into the delivery and hold against the code:
  - **By-alias route, one 404.** `GET /v1/names/:alias` runs `parseNameParam` (`src/team/routes.ts:63-65`), which is `isSharedName` alone with no SQL. A `remote:` alias, a malformed alias, an unheld name and a purged name all get the same 404 `unknown-name` (`routes.ts:596-598`; `liveNameByAlias` filters out purged names).
  - **Grammar before SQL.** `after` is checked by `isSharedName` before any read (`routes.ts:577`). `limit` must be an integer, is clamped to 1..200 and defaults to 50 (`:578-584`). On `POST`, the alias is checked by `isSharedName` and a given id by `NAME_ID` (16 hex) before the transaction (`:536-540`).
  - **Auth and rate.** All three name routes call `withCaller` (device token) before any read (`routes.ts:534`, `:574`, `:595`). The create takes from the per-member `names` bucket inside the transaction (`:548-549`). `requireNames` answers the 0.7.0 router's own 404 below contract 2 (`:68-70`).
  - **Confirmation by name at every level.** `commitBinding` answers `needs-confirm` before any request whenever it would create or join (`src/sync/binding.ts:357`), whatever the level. Receive only is covered by AC-43 and AC-44.
  - **Registry check in the push transaction.** `nameRefusal` (`src/team/push.ts:184-194`) runs inside the item's transaction, after the pure checks and `purged`. A never-held name is refused `name`, a purged one `name-purged`, and a remote does not touch the registry.
  - **Operator's erasure.** `serve purge name <alias> --yes` requires `--yes` (`src/cli/commands/serve.ts:515`). It marks the row and writes the `name purged` audit row with the counts in one transaction (`:516-529`). It exits 1 with `no such name` and exits 0 with `already purged` (`:531-537`). `purgeName` in `src/team/store.ts:1019-1025` sets only `purged_at`, which is the documented limit for `team.db`.
- **Security review, round 3.** It has three advisories:
  - F-1: an id re-created after a restore without proof of the creator.
  - F-2: the alias and creator columns are kept.
  - F-3: `lowerContract` has no floor at 1, and fails closed.

  I accept all three as advisory. F-1 does not widen a member's power, because the alias filter stays minimisation (ADR 0026 D-11). F-2 is stated in ADR 0028. F-3 stops the server as `contract`. None of them is a return.
- **Gates.** `report.md:53-59` shows secrets, build, test (3109 → 3222 pass under AC-47), lint and typecheck passing. The security judgement gate is `proven` (`report.md:68`).
- **No task briefs.** The item was built by the session alone, so there is no brief to check for what changed, what was proven and what is left.

Files read:
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/docs/runbooks/team-server.md
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/docs/adr/0028-shared-names.md
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/team/mirror.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/team/routes.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/team/store.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/team/push.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/cli/commands/serve.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/sync/binding.ts
