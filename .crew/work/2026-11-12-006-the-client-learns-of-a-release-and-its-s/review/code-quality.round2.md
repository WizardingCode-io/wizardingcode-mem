

## Clarifications
- # code-quality findings for 2026-11-12-006-the-client-learns-of-a-release-and-its-s
  reviewer: review-code-quality
  read: 5 files, 30 hunks
  
  ## Findings
  - F-1 · advisory · src/update/reconcile.ts:10 · `reconcile.ts` now imports `mayRunStaged` and `binOwner` from `src/update/report.ts`. That puts the rule for whether a binary may be run, and the reading of who owns its folder, inside the module that writes the lines a person reads, so `report.ts` has a second job (questions 1 and 6). A home beside `stagedPath` and `stagedVersion` in `src/install/binary.ts`, or a leaf module of its own, would keep both callers' dependencies pointing at the binary, not at the text.
  - F-2 · advisory · src/update/reconcile.ts:75 · `gather` is described as "what this process and the staged binary are, read from the machine", but it also deletes `WIZARDINGCODE_MEM_HANDED` from `process.env`. That is a side effect hidden inside a read, and it sits in the function a test replaces through `look` (questions 1 and 3).
  - F-3 · advisory · src/update/report.ts:133 · `firstLine` (the first line of an error message) is the same reduction as `said` in `src/update/check.ts:93` and `message.split("\n")[0]` in `src/update/reconcile.ts:62`: one small rule written three times in the diff (question 2). The name `said` still does not say what it returns (question 3).
  - F-4 · advisory · src/update/report.ts:1 · The file's header says `updateLine` and `agentsLine` are "the only places these sentences are written", but `reportOrReason` in this file (line 148, `update: not checked: …`) and `src/cli/commands/update.ts:20-21` (`unset/set WIZARDINGCODE_MEM_UPDATE … to turn it on`) also write lines for the person. The comment no longer matches the code it describes (question 10).
  
  The round 1 findings are resolved:
  - F-1 (round 1): `stagedVersion` no longer takes a `timeoutMs` parameter.
  - F-2 (round 1): `updateCheck` no longer takes a `running` parameter.
  - F-3 (round 1): `status` now gets its notice through `reportOrReason`, which says why a report could not be built.
  - F-4 (round 1): `Source` is now imported from the settings.
  - F-5 (round 1): the re-export is gone, and `share.ts` imports `ago` from `src/util/ago.ts`.
  - F-6 (round 1): the owner rule is one function, `mayRunStaged`. The `realpath` self-comparison is still written in both `stagedFacts` and `gather`; it is too small to raise again.
  
  ## Outside the change
  none
  
  ## Not answerable
  none
