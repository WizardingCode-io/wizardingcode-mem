# architects lead's validation of 2026-11-11-005-share-a-project-without-a-git-remote-tod: delivery
verdict: returned
## Returns
- R-1 · src/ui/api.ts:1295 · **Problem.** When the body of `PUT /api/projects/<id>/sharing` has no `as`, the route calls `setLevel` directly (line 1296). It never goes through `prepareBinding`/`commitBinding`. The spec says this route runs both (spec.md:219), and ADR 0028 says the same (docs/adr/0028-shared-names.md:37). The CLI already does: share.ts:265 sends every `share project` through `prepareBinding`, with or without `--as`. So the two entry points apply different rules to the same request.
  **Effect.** Take a project at Nothing that still carries `name:docs`. Nothing removed its level row and kept the name (src/sharing/store.ts:508-513).
  - `PUT {level:"receive"}` binds it to the name. `aliasToBind` picks the carried name (store.ts:547-551). `binding` is false because `as` is null (store.ts:558). Receive only is not a widening, so `needs-confirm` never fires (store.ts:560).
  - There is no registry lookup and no confirmation. The bind is written with `name_id` NULL (store.ts:579-582, since the row is gone).
  - With a NULL id, the sync's re-created check never fires (src/sync/inbound.ts:180: `row.nameId === null` → not flagged). Suppose the operator purged `docs` and a teammate re-created it for an unrelated project. This binding would then pull the unrelated project's items with no flag. That is the silent merge the registry and the name id exist to prevent (spec.md:263, ADR 0028:11 "confirmed by name at every level, Receive only included").
  - The dock does not take this path, because it always sends `as` while the field shows (ui/src/components/ProjectsView.vue:153, :265). The route is still the contract, and AC-43 tests the route directly.
  **What must change.** Send the no-`as` case through `prepareBinding` then `commitBinding` too, as share.ts:265-295 does. `prepareBinding` already derives the alias from the dry run's `boundAlias` (src/sync/binding.ts:282). That path does the lookup, asks for `confirm` and stores the id. Add a case to tests/integration/ui-sharing.test.ts:
  1. Start with a project at Nothing that carries a name.
  2. `PUT {level:"receive"}` with no `as` and no `confirm` → 400 `needs-confirm`, with no POST to the test server.
  3. The same request with `confirm: true` → the level row holds the registry's `name_id`.
## Notes
- **The identity leaf holds.** src/core/identity.ts has no import. Its predicates and `TEAM_ALIAS_SQL` (:105) are built from `ALIAS_KINDS` (:11). src/team/contract.ts:5 imports the leaf, and its old import of `../sharing/levels.ts` is gone (diff.patch:3082). levels.ts:118 re-exports `isHostLedAlias`. entry.ts:5 takes `SLUG`, `SLUG_MAX` and `RESERVED` from the leaf. The three prefilters name `TEAM_ALIAS_SQL`: src/ui/api.ts:141, src/sharing/report.ts:187, src/sync/inbound.ts:761. `'remote:%'` is left only in src/core/project.ts:87 and src/links/suggest.ts:42, which the spec allows (spec.md:47).
- **My spec returns are applied.**
  - The dry run comes before the server: `setLevel`'s `dryRun` runs in `db.transaction(run)()`, never `withWrite` (store.ts:597). `prepareBinding` runs it before any request (binding.ts:269-281).
  - The two-phase bind lives in the sync client: binding.ts:261 and :331, with the `hooks.afterServer` seam at :383.
  - The binding module names no sharing table: tests/unit/sync-boundary.test.ts:181 is the only change to that test (diff.patch:7754-7758). tests/unit/team-store-boundary.test.ts is not in review/files.txt.
  - src/sharing/ imports nothing of src/sync, src/team or src/ui (grep: no match).
- **The server side holds.** src/team/validate.ts imports no store and runs no SQL. The three advisories carried in architecture.findings.md are naming and typing debt, not boundary breaks. They are the bare contract `2` (src/sync/servers.ts:462), `nameId` typed as required (src/team/contract.ts:259), and the `'names.%'` literal (src/backup/backup.ts:238). I agree with the judge's advisory rating.
- **The ADR matches the code.** ADR 0028 records D-1 to D-7, the leaf, the two-phase bind, the flags, the schemas, the rollbacks and the known limits. Its "What building changed from the plan" section (:73) matches the code: `slugCore`, the 16-hex id, `spokenAfterMe`, and `listServerNames` moved into the sync client.
- **Gates.** The gates (build, test, lint, typecheck) passed on the merged tree (report.md:56-59), and every judgement gate is proven in round 3 (report.md:64-72).
