

## Clarifications
- # architecture findings for 2026-11-12-006-the-client-learns-of-a-release-and-its-s
  reviewer: review-architecture
  read: rubric; CLAUDE.md (engine with modules, settings of ADR 0010, the conventions on the hook path); ADR 0029 (its changed Status line) and ADR 0030; the spec (Design §1–4, AC-32 and its Design paragraph at line 87); review/diff.patch, round 2 (36 files), read in full for every changed source file (cli commands distill, doctor, install, share, status, update; main.ts; reconciled.ts; install/binary.ts; settings.ts; status/report.ts; update/*; util/ago.ts; util/version.ts) and for the docs; tests skimmed through their headers.
  
  ## Findings
  - F-1 · advisory · src/update/reconcile.ts:875 · The rule on who may run the staged file (`mayRunStaged`, `binOwner`) lives in `src/update/report.ts`, the file of sentences a person reads, and `reconcile.ts` now imports it from there. The dependency stays inside the folder and crosses no boundary the base draws (AC-27 still holds, and `main.ts` still loads `reconcile.ts` only through `await import()`). But the hand-over now also loads the report's own imports (settings, state, check, channels) to read one rule. A small leaf in `src/update/` that both files import (say `staged.ts`, holding `mayRunStaged`, `binOwner` and perhaps `stagedFacts`) would keep the rule apart from the report.
  
  The four round 1 advisories are resolved in the diff:
  - ADR 0029's Status line says its piece 2 is narrowed by ADR 0030 (docs/adr/0029-release-distribution.md:3).
  - `Source` is imported from the settings (src/update/report.ts:994).
  - `ago` has one home in `src/util/ago.ts`; share.ts imports it from there, and status/report.ts no longer re-exports it.
  - `src/status/report.ts` imports only `type UpdateReport`, and `formatStatus(report, notice)` takes the notice lines from the `status` command. So the status layer and the viewer no longer load update or install code at run time.
  
  The new pieces were checked against the Design:
  - `reportOrReason` lives in `src/update/report.ts` and is used by `status`, `doctor` and `update`.
  - `reconcile(argv, look)` keeps `gather` as the default and turns a throw into "run in this copy" (AC-32).
  - `stagedFacts` and `decide` share one ownership rule.
  - The refused sentence is written in `agentsLine`, the one writer of line 2.
  
  None of this changes the boundaries of AC-27, the hook path, the store, the settings contract or the place of `update.json`.
  
  ## Outside the change
  none
  
  ## Not answerable
  none
