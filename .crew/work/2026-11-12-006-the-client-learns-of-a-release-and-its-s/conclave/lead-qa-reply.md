# qa lead's validation of 2026-11-12-006-the-client-learns-of-a-release-and-its-s: spec
verdict: validated
## Returns
none
## Notes
- Round 2's R-1 holds: `reconciles(name, rest)` and `RECONCILED` are in the leaf `src/cli/reconciled.ts` (spec.md:78), and `tests/unit/update-reconcile.test.ts` has its two tables, `reconciles` over every command plus `ui --auto`, and `decide` (spec.md:117). AC-16's command half now has a unit test that fails if a command joins the list by mistake.
- `due` reads a time in the future, `attemptAt` included, before the 60-second rule (spec.md:52), and `update` ignores the last check's age and a fresh `attemptAt` (spec.md:69). Both are consistent with AC-11 and AC-15 and testable with an injected `now`.
- "Every command of the CLI" in the `reconciles` table: the `COMMANDS` map stays in `src/cli/main.ts:11-32`, which a test cannot import, so a hand-written list in the test would miss a command added later. Have the test take the names from the source text of `main.ts` (the keys of `COMMANDS`), or assert its own list against them, so a new command must be classified.
- Still advisory from round 2, for the plan's briefs:
  - the in-process tests of `distill` and `update` restore `process.env` in `afterEach`;
  - `tests/e2e/install-forward.test.ts` stays unchanged as the proof that `install` hands over through the shared function;
  - the e2e adds `--version` with an older staged file (file unchanged, standard error empty) and the staging that fails;
  - one hanging staged script with a short limit goes beside the cases at `tests/integration/install.test.ts:425-431`.
- Every criterion AC-10 to AC-21 names a test file at the right level, and the compiled-binary harness exists (`tests/helpers/binary.ts`). Nothing in the Design is left untestable, except the sentence at spec.md:80 that `WIZARDINGCODE_MEM_HANDED` is removed from the environment given to the handed-over command's children, which no criterion covers.

Files re-read for this round: `/Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.crew/work/2026-11-12-006-the-client-learns-of-a-release-and-its-s/spec.md` (lines 52, 54, 69 and 76-117) and the section "The leads' validation, round 2" of `conclave.md` in the same folder.
