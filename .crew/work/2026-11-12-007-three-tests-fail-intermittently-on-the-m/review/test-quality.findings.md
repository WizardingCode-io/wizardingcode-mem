

## Clarifications
- # test-quality findings for 2026-11-12-007-three-tests-fail-intermittently-on-the-m
  reviewer: review-test-quality
  read: 3 test files, 8 criteria
  
  ## Findings
  - F-1 · advisory · tests/unit/knowledge-maintenance.test.ts:492 · Carried over from round 1; the test is otherwise sound. AC-13: if the whole change is reverted, the red is still a race, because the commit's own detached maintenance (with `gc.auto=1`) may pack the two objects before the assertions run. If only the runner's call is removed and the settings are kept, it is red every time. With two objects written and at least two counted, the folder git samples is still over the `gc.auto=1` threshold.
  
  ## Outside the change
  none
  
  ## Not answerable
  - Mutation (Q7) · no mutation report was named for this item
