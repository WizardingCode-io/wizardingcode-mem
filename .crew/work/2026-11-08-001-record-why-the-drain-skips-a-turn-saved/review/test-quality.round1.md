# test-quality findings for 2026-11-08-001-record-why-the-drain-skips-a-turn-saved
reviewer: review-test-quality
read: 4 test files (distill.test.ts, distill-cli.test.ts, status-skips.test.ts, doctor.test.ts), 3 criteria

## Findings
- F-1 · advisory · /Users/andreagroferreira/AIProjects/ai-mem/tests/integration/status-skips.test.ts:656 · AC-3 says "the project's skipped turns", but the test creates a single project. Dropping `project_id = ?` from the `skippedBy` query in `src/status/report.ts` would still pass. A second project with a skipped turn and an assertion that it is not counted would pin it.
- F-2 · advisory · /Users/andreagroferreira/AIProjects/ai-mem/tests/integration/status-skips.test.ts:656 · A stored `last_error` that is neither `skip:<known>` nor NULL (for example `skip:bogus`) should count as `unknown`. This is untested, so the `?? "unknown"` fallback for a `skip:` value with no matching key is unpinned. A key such as `skip:constructor` would also resolve through the object prototype in `SKIPPED_KEY`. This is a minor edge, not realistic input.

## Per criterion
- AC-1: each reason has a test that fails on reversion.
  - `skip:saved`: distill.test.ts "a turn the agent saved itself is skipped with the reason saved", asserting `reasons()`.
  - `skip:empty`: "a turn the filter empties…".
  - `skip:not-worth`: "a turn the judge finds not worth keeping…" and "a verdict of kind none is not-worth too".
  - `skip:no-title`: "a turn with no knowledge sentence…".
  - Done turn has none: "a distilled turn has no reason, even after an earlier failure" seeds an old error and asserts NULL.
- AC-2: the "the drain report counts the skipped turns by reason" test in distill.test.ts mixes reasons and uses exact `toEqual`. The existing report assertions were updated to carry `skippedBy`. The `distill` command output is pinned in distill-cli.test.ts "says why the turns it skipped were skipped", as the literal string `1 skipped (not-worth 1)`.
- AC-3: status-skips.test.ts asserts the per-reason counts, `unknown` for a NULL `last_error`, and the exact formatted line. The line omits reasons that did not occur and shows plain `0 skipped` when none were skipped. doctor.test.ts pins `(unknown 1)` for an old skipped turn.
- No test asserts only its own mock or fixture. Fixtures use neutral names. No mutation report was given.

## Outside the change
none

## Not answerable
none
