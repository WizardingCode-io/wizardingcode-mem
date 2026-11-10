# risk findings for 2026-11-10-001-team-server-wizardingcode-mem-serve-one
reviewer: review-risk
read: spec, plan, 8 files (src/team/server.ts, src/team/mirror.ts, .github/workflows/release.yml, .env.example, package.json, docs/adr/0026-team-server.md, tests/unit/knowledge-git-host.test.ts in the diff, review/files.txt), plus review/risk.round5.md and review/ruling.round5.json

## Round 5 state
The round-5 state holds on the current diff. The one change since round 5 is the biome formatting of tests/unit/knowledge-git-host.test.ts (diff.patch:11704-11812). It is a test file, it does not ship in the image, and it changes no production path. Each round-5 finding was checked again at its cited line, and each line still says what it said then:
- src/team/server.ts:221 still skips the checkpoint without a log line while `mirror.child()` is running.
- src/team/mirror.ts:402-403 still sets `REBUILD_MARK` when a note cannot be parsed.
- .github/workflows/release.yml:93 and :99 still push multi-arch, and `publish` still needs `docker`.
- .env.example:4 still says 0.7.0 while package.json:3 says 0.6.0.
- The ADR 0026:98 rollback procedure has not changed.
- spec.md:251 still states that nothing restarts the container on the health check.

No new risk is introduced. Each finding below is the round-5 advisory carried forward, and each is recorded as deferred in docs/real-use/findings.md.

## Findings
- F-1 · advisory · src/team/server.ts:221 · Carried. When the server's own export child is running at the top of the hour, the checkpoint is skipped and nothing is logged, so a purge's `wal: busy` debt can last past that hour without a trace. No test covers the tick's warn line or the logged throw. It heals at the next free tick, and no client exists yet.
- F-2 · advisory · src/team/mirror.ts:402 · Carried. A note that cannot be parsed sets `mirror.rebuild`, but `serve status` shows neither `mirror.replay` nor `mirror.rebuild`, and an old `mirror.last.error` can stay after the problem is fixed. The next run heals it, and it is placed in the part 7 runbook.
- F-3 · advisory · .github/workflows/release.yml:99 · Carried. `publish` depends on a multi-arch push (release.yml:93) whose arm64 image is never run before the release goes out. The ADR 0026 "Follow-ups" section states this, with the undo.
- F-4 · advisory · .env.example:4 · Carried. `WIZARDINGCODE_MEM_VERSION=0.7.0` while package.json:3 is 0.6.0, so the image a copied `.env` names does not exist until 0.7.0 is tagged. `docker compose pull` shows this at once.
- F-5 · advisory · docs/adr/0026-team-server.md:98 · Carried. Rolling back across a schema bump is a manual restore of the copy taken before the migration, and it relies on part 6 clients to re-push what that copy lacks. The procedure is written down, but it is manual.
- F-6 · advisory · .crew/work/2026-11-10-001-team-server-wizardingcode-mem-serve-one/spec.md:251 · Carried. Only `docker ps` and the runbook read the HEALTHCHECK, and nothing restarts the container on it, as the spec itself states.

## Outside the change
none

## Not answerable
none
