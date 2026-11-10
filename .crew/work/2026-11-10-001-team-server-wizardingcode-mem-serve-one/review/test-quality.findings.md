# test-quality findings for 2026-11-10-001-team-server-wizardingcode-mem-serve-one
reviewer: review-test-quality
read: 4 test files this round (tests/unit/knowledge-git-host.test.ts read whole, plus the round-5 cited lines in tests/integration/team-mirror.test.ts:545-780, tests/unit/team-db.test.ts:100-212 and tests/unit/deploy-files.test.ts:40-59), 14 criteria

The round-5 state still holds. Two checks:

- **The formatting change is only formatting.** The file tests/unit/knowledge-git-host.test.ts (103 lines) is the same as its hunk in diff.patch (lines 11704-11812 of the patch). The two wrapped calls are the `thrown(() => runGit(...))` at :47-49 and the `commitPaths(...)` at :90-98. Their arguments are unchanged. Every `expect` in the file still checks the same thing: the author and committer environment, the ceiling root, the host timeout against the per-call timeout, the order of the extra `-c` options, the fail-path message, and the committer recorded in `git log`. I did not run git, so I could not compare against the file before the format commit (208d5de). That conclusion rests on the diff and the current file only.
- **Every round-5 citation still points at the same line.** team-mirror.test.ts :551, :639, :726 and :776, team-db.test.ts :109 and :207, and deploy-files.test.ts :50 all sit where round 5 put them. None of the seven advisories was addressed, which matches their deferral in docs/real-use/findings.md. They are carried over unchanged below.

## Findings
- F-1 · advisory · tests/integration/team-mirror.test.ts:726 · AC-49, a purge over a note it cannot read (Q1). The test's name says the purge replays its own folders, but the only check is that `keep` is still there, and it was there before the purge. If the purge skipped its own replay, the test would still pass. Asserting that `gone`'s uuid is gone from `realGit(sharedRepo(t), "log", "--all", ...)`, as :653 and :698 do, would prove the replay.
- F-2 · advisory · tests/unit/team-db.test.ts:207 · `checkpointWal` (Q1/Q6). The test proves the busy timeout is put back, but not that the 200 ms wait is applied or that the log is cut. Dropping `PRAGMA busy_timeout = ${waitMs}`, or changing `TRUNCATE` to `PASSIVE`, would still pass.
- F-3 · advisory · tests/integration/team-mirror.test.ts:639 · AC-49, the owed replay of a purge. The test shows the note is written before the first git call, not inside the erasure's transaction. A `setMeta` placed right after `transaction(...)` would also pass.
- F-4 · advisory · tests/integration/team-mirror.test.ts:551 · AC-49, a lease renewal before every git call (Q5). This is proven by an exact count of clock reads, so an unrelated extra clock read would break the test.
- F-5 · advisory · tests/unit/team-db.test.ts:109 · AC-44, the handle is closed when a module migration fails. Opening the file again (:111-118) does not show that the earlier handle was closed.
- F-6 · advisory · tests/integration/team-mirror.test.ts:776 · AC-49, no request waits on git. The 500 ms timing is taken with an injected `mirrorChild`, before any real child starts.
- F-7 · advisory · tests/unit/deploy-files.test.ts:50 · AC-54. The test asserts the Dockerfile's contents, but AC-54 is an observed criterion, so the item has no red run for this part (as ruled in round 1).

## Outside the change
none

## Not answerable
- Mutation (Q7) · no mutation report was named or found for this item.
- Observed AC-58 (Q3/Q4) · its proof is the named files passing on the final tree, compared with the base's whole-suite run. I did not open the gate logs that hold those runs.

Paths: /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/unit/knowledge-git-host.test.ts, /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/integration/team-mirror.test.ts, /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/unit/team-db.test.ts, /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/unit/deploy-files.test.ts, /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.crew/work/2026-11-10-001-team-server-wizardingcode-mem-serve-one/review/diff.patch
