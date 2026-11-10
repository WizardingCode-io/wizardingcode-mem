# infra findings for 2026-11-10-001-team-server-wizardingcode-mem-serve-one
reviewer: review-infra
read: 13 files. Pipeline and deployment files read in full: Dockerfile, .dockerignore, compose.yml, Caddyfile, .env.example, .gitignore, .github/workflows/release.yml, .github/workflows/ci.yml. Also read: src/cli/commands/serve.ts (signals, exit codes, health), docs/adr/0026-team-server.md (the image, Rollback, the one-time step, the lease window, Follow-ups), .crew/profile.json, work.json (AC-54, AC-56, AC-58) and review/infra.round1.md. Grepped for the mirror child's command line: src/team/server.ts, src/team/mirror.ts.

## Findings
- F-1 · advisory · .github/workflows/release.yml:89 · The `docker` job still pushes the version tag and moves `latest` before `publish` runs (`publish` needs `[sign, docker]`). A failing `publish` leaves a pushed image with no GitHub release. The ADR's Follow-ups now say how to undo it (delete the package version or re-run the job), and compose's required `WIZARDINGCODE_MEM_VERSION` keeps deployments from drifting, so this stays advisory (rubric Q4).
- F-2 · advisory · .github/workflows/release.yml:89 · The two-platform image is still built and pushed without being run once. CI's smoke step at .github/workflows/ci.yml:48 runs only the amd64 image, so the arm64 image first runs on a host. The ADR's Follow-ups name this as a known limit (rubric Q1).
- F-3 · advisory · Dockerfile:19 · The base image is pinned by digest, but `apt-get install git ca-certificates` installs whatever versions Debian serves on the day of the build, so two builds of the same tag can differ. The ADR's Follow-ups name this as a known limit (rubric Q6).

No defects. The gates come before the push: the release `build` job runs `bun run check` and `bun run build` before `sign`, then `docker`, then `publish`. The `docker` job narrows its permissions to `contents: read, packages: write`, and its registry login uses `GITHUB_TOKEN`. No secret is committed in the image, `.env.example` or a variable's default; `.env` is ignored, `.env.example` is allowed, and `.dockerignore` lets only `dist/wizardingcode-mem-linux-*` into the context. The container runs as uid 10001 with a read-only root, `cap_drop ALL` and `no-new-privileges`, and the server's port is not published. The rollback for a schema bump is written as compose commands in ADR 0026 "Rollback", WAL and SHM files included. SIGTERM and SIGINT stop the server cleanly through `init: true` with a 30 s grace, and CI checks the exit code. No path, name or address in the deploy files is tied to one machine; the domain and version come from `.env`.

## Outside the change
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.crew/profile.json:72 · The proposed environment health command `curl -fsS http://localhost:80/` hits Caddy. Caddy serves only `{$SERVER_DOMAIN}` and redirects HTTP to HTTPS, so this command does not report the server's health on a local compose run. The check the change provides is `serve health` inside the `server` container.

## Not answerable
none
