

## Clarifications
- # architecture findings for 2026-11-12-006-the-client-learns-of-a-release-and-its-s
  reviewer: review-architecture
  read: the rubric; CLAUDE.md (where things are, the engine with modules, the ADR 0010 settings, the hook-path conventions); ADR 0029 and ADR 0030; the spec (Design §1–4, AC-27, AC-32). Round 3 `review/diff.patch` (36 files): I re-read every source hunk that changed (`src/cli/commands/status.ts`, `src/update/check.ts`, the new `src/update/reason.ts` and `src/update/staged.ts`, `src/update/reconcile.ts`, `src/update/report.ts`) and kept round 2's reading of the unchanged hunks. I also searched `src/` for an existing error-line helper and found none besides the new one.
  
  ## Findings
  none
  
  Round 2's one advisory is resolved:
  - **The staged-file rule is a leaf.** `src/update/staged.ts` holds `StagedFacts`, `whoAmI`, `mayRunStaged`, `binOwner` and `stagedFacts`, and imports only `node:fs`, `node:path` and `../install/binary.ts`.
  - **The hand-over no longer loads the report.** `reconcile.ts` imports `staged.ts` and `reason.ts` but not `report.ts`, so it loads no settings, state or channels code.
  
  The new pieces stay where the base puts them:
  - **`src/update/reason.ts`** imports nothing. Nothing in `src/util/` duplicates it, and it is used only inside the folder (`check.ts`, `reconcile.ts`, `report.ts`).
  - **The test parameters** (`stagedFacts(dataDir, running, who = whoAmI())` and `status`'s `run(argv, build = …)`) default to the real behaviour. Their tests inject them in-process, the seam the Design names for `distill` and `update`, and they add no address or setting read from the environment.
  
  AC-27 still holds: nothing in `src/update/` imports from store, modules, engine, sync, status or doctor; `main.ts` loads `reconcile.ts` only through `await import()`; `reconciled.ts` imports nothing. The status layer imports only the `UpdateReport` type, and `update.json` stays in the data directory, outside the store.
  
  ## Outside the change
  none
  
  ## Not answerable
  none
