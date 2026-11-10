# risk findings for 2026-11-10-001-team-server-wizardingcode-mem-serve-one
reviewer: review-risk
read: spec, plan, 6 files (src/team/store.ts, src/team/server.ts, src/team/mirror.ts, docs/adr/0026-team-server.md, .github/workflows/release.yml, .env.example), plus review/risk.round4.md and package.json

## Round 4 advisories F-1 to F-3 (the ones taken)
All three are answered.
- F-1 (the hourly checkpoint could hold the event loop for up to 5 s) is answered. `checkpointWal(db, waitMs)` (src/team/store.ts:637-648) sets `busy_timeout` to the wait, runs `wal_checkpoint(TRUNCATE)` and puts the old timeout back in a `finally`. The server calls it with `CHECKPOINT_WAIT_MS = 200` (src/team/server.ts:44, :223). A TRUNCATE checkpoint calls the busy handler while it waits for readers, so 200 ms is the real limit on how long the event loop stops. ADR 0026:78 now says the purge's own 5 s wait is "on the operator's command" and the server's tick is limited to 200 ms, which is correct. tests/unit/team-db.test.ts:202 proves the timeout is put back.
- F-2 (a busy hourly checkpoint left no trace) is answered. A busy result logs `{level: "warn", event: "wal-checkpoint", busy: true}` (server.ts:224), and a throw is caught and logged as `log.error("team.checkpoint", …)` without stopping the process (server.ts:226-228). ADR 0026:78 says both.
- F-3 (a purge replays folders an earlier purge left owed) is answered as documentation at ADR 0026:78: "a slow purge whose output names another folder's failures is finishing that debt".

The short wait adds no real risk. With a long outside reader (for example a hand-run `serve mirror --rebuild` of about 35 min), the worst case is one warn line and a 200 ms pause per hour. That warn line is the visibility round 4 asked for, not noise. If the reader holds the log across several hours, the purged frames stay in `team.db-wal` for those hours, and the hourly line now says so. Outside commands that write, such as `serve invite` beside the server, wait at most about 200 ms more than before. The one gap is in F-1 below.

## Findings
- F-1 · advisory · src/team/server.ts:221 · When the server's own export child is running at the top of the hour, the checkpoint is skipped and nothing is logged. A purge's `wal: busy` debt can then outlive that hour with no line saying so, and this can happen more than once in a row if push-triggered runs (a quiet minute after a push) keep a child alive at the tick. The window is narrow, the next free tick or any later purge cuts the log, and no client exists yet. A `wal-checkpoint skipped: child` line, or a check of `team.db-wal`'s size in `serve status`, would close it. No test covers either the tick's warn line or the logged throw (only the store-level wait is tested at tests/unit/team-db.test.ts:202).
- F-2 · advisory · src/team/mirror.ts:402 · Carried (round 4 F-4, not taken). A note that cannot be parsed sets `mirror.rebuild`, but the purge replays only its own `touched` folders, and a replay that succeeds writes no `mirror.last`. `serve status` (src/team/status.ts:92) shows neither `mirror.replay` nor `mirror.rebuild`, and an old `mirror.last.error` can stay after the problem is fixed. The next run heals this, and the brief puts it in the part 7 runbook.
- F-3 · advisory · .github/workflows/release.yml:99 · Carried. `publish` needs `docker`, which pushes `linux/amd64,linux/arm64` (release.yml:93) built through QEMU without running either image, so the arm64 image first runs on a host. ADR "Follow-ups" states this and the undo for an image that was pushed when the release then failed.
- F-4 · advisory · .env.example:4 · Carried. `WIZARDINGCODE_MEM_VERSION=0.7.0` while package.json:3 is 0.6.0, so a `.env` copied before 0.7.0 is tagged names an image that does not exist. `docker compose pull` would show this at once.
- F-5 · advisory · docs/adr/0026-team-server.md:98 · Carried. Rolling back across a schema bump is a manual restore of the copy taken before the migration, and it relies on part 6 clients to re-push what that copy lacks. The procedure is written down, but it is manual.
- F-6 · advisory · .crew/work/2026-11-10-001-team-server-wizardingcode-mem-serve-one/spec.md:251 · Carried. Only `docker ps` and the runbook read the HEALTHCHECK, and nothing restarts the container on it, as the spec states.

## Outside the change
none

## Not answerable
none
