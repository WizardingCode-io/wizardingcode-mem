# architecture findings for 2026-11-10-001-team-server-wizardingcode-mem-serve-one
reviewer: review-architecture
read: the rubric; review/architecture.round4.md; review/files.txt (63 paths, 34 source files); docs/adr/0026-team-server.md:50-78 ("The data model", "The mirror", "Purge"); src/team/store.ts:530-660 (revisionAt, PendingKey, PENDING_SQL, pendingRevisionsAfter, forEachRevision, checkpointWal); src/team/server.ts:1-44 and 190-250 (imports, CHECKPOINT_WAIT_MS, the hourly tick); src/team/mirror.ts:5-50, 360-372, 476-484, 547-555, 596-719 (imports, the pending fetch, eraseEntry/eraseMemory, purgeItem); the import lines of src/team/types.ts; tests/unit/team-store-boundary.test.ts in full

Round 4 advisories, now:
- F-1 is answered. ADR 0026's data model (docs/adr/0026-team-server.md:52) now lists `meta` as "the ids, the leases, `mirror.last`, and the two notes a run reads first: `mirror.rebuild`, a rebuild cut midway, and `mirror.replay`, the folders a purge owes a replay". That matches the keys mirror.ts keeps and agrees with line 78.
- F-2 was declined, and the reason holds. `parseFeedUid` reads the database through the store's functions, so ids.ts, a leaf, cannot hold it. The cross-import (mirror.ts:25 takes three helpers from push.ts) still crosses no boundary the ADR draws. It stays an advisory and is not raised again.

The fourth-round changes keep the stated boundaries:
- **Every SQL statement in store.ts.** The new `PRAGMA busy_timeout` read, set and restore are inside `checkpointWal` (store.ts:637-648), beside the truncating checkpoint. server.ts:223 only calls `checkpointWal(db, CHECKPOINT_WAIT_MS)`. `CHECKPOINT_WAIT_MS` is a plain constant at server.ts:44.
  - The missing-row throw in the pending fetch (mirror.ts:367-369) goes through the store's `revisionAt` and holds no SQL.
  - The purge's transaction now returns `{ counts, owed }` (mirror.ts:681-700) through the store's `transaction`.
  - store.ts still imports only db.ts and errors.ts of the folder. No other file under src/team/ has `.query(`, `.run(`, `.prepare(` or `withWrite(`, which is what team-store-boundary.test.ts:31-46 checks.
- **types.ts a leaf.** It is unchanged: only `import type` lines (db, limits, log, signal, types.ts:5-8).
- **The one-process assumption.** Nothing new is shared between processes.
  - The hourly checkpoint still runs on the server's own connection and timer, only while no export child runs (server.ts:221).
  - Its busy timeout is changed for that one call and restored in a `finally` (store.ts:645-646). So the connection's 5 s timeout, which ADR line 78 gives a purge, is untouched for every other statement.
  - The try/catch with the `team.checkpoint` log line (server.ts:222-228) is what ADR line 78 states: "a failure of it is logged, never fatal". So is the `wal-checkpoint busy` warning with a 200 ms wait.

Afresh: I read the diff against ADR 0019, 0024, 0025 and 0026 and the contract files, and found no new drift.

## Findings
- F-1 · advisory · src/team/mirror.ts:25 · Carried from round 4, declined with a sound reason: the feed-uid helpers (`deviceAlias`, `memoryFeedUid`, `parseFeedUid`) stay in the push handler and the mirror imports them from there. This is a convention point where the base is silent, not a boundary crossed.

## Outside the change
none

## Not answerable
none
