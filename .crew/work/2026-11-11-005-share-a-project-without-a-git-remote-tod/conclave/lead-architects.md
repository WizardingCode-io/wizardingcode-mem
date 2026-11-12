# architects lead's validation of 2026-11-11-005-share-a-project-without-a-git-remote-tod: spec
verdict: validated
## Returns
none
## Notes
- My round-3 return is applied at spec.md:112. `bindName` is in `src/sync/binding.ts`, beside `join.ts`. The spec says it never lives under `src/sharing/`, because the sync imports sharing and sharing must not know the client. It names no sharing table in SQL and reaches the tables through `setLevel` and `servers.ts`. It joins the boundary test's quiet list. The viewer route and the CLI both call it.
- The code supports this. `src/sync/join.ts` and `src/sync/servers.ts` exist and `join.ts` is already in the quiet list at tests/unit/sync-boundary.test.ts:174-182. A grep found no import of `src/sync` anywhere under `src/sharing/`, so placing `bindName` in the sync keeps ADR 0027's boundary. The `hooks.afterServer` seam is declared as the only test seam on this side, which matches `Context.contract` on the server's side.
- AC-22 (spec.md:276) and AC-23 (spec.md:277) name `bindName` and its `hooks.afterServer` without a path. The disabled-between-dry-run-and-write race and the CLI's created-name sentence are both driven through it.
- AC-25 (spec.md:272) now reads: a malformed alias gives the same 404 `unknown-name` with no SQL run, and an undecodable escape (`%E0%A4%A`) gives the router's own 404 `not found`. It stays a 404, never a 400 or a 500. The line at spec.md:266 records that AC-25 replaces AC-21.
- The criteria are AC-2, 3, 4, 8, 11, 13, 14, 16, 17, 22, 23, 24 and 25, as stated. The server-side and client-side contract, schema and registry design is unchanged from the revision I previously accepted.
- One nit, not a return: spec.md:269 (AC-2) and the "Migration 8" heading at spec.md:114 put the client store at `LATEST_VERSION` 8. CLAUDE.md says `user_version` stays 7. The spec states the bump deliberately, with the upgrade copy and the `SchemaTooNewError` proof, and AC-24 updates CLAUDE.md, so this is consistent.
