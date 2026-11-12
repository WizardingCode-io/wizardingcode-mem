

## Clarifications
- # code-quality findings for 2026-11-12-006-the-client-learns-of-a-release-and-its-s
  reviewer: review-code-quality
  read: 3 files, 31 hunks
  
  ## Findings
  - F-1 · advisory · src/update/reason.ts:5 · `reason` repeats `firstLine`'s body (`(error instanceof Error ? error.message : String(error)).split("\n")[0] ?? ""`, also at line 10) instead of returning `firstLine(error)` after its code check: one line of duplicated boilerplate in the new module (question 2).
  
  The round 2 advisories are resolved:
  - F-1 (round 2): the run rule is now the leaf `src/update/staged.ts`, which `report.ts` and `reconcile.ts` both read.
  - F-2 (round 2): `gather` changes nothing, and `reconcile` reads and deletes `WIZARDINGCODE_MEM_HANDED` itself.
  - F-3 (round 2): the reduction of an error to one line is now in `src/update/reason.ts`, used by `check.ts`, `report.ts` and `reconcile.ts`.
  - F-4 (round 2): `report.ts`'s header now names `reportOrReason` and the `update` command among the writers of the lines.
  
  The new seams are both passed by tests: `stagedFacts(..., who)` in tests/unit/update-report.test.ts:232-259, and `status`'s `run(argv, build)` in tests/integration/update-command.test.ts:283.
  
  ## Outside the change
  none
  
  ## Not answerable
  none
