# devops lead's validation of 2026-11-10-001-team-server-wizardingcode-mem-serve-one: delivery
verdict: validated
## Returns
none
## Notes
- The current report.md (report.md:8, "Proven") holds the sixth judgement round. Its devops part is the same as in round 1 of this validation:
  - report.md:72 has the infra gate proven with the same 4 findings.
  - report.md:91-93 carry the three advisories from ADR 0026's Follow-ups (docs/adr/0026-team-server.md:114): the image pushed before `publish` (release.yml:89), the arm64 image never run (release.yml:93), and the unpinned apt packages.
  - The apt finding now points at Dockerfile:20, the `apt-get install` line itself, where it used to point at the start of the `RUN` on line 19. The finding is the same, now on the more exact line.
  - report.md:94 keeps the one finding outside the change: the profile's health command reaches Caddy, not the server (.crew/profile.json:72).
- The gates passed again on the new tree: build at report.md:57, the whole `bun run test` at report.md:58 (206 s, which includes tests/unit/deploy-files.test.ts), lint at report.md:59 and typecheck at report.md:60.
- AC-54 is still the same observation from the gate machine (report.md:44). The commit between the rounds only formatted tests/unit/knowledge-git-host.test.ts and touched no deployment file, so the observation still applies. The CI image step (ci.yml:48-65) still first runs on the push.
- What I checked file by file in round 1 still stands:
  - The image: Dockerfile:7-36, .dockerignore:1-2.
  - The compose file: compose.yml:6-25, Caddyfile:4-8, .env.example, .gitignore:7-9.
  - The release workflow: release.yml:62-99, with `docker` needing `sign` and `publish` needing `[sign, docker]`.
  - The process: SIGTERM is handled at serve.ts:219-223, the mirror child is the binary itself and is stopped on abort (server.ts:47-49, mirror.ts:743), and health defaults to `127.0.0.1:8787` (serve.ts:537-538).
  - The ADR's rollback, the one-time public-package step, the lease window and the part-7 runbook are at docs/adr/0026-team-server.md:98-110.
- Still to watch, unchanged:
  - `.env.example:4` names 0.7.0 while package.json is 0.6.0, so `docker compose pull` fails until 0.7.0 is tagged.
  - If the CI image step fails, `set -eu` stops it before `docker logs wcm` (ci.yml:63), so the container's log is lost.
  - The base and Caddy digests need a renewal habit.
  - The volume must be a local Docker volume, not NFS.

Files: /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.crew/work/2026-11-10-001-team-server-wizardingcode-mem-serve-one/report.md, /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/Dockerfile, /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/compose.yml, /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.github/workflows/release.yml, /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.github/workflows/ci.yml, /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/docs/adr/0026-team-server.md
