# architects lead's validation of 2026-11-10-002-part-6-of-the-knowledge-and-team-journey: spec
verdict: validated
## Returns
none
## Notes
- My three round-3 returns are answered and hold against the code as it is.
  - **R-1 (`user_version` stays 7).**
    - The spec says it at spec.md:63, at spec.md:81 (add-only, registered only through `src/engine/module-schemas.ts`, no core column, foreign key or trigger, pinned by `tests/unit/sync-schema.test.ts`) and at spec.md:199.
    - The plan says it at plan.md:49. Plan task 1 (plan.md:70) asserts `user_version` 7 and the core tables' `sqlite_master` rows unchanged.
    - `sharing.carry_owed` is in the `meta` keys list (plan.md:49).
    - The code agrees: `upgrade` in `src/store/db.ts:141-173` runs one `BEGIN IMMEDIATE` for both modules' migrations (`migrateModules`, db.ts:284-330). Module versions are recorded in `module_migrations` (db.ts:318-322) and never move `user_version`. A failure rolls everything back (db.ts:162-169), as spec.md:81 says.
    - Sharing v2's `run` runs after its `sql` (db.ts:157-158), so the resolve-then-create-index order in spec.md:81 and plan.md:49 is buildable.
    - `sharing_levels` has no CHECK on `level` (`src/sharing/migrations/0001_sharing_policy.sql:7-11`), so storing `receive` needs no rebuild.
  - **R-2 (the callers of `TEAM_DESTINATION`).** I ran `grep -rn TEAM_DESTINATION src/` and every caller outside `src/sharing/` is now named.
    - `src/ui/api.ts:103` and `:1029`, `src/status/report.ts:259` and `:262`, `src/doctor/checks.ts:913` and `src/sharing/store.ts:227` (`previewLevel`) are in plan task 9 (plan.md:84) and spec.md:81 and :83.
    - `src/cli/commands/share.ts:132`, `:253`, `:254`, `:287` and `:288`, and the `src/sharing/report.ts` calls at lines 108, 114, 187, 311, 459, 477, 574 and 627, are covered by "`destination` parameters everywhere `TEAM_DESTINATION` was" and the `--server` handling in the same task.
    - The "bound server's level, else Nothing, never `team`" rule is stated once in task 9 and in AC-35 (spec.md:178), with its test case at plan.md:120.
  - **R-3 (the boundary).**
    - Today `src/modules/knowledge/` and `src/retrieve/` import nothing of `src/sharing/` or `src/sync/` (my grep for `sharing/|sync/` over both returned nothing; the imports of `brief.ts` and `notes.ts` are engine, store, util and core only).
    - The spec states that they keep to this: spec.md:80 for the boundary and spec.md:82 and :83 for the read-only SQL over `sharing_servers` and `sharing_muted_members`. The boundary test (plan.md:74) pins it.
    - `agentName` is in the leaf `src/core/agent-name.ts` (spec.md:80, :83 and :134; plan tasks 12 and 14), imported by both modules the way `src/core/redact.ts` is.
    - `RECEIVED_SHARE` sits beside the brief's shares (plan.md:95).
- The schema versions (sharing v2, knowledge v8, `user_version` 7) read the same in the Sizing line (spec.md:63), `Where things live` (spec.md:81), the rollback risk (spec.md:199), plan.md:7, :51, :70 and :84, and the criteria (AC-27, AC-33, AC-35).
- The criteria renumbering is consistent. The plan's phase headers use AC-35, AC-37, AC-36 and AC-38, and the test-case lines at plan.md:120-126 match the criteria. AC-34 (spec.md:190) is the preserve list, and plan task 21 (plan.md:114) uses it.
- The unbinding rule in spec.md:123 and AC-36 (`reconcileReceived`) uses the same grouping rule as the cursor groups. The unbound project's received rows go before the first page of the next pull, and a re-bind's snapshot brings them back.
- The conflicts row's close is stated the same way in spec.md:142, plan.md:89 and AC-37. `closeConflict` is called from the CLI and the viewer's route, which are not hook paths, so the hook boundary is not touched.
- Two small notes, neither a return:
  - `src/sync/join.ts` (plan tasks 8 and 15) is missing from the file inventory at spec.md:80. The Sizing line (spec.md:63) says 13 new files under `src/sync/`, and the inventory plus `join.ts` gives 12. The boundary test covers it either way, since it checks everything under `src/sync/`. I suggest fixing the spec's list at the next edit.
  - `src/sharing/levels.ts` is described as a leaf over `types.ts` (its header, levels.ts:1-3). Plan task 9 puts `destinationsOf(db)` and `boundServerOf(db, projectId)` there, and both read the database. A type-only `Db` import keeps the store-to-loader direction, but ADR 0025's amendment should say that the leaf now holds two reads.
