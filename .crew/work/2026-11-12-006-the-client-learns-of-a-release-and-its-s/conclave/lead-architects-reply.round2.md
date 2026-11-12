# architects lead's validation of 2026-11-12-006-the-client-learns-of-a-release-and-its-s: spec
verdict: validated
## Returns
none
## Notes
- R-1 holds: spec.md:78 places the decision after the early returns and the legacy migration and imports `reconcile.ts` only for a reconciled command, matching `src/cli/main.ts:54-66` and `:68-86`; AC-20 (spec.md:114) forbids a static import of `src/update/` or `src/install/binary.ts` in `main.ts`.
- R-2 holds: spec.md:78 names one constant `RECONCILED` beside `SKIPS_LEGACY` (`status`, `doctor`, `update`, `ui` without `--auto`); spec.md:26 states what the other commands are left with; AC-16 (spec.md:110) is the table. This allow list also covers the hook-started `backup` and `history index` (`src/cli/commands/hook.ts:58`, `:160`) and `uninstall`.
- R-3 holds: spec.md:83 makes `handOver(path, argv)` the one function `binaryOrHandOver` also calls, proven by AC-18 (spec.md:112). For the build: today `install` prints its own sentence with the `--force` hint on standard output and prepends `"install"` to the arguments (`src/cli/commands/install.ts:241-245`), so `handOver` should take the line as a parameter or `install` should print its own before calling.
- R-4 holds: spec.md:55 puts the check in its own guard after the drain's `try`, with AC-13 (spec.md:107). For the build: `resolvePaths()` is inside that `try` today (`src/cli/commands/distill.ts:26`) and both exits are returns inside it (`:59`, `:65`), so the data directory must be resolved and the exit code carried outside it.
- R-5 holds: spec.md:90 names the exception in the README's "Every setting can be changed from the viewer…" sentence (`README.md:352`), with AC-21 (spec.md:115).
- R-6 holds: spec.md:48 says which files are liftable (`check.ts`, `state.ts`) and which are the product's (`report.ts`, `channels.ts`, `reconcile.ts`); AC-20 with `tests/unit/update-boundary.test.ts` (spec.md:117) is the boundary's proof.
- The round 1 notes are taken: `force: false` and `known` (spec.md:82), at most two `--version` runs (spec.md:86, :122), `mode` reading the merged value once (spec.md:53), the rule, field, default and the viewer's union member (spec.md:56), `status` printing without the store (spec.md:68, AC-14), ADR 0030 narrowing ADR 0029 (spec.md:92), "of use" in G-1 (spec.md:17).
- For the build: `off-unknown` (spec.md:53) needs the `Settings` field to keep the raw text, not a value normalised the way `onOff` does (`src/settings/settings.ts:124`), or the unknown value is lost before `mode` sees it.
- The files the tests rest on exist: `tests/preload.ts` (loaded by `bunfig.toml:2`), `tests/helpers/binary.ts`, `tests/e2e/install-forward.test.ts`, `tests/integration/install.test.ts`.
- The viewer cut stays coherent: spec.md:25 and the findings row in spec.md:94 record it, and the only user-visible gap, the README's sentence, is now closed by AC-21.

Files read this round: `/Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.crew/work/2026-11-12-006-the-client-learns-of-a-release-and-its-s/spec.md` (whole) and the section "The leads' validation, round 1" of `conclave.md` in the same folder.
