# security lead's validation of 2026-11-09-002-sharing-policy-per-project-local-only-kn: delivery
verdict: validated
## Returns
none
## Notes
- The security gate is proven with no findings (report.md:75, review/ruling.json security entry, review/security.findings.md:5-12). The reviewer's fifth-round notes cover personal-data, auth and data-migration.
- The throw in `levelRefusal` (src/sharing/policy.ts:315-319) fails closed. No path from it leads to `send`. It can only be reached by a hand-built policy, because `effectiveLevel` maps a stored `local` row to `level-local` before it can return `allowed`. Its message names only a project id and a destination.
- The gates my team owns passed on the merged tree (report.md:59-66). They are secrets, build, test, lint, typecheck, and the plugin test. The e2e gate is skipped by the author's standing decision (report.md:67, 254).
- The auth boundary holds, per the reviewer's notes. The three sharing routes run after the Host and token checks (src/ui/server.ts:249-266, 452-476). A widening needs `confirm`, which `setLevel` checks inside its own transaction. `validatePatch` refuses `\r` and `\n` under every key (AC-22), which closes the env-file second-line injection.
- The restore path resets levels before the swap, under `BEGIN IMMEDIATE`. A failed reset throws before the rename (src/backup/backup.ts:114-185, AC-12).
- Redaction at the edge and the pinned key lists are covered by AC-15 and AC-19. `decide` is pure.
- The sharing migration only adds tables, with no foreign key or trigger on core tables (0001_sharing_policy.sql). `user_version` stays 7.
- Advisories left open, none blocking:
  - The ADR's predicate contract (docs/adr/0025-sharing-policy.md:70-76) still says `decide` always returns a ruling. It should get one sentence about the hand-built-policy throw (architecture, advisory).
  - Parts 5 and 6 should decide whether one broken row stops a run or only skips that item (risk, advisory).
  - Parts 5 and 6 should bound `ledgerRecords`' query and state the retention of `sharing_ledger` and `sharing_changes` before writing rows (data, advisory).
  - The `Backups.vue:115` restore toast with `sharingReset > 0` has no capture (ui-ux, advisory).
- Open objections O-1 to O-4 are advisory and recorded in the ADR. They are agent shell access, restore resetting levels, the environment-only-narrows exception, and memories having no area.
