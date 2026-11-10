# infra findings for 2026-11-10-001-team-server-wizardingcode-mem-serve-one
reviewer: review-infra
read: 8 files. I read these pipeline and deployment files in full: Dockerfile, compose.yml, .github/workflows/release.yml, .github/workflows/ci.yml. I also read review/infra.round5.md, review/files.txt, .crew/profile.json (the health command) and tests/unit/knowledge-git-host.test.ts, the only file changed since round 5. I found its entry in diff.patch at line 11704.

## Findings
- F-1 · advisory · .github/workflows/release.yml:89 · Same as round 5. The `docker` job (lines 62-96) pushes the version tag and moves `latest` before `publish` (line 98) runs, so a failed `publish` leaves an image with no release. ADR 0026 "Follow-ups" states the undo. compose.yml:6 requires `WIZARDINGCODE_MEM_VERSION`, so no deployment moves onto that image by itself (rubric Q4).
- F-2 · advisory · .github/workflows/release.yml:93 · Same as round 5. The `linux/amd64,linux/arm64` image is pushed without being run once. CI's image step (.github/workflows/ci.yml:48-65) builds and runs only the runner's amd64 image, so the arm64 image first runs on a host. ADR 0026 "Follow-ups" names this (rubric Q1).
- F-3 · advisory · Dockerfile:20 · Same as round 5; round 5 cited line 19, where the `RUN` starts, and the install is line 20. Both stages' base image is pinned by digest (lines 7 and 18), but `apt-get install -y --no-install-recommends git ca-certificates` installs whatever Debian serves on the day of the build. ADR 0026 "Follow-ups" names this (rubric Q6).

No defects. The round-5 state holds:
- **No deployment file changed.** Dockerfile, compose.yml, release.yml and ci.yml read the same as in round 5, at the same lines.
- **Pipeline order.** The gates `bun run check` and `bun run build` (release.yml:31-32) run before `sign`, `docker` and `publish`.
- **Permissions.** `docker` narrows its permissions to `contents: read, packages: write` (lines 65-67) and logs in with `GITHUB_TOKEN`.
- **Secrets.** There is no secret in the image, in a variable's default or in a comment.
- **Runtime hardening.** The image runs as uid 10001 (Dockerfile:31). compose.yml:11-20 adds a read-only root, tmpfs `/tmp`, `cap_drop ALL` and `no-new-privileges`. The server publishes no port.
- **Clean stop.** CI checks that a stop exits 0 (ci.yml:61-62).
- **Hosts.** There is no path, name or address tied to one machine.
- **The formatted test.** tests/unit/knowledge-git-host.test.ts is a unit test only. It uses fixture directories and stub gits, and its addresses are `.invalid`. It changes nothing in the pipeline or the deployment.

## Outside the change
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.crew/profile.json:72 · Carried over (debt). The proposed health command `curl -fsS http://localhost:80/` reaches Caddy, which serves only `{$SERVER_DOMAIN}` and redirects HTTP to HTTPS, so it does not report the server's health on a local compose run. The check this change provides is `serve health` inside the `server` container (Dockerfile:34).

## Not answerable
none
