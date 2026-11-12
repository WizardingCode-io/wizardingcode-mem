# test-quality findings for 2026-11-11-005-share-a-project-without-a-git-remote-tod
reviewer: review-test-quality
read: 40 test files, 13 criteria

## Findings
- F-1 · advisory · tests/unit/sharing-store-writes.test.ts:488 · Carried from round 2 F-1. AC-48 is observed (Q4). Its recorded reason says "no red is possible after the fact", but that is a limit of the engine. The assertion itself could have failed first: against the base code, naming A rebinds to A. The only red recorded for this file is AC-3's, and it failed on an import error. The test does pin the rule (lines 488-492) and would fail on reversion, so this stays advisory.
- F-2 · advisory · tests/integration/share-names-cli.test.ts:253 · Carried from round 2 F-2; the line moved from 232 to 253 and 257. AC-44 says "`--as` on a remote project … with no request" (Q1, partial). The test counts only `GET /v1/names/name%3Az`, so a `/v1/me` read or a POST would go unseen.
- F-3 · advisory · tests/integration/sync-contract.test.ts:155 · Carried. AC-41 says "in parallel" and "unstopped". Sequential reads would still pass once the clock moves 5 s, and the fixture has no stopped row.
- F-4 · advisory · tests/integration/team-names.test.ts:272 · Carried; the line moved from 247 to 272 (Q2). "A remote is never listed" holds because of how the fixture is built: ALIAS_A is seeded with items but never put in the `names` registry.
- F-5 · advisory · tests/unit/team-validate.test.ts:227 · Carried; the line moved from 225 to 227. The no-SQL check for AC-40 searches only for `.query(` and `.run(`, and AC-40's order "after `purged`" has no test.
- F-6 · advisory · tests/integration/sync-names.test.ts:1 · Carried. These edge cases from the plan are still unwritten:
  - the 101st bound name
  - no D-10 hold on a `name` refusal
  - `one-server` at the CLI
- F-7 · advisory · ui/src/components/ProjectsView.vue:353 · New in round 3, from the round-2 Vue literal change. The dock's created-name sentence is now the route's sentence with a capital first letter and a full stop. No test pins this. `tests/unit/ui-sharing-copy.test.ts` does not cover it either, because the sentence is built at runtime from the server's answer, not written in the Vue source. The UI capture covers it, and AC-43's word-for-word list names the constant's sentence (`BIND_MESSAGES`), which stays pinned. So this is advisory and not a gap in a behaviour criterion.

Round 3 re-check: no test file and no test helper changed in round 2. Round 2's changes were:
- a comment and a doc comment
- three dock sentences
- one Vue literal, in ProjectsView.vue at line 353
- the runbook, held by `tests/unit/team-runbook.test.ts`
- one more declared UI state in the probe, at ProjectsView.vue:338-343 (the `exists` → join branch), which is a design capture and not a test

So each behaviour criterion still has the same test that fails on reversion, as established in rounds 1 and 2. Round 1's six defects remain fixed, at these lines:
- share-names-cli.test.ts:91-125
- sync-contract.test.ts:217-254
- sharing-contract.test.ts:229-231
- sync-names.test.ts:339-359
- team-names.test.ts:235-247

The AC-47 preserve suites are unchanged, and the item's before and after runs over the whole suite stand.

## Outside the change
- tests/integration/sharing-cli.test.ts:230 · This is debt, carried. The test asserts only the substring "no git remote", so the `no-name` advice ("give it a shared name") is not pinned there.

## Not answerable
- Mutation (Q7) · no mutation report was named, so I judged mutants by reading.
- Screens of AC-43, including the newly declared exists→join state (viewports, schemes, states) · these are design captures, not tests, and the ui-ux gate judges them.
