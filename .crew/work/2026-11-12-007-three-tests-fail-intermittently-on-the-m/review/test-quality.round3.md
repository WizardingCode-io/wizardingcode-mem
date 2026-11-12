

## Clarifications
- # test-quality findings for 2026-11-12-007-three-tests-fail-intermittently-on-the-m
  reviewer: review-test-quality
  read: 3 test files, 8 criteria
  
  ## Findings
  - F-1 · advisory · tests/unit/knowledge-maintenance.test.ts:509 · AC-13: the host now also passes `maintenance.geometric-repack.auto=1`, and spec.md's AC-13 still says only "`gc.auto=1` given by the host". The test still fails if the runner's call is removed (with `maintenance.auto=false` nothing else runs, so the objects in `objects/17` stay loose). The change is sound. The criterion's wording should name both thresholds so the test reads as the criterion (Q6).
  - F-2 · advisory · tests/unit/knowledge-maintenance.test.ts:492 · AC-13, carried from round 2: if the whole change is reverted, the red is still a race, because the commit's own detached maintenance may pack before the assertions run. If only the runner's call is removed and the settings are kept, it is red every time.
  
  ## Outside the change
  none
  
  ## Not answerable
  - Mutation (Q7) · no mutation report was named for this item
