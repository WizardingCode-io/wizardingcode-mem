# qa lead's validation of 2026-11-12-008-the-viewer-tells-of-a-newer-release-sett: spec
verdict: validated
## Returns
none
## Notes
- R-1 is closed. spec.md:18 now states the fact (`src/update/report.ts:10` imports `mode` from `check.ts`) and moves `mode`/`Mode` to a leaf `src/update/mode.ts`. AC-10 (spec.md:43) covers every file of `src/ui/` through static and dynamic imports at any depth, held by a named new test in `tests/unit/update-boundary.test.ts`. The criterion is attainable on the tree: the only importers of `update/check.ts` are `src/update/report.ts:10`, `src/cli/commands/update.ts:5` and `src/cli/commands/distill.ts:31`, and no file of `src/ui/` imports from `src/cli/`.
- One thing for the plan: spec.md:18 lists `report.ts`, `check.ts` and `src/cli/commands/update.ts` as the importers of the new leaf, but `src/cli/commands/distill.ts:31` also takes `mode` from `check.ts` by a dynamic import. With "`check.ts` keeps no export of them" that line must change too. The typecheck in `bun run check` will catch it, so this is not a return; the task brief should name the file.
- R-2 is closed. AC-10 says what is counted (requests to any host but the viewer's own loopback address, by a wrapped `fetch`), in which state (a check due: no `update.json`, an env with neither `WIZARDINGCODE_MEM_UPDATE` nor `CI`, so the mode is `check` per `src/update/check.ts:80-84`), and for both routes.
- R-3 is closed. AC-8 (spec.md:41) adds `off-unknown`, `ci` and the builder that throws, with its expected answer fixed at spec.md:16 (200, the shape, `not checked: <first line>`, `out` and `banner` false, `mode` `check`, nulls, no commands). The seam on `viewerUpdate` in `src/ui/update.ts` makes that case testable without corrupting files, as `reportOrReason` does for `status` (`src/update/report.ts:82-92`). AC-11 (spec.md:44) lists the eleven states, and spec.md:25 gives a tone to each.
- The earlier notes were taken up:
  - spec.md:39 binds the tests to `startUi`'s `env` and `now` (`src/ui/server.ts:113,118`).
  - AC-8 states the staged case's limits (skipped on Windows, not run as root).
  - AC-9 adds the `meta` assertion and the ignored body.
  - AC-13 names both README places (`README.md:361`, `README.md:405`) and keeps the other remark of `docs/real-use/findings.md:81`.
  - The screens gain `settings-about:off-env` (spec.md:30, `work.json:48`).
- spec.md:49 says openly what no test or capture holds: the clicks of `How to update`, `Dismiss` and the copy buttons. I accept that as stated; this project has no component test harness, and the routes behind the buttons are under AC-9 and AC-12. The test-quality gate should check that the delivery report repeats it as left unproven, not as covered.
- AC-14 now says "the tests `tests/unit/update-boundary.test.ts` holds today", which is consistent with that file gaining AC-10's test.
- D-1 and D-2 are unchanged and followed (spec.md:11-12, 35).

Files read for this round, under `/Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab`: `.crew/work/2026-11-12-008-the-viewer-tells-of-a-newer-release-sett/spec.md`, `work.json` in the same folder, `src/update/check.ts`, `src/update/report.ts`, `src/cli/commands/update.ts`, `src/cli/commands/distill.ts`, `src/cli/main.ts`, and the import lines of `src/ui/*.ts`.
