# risk findings for 2026-11-11-005-share-a-project-without-a-git-remote-tod
reviewer: review-risk
read: spec, plan, round-3 findings, src/ui/api.ts (setProjectSharing), runbook rollback/share-names lines, README grep (97 files listed; diff read selectively)

## Findings
- F-1 · advisory · docs/adr/0028-shared-names.md:57 · Carried from rounds 2 and 3. The ADR goes from "the names created since are lost" straight to "a project bound to a lost name is `missing`". It does not name the `names held (server at contract 1)` state that lasts while the 0.7.0 image runs. The runbook says it correctly, so only the ADR's summary is incomplete.
- F-2 · advisory · src/sync/outbound.ts:632 · Carried, unchanged. A push answered `name` sets `missing`, and the sweep retries at every later sweep with no backoff and no breaker until the person sets the level again. The only signs are the `missing` flag in `status`, `doctor` and the dock.
- F-3 · advisory · src/cli/commands/serve.ts:515 · Carried, unchanged. `serve purge name <alias> --yes` has no dry run and no undo. A mistyped alias retires a live name for good. The only way back is restoring `team.db`, which loses everything written since. The runbook now names the mirror repository as what stays and gives `serve mirror --rebuild` as the third step.
- F-4 · advisory · src/sync/inbound.ts:791 · Carried, unchanged. After a restore older than a name, a Receive-only teammate never pushes, so `missing` is never set on their side. Their received copies under the name are dropped by the snapshot, and nothing on their machine explains it. The runbook's "the server no longer holds the name" reaches only members who send.
- F-5 · advisory · .crew/work/2026-11-11-005-share-a-project-without-a-git-remote-tod/spec.md:295 · Carried. The spec promises the client rollback (restore the upgrade copy; a 0.7.0 binary refuses a version 8 store) in "the release notes". README.md has no sentence on `SchemaTooNewError` or the version 8 store. The ADR and runbook carry it, and the release item still owes the README or notes line.

Resolved since round 3:
- Round 3 F-1 (the `share names` order): the runbook's rollback block now stops the server only after the member's `share names` step. Line 78 keeps `team-before-rollback.db` by a `cp` ahead of the restore.
- The viewer route's `PUT /api/projects/<id>/sharing` (src/ui/api.ts:1283-1324) runs `prepareBinding` then `commitBinding`, with or without `as`. This matches the CLI. By the stated dry-run behaviour, Nothing and an already-bound level change never reach the server, and the `confirm` flag is judged under the write lock. This adds no irreversible or invisible step.

## Outside the change
- src/team/server.ts:99 · Debt. A stale `serve.lease` after a kill makes the container restart repeatedly until the lease expires, up to 30 s. The runbook line 99 documents it.
- src/store/db.ts:1 · Debt. An older binary still on PATH refuses the version 8 store and its hooks fail open, so that agent silently stops capturing. Only `doctor` shows it. Every store bump has carried this risk.

## Not answerable
- Third parties: cost of the first run · No request count was measured for repeated sweeps against a server that has lost a bound name (F-2), or for the full re-send after an instance renewal under shared names.
