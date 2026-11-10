# infra findings for 2026-11-10-001-team-server-wizardingcode-mem-serve-one
reviewer: review-infra
read: 15 files. I read these pipeline and deployment files in full: Dockerfile, .dockerignore, compose.yml, Caddyfile, .env.example, .github/workflows/release.yml, .github/workflows/ci.yml. I also read: .crew/profile.json; review/infra.round2.md and review/ruling.round2.json; review/files.txt; docs/adr/0026-team-server.md ("Purge", "The image and the compose file", "Rollback", "The one-time step", "The lease's 30-second window", "Follow-ups"); src/cli/commands/serve.ts (the usage line, runServer's signals and exit code, mirror, purge, health); src/team/server.ts (mirrorCommandFor and how it is wired); src/team/mirror.ts (underMirrorLease, runMirror, replayFolders, replayOwed, purgeItem); src/team/store.ts (checkpointWal); src/util/self.ts (selfCommand).

## Findings
- F-1 · advisory · .github/workflows/release.yml:89 · Unchanged since round 2. The `docker` job pushes the version tag and moves `latest` before `publish` runs (`publish` needs `[sign, docker]`), so a failed `publish` leaves an image with no GitHub release. The undo is written in ADR 0026 "Follow-ups", and compose requires `WIZARDINGCODE_MEM_VERSION`, so a deployment cannot drift onto that image by itself (rubric Q4).
- F-2 · advisory · .github/workflows/release.yml:93 · Unchanged since round 2. The `linux/amd64,linux/arm64` image is pushed without being run once. CI's smoke step (.github/workflows/ci.yml:48) runs only the runner's amd64 image, so the arm64 image first runs on a host. ADR 0026 "Follow-ups" names this limit (rubric Q1).
- F-3 · advisory · Dockerfile:19 · Unchanged since round 2. The base image is pinned by digest, but `apt-get install git ca-certificates` installs whatever Debian serves on the day of the build, so two builds of the same tag can differ. ADR 0026 "Follow-ups" names this limit (rubric Q6).

No defects.

Commit e8ebb12 changed no deployment file, and I found nothing in its process changes that needs a finding:
- **The mirror child's command.** `mirrorCommandFor` (src/team/server.ts:45) is `selfCommand("serve", "mirror", "--data", dataDir)`. In the compiled image that is `/usr/local/bin/wizardingcode-mem serve mirror --data /data`. The binary is the image's own and is not tied to a host path, and the child runs under the same uid 10001 as the server, with no widened identity.
- **The purge.** It runs inside the server container and writes no file outside the volume. The two truncating checkpoints (src/team/mirror.ts:664 and :681) are `PRAGMA wal_checkpoint(TRUNCATE)`, so they need no extra permission and nothing from the read-only root. The `mirror.replay` mark is set inside the erasure's transaction (mirror.ts:653), so a purge killed by a container stop, where compose's 30 s grace runs out, is finished by the next `serve mirror`.
- **Purge rollback.** Purge is an intended, irreversible erasure behind `--yes`. ADR 0026 "Purge" states what it does not reach (the copies under `backups/`, volume clones) and leaves those to the operator's runbook. That counts as a stated rollback position for rubric Q4.
- **The usage line.** serve.ts:41 now says `health` takes `--url` alone, which matches `health()` at serve.ts:534 and the Dockerfile's HEALTHCHECK. The HEALTHCHECK passes no `--data` and falls back to `127.0.0.1:${WIZARDINGCODE_MEM_TEAM_PORT ?? 8787}`.
- **`WIZARDINGCODE_MEM_MIGRATE=off` in the image** (Dockerfile:29). It is kept on purpose, and ADR 0026 "The image and the compose file" now gives the reason. It narrows what a command in the image does and widens nothing.

Everything else I checked in round 2 still holds:
- **Gates before the push.** The release `build` job runs `bun run check` and `bun run build` before `sign`, then `docker`, then `publish`.
- **Permissions.** `docker` narrows its permissions to `contents: read, packages: write` and logs in with `GITHUB_TOKEN`.
- **Secrets.** No secret is in the image, `.env.example`, a variable's default or a comment. `.dockerignore` lets only `dist/wizardingcode-mem-linux-*` into the build context.
- **Container hardening.** It runs as uid 10001 with a read-only root, tmpfs on `/tmp`, `cap_drop ALL` and `no-new-privileges`. The server's port is not published.
- **Rollback across a schema bump.** ADR 0026 "Rollback" gives it as compose commands, with the WAL and SHM files removed.
- **Clean stop.** SIGTERM and SIGINT stop the server through `init: true` with a 30 s grace, and CI checks the exit code is 0.
- **Hosts.** No host-specific path, name or address in the deploy files. The domain and the version come from `.env`.

## Outside the change
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.crew/profile.json:72 · Carried over (debt). The proposed environment health command `curl -fsS http://localhost:80/` hits Caddy, which serves only `{$SERVER_DOMAIN}` and redirects HTTP to HTTPS, so it does not report the server's health on a local compose run. The check this change provides is `serve health` inside the `server` container.

## Not answerable
none
