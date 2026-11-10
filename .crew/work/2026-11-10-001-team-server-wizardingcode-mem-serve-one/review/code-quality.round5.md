# code-quality findings for 2026-11-10-001-team-server-wizardingcode-mem-serve-one
reviewer: review-code-quality
read: 5 files, 6 hunks

## Round 4 advisories, checked against the current code
- Round 4 F-1 (`mirror` and `purge` async for nothing) · answered. src/cli/commands/serve.ts:475 and :491 now return `number`, like `instanceRenew` at :516. The dispatcher at :597 and :599 returns them without `await`. Only `health` (:534, which does `fetch`) is still async, and `run` still awaits it at :604.
- Round 4 F-2 (a pending key without its row was skipped silently) · answered. src/team/mirror.ts:369 throws `pending <uuid>@<revision> has no row`. The comment at :368 says why the case is a fault.
- Round 4 F-3 (the generator's batch loop and the always-same `limit`) · partly answered. `pendingRevisionsAfter(db, seq)` at src/team/store.ts:592 takes no limit and uses `REVISION_BATCH` inside, as `forEachRevision` does, so the Q4 half is gone. The Q2 half, the repeated seq-keyed batch loop, is still there (F-2 below; boilerplate, advisory).
- Round 4 F-4 (outer mutable `touched` and `owed`) · answered. src/team/mirror.ts:681-696 builds `touched` inside the transaction and returns `{ counts, owed }`. No outer `let` is left.

## Findings
- F-1 · advisory · src/team/store.ts:640 · `checkpointWal` always reads `PRAGMA busy_timeout`, even when `waitMs` is undefined. Both mirror.ts callers (:698, :717) leave it undefined, so for them the read does nothing and only the server's caller (server.ts:223) uses `before`; reading it inside the `waitMs !== undefined` branch would keep the work tied to the case that needs it (Q5).
- F-2 · advisory · src/team/mirror.ts:360 · The generator `pendingRevisions` still repeats the seq-keyed batch loop of `forEachRevision` (src/team/store.ts:617-631): read after `after`, stop on an empty batch, move `after` forward. This is round 4 F-3's remaining half, and it is boilerplate rather than logic (Q2).

## Outside the change
none

## Not answerable
- Q2/Q8 across the 21 test and helper files and the deploy files · This round did not reread them hunk by hunk. A search of the diff's added lines for `console.log`, `console.debug`, `debugger`, `TODO`, `FIXME` and `XXX` found nothing. A search for narrating phrases and fallback phrases ("now uses", "updated to", "as requested", "changed from", "fallback", "workaround") found only `integer(..., fallback)` at diff line 1980 and `slugOf(text, fallback)` at diff line 3061. Both are default values, not hidden second paths.
- Q8 (unused exports across src/team/store.ts) · The roughly 80 exports were not each traced to a caller. The ones this round touched (`pendingRevisionsAfter`, `explainPendingMirror`, `checkpointWal`, `REVISION_BATCH`, `PendingKey`) all have callers.
- Q11 (prose against references/writing.md) · writing.md was not given. Only the ADR's purge and checkpoint paragraph (/Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/docs/adr/0026-team-server.md:78) was read against the code. It matches the code: the 5 s purge wait, "bounded, and on the operator's command", the hourly checkpoint's 200 ms wait (`CHECKPOINT_WAIT_MS`, server.ts:44), the `wal-checkpoint busy` log line (server.ts:224), and "a failure of it is logged, never fatal" (server.ts:226-228).
