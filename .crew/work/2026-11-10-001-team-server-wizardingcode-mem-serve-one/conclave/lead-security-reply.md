# security lead's validation of 2026-11-10-001-team-server-wizardingcode-mem-serve-one: spec
verdict: validated
## Returns
none
## Notes
- I re-read the revised passages in spec.md. I did not re-read the plan or the new feed.seq paragraph. The coordinator reports those changes and I did not check them.
- R-1 is closed. The trust-proxy rule at spec.md:109 and AC-17 at :262 now require `https required` for every route except `/v1/health`, join included, and a refused join spends no invitation. Health stays exempt because Docker's probe sends no proxy headers.
- R-2 is closed. The member-folder name slug is defined at spec.md:196. AC-21 at :266 names the hostile names `../x`, `a/b`, `.` and `-rf` and the folders they must produce, all directly under `repos/members/`.
- R-3 is closed. The CI step and AC-26 (spec.md:208, :271) start the container with `--init --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges:true`. They assert uid 10001, retry `serve health` for up to 30 s, and check exit code 0 after `docker stop -t 30`.
- R-4 is closed. Typed validation is in the Push section at spec.md:164. `memoryKind` and `status` are held to `^[a-z][a-z0-9_-]{0,31}$`, a memory's JSON is capped at 256 KiB, and `itemBytes` is published in `me.limits` (:152). AC-19 and AC-20 name the wrong-type, oversized and bad-`memoryKind` cases, each answering `refused shape` or `refused size` and never 500 (AC-20 at :265).
- The last-admin check running inside the write's transaction is taken, as the coordinator states.
- Everything I listed as held in the first round still holds: hashed device tokens compared with `timingSafeEqual`, admin-only invitations, roles read on the server, the body caps, the hash recomputation, the secret check, the redaction rules, the stable `serverId` and `instance` in the 401 bodies, and the logging rules.
- Residual risks I accepted: the alias filter is not a permission (D-11), withdrawn text stays until `serve purge` (D-24), and the bootstrap code is in the container log.
