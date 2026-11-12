# qa lead's validation of 2026-11-11-005-share-a-project-without-a-git-remote-tod: spec
verdict: validated
## Returns
none
## Notes
- Round-2 R-1 is answered. The paragraph "The two-phase write and its race" (spec.md:112) names `bindName` in `src/sharing/binding.ts` as the single two-phase flow. The viewer route and the CLI both call it. It takes an optional `hooks.afterServer`, called after the server answered and before the write. Tests supply it and production leaves it unset. The spec calls it "the one test seam on this side, as `Context.contract` is on the server's". That is what my return asked for.
- AC-22 (spec.md:276) drives the viewer race through `bindName`'s `hooks.afterServer`: a project disabled between the dry run and the write. The expected result is 409 `disabled` with `named: true`, and the name exists on the server. That can fail on a real regression.
- AC-23 (spec.md:277) drives the CLI case in-process on `bindName` and pins the CLI's sentence on the outcome's message constant. This fits the suite: the CLI tests run the binary, so a hook cannot reach them.
- Implementation note, not a return: AC-22 says the route "passes through" the hook, and `tests/integration/ui-sharing.test.ts` calls the viewer with `fetch` against a started origin (lines 91 and 236). The plan task should name how the hook reaches the route, for example a field on the viewer's start options or deps in `src/ui/server.ts`. The criterion is testable as written.
- Round-1 notes still hold. `Context.contract` is named at spec.md:148, and AC-17 pins it. The stored row is checked before any request, and a bare 404 comes second and sets the row to 1. AC-22 and AC-23 each give both cases.
- Implementation note, not a return: `SyncClient.contract` is `private readonly` (`src/sync/client.ts:142`, set at line 150), so the repeat-once at the lower value needs a mutable field or a new client. AC-17 is testable either way.
- AC-14, AC-2, AC-3, AC-4, AC-8 and AC-11 are testable. Each names its observable outputs: the exports, the grammar parity with `isSlug`, the migration 8 constraint, the `SchemaTooNewError` case, the refusal order, the uid shapes, the `imported` count, the status lines and the doctor warning.
- AC-21 and AC-16 name their status codes, bodies, the registry check's place inside the item's transaction, the move cases and the documented erasure limit. All can fail on a real regression. AC-17 pins the contract, the fingerprint and the 409 accepted list.
- AC-13 lists every existing case that changes. AC-24 is correctly marked observed, with its documents listed.
