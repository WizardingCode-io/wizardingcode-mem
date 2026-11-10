# devops lead's validation of 2026-11-10-001-team-server-wizardingcode-mem-serve-one: delivery
verdict: validated
## Returns
none
## Notes
- The image is as specified. `Dockerfile:7-16`: a `pick` stage on `$BUILDPLATFORM` maps `TARGETARCH` to `wizardingcode-mem-linux-x64` or `-arm64` and fails on any other architecture. `Dockerfile:18`: the runtime base is pinned by digest. `Dockerfile:22-24`: user 10001 owns `/data`. `Dockerfile:26`: `COPY --from=pick --chmod=0755` restores the executable bit the artefact loses. `Dockerfile:27-30`: the environment sets the data directory, host `0.0.0.0`, `WIZARDINGCODE_HOME=/data/home` and `MIGRATE=off`, with no trust-proxy line. `Dockerfile:34`: `HEALTHCHECK` runs `serve health` every 60 s. That check reaches the listener because `src/cli/commands/serve.ts:537-538` defaults to `http://127.0.0.1:${WIZARDINGCODE_MEM_TEAM_PORT ?? 8787}`, and the server binds `0.0.0.0`. `.dockerignore:1-2` lets only `dist/wizardingcode-mem-linux-*` into the context.
- The compose file matches ADR 0026 "The image and the compose file" (docs/adr/0026-team-server.md:86).
  - `compose.yml:6`: the image is `${WIZARDINGCODE_MEM_VERSION:?…}`.
  - `compose.yml:8`: trust-proxy is on.
  - `compose.yml:11-20`: `init: true`, a 30 s grace, `read_only` with `/tmp` on tmpfs, `cap_drop: ALL`, `no-new-privileges`, and no `ports`.
  - `compose.yml:23-25`: Caddy is pinned by digest and gets `SERVER_DOMAIN=${SERVER_DOMAIN:?…}`.
  - `Caddyfile:4-8`: `max_size 1MiB`, HSTS, and `reverse_proxy server:8787`.
  - `.gitignore:7-9`: `.env` is ignored and `.env.example` is kept.
- The release workflow is wired correctly.
  - `.github/workflows/release.yml:62-67`: the `docker` job needs `sign`, with `packages: write` and `contents: read`.
  - `release.yml:69-73`: it checks out and downloads `binaries` into `dist`.
  - `release.yml:74`: QEMU is needed, because the runtime stage's `apt-get` runs on the target platform.
  - `release.yml:81-88`: `metadata-action` uses the lower-case image, `type=semver`, and `latest` only for a tag without `-`.
  - `release.yml:89-96`: the build uses `context: .`, `file: Dockerfile` and both platforms.
  - `release.yml:99`: `publish` needs `[sign, docker]`.
- The CI step (`.github/workflows/ci.yml:48-65`) matches plan task 19 (plan.md:242) flag for flag: the hardened run, the 30-try health loop, `id -u` = 10001, `docker stop -t 30`, and the exit code read with `docker inspect`. `tests/unit/deploy-files.test.ts:50-189` pins all seven files to those values.
- The process side holds. `serve.ts:219-223` handles SIGTERM and SIGINT. The mirror child is the binary itself (`src/team/server.ts:47-49`) and is stopped with SIGTERM on abort (`src/team/mirror.ts:743`). Under `--init` and `init: true`, that matches the observed clean stop (exit 0 in under 1 s).
- AC-54 was observed on the gate machine with Docker 29.9.2 (arm64) (report.md:44). That run proved the build, `--version`, the hardened start, health, uid 10001 and exit code 0. The CI image step itself has not run yet: it first runs on the push. That is the observed status the spec accepted, not a gap in the delivery. If it fails, `set -eu` exits before `docker logs wcm` (ci.yml:63), so the log is lost. This is a preference for later, not a return.
- These advisories are accepted, each named in the ADR's Follow-ups (docs/adr/0026-team-server.md:114) with its undo:
  - the image is pushed before `publish` (release.yml:89);
  - the arm64 image is never run in the pipeline (release.yml:93);
  - the apt packages are not pinned (Dockerfile:19-20).
- The profile's health command reaches Caddy, not the server (.crew/profile.json:72). It is outside the change and does not affect this delivery.
- The ADR has the runbook sections my spec notes asked for:
  - rollback in compose form, with WAL and SHM removed (docs/adr/0026-team-server.md:98);
  - the one-time step that makes the package public (:102);
  - the lease's 30 s window (:106);
  - the part-7 runbook items (:110).
- Still to watch:
  - `.env.example:4` names 0.7.0 while package.json is 0.6.0, so `docker compose pull` fails until 0.7.0 is tagged.
  - The base and Caddy digests need a renewal habit.
  - The volume must be a local Docker volume, not NFS.

Files: /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/Dockerfile, /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/compose.yml, /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.github/workflows/release.yml, /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.github/workflows/ci.yml, /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/docs/adr/0026-team-server.md
