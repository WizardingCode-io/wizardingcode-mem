# data findings for 2026-11-10-001-team-server-wizardingcode-mem-serve-one
reviewer: review-data
read: 8 files (src/team/store.ts, src/team/server.ts, src/team/mirror.ts, src/team/feed.ts, docs/adr/0026-team-server.md, tests/unit/team-db.test.ts, review/data.round4.md, the rubric). Schema and migrations read: 0001_team_init.sql and the team opens in src/team/db.ts, from earlier rounds and unchanged since round 4; the core runner's busy_timeout in src/store/db.ts. Risk areas: data-migration, personal-data.

## Findings
- F-1 · advisory · tests/unit/team-db.test.ts:202 · The test proves that `checkpointWal(db, 200)` puts the busy timeout back only when no reader holds the log. Two cases are not exercised: a held reader, where the call should return `false` within about the 200 ms wait with the timeout put back, and a throw inside the `try`, where the `finally` should restore the timeout. These are the two paths the round-4 advisories were about. The code at src/team/store.ts:640-647 handles both correctly, but no test pins them (rubric question 6, availability).

## Outside the change
none

## Not answerable
- Availability (rubric question 6): whether an upgrade migration of `team.db` holds the write lock across a long step · only migration 1 exists, and it creates a new file.

## Round 4
- F-1, advisory (the hourly checkpoint stalls every request for up to 5 s): answered.
  - src/team/server.ts:44 sets `CHECKPOINT_WAIT_MS = 200`, and server.ts:223 passes it to `checkpointWal`.
  - store.ts:640-647 reads `PRAGMA busy_timeout`, sets the wait, runs `wal_checkpoint(TRUNCATE)` and restores the earlier value in a `finally`. TRUNCATE uses the busy handler while it waits for the writer lock and for readers, so the 200 ms is a real bound on the stall.
  - ADR 0026:78 now says the hourly checkpoint "would hold every request while it waits", gives the 200 ms bound, the `wal-checkpoint busy` log line and that a failure is never fatal.
- F-2, advisory (an unguarded hourly checkpoint could end the process): answered. server.ts:222-228 wraps the call in try/catch: a `false` result logs `{level: "warn", event: "wal-checkpoint", busy: true}` and a throw goes to `log.error("team.checkpoint", …)`. `mirror.hourly()` at server.ts:230 sits outside the try, so it runs on every tick either way.
- Is setting and restoring the timeout around the checkpoint sound on the shared connection? Yes.
  - No other statement can run in between: bun:sqlite is synchronous and the timer callback runs to completion on the one JS thread. Nothing between the set (store.ts:641) and the restore (store.ts:646) awaits, so no request handler or held-pull reread can use the connection with the 200 ms value.
  - No read snapshot is left open across a tick: the held-pull loop (feed.ts:204-209) awaits only between complete synchronous reads (`hasChanges`, `pull`), so a tick never finds a read transaction from its own process open.
  - The restore runs on both the return and the throw path. `before` comes from the pragma's `timeout` column, so it is the value `openTeamDb` set and not a default.
  - One theoretical gap: if the restoring `PRAGMA busy_timeout = …` itself threw, the connection would keep 200 ms, and the outer catch would log it. That pragma touches no file, so this is not a realistic failure.
  - Without `waitMs` (the purge's two calls at mirror.ts:698 and :717) nothing changes, and the operator's process keeps its 5 s wait as the ADR states.
- The other fourth-round changes:
  - The pending key with no row (mirror.ts:369) now throws inside the generator. The throw reaches `underMirrorLease`'s catch (mirror.ts:434-443), which records it as `(run)` in `mirror.last` and releases the lease, so the fault is visible instead of skipped. Nothing deletes a revision under the mirror lease, so this marks a real inconsistency.
  - `pendingRevisionsAfter` (store.ts:592) is one keyed batch of `REVISION_BATCH`. The generator moves `after` forward per key, so a skipped or failed uuid never repeats a batch.
  - The purge's transaction (mirror.ts:681-696) returns the counts and the folders owed, so the replay at :699 works from exactly the union written in the same atomic step.

Paths: /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/team/store.ts, /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/team/server.ts, /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/team/mirror.ts, /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/team/feed.ts, /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/docs/adr/0026-team-server.md, /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/unit/team-db.test.ts
