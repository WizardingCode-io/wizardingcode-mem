# risk findings for 2026-11-10-001-team-server-wizardingcode-mem-serve-one
reviewer: review-risk
read: spec, plan, 5 files (src/team/mirror.ts, src/team/server.ts, src/team/store.ts, src/team/status.ts, docs/adr/0026-team-server.md), plus round 3 findings, .env.example and package.json

## Round 3 advisories F-1 to F-5
All five are answered.
- F-1 is answered. `noteOwed` (src/team/mirror.ts:396-407) adds `touched` to the note already owed, inside the erasure's transaction. The purge then replays the whole merged set (mirror.ts:699). A note that cannot be parsed sets `mirror.rebuild` in the same transaction (mirror.ts:402), and `runMirror` treats `"all"` as a rebuild (mirror.ts:465).
- F-2 is answered as documentation. The writer stall (up to 5 s, twice per purge) is stated at ADR 0026:78.
- F-3 is answered. The server's hourly callback cuts the log when no export child is running (src/team/server.ts:217), and ADR 0026:78 names this as the remedy after `wal: busy`.
- F-4 is answered as documentation. ADR 0026:78 says a replay that keeps failing is retried by every run while it holds the lease, until the operator repairs the repository or runs `--rebuild`.
- F-5 is answered for throws inside the run. `underMirrorLease` (mirror.ts:431-446) records a `(run)` failure for anything but an `HttpError`, rethrows, and the `finally` writes the record and releases the lease. A child that dies before it opens the database still leaves only the `mirror-exit` warn line (mirror.ts:753), which is acceptable.

## Findings
- F-1 · advisory · src/team/server.ts:217 · The new hourly `checkpointWal(db)` runs on the server's own connection. That call is synchronous and has a 5 s busy timeout, and the `mirror.child()` guard only sees the server's own child. If another process holds a read at the top of the hour, the whole event loop (health, pulls, pushes) can freeze for up to 5 s. Such readers include an operator's hand-run `serve mirror --rebuild` (about 35 min), a purge's replay, or `serve status`. ADR 0026:78 still says this stall happens "only on the operator's command", which is no longer true. The stall is bounded, happens at most once an hour, and no client exists yet.
- F-2 · advisory · src/team/server.ts:217 · The hourly checkpoint's result is thrown away, and no log line records a `busy` answer. When a purge has answered `wal: busy`, the operator is told the hourly checkpoint will cut the log (ADR 0026:78), but nothing confirms that it did. If readers keep it busy every hour, the purged text's frames stay in `team.db-wal` and nobody can see it. The fix is to log `wal-checkpoint` with the result when busy is 1, or to show it in `serve status`.
- F-3 · advisory · src/team/mirror.ts:699 · Because the note is merged, every purge also replays the folders an earlier purge left owed. That includes a memory purge, whose own `touched` is empty. If one repository always fails, each later erasure holds the lease for up to about 35 min (`repos/shared` at the pilot's size), and its output reports failures that are not its own. This is durable and visible, since the erasure commits before the replay starts. But the runbook should tell the operator that a slow purge with foreign errors means an owed replay.
- F-4 · advisory · src/team/mirror.ts:402 · When the note cannot be read, the purge sets `mirror.rebuild` but replays only its own `touched` folders. When that replay is whole, the purge writes nothing to `mirror.last` (mirror.ts:703), so until the next scheduled run finishes the rebuild the other folders stay half-replayed with no sign of it. `serve status` (src/team/status.ts:92) shows neither `mirror.replay` nor `mirror.rebuild`, so an owed replay or a pending rebuild is visible only through a past `mirror.last.error`. A whole purge replay also does not clear an older `mirror.last.error`, so the status can still show an error that has already been fixed. The next run heals all of this.
- F-5 · advisory · .github/workflows/release.yml:99 · Carried, unchanged. `publish` waits for `docker`, which pushes two platforms through QEMU without running them, and the arm64 image runs for the first time on a host. ADR "Follow-ups" names this, and states the undo for a pushed image whose release failed.
- F-6 · advisory · .env.example:4 · Carried, unchanged. `WIZARDINGCODE_MEM_VERSION=0.7.0` while package.json:3 is still 0.6.0. A copied `.env` names an image that does not exist until 0.7.0 is tagged, and this would surface at `docker compose pull`.
- F-7 · advisory · docs/adr/0026-team-server.md:98 · Carried. Rolling back across a schema bump is a manual restore of the copy taken before the migration, and it relies on part 6 clients to re-push what that copy lacks. The procedure is written down.
- F-8 · advisory · .crew/work/2026-11-10-001-team-server-wizardingcode-mem-serve-one/spec.md:251 · Carried. Nothing consumes the HEALTHCHECK, as the spec states.

## Outside the change
none

## Not answerable
none
