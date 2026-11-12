# test-quality findings for 2026-11-11-005-share-a-project-without-a-git-remote-tod
reviewer: review-test-quality
read: 39 test files, 12 criteria

## Findings
- F-1 · defect · tests/integration/share-names-cli.test.ts:103 · AC-44 promises that the CLI prints "the imported count when above 0" (src/cli/commands/share.ts:289 and :308). No CLI test sets up an imported memory, and "imported" appears nowhere in share-names-cli.test.ts or sharing-cli.test.ts, so deleting both lines leaves every test green (Q1).
- F-2 · defect · tests/integration/sync-contract.test.ts:184 · AC-41 promises that "a full sweep reads /v1/me again for a row below CONTRACT … within one full sweep". The test calls `refreshContracts(ctx, { onlyBelow: true })` directly, and no test drives the run loop's full-sweep branch. Removing `await refreshContracts(ctx, { onlyBelow: true })` at src/sync/run.ts:347 passes every test (Q1).
- F-3 · defect · tests/integration/sync-contract.test.ts:216 · AC-41 says the join, and the `/v1/me` read, store "the lower of CONTRACT and" the server's answer. Every server in the tests answers 1 or 2, never above CONTRACT, so storing the server's value as-is would pass. One server started with the seam `{ current: 3, accepted: [1, 2, 3] }`, checked after the join and after `refreshContracts` (line 154), would catch it (Q1/Q7).
- F-4 · defect · tests/unit/sharing-contract.test.ts:225 · AC-28 requires `REASON_TEXT["unbound-alias"]` to say "git remote or shared name". No test reads that sentence; sharing-contract only checks that every text ends with ".". Putting back the old sentence at src/sharing/types.ts:125 passes (Q1).
- F-5 · defect · tests/integration/sync-names.test.ts:130 · AC-42 says "a snapshot without that memory forgets it" for a teammate's memory under the name. No test runs a snapshot that drops a received row under a shared name. The only snapshot case is the re-created one, which asserts rows are kept. If the snapshot filter at src/sync/inbound.ts:790 were widened to skip every name alias, the tests would still pass (Q1).
- F-6 · defect · tests/integration/team-names.test.ts:227 · AC-39 says `limit` is "clamped to 1..200", but only 60 names are seeded. `?limit=500` returning 60 items proves no upper clamp; any maximum of 60 or more, or none at all, passes. Seeding 201 or more names and expecting 200 would catch it (Q1).
- F-7 · defect · tests/unit/sharing-store-writes.test.ts:486 · An existing assertion for remote aliases was inverted. Before, naming another alias rebound a level (X → A); now X is kept until Nothing. This is a behaviour change for remote-bound projects. AC-3 states "no rebind" only for a shared name, and AC-47's list names only this file's `no-remote` cases. So a preserved test was rewritten to accept new behaviour without being named (Q3).

- F-8 · advisory · tests/integration/share-names-cli.test.ts:232 · AC-44 "`--as` on a remote project refuses has-remote with no request". The test counts only `GET /v1/names/name%3Az`, so a `/v1/me` read or a POST would go unseen. Counting every `/v1/` request, as ui-sharing.test.ts does, would match the criterion.
- F-9 · advisory · tests/integration/sync-contract.test.ts:154 · AC-41 says "in parallel". If the reads ran one after another, the test still passes: both resolve once the clock moves 5 s. The "unstopped" filter is not tested either (no stopped row in the fixture).
- F-10 · advisory · tests/integration/team-names.test.ts:247 · "a remote is never listed" holds by construction. Items are seeded under ALIAS_A, but ALIAS_A is never put into the `names` registry, and `listLiveNames` (src/team/store.ts:986) has no alias-kind filter of its own, so the assertion cannot fail.
- F-11 · advisory · tests/unit/team-validate.test.ts:225 · The "validate.ts runs no SQL" check (AC-40) only searches the source for `.query(` and `.run(`, so `.prepare(`, `.get(` or a helper call would slip past. AC-40's rule that the registry check runs "after `purged`" has no ordering test.
- F-12 · advisory · tests/integration/sync-binding.test.ts:340 · The test reads tests/unit/sync-boundary.test.ts and asserts it contains `"src/sync/binding.ts"`. That only checks an edit this item made; the boundary test itself is what proves the boundary.
- F-13 · advisory · tests/integration/sync-status.test.ts:5 · AC-45 says "status --json carries them", but the test asserts the `statusReport` object, not the CLI's `--json` output.
- F-14 · advisory · tests/integration/ui-sharing.test.ts:56 · AC-43 names `GET /api/projects`. The tests read `/api/overview`, which is the only route that exists (src/ui/server.ts:331). The criterion text and the code disagree; the test follows the code.
- F-15 · advisory · tests/integration/sync-names.test.ts:1 · Some edge cases the plan lists were not written:
  - AC-42: a 101st bound name goes to the extras.
  - AC-42: a `name` refusal never produces a D-10 hold.
  - AC-44: `--as` with `--server` naming another server gives `one-server` before any request, in sharing-cli.test.ts. Only the library level covers this, in sync-binding.test.ts.
- F-16 · advisory · tests/unit/sharing-levels.test.ts:258 · Several existing assertions were edited without being named in AC-47:
  - `nameId: null` on level rows, in sharing-levels and sharing-policy.
  - `imported: 0` in `perProject`, in share-confirm, sharing-report, sharing-server-writes, sync-join and ui-sharing.
  - The sharing namespace version pins 3→4, in sharing-policy.test.ts:122 and ui-sharing.test.ts:685.
  - sync-restore.test.ts:763 (2→3).
  - team-serve-cli.test.ts:293 (schema "2", names "0").
  - ui-servers.test.ts:434 (`{ error }` → `{ error, reason }`).

  Each follows a change some criterion states, but AC-47's list is incomplete.
- F-17 · advisory · AC-46 (observed) · The reason ("documents") mostly holds. Part of the criterion could have had a red run: a test asserting that docs/adr/0028-shared-names.md exists and that the runbook cites `serve purge name`, `share project --as` and `share names`. The runbook test that was run is unchanged and generic; it passed before the docs were written.

## Outside the change
- tests/unit/sharing-contract.test.ts:225 · The reason-text test only checks that each sentence ends with "."; no sentence's content is pinned, which is what let F-4 through.
- tests/integration/sharing-cli.test.ts:230 · It still asserts only the substring "no git remote". The new `no-name` sentence ("…; give it a shared name") passes it unchanged, so the CLI's new advice is never checked there.

## Not answerable
- Mutation (Q7) · no mutation report was named for this item; the mutation questions were answered by reading only.
- Screens of AC-43 (viewports, schemes, states) · these are design captures, not tests; there was nothing to review as a test.
