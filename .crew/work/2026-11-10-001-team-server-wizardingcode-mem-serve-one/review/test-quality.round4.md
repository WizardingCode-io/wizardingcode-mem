# test-quality findings for 2026-11-10-001-team-server-wizardingcode-mem-serve-one
reviewer: review-test-quality
read: 3 test files (tests/integration/team-mirror.test.ts in full; the carried-over lines of tests/unit/team-db.test.ts and tests/unit/deploy-files.test.ts), plus tests/helpers/team.ts (fakeTimers) and the code they exercise in src/team/mirror.ts and src/team/server.ts; 14 criteria

This round I checked the round-3 F-1 fix and the four tests commit 982ac11 added against src/team/mirror.ts:374-719 and src/team/server.ts:205-219:

- **Clock hook (team-mirror.test.ts:629-639): it proves what it claims.**
  - The hooked `now` is installed before `purgeItem`. `holdLease` and the host's `renew` take `ctx.now` as a function, so the lease take, every renewal and every `applyRevision(..., ctx.now())` read the hook.
  - The erasure uses the `now` argument, not the clock. So the first read with `purgedCount > 0` is the replay's first clock read: either `applyRevision`'s argument or the renewal before the first git call. Either way it comes before any git runs.
  - If the note were written only on failure (in `record`) or after the replay, `note` is null there and `toContain` fails. If the ordering left no read after the audit row, `find` returns undefined and the assertion still fails, so it cannot pass vacuously.
  - It does not prove the note sits inside the erasure's transaction (see F-1).
- **Second purge merges the note (:662-697): it would fail if broken.**
  - `goneA` touches only folderA, so shared reaches the second replay only through the merge in `noteOwed` (mirror.ts:403-405).
  - Without the merge, `keep-shared` is never rewritten and the `readFileSync` at :686 throws.
  - The precondition that the first failed replay left `keep-shared` absent is not asserted in this test (see F-2).
- **Unreadable note (:699-709): it would fail if broken.**
  - If `owedReplay` treated an unreadable note as null, nothing is pending, `commits` is 0 and the note stays, so :706 and :707 fail.
  - If the parse threw through, the run throws.
- **Throw outside the per-revision blocks (:711-725): it would fail if broken.**
  - Removing the `catch` push in `underMirrorLease` leaves `error` null, and :722 fails.
  - Removing the `finally` release leaves the lease held, and :723 fails.
  - Setting `REBUILD_MARK` after the `rmSync` instead of before it gives 0 pending at the next run, and :724 fails.
  - Run as root, the chmod would not stop the removal and the test would fail rather than pass falsely.
- **Hourly checkpoint only while no child runs (:785-797): it would fail if broken.**
  - The renewal interval (10 s) is registered before the hourly one. `fakeTimers` sorts stably by due time, so at 3,600,000 the renewal runs first and the checkpoint writes last.
  - Without the `mirror.child() === null` guard, the WAL is 0 at :791 and the test fails.
  - With the checkpoint moved after `mirror.hourly()`, the child exists, nothing is cut, and :797 fails.
- **The `rows` rename:** it is pinned by exact `toEqual` at :412, :469 and :608.

## Findings
- F-1 · advisory · tests/integration/team-mirror.test.ts:639 · AC-49 purge, owed replay (Q1). The hook shows the note is written before the replay's first git call, but not that it is written in the erasure's transaction. A `setMeta` placed right after `transaction(...)` (before `checkpointWal`, mirror.ts:698) would pass, and a crash between the commit and that write would lose the replay. The doc comment at mirror.ts:377 promises the transaction. A test could prove it by throwing from the transaction after the note (for example a failing `insertAudit`) and asserting that neither the erasure nor the note survives.
- F-2 · advisory · tests/integration/team-mirror.test.ts:678 · The merge test (Q1). It relies on the first failed replay having left `keep-shared` absent, but asserts this only through the note. Adding `expect(existsSync(<keep-shared file>)).toBe(false)` after the first purge would pin the precondition the merge's proof stands on, as :643 does in the previous test.
- F-3 · advisory · tests/integration/team-mirror.test.ts:705 · The unreadable-note path. It is tested only through `runMirror`. The purge-side branch, `noteOwed` setting `REBUILD_MARK` when the note is "all" (mirror.ts:402), has no test: a purge over an unreadable note followed by a run that rebuilds would cover it.
- F-4 · advisory · tests/integration/team-mirror.test.ts:551 · AC-49, "a renewal before every git call" (Q5, carried over). It is still proven by an exact count of clock reads. The count now also has to absorb any added read, so an unrelated clock read breaks it.
- F-5 · advisory · tests/unit/team-db.test.ts:109 · AC-44, "closes its handle when a module migration fails" (carried over). Reopening the file does not show that the earlier handle was closed.
- F-6 · advisory · tests/integration/team-mirror.test.ts:776 · AC-49, "no request waits on git" (carried over). The 500 ms timing is taken with an injected `mirrorChild`, before any child launches.
- F-7 · advisory · tests/unit/deploy-files.test.ts:50 · AC-54 (carried over, as ruled in round 1). The file half is asserted here, but it sits under an observed criterion, so the item records no red run for it.

## Outside the change
none

## Not answerable
- Mutation (Q7) · no mutation report was named or found for this item.
- Observed AC-58 (Q3/Q4) · its proof is the named files passing on the final tree, compared with the base's whole-suite run. I did not open the gate logs that hold those runs.

Paths: /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/integration/team-mirror.test.ts, /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/team/mirror.ts, /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/team/server.ts, /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/helpers/team.ts, /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/unit/team-db.test.ts, /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/unit/deploy-files.test.ts
