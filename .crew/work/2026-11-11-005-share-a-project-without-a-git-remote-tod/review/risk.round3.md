# risk findings for 2026-11-11-005-share-a-project-without-a-git-remote-tod
reviewer: review-risk
read: spec, plan, 97 files

## Findings
- F-1 · advisory · docs/runbooks/team-server.md:81 · New in round 3. The Rollback paragraph says "before the `cp`", ask a member for `wizardingcode-mem share names`. But the code block at line 77 stops the server before the `cp`. `share names` reads the live server, so a member asked at that point gets a connection failure and no list. The step has to come before `docker compose stop server`. The failure is visible, and the kept-aside `team-before-rollback.db` still holds the names, but the image has no SQL shell to read them. Round 2's F-3 (the order the members see) and F-4 (keeping the newer file aside) are otherwise resolved: the paragraph now says names are held under the 0.7.0 image and read `missing` only after the re-upgrade. The copy made at the 0.8.0 bump has no registry at all, so `share names` does list exactly the names that will be lost.
- F-2 · advisory · docs/adr/0028-shared-names.md:57 · Carried from round 2. The ADR still goes from "the names created since are lost" straight to "a project bound to a lost name is `missing`". It does not name the `names held (server at contract 1)` state that lasts while the 0.7.0 image runs. The runbook now says it correctly, so only the ADR's summary is incomplete.
- F-3 · advisory · src/sync/outbound.ts:632 · Carried, unchanged. A push answered `name` sets `missing`, and the sweep retries at every later sweep, with no backoff and no breaker, until the person sets the level again. The only signs are the `missing` flag in `status`, `doctor` and the dock.
- F-4 · advisory · src/cli/commands/serve.ts:515 · Carried, unchanged. `serve purge name <alias> --yes` has no dry run and no undo. A mistyped alias retires a live name for good. The only way back is restoring `team.db`, which loses everything written since.
- F-5 · advisory · src/sync/inbound.ts:791 · Carried, unchanged. After a restore older than a name, a Receive-only teammate never pushes, so `missing` is never set on their side. Their received copies under the name are dropped by the snapshot, and nothing on their machine explains it. The runbook's line 164 ("the server no longer holds the name") reaches only members who send.
- F-6 · advisory · .crew/work/2026-11-11-005-share-a-project-without-a-git-remote-tod/spec.md:295 · Carried. The spec promises the client rollback to "the release notes". README.md still has no sentence on the version 8 store, `SchemaTooNewError` or restoring the upgrade copy, so the release item still owes it.

## Outside the change
- src/team/server.ts:99 · Debt. A stale `serve.lease` after a kill makes the container restart repeatedly until the lease expires (runbook line 99 documents it).
- src/store/db.ts:1 · Debt. An older binary still on PATH refuses the version 8 store, and its hooks fail open, so that agent silently stops capturing. Only `doctor` shows it. Every store bump has carried this risk.

## Not answerable
- Third parties: cost of the first run · No request count was measured for the repeated sweeps against a server that has lost a bound name (F-3), or for the full re-send after an instance renewal under shared names.
