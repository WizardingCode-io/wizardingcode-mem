# qa lead's validation of 2026-11-12-007-three-tests-fail-intermittently-on-the-m: delivery
verdict: validated
## Returns
none
## Notes
- I validated on the files and logs; I ran nothing. The gates QA owns passed on the report's fingerprint (report.md:177):
  - `bun run test` passed (report.md:49). Its log .crew/work/2026-11-12-007-three-tests-fail-intermittently-on-the-m/logs/test-_-1794517535788.txt:78-82 reads 3403 pass, 4 skip, 0 fail, 3407 tests across 218 files.
  - Build, lint and typecheck passed (report.md:48-51).
  - The test-quality judgement gate is proven, with two advisories (report.md:58, :62-63).
- Every criterion has its red and green recorded (report.md:33-40); AC-11 is 105 → 105 (report.md:38). Each has a named test as committed:
  - AC-6: tests/unit/knowledge-maintenance.test.ts:45-61, through `commitsEachMaintained` (tests/helpers/stub-git.ts:120-130), which gives null for a trace with no commit, an unpaired commit, or any `--detach`.
  - AC-7: tests/integration/team-mirror-maintenance.test.ts:57-74.
  - AC-8: knowledge-maintenance.test.ts:65-100, with the stall on one subcommand I asked for (`stallOn`, stub-git.ts:22-23, :67-70).
  - AC-9: knowledge-maintenance.test.ts:191-195 (stub-git.ts:139).
  - AC-10: knowledge-maintenance.test.ts:197-229.
  - AC-12: knowledge-maintenance.test.ts:102-128 for the store; team-mirror-maintenance.test.ts:76-127 for the mirror.
  - AC-13: knowledge-maintenance.test.ts:160-188.
- The code matches the spec: the three settings in `configArgs` (src/modules/knowledge/repo.ts:437-439) and the runner's call after the commit (repo.ts:975). The trace seam is the stub's (stub-git.ts:86); `gitEnv` is not widened.
- The four things I asked for at the spec are there:
  - CLAUDE.md line 18 now has the new sentence after "…as its hooks path, and no template.", and knowledge-maintenance.test.ts:209-211 holds that junction.
  - The mirror test shows the next run commits one revision, with no error and a clean tree (team-mirror-maintenance.test.ts:121-126), and that no git ran after the theft (:111-112).
  - The runner's runs are cited by number (probes/runner-removal.md:68-72): 43303693995 and 43305613360 failed on the item's own compaction test, and 43306754559 at `421df55` passed on both runners.
  - "A run with no git call left ends" is in the spec's Risks (spec.md:54) and in docs/real-use/findings.md:73.
- AC-13's change is sound: spec.md:42 now names `maintenance.geometric-repack.auto=1`, the test passes it (knowledge-maintenance.test.ts:175-178), and the reason is recorded (runner-removal.md:74). The remaining weakness is on record in docs/real-use/findings.md:74: under a whole revert its red is a race; it fails every time with the runner's call alone removed.
- What is left, stated plainly in the delivery itself: one green run does not show an intermittent failure gone (runner-removal.md:76; spec.md:60). The item's claim is the cause closed, not the flake proven absent. The later runs of `check (macos-latest)` are the evidence, and a recurrence of one of the three tests should reopen this item, not be retried.
- The engine's report lags the spec in four places. I do not return it, since the tests prove the spec's wording and the engine's criterion text is not amended in place, but the author should not read these lines as the final state:
  - report.md:39 has AC-12's earlier text ("the run stops with its lost-lease error, as at any other git call"); spec.md:41 has the rule as built.
  - report.md:40 has AC-13 without the second threshold.
  - report.md:125 records D-1 as "inside the commit". The mechanism changed to a call after the commit (spec.md:12, :19), and conclave.md:15 promises the author is told of it in the delivery. That telling is still owed.
  - report.md:174 keeps O-1 in its first-draft wording ("would report a failure for a commit that landed"), which the design no longer allows (AC-8). The live risk is the one at spec.md:51 and docs/real-use/findings.md:72.
- Deferred and on record: the latency test and the 2,000-entry budget on the macOS runner are another cause (docs/real-use/findings.md:75; spec.md:69). They can still fail the same required check.

Files read:
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.crew/work/2026-11-12-007-three-tests-fail-intermittently-on-the-m/report.md
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.crew/work/2026-11-12-007-three-tests-fail-intermittently-on-the-m/spec.md
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.crew/work/2026-11-12-007-three-tests-fail-intermittently-on-the-m/probes/runner-removal.md
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.crew/work/2026-11-12-007-three-tests-fail-intermittently-on-the-m/logs/test-_-1794517535788.txt
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/modules/knowledge/repo.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/helpers/stub-git.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/unit/knowledge-maintenance.test.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/integration/team-mirror-maintenance.test.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/CLAUDE.md
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/docs/real-use/findings.md
