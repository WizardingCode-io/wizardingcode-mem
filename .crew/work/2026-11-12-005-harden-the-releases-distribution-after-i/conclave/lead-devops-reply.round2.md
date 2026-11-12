# devops lead's validation of 2026-11-12-005-harden-the-releases-distribution-after-i: spec
verdict: validated
## Returns
none
## Notes
- R-1 is answered. J-4 (spec.md:37) and AC-13 (spec.md:94) now say what a second run does at each target, and it matches the code: npm `already published` (scripts/release/lib.ts:137), tap and marketplace `already at <version>` (scripts/release/lib.ts:143), `latest` retagged and `latest: moved to <version>` again (.github/workflows/distribute.yml:199-209). The exception after a hand revert agrees with docs/runbooks/release.md:79 and :81.
- Design 3 (spec.md:70) ties the new paragraph to "Repeating a target" (docs/runbooks/release.md:62), so the one-waiting-run rule of the concurrency group (.github/workflows/distribute.yml:34-36) is not contradicted.
- The round 1 notes are taken: "cut (cancelled or failed)", look again after a minute, and either way of starting the second run are in spec.md:37; the run's name `distribute <tag>` is cited and matches .github/workflows/distribute.yml:31.
- The mask line is now pinned where it has to be: `process.stdout.write`, never `summary()`, before `need("VERSION")` (spec.md:49), with AC-10 covering the unset-`VERSION` case and the summary file (spec.md:90). The `tap` and `marketplace` steps run the script directly (.github/workflows/distribute.yml:141, :168), so nothing can precede it.
- Rollout and rollback are complete (spec.md:107): runs dispatched before the merge keep their commit, changes 1 and 2 revert on `main`, and change 3's revert reaches later tags only, with J-4's hand start for a tag already cut.
- AC-6 and AC-13 have named test files (spec.md:100). `tests/unit/deploy-files.test.ts:197-205` already holds the `distribute` job's shape, so the timeout assertion belongs beside it.
- For the build: the runbook paragraph should read the minutes as AC-13 says ("the minutes `release.yml` sets"), so the test compares the document to the workflow instead of to a literal 5.
- Still seen only in a real run, and stated as such in Risks: whether five minutes is enough for the dispatch, whether a timed-out job shows as cancelled or failed, and whether the runner honours the mask line.
- Files read are in /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab; I ran nothing.
