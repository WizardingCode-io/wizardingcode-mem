# etl lead's validation of 2026-11-11-005-share-a-project-without-a-git-remote-tod: delivery
verdict: validated
## Returns
none
## Notes
- The three migrations hold. `src/store/migrations/0008_shared_names.sql:4` is a partial unique index `project_aliases_one_name` that matches the prefix with `substr(alias,1,5)='name:'`, not LIKE, so no case folding lets a second name through. `src/sharing/migrations/0003_sharing_names.sql:4` adds a nullable `sharing_levels.name_id`, so rows written before it stay valid. `src/team/migrations/0002_team_names.sql` renames the four `remote_alias` columns with RENAME COLUMN (the `changes_scope` index follows the rename), creates `names` with a unique `id` and a nullable `purged_at`, and adds the partial indexes `entries_project` and `memories_project` for the name counts.
- Every migration is additive or a rename, and the `.sql` files I read carry no data rewrite. A grep of `src/` for `remote_alias` finds it only in the 0001 migration, in the rename statements, and in `knowledge_received.remote_alias`. That column is unchanged by design (ADR 0028, CLAUDE.md). So no query was left on a renamed column, and the wire key stays `remoteAlias`.
- The version gates are in the code. `TEAM_LATEST = 2` is at `src/team/db.ts:18`, and `LATEST_VERSION = MIGRATIONS.length` (`src/store/db.ts:31`) is checked on restore at `src/backup/backup.ts:265` and `:422`. The criteria AC-27 and AC-39 pin the refusals: `SchemaTooNewError` on an older binary, `serve` exiting 3, and `openTeamForWrite` refusing to migrate. Their red and green records are in report.md.
- A restore clears the `names.%` flags (`src/backup/backup.ts:238`) together with the `sync.%` keys, so a restored store carries no stale name state.
- Rollback is stated in ADR 0028, the runbook ("Rollback" and "Upgrade") and the spec. The server's rollback is keeping `team-before-rollback.db` aside. The client's is restoring the upgrade copy, since a 0.7.0 binary refuses a version 8 store. Round 3 closed the runbook ordering finding: `share names` is asked for before the server stops.
- Erasure of a name is `purged_at` only. The limit (alias, creator and the change and audit rows stay, mirror rebuild is a third step) is documented and asserted as the documented limit in AC-39 (report.md:38). That matches the security lead's round-2 acceptance.
- Gates passed on the merged tree: build, test (3225 pass, up from 3109), typecheck and lint. The data judgement gate reads Proven in round 4 (report.md:94-96).
- Three advisories were carried from round 1 and are not defects:
  - `src/sharing/report.ts:681` filters `memories.origin` with no index, on a non-hook path.
  - `src/team/routes.ts:73` does up to 3×200 indexed reads per names page, which is capped and recorded in ADR 0028.
  - `src/sync/ledger.ts:626` reads `knowledge_received.remote_alias` with no index, on a non-hook path.
  - All three are deferred as rows in `docs/real-use/findings.md` dated 2026-11-12. I did not open that file; the deferral is as the brief states.
- Not re-run: I did not run the tests or open the test files myself. I relied on the engine's gate records and the four rounds of data findings.
