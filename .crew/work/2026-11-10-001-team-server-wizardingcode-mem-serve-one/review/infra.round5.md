# infra findings for 2026-11-10-001-team-server-wizardingcode-mem-serve-one
reviewer: review-infra
read: 10 files. I read these pipeline and deployment files in full: Dockerfile, compose.yml, .github/workflows/release.yml, .github/workflows/ci.yml (the image step). I also read: the rubric; .crew/profile.json; review/files.txt; review/infra.round4.md; docs/adr/0026-team-server.md ("Purge", "The image and the compose file", "Rollback", "The one-time step", "The lease's 30-second window", "Follow-ups"); src/team/server.ts (the lease, stop, the hourly tick, mirrorCommandFor); src/team/store.ts (`checkpointWal`); src/cli/commands/serve.ts (the `runMirror` and `purgeItem` call sites, `exitFor`). Commit 3361487 changed no deployment file, so I did not re-read .dockerignore, Caddyfile or .env.example this round.

## Findings
- F-1 · advisory · .github/workflows/release.yml:89 · Unchanged since round 4. The `docker` job pushes the version tag and moves `latest` before `publish` runs, so a failed `publish` leaves an image with no release. The undo is stated in ADR 0026 "Follow-ups". Compose requires `WIZARDINGCODE_MEM_VERSION` (compose.yml:6), so no deployment moves onto that image by itself (rubric Q4).
- F-2 · advisory · .github/workflows/release.yml:93 · Unchanged since round 4. The `linux/amd64,linux/arm64` image is pushed without being run once. CI's image step (.github/workflows/ci.yml:48) runs only the runner's amd64 image, so the arm64 image first runs on a host. ADR 0026 "Follow-ups" names this (rubric Q1).
- F-3 · advisory · Dockerfile:19 · Unchanged since round 4. The base image is pinned by digest, but `apt-get install git ca-certificates` installs whatever Debian serves on the day of the build. ADR 0026 "Follow-ups" names this (rubric Q6).

No defects.

Round 4's F-4 is resolved by 3361487:
- **Wait bounded.** At src/team/server.ts:221-229 the hourly tick calls `checkpointWal(db, CHECKPOINT_WAIT_MS)` (200 ms, server.ts:44). At store.ts:637-648, `checkpointWal` puts the connection's own busy timeout back in a `finally`. An outside reader, such as an operator's `serve mirror --rebuild` beside the server, now holds the event loop for at most 200 ms an hour, where it was up to 5 s.
- **Busy log stated.** When the log was held, the tick logs `wal-checkpoint` `busy: true`.
- **No exit.** The tick's try/catch sends a throw to `log.error("team.checkpoint", …)`. The process does not exit on it, so it never leaves `serve.lease` waiting out the 30-second window under `restart: unless-stopped`.
- **ADR current.** ADR 0026 "Purge" (line 78) now states the 200 ms wait, the log line and that a failure is not fatal. It still states the purge's own two 5 s waits, which are on the operator's command.

The rest of the deployment is as reviewed in round 4:
- **Pipeline order.** The gates run before the push (`bun run check` and `bun run build`, then `sign`, `docker`, `publish`).
- **Permissions.** `docker` narrows its permissions to `contents: read, packages: write` and logs in with `GITHUB_TOKEN`.
- **Secrets.** There is no secret in the image, in a variable's default or in a comment.
- **Runtime hardening.** The container runs as uid 10001, with a read-only root, tmpfs `/tmp`, `cap_drop ALL` and `no-new-privileges`. It publishes no port.
- **Mirror child.** It is the image's own binary (`mirrorCommandFor`, server.ts:47), run under the same identity.
- **Synchronous wrappers.** The `mirror` and `purge` wrappers in serve.ts (lines 480 and 502) run inside the container and write only under `/data`. Purge stays an intended erasure behind `--yes`, and the ADR states what it does not reach.
- **Rollback.** The schema-bump rollback is in ADR 0026 "Rollback".
- **Clean stop.** CI checks that a clean stop exits 0 (ci.yml:61-62).
- **Hosts.** There is no path, name or address tied to one machine.

## Outside the change
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.crew/profile.json:72 · Carried over (debt). The proposed health command `curl -fsS http://localhost:80/` reaches Caddy, which serves only `{$SERVER_DOMAIN}` and redirects HTTP to HTTPS. It does not report the server's health on a local compose run. The check this change provides is `serve health` inside the `server` container.

## Not answerable
none
