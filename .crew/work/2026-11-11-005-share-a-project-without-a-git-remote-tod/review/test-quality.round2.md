# test-quality findings for 2026-11-11-005-share-a-project-without-a-git-remote-tod
reviewer: review-test-quality
read: 8 test files, 13 criteria

## Findings
- F-1 · advisory · tests/unit/sharing-store-writes.test.ts:488 · AC-48 (observed), Q4. The reason says "no red is possible after the fact". That holds only as a limit of the engine. The test itself could have failed first: the assertion `boundAlias: X` fails against the base code (naming A rebound to A) or with `aliasToBind` changed so the named alias wins. The only recorded red for this file is AC-3's, and it failed on an import error (`forgetName` not found), not on this assertion. The test does pin the rule now and would fail on reversion, so this is advisory, not a false reason that hides an untested behaviour. This resolves round-1 F-7: the case is now named for AC-47 by AC-48.
- F-2 · advisory · tests/integration/share-names-cli.test.ts:232 · Carried from round 1 F-8, unchanged. AC-44 "`--as` on a remote project … with no request": the test counts only `GET /v1/names/name%3Az`, so a `/v1/me` read or a POST would go unseen.
- F-3 · advisory · tests/integration/sync-contract.test.ts:155 · Carried from round 1 F-9. AC-41 says "in parallel" and "unstopped". Sequential reads would still pass once the clock moves 5 s, and no stopped row is in the fixture.
- F-4 · advisory · tests/integration/team-names.test.ts:247 · Carried from round 1 F-10. "A remote is never listed" holds because of how the fixture is built: ALIAS_A is never in the `names` registry.
- F-5 · advisory · tests/unit/team-validate.test.ts:225 · Carried from round 1 F-11. The no-SQL check searches for `.query(` and `.run(` only, and AC-40's order "after `purged`" has no test.
- F-6 · advisory · tests/integration/sync-names.test.ts:1 · Carried from round 1 F-15. These planned edge cases are still unwritten:
  - the 101st bound name
  - no D-10 hold on a `name` refusal
  - `one-server` at the CLI

Round-1 defects re-checked against the code; each now has a test that fails on reversion:
- Round-1 F-1 (AC-44, imported count in the CLI): fixed. tests/integration/share-names-cli.test.ts:91-125 inserts an `origin: "imported"` memory. It asserts the question's `· 1 imported memory stays` and that the output ends with `1 imported memory stays`. That covers both src/cli/commands/share.ts:288 and :307-308.
- Round-1 F-2 (AC-41, the full sweep reads `/v1/me` again): fixed. tests/integration/sync-contract.test.ts:217-240 drives `runSync` with `once: false`. It sets the row to 1 and advances 60 s, then expects a second `/v1/me` with header 1 and the row back at CONTRACT. Removing src/sync/run.ts:342 leaves the count at 1.
- Round-1 F-3 (AC-41, "the lower of"): fixed. tests/integration/sync-contract.test.ts:248-254 uses a server at `{ current: 3, accepted: [1, 2, 3] }` and asserts CONTRACT after the join and after `refreshContracts`. The join (`lowerContract`, src/sync/join.ts:165), the sweep (src/sync/run.ts:102) and binding (src/sync/binding.ts:203) all go through the one rule in src/sync/servers.ts:439-455, so the test covers all three.
- Round-1 F-4 (AC-28, `REASON_TEXT["unbound-alias"]`): fixed at tests/unit/sharing-contract.test.ts:229-231.
- Round-1 F-5 (AC-42, a snapshot forgets a dropped memory under the name): fixed at tests/integration/sync-names.test.ts:339-359. It asserts that both the received row and the `memories` row are gone, and that the entry stays. A filter that skipped every name alias would fail it.
- Round-1 F-6 (AC-39, upper clamp of `limit`): fixed at tests/integration/team-names.test.ts:235-247. With 210 names, `?limit=500` returns 200 with `next: "name:zz-bulk-139"`.

## Outside the change
- tests/integration/sharing-cli.test.ts:230 · This is debt, carried from round 1. The test still asserts only the substring "no git remote", so the `no-name` advice ("give it a shared name") is not pinned there.

## Not answerable
- Mutation (Q7) · no mutation report was named; mutants were judged by reading.
- Screens of AC-43 (viewports, schemes, states) · design captures, not tests.
