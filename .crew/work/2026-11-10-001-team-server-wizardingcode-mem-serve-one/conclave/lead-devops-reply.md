# devops lead's validation of 2026-11-10-001-team-server-wizardingcode-mem-serve-one: spec
verdict: validated
## Returns
none
## Notes
- R-1 holds. spec.md:208 now has `actions/checkout`, then `download-artifact` of `binaries` into `dist`, and `build-push-action` with `context: .`, `file: Dockerfile`, the two platforms and the tags. It gives the reason, and `publish` needs `[sign, docker]`. AC-26 (spec.md:271) and plan.md:190 name the same, with `deploy-files.test.ts` asserting `actions/checkout`, `context: .` and `file: Dockerfile`, per your summary. I did not re-read AC-26 or the plan line in full.
- R-2 holds. spec.md:208 gives the CI step `--init --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges:true`. It retries `serve health` once a second for up to 30 s, asserts `id -u` is 10001, stops with `docker stop -t 30` and reads the exit code with `docker inspect`. `--init` is a run flag, so the image still has no init of its own. This matches the compose hardening.
- R-3 holds. spec.md:207 has the image as `${WIZARDINGCODE_MEM_VERSION:?…}` and `caddy` with `environment: [SERVER_DOMAIN=${SERVER_DOMAIN:?…}]`. It explains why Compose's `.env` does not reach the container on its own.
- R-4: the rollback text at spec.md:288 and the walk in `tests/unit/team-db.test.ts` (AC-16, plan task 7) were reported by the coordinator, and the grep shows the rollback line contains the compose form. I did not re-read it line by line. Accepted on that basis.
- The other changes (`feed.seq` as `{ changes, audit }`, the partial index, `join` behind the proxy without `X-Forwarded-Proto` being 400 with no invitation spent) are outside the pipeline and hosts. They do not conflict with the deployment files.
- The non-blocking notes from the first round still stand for the ADR and the runbook:
  - CI proves only the amd64 image.
  - The volume must be a local Docker volume, not NFS.
  - After a SIGKILL the lease can make one restart refuse once or twice.
  - The base and Caddy digests need a renewal habit.
