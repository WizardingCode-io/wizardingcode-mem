# security lead's validation of 2026-11-10-001-team-server-wizardingcode-mem-serve-one: delivery
verdict: validated
## Returns
none
## Notes
- The security gate is proven on the final tree. `.crew/work/2026-11-10-001-team-server-wizardingcode-mem-serve-one/report.md:68` shows security proven with 0 findings. `review/security.findings.md:5-6` (round 5) has no findings, and rounds 3 and 4 had none either. The deterministic gates pass in `report.md:55-60`: secrets, build, test, lint and typecheck.
- The one round-1 security defect is fixed. A demoted admin kept their open invitations (`review/security.round1.md:6`). Now `src/team/members.ts:318-322` revokes every invitation of the member's devices inside the transaction that changes the role. `revokeDevice` (`members.ts:277-287`) and `disableMember` (`members.ts:290-303`) do the same.
- The round-1 and round-2 advisories are closed in the code:
  - A wrong token now counts against the address's `auth` bucket (`src/team/routes.ts:176-183`).
  - A memory uid must match `MEMORY_UID` (`src/team/ids.ts:56`, `src/team/validate.ts:183`).
  - Held pulls are capped per device.
  - A refused uid is cut to 256 characters in the log line (`review/security.round3.md:7`).
- My spec returns R-1 to R-4 (`conclave/lead-security.md`) hold in the code:
  - R-1: every route but health requires https behind the proxy, join included (`src/team/routes.ts:56-60`, `:511-512`). The check runs before the handler, so a refused join spends no invitation.
  - R-2: a member's folder is `members/<id>-<slug>`, and `slugOf` uses a fallback and never the raw name (`src/team/mirror.ts:63-70`, `:88-89`). AC-49 tests the hostile names (`report.md:39`).
  - R-3: AC-54 was observed with the container started as `--init --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges:true`. It ran as uid 10001, health answered, and the exit code was 0 (`report.md:44`). `compose.yml:11-20` carries the same hardening, and the server's port is not published.
  - R-4: `typedMemory` checks the type of every field, `KIND_WORD` checks `memoryKind` and `status`, and numbers must be finite (`src/team/validate.ts:101-120`). The 256 KiB cap applies to memories (`validate.ts:187-188`) as well as to entries (`validate.ts:148`).
- Tokens and codes:
  - Each is 32 random bytes or 130 random bits (`src/team/ids.ts:29-36`).
  - Only the SHA-256 is stored (`ids.ts:39-41`, `members.ts:173`, `:236`).
  - The digests are compared with `timingSafeEqual` (`ids.ts:44-48`, `src/team/auth.ts:23-27`).
  - A disabled member is checked before a revoked device (`auth.ts:30-31`).
  - A refused join is audited with the address and never the code (`routes.ts:244-253`).
  - 401, 403, 409 and 410 bodies carry `serverId` and `instance` (`routes.ts:37`, `:525`).
  - A 500 answers only the request id (`routes.ts:533-534`).
- Redaction: `team-token` and `team-invitation` carry the `d` and `g` flags and sit before `auth-header` (`src/core/redact.ts:60-61`).
- Pushed text goes through the secret check: `findSecrets(..., { env: {} })` runs over an entry's text and over a memory's title and body (`src/team/validate.ts:155-156`, `:191-193`). The hash is recomputed over the bytes received before the item is accepted (`validate.ts:149-150`, `:189-190`).
- The image and the proxy:
  - The image runs as user 10001 on bases pinned by digest. It sets `MIGRATE=off` and has no trust-proxy (`Dockerfile:7`, `:18-31`).
  - The compose file sets trust-proxy (`compose.yml:8`).
  - Caddy caps the body at 1 MiB and sends HSTS (`Caddyfile:4-7`).
  - The apt packages are not pinned, the arm64 image is not run before it is pushed, and `latest` moves before publish. These are infra advisories named in the ADR's Follow-ups (`report.md:91-93`), not security returns.
- The residual risks are accepted and recorded as deferred:
  - A member's name has no erasure command. The operator changes it from a shell, and `serve forget` is the follow-up (`docs/adr/0026-team-server.md:94`, `:114`; `docs/real-use/findings.md:36`).
  - The audit table, addresses included, is never pruned (`findings.md:37`).
  - The `wal: busy` result after a purge is reported honestly (`docs/adr/0026-team-server.md:78`), and the skipped hourly checkpoint is on `findings.md:38`.
  - Already accepted at the spec: the alias filter is minimisation and not a permission (D-11), withdrawn text stays until `serve purge` (D-24), and the bootstrap code is in the container log.
- Note, not a return: on a request that fails, the request log records `url.pathname` with no length limit (`routes.ts:501`, `:540`). Bun's own request-line limit bounds it, and the query string, the only place a token could ride, is not logged.
