# qa lead's validation of 2026-11-12-004-the-release-publishes-everywhere-by-itse: spec
verdict: validated
## Returns
none
## Notes
- The `sha` output is provable. spec.md:105 names it among `plan`'s outputs, and AC-36 (spec.md:226) has the accepted tag give "the version, the tag's commit and whether it is a pre-release". The plan's decision is still a pure function, so a unit test covers it.
- The `npm` checkout is provable from the workflow file. spec.md:136 has the job check out `plan`'s `sha`, never the tag by name. AC-37 (spec.md:231) pins it: `npm`'s checkout takes its `ref` from the `sha` output and no checkout takes `inputs.tag`. The YAML parse already used in `tests/unit/deploy-files.test.ts:146` can read that.
- The refusal in `push.ts` is provable. spec.md:151 has it refuse before any write when the tag no longer names the commit, and AC-38 (spec.md:235) adds that case to the run against a local bare repository.
- J-4 (spec.md:59) now quotes `latest: held: v0.10.0 accepts contract 4 and up; v0.9.0 speaks 3`, the text of the summary table that AC-35 binds. My round 2 note is answered.
- My round 1 returns R-1 to R-7 still hold after the renumbering: AC-36 keeps every refusal case of the old AC-25, AC-38 keeps every case of the old AC-34, and AC-26, AC-27, AC-31 and AC-35 are unchanged.
- For the plan, not returns:
  - For AC-38's new case to run offline, `push.ts` must take the repository it asks with `git ls-remote` as an input, so a local repository can stand in for "this repository".
  - An annotated tag answers `git ls-remote` with the tag object's id and a peeled `^{}` line. The comparison should use the peeled commit, and the test should include an annotated tag.
  - I would prefer "before any write" to be asserted as the remote being unchanged and no commit made in the clone.
  - Still open from earlier rounds: `tests/unit/deploy-files.test.ts:165-167` asserts the `latest` line AC-29 removes; AC-21 needs the compiled binary from `tests/helpers/binary.ts`; "a second refusal exits 1" (spec.md:148) is not in AC-38.
- Files read this round: `/Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.crew/work/2026-11-12-004-the-release-publishes-everywhere-by-itse/spec.md` and `conclave.md` (lines 51-53) in the same folder.
