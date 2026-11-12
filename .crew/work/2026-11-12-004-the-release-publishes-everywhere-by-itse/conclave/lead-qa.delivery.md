# qa lead's validation of 2026-11-12-004-the-release-publishes-everywhere-by-itse: delivery
verdict: returned
## Returns
- R-1 · .crew/work/2026-11-12-004-the-release-publishes-everywhere-by-itse/report.md:66 · The lint gate is recorded as "pass: 1 untouched file with problems, none of the item's", but its log shows that no file was linted. `logs/lint-_-1794501151252.txt:2` reads "Checked 0 files in 4ms", line 5 reads "No files were processed in the specified paths", and line 14 reads `error: script "lint" exited with code 1`. Biome ignores `.` inside `.crew/worktrees/`, so none of the 39 files in `review/files.txt` has a lint run behind it. What must change: run Biome over the item's files by naming the folders (for example `./node_modules/.bin/biome check scripts src tests npm plugins`, as far as `biome.json` covers them) on the tree of fingerprint `sha256:f84f2d0d…`, and record that run as the lint proof. If it reports a problem in one of the item's files, fix it and re-run the gates and the review on the new fingerprint.

## Notes
- The test gate passed on the reviewed tree. `logs/test-_-1794500938602.txt:78-82` shows 3390 pass, 4 skip, 0 fail across 216 files. The "error: connection reset" at line 35 is the fixture of `tests/integration/embed-download.test.ts:61`, not a failure.
- None of the 4 skips hides one of this item's criteria. On darwin the only `skipIf` conditions that are true are the full-pack search (`tests/golden/search.test.ts:199`) and `tests/integration/plugin-script.test.ts:238`, which skips because the version is not a pre-release. That property is in the version-order table that AC-57 runs.
- The report, the review inputs and the round 3 ruling are on one fingerprint (`report.md:313`, `review/inputs.json:40`). Test-quality is ruled proven with five advisories and no defect (`review/ruling.json`).
- Every behavior criterion has a red log and a green log under `logs/` (`tdd-AC-57` to `tdd-AC-73` and `tdd-AC-78`).
- I read the tests for these criteria and they assert what the criteria say:
  - AC-57 and AC-58: `tests/unit/version-order.test.ts:12-40` and `:53-66`. The generated copies are held to the generator by `tests/integration/plugin-script.test.ts:97-101`.
  - AC-64: `tests/unit/release-lib.test.ts:208-295`, including the Claude-higher case and the Claude `ref` case that the round 1 review asked for.
  - AC-65: `tests/unit/release-lib.test.ts:339-439`, with the merged-only tag listing held at `tests/integration/release-commands.test.ts:97`.
  - AC-69 to AC-71: `tests/unit/deploy-files.test.ts:166-370`. The `latest` first step is now run as a script with job results (`:280-300`), which closes the round 1 advisory.
  - AC-72: `tests/integration/release-push.test.ts:91-253`. The annotated-tag refusal on an existing tag is at `:181-185` and the non-empty `ls-remote` guard at `:251`, both asked for in earlier rounds.
  - AC-73: `tests/integration/release-commands.test.ts:162-193`.
  - AC-59 to AC-62: I only confirmed these tests exist, by a search for their names (`tests/integration/npm-shim.test.ts:110-130`, `tests/integration/install.test.ts:416-440`, `tests/e2e/install-forward.test.ts:66-80`, `tests/integration/install-script.test.ts:125-162`).
- AC-78's red is partial. `logs/tdd-AC-78-red-1794500824205.txt:39-40` shows 3 pass, 2 fail: the citation, CLAUDE.md-names and command tests were never seen failing, because the documents already existed. One of the two reds went green by loosening the test: the red log shows `toBeGreaterThan(3)` at line 61, and the file now has `toBeGreaterThanOrEqual(3)` at `tests/unit/release-docs.test.ts:61`. I accept it because the test fails if the documents are reverted, as the test-quality ruling says, but the record should not read as five claims seen red.
- Three advisories stay open and I would close them in a follow-up; none blocks:
  - `tests/unit/release-docs.test.ts:68`: the list of summary lines is typed by hand, not derived from `OUTCOMES`.
  - `tests/unit/release-docs.test.ts:49`: `module.includes(flag)` matches a flag anywhere in the command's source.
  - `tests/unit/release-lib.test.ts:438`: the test uses `v99`, not the `v99.0.0` branch-tag case AC-65 names.
- AC-74 and AC-76 are observed and I did not read the two documents. The ruling cites `docs/adr/0029-release-distribution.md:3, 21, 31-35, 57-59` for AC-76.
- Rounds stand at "judgement 3 of 2, validation 3 of 2" (`report.md:145`), over the planned count. That is for the session to account for, not a return.
- No mutation report exists for this item; the test-quality reviewer could not answer Q7 in any round.

All paths above are relative to `/Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/`; `logs/` and `review/` are under `.crew/work/2026-11-12-004-the-release-publishes-everywhere-by-itse/` there.
