# test-quality findings for 2026-11-10-001-team-server-wizardingcode-mem-serve-one
reviewer: review-test-quality
read: 2 test files this round (tests/integration/team-mirror.test.ts:600-747, tests/unit/team-db.test.ts:1-60 and :180-230), plus the code they exercise (src/team/mirror.ts:375-430 and :640-719, src/team/store.ts:634-648); 14 criteria

On the two advisories you took and the new unit test:

- **Round-4 F-2 is answered.** team-mirror.test.ts:681-683 now asserts that the kept `keep-shared` file is gone after the first failed replay, before the second purge runs. The merge proof at :688-690 now stands on a condition the test checks.
- **Round-4 F-3 is answered.** The new test at team-mirror.test.ts:714-731 goes through the purge-side branch of `noteOwed` (mirror.ts:403). If an unreadable note no longer set `REBUILD_MARK`, `mirror.rebuild` would stay null and :725 would fail. :729-730 then show that the next run rebuilds and clears the mark. The test does not prove the "replays its own folders" half of its name (see F-1 below).
- **The new unit test fails if the busy timeout is not put back.** It is at team-db.test.ts:202-212. If the `finally` restore at store.ts:646 is removed, the timeout stays at 200 and :208 fails. :206 shows the `PRAGMA busy_timeout` column really is `timeout` (5000), so the check cannot pass on `undefined`. It does not prove the other two things its name claims: that the wait is applied, or that the log is cut (see F-2 below).
- **Kept as before:** proving the note is written inside the erasure's transaction, the exact count of clock reads, the closed-handle proof, the no-wait timing, and AC-54's observed half. They appear again as F-3 to F-7.

## Findings
- F-1 · advisory · tests/integration/team-mirror.test.ts:726 · AC-49 purge over an unreadable note (Q1). The name says the purge "replays its own folders", but the only check on the folder is that `keep` is still there, and that file was there before the purge. If the `"all"` branch skipped the purge's own replay and left everything to the rebuild, :723-726 would still pass. Checking right after the purge that `gone`'s uuid is no longer in `realGit(sharedRepo(t), "log", "--all", ...)`, as :653 and :698 do, would prove the replay.
- F-2 · advisory · tests/unit/team-db.test.ts:207 · `checkpointWal` (Q1/Q6). The test proves the timeout is put back, not the other two things its name claims. Nothing shows the 200 ms wait is applied: dropping the `PRAGMA busy_timeout = ${waitMs}` line at store.ts:641 still passes. Nothing shows the log is cut either: no frames are written first and the size of `team.db-wal` is never checked, so `TRUNCATE` changed to `PASSIVE` also passes. Writing a row, then asserting the `-wal` file is 0 bytes, and reading the timeout inside the call (for example from a second connection holding a read) would prove both.
- F-3 · advisory · tests/integration/team-mirror.test.ts:639 · AC-49 purge, owed replay (carried over from round 4 F-1, not taken). The test shows the note is written before the replay's first git call, but not that it is written inside the erasure's transaction. A `setMeta` placed right after `transaction(...)` (mirror.ts:697) would also pass.
- F-4 · advisory · tests/integration/team-mirror.test.ts:551 · AC-49, "a renewal before every git call" (Q5, carried over). This is still proven by an exact count of clock reads, so an unrelated added clock read would break the test.
- F-5 · advisory · tests/unit/team-db.test.ts:109 · AC-44, "closes its handle when a module migration fails" (carried over). Reopening the file does not show that the earlier handle was closed.
- F-6 · advisory · tests/integration/team-mirror.test.ts:776 · AC-49, "no request waits on git" (carried over). The 500 ms timing is taken with an injected `mirrorChild`, before any child launches.
- F-7 · advisory · tests/unit/deploy-files.test.ts:50 · AC-54 (carried over, as ruled in round 1). The file half is asserted, but it sits under an observed criterion, so the item has no red run for it.

## Outside the change
none

## Not answerable
- Mutation (Q7) · no mutation report was named or found for this item.
- Observed AC-58 (Q3/Q4) · its proof is the named files passing on the final tree, compared with the base's whole-suite run. I did not open the gate logs that hold those runs.

Paths: /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/integration/team-mirror.test.ts, /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/unit/team-db.test.ts, /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/team/mirror.ts, /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/team/store.ts, /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/unit/deploy-files.test.ts
