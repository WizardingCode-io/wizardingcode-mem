# test-quality findings for 2026-11-12-007-three-tests-fail-intermittently-on-the-m
reviewer: review-test-quality
read: 3 test files, 8 criteria

## Findings
- F-1 · defect · tests/unit/knowledge-maintenance.test.ts:529 · AC-10 asks that the ADR's paragraph on what `.git` may hold say the housekeeping still runs, now started by the runner after a commit and in the foreground. The test does not check that paragraph. `paragraphs.length >= 2` was already true before the change: line 86 (the `.git` paragraph, which the diff did not touch and which still says only "in its own housekeeping, removes") and the old Known-limits line both contain the word. Only the Known-limits paragraph is checked for "started by the runner after a commit, in the foreground". So that clause of AC-10 has no assertion that fails when it is reverted (rubric Q1).
- F-2 · advisory · tests/integration/team-mirror-maintenance.test.ts:251 · AC-12 (mirror): the lease is stolen at "the next `now()` read after the second commit". If the call `maintain` makes were removed, the same steal would happen at `ctx.now()` before the next revision (`src/team/mirror.ts:462`), and every assertion would still pass. The test does fail if the swallowing of a lease error that is not a `KnowledgeError` is reverted (commits would be 0, not 1), so it does prove the record is not parted from the commit. It does not prove the loss happened at the maintenance call itself; AC-7's test is what holds that the call exists (Q1/Q5).
- F-3 · advisory · tests/unit/knowledge-maintenance.test.ts:479 · AC-13: only with the settings kept and the runner's call removed does the test fail every time. If the whole change is reverted, the commit's own detached maintenance (with `gc.auto=1`) may pack the objects before the assertions run, so the red is a race, not certain. Also, the spec says "two loose objects" and the test writes three. Both are harmless for the threshold (`gc.auto=1` needs more than one in `objects/17`).

## Outside the change
none

## Not answerable
- Mutation (Q7) · no mutation report was named for this item
