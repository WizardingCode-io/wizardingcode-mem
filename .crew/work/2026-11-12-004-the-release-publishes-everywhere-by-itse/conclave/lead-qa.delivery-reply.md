# qa lead's validation of 2026-11-12-004-the-release-publishes-everywhere-by-itse: delivery
verdict: validated
## Returns
none
## Notes
- R-1 is answered by a lint run of the item's files by name. `probes/lint-by-name.md:8-9` shows `biome check` over the 21 files that `biome.json` covers: "Checked 21 files in 41ms. No fixes applied." Lines 15-16 show `src scripts tests npm` at error level: "Checked 500 files", no error. The run is on commit bd45b41, the last commit that changed a linted file; 1d69563 after it changed documents only.
- That lint proof is a session-made transcript, not an engine log, and I could not re-run it. The engine's own lint row is still wrong: `report.md:66` says "pass" while `logs/lint-_-1794501938381.txt:2` and `:14` show "Checked 0 files" and exit code 1. I accept this because the session cannot edit that row and the limit is on record at `docs/real-use/findings.md:64`. The pull request's `bun run check` in CI, outside the crew worktree, is the lint run that counts; a red lint there reopens this validation.
- The test gate passed on the new tree: `logs/test-_-1794501723289.txt:78-82` shows 3392 pass, 4 skip, 0 fail across 216 files. That is two more tests than round 1, and the skips are the same platform and full-pack conditions.
- The report and the round 4 review are on one fingerprint, `sha256:86f7ad96…` (`report.md:323`, `review/inputs.json:40`). Test-quality is ruled proven with two advisories and no defect (`report.md:76`, `:86-87`).
- The two code changes since round 1 each have a test that states the behaviour:
  - A push refused by a ruleset (GH013) gets the rule sentence and is not retried: `tests/integration/release-push.test.ts:189-206`, a `test.each` over GH006 and GH013 against a real pre-receive hook, for `scripts/release/push.ts:127`.
  - On a runner the overrides `PUSH_REMOTE` and `PUSH_ORIGIN` are ignored: `tests/integration/release-commands.test.ts:476-492` sets `GITHUB_ACTIONS=true` and asserts git was asked for `https://github.com/o/r.git` and never for the override path, for `scripts/release/push.ts:215-221`.
- AC-72 now shows its red and its green each recorded twice, "the latest decides" (`report.md:50`), which matches the round 4 change to the push tests.
- Two advisories from round 4 are open and neither blocks:
  - `tests/unit/release-lib.test.ts:486`: the only `previous: null` case also passes `atPrevious: "missing"`, so the `previous === null` branch of `decideHold` is not the one under test.
  - `tests/unit/deploy-files.test.ts:281`: the `step()` helper leaves its temporary folders behind.
- Three advisories from earlier rounds stay deferred at `docs/real-use/findings.md:68`, per the reviewer's note at `review/test-quality.findings.md:32`: the hand-typed outcome list in `tests/unit/release-docs.test.ts`, the flag matched anywhere in a command's module, and no outcome test for `v99.0.0` on a branch.
- My round 1 note on AC-78's partial red stands as given: three of its five claims were never seen failing, and one red went green by loosening the test.
- Rounds now read "judgement 4 of 2, validation 3 of 2" (`report.md:136`), over the planned count. That is for the session to account for to the author.

All paths above are relative to `/Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/`; `probes/`, `logs/`, `review/` and `report.md` are under `.crew/work/2026-11-12-004-the-release-publishes-everywhere-by-itse/` there.
