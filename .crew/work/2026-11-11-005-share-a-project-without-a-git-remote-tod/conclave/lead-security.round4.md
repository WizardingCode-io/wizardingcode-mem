# security lead's validation of 2026-11-11-005-share-a-project-without-a-git-remote-tod: spec
verdict: returned
## Returns
- R-1 · .crew/work/2026-11-11-005-share-a-project-without-a-git-remote-tod/spec.md:154 (and AC-21 at :272) · The spec says the router's `decodeURIComponent` throw is "caught and answered the same way" as `{ error: "unknown-name" }`. The code already catches it. `src/team/routes.ts:90-94` has `match` return `null` on a throw, and the route table then answers its own bare 404 `not found`, not `unknown-name`. So a parameter that does not decode (`%E0%A4%A`) cannot answer the "same 404 `unknown-name`" as AC-21 asserts, unless the spec adds a router change. Change one of two things. Either say that this one case answers the route table's 404 `not found`, still a 404 and never a 400 or a 500, and have AC-21 assert that body. Or specify a change to `match` or the names handler so an undecodable segment on `/v1/names/:alias` yields `unknown-name`. The first is enough: both bodies are 404 and neither reveals whether a remote is held. The fix is the wording; as it stands AC-21 would fail on the code.
## Notes
- Round-2 return R-1 (option (a)) is answered everywhere it was asked:
  - The paragraph "The operator's erasure" (spec.md:158) names what `serve purge name` erases: the registry row, and the name from every member's list.
  - It also names what stays: the string in the `purged` keys and the `changes` rows of purged items, the withdrawn entry and memory rows that carry it as `project_alias`, and the audit rows `name created` and `name purged`.
  - It says that an operator who needs the string gone restores or rebuilds `team.db`.
  - The code supports the claim: `store.ts:895-913` (`markPurged`) turns the rows into `purge` rows, keeps the key and inserts it into `purged`. `mirror.ts:574-605` shows the purge writing an audit row.
  - Journey 6 (:72), the risk at :247, the Documents section (:217), AC-21 (:272, asserted as the documented limit) and AC-24 (:279, the ADR and the runbook say it) all carry the limit.
  - The alternative at :233 is consistent with this.
- Round-1 returns still hold:
  - The by-alias route and `after` are judged by the grammar before any SQL (:153-154).
  - A `remote:` alias, a malformed alias and an unheld name give the same 404, so the route cannot probe for a remote.
  - Confirmation is by name at every level, Receive only included (:104, :181, :205, AC-22 and AC-23).
- Auth and rate: the three names routes sit behind the device token and the devices bucket. The list shows names only, and the alias filter stays minimisation (:40).
- Path safety: the grammar refuses `/`, `.`, `:` and reserved file names, and the folder is `<slug>-<8 hex>` checked by `PROJECT_FOLDER`.
- Push: the registry check is inside each item's transaction after the pure checks, so `validate.ts` stays free of SQL. `path:` and `gitdir:` never leave.
- Migration: both rollbacks fail loudly, through the 0.7.0 binary's `SchemaTooNewError` on store version 8 and the 0.7.0 image's exit 3 on schema 2.
- The remaining advisory is that registry growth is bounded only by the devices bucket, which is acceptable for a closed team.
