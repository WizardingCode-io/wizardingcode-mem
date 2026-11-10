# infra findings for 2026-11-10-001-team-server-wizardingcode-mem-serve-one
reviewer: review-infra
read: 11 files: Dockerfile, .dockerignore, compose.yml, Caddyfile, .env.example, .gitignore, .github/workflows/release.yml, .github/workflows/ci.yml, src/cli/commands/serve.ts (the server, signals, health), docs/adr/0026-team-server.md (image, rollback, one-time step, lease window), .crew/profile.json; src/team/db.ts grepped for the backups the rollback names

## Findings
- F-1 · advisory · .github/workflows/release.yml:89 · The `docker` job pushes the version tag and moves `latest` before `publish` runs, so a failing `publish` leaves a pushed image with no GitHub release and no stated way to undo it (delete the package version or retag `latest`). Compose requires an explicit `WIZARDINGCODE_MEM_VERSION`, so no deployment drifts, which keeps this advisory (rubric Q4).
- F-2 · advisory · .github/workflows/release.yml:89 · The release builds and pushes the two-platform image without running it once: no `--version` or `serve health` for either architecture. In this pipeline the Linux binaries are executed only in CI's `verify`, and the image only in CI's amd64 smoke step, so the arm64 image ships with no run (rubric Q1).
- F-3 · advisory · Dockerfile:19 · The base image is pinned by digest, but `apt-get install git ca-certificates` takes whatever versions Debian serves on the day of the build, so two builds of the same tag can differ (rubric Q6).

## Outside the change
- .crew/profile.json:72 · The proposed environment health command `curl -fsS http://localhost:80/` targets Caddy, which serves only `{$SERVER_DOMAIN}` and redirects HTTP to HTTPS, so it would not report the server's health on a local compose run; `serve health` inside the `server` container is the check the change provides.

## Not answerable
none
