# test-quality findings for 2026-11-08-001-record-why-the-drain-skips-a-turn-saved
reviewer: review-test-quality
read: 4 test files (distill.test.ts, distill-cli.test.ts, doctor.test.ts, status-skips.test.ts), 3 criteria

## Findings
none

Per criterion, the test that fails when the behaviour is reverted:
- AC-1, in /Users/andreagroferreira/AIProjects/ai-mem/tests/integration/distill.test.ts:
  - saved: "a turn the agent saved itself is skipped with the reason saved" reads `last_error` from the database.
  - empty: "a turn the filter empties…".
  - not-worth: the low `worthSaving` test and the `kind: none` test.
  - no-title: the `judging({}, null)` test.
  - A done turn has no reason: "a distilled turn has no reason, even after an earlier failure" seeds `last_error` first. That test would fail if `finish` stopped clearing it.
- AC-2:
  - "the drain report counts the skipped turns by reason" mixes done, empty, not-worth and no-title in one drain and asserts the whole report.
  - The existing `drain` report assertions now include `skippedBy`, so the held and failed reports are pinned too.
  - The `distill` command's output line is pinned by the new test in distill-cli.test.ts ("1 skipped (not-worth 1)").
- AC-3, in /Users/andreagroferreira/AIProjects/ai-mem/tests/integration/status-skips.test.ts:
  - Counts per reason, with NULL counted as `unknown`.
  - The status line shows only the reasons that occurred, and no parentheses when nothing was skipped.
  - Turns from another project are excluded. A removed `project_id` filter would give `noTitle: 1`, and the test expects 0.
  - Unknown reasons and `skip:constructor` fall into `unknown`, so the prototype guard is exercised.
  - The doctor.test.ts expectation of `(unknown 1)` covers the pre-change NULL case through the CLI.

I found no assertion on a mock's own return, and no test that passes because nothing threw. Fixtures use neutral names.

## Outside the change
none

## Not answerable
- Mutation score (rubric question 7) · no mutation report was named in the prompt.
