# architects lead's validation of 2026-11-09-002-sharing-policy-per-project-local-only-kn: delivery
verdict: validated
## Returns
none
## Notes
- The gates my team owns passed on the merged tree (report.md:59-67). Build, test, lint and typecheck pass, and so does the opencode plugin test. The e2e gate is skipped by a recorded standing decision from the author (report.md:67, :254).
- The architecture and risk judgement gates are both `proven` (report.md:77-78). Round five of review/architecture.findings.md has one finding, F-1, advisory. It asks the ADR to say that `decide` throws on a hand-built `local`/`allowed` row.
  - F-1 is already met in docs/adr/0025-sharing-policy.md:70, which says `decide` throws in that one case, names the project and the destination, and never rewrites the reason. Line 75 (step 4) now reads "the reason its level read `local` under, as `effectiveLevel` named it", not the old "or `level-local`".
  - So the reviewer's own ask holds in the tree, and it is not a return.
- The change stays inside the sharing layer (review/architecture.findings.md:15, :17).
  - The `sharing` namespace is registered in src/engine/module-schemas.ts, which imports only migration lists. This follows ADR 0019 and CLAUDE.md.
  - `user_version` stays at 7. `module_migrations` versions the namespace apart, and AC-1 pins that.
  - `src/core/project.ts` gains `remoteAliasOf` and writes nothing.
  - No hook reads the policy.
  - Memory stays an always-on module.
- `decide` is the one predicate and is pure. AC-4, AC-5 and AC-25 pin its contract, and AC-19 pins the key lists. The ADR records the rulings D-1 to D-20, the destination binding and the identity rule. It also records restore and `moveStore`, the agent-shell boundary, and what parts 5 and 6 must do. AC-18 is checked by probes/check-docs.ts, which exits 1 against the base and 0 on the tree.
- Decision D-9, a level per (project, destination), and D-11, the three-valued answer with a ledger, were contested at spec review (report.md:13-16) and ruled by the validator with reasons. They were not reopened.
- Open advisories carry no architectural debt for this item.
  - Part 6 must bound the `ledgerRecords` scan and state the ledger's retention.
  - The `sharing_changes_at` index is unused.
  - The restore journal mode is a separate item.
  - Part 6 must decide whether one broken row stops the run or only skips that item.
