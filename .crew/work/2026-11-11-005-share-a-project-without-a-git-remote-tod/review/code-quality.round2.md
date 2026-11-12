# code-quality findings for 2026-11-11-005-share-a-project-without-a-git-remote-tod
reviewer: review-code-quality
read: 16 files, 430 hunks

## Findings
- F-1 · advisory · src/sync/servers.ts:430 · The round-1 defect is fixed: `spokenAfterMe` with the single `CONTRACT_READ_MS` (servers.ts:432-459) is now the only rule, and run.ts:101-102 and binding.ts:203 both call it. But the move left `heldByContract`'s doc comment ("Whether an alias is held out of the sync while the server speaks 1…") stranded above `CONTRACT_READ_MS`'s own comment, while `heldByContract` at line 461 has none. That is a comment sitting on code it does not describe (Q10).
- F-2 · advisory · src/sync/binding.ts:134 · `bindMessage` moved into the sync client "so the CLI and the viewer read one sentence", but its `unknown-name` and `exists` sentences tell the person to use CLI flags ("--create makes it, or pick one from share names", "run without --create to join it", line 136). src/ui/api.ts:1191 now sends those sentences as the viewer's `error`, and ProjectsView.vue:360 shows it in a toast. One unit is doing two jobs (CLI wording and the shared refusal sentence) (Q1).
- F-3 · advisory · src/sync/ledger.ts:842 · The new loop that deletes the `names.<state>` flags in `clearServerLedger` is a third copy of the flag-clearing logic. The other two are `clearName` (src/sync/state.ts:288-298) and `setLevel`'s Nothing branch (src/sharing/store.ts:515-521). backup.ts:238 adds a hand-written `'names.%'` prefix next to `nameFlagKey`. Round-1 F-2 is still open and has grown (Q2, boilerplate).
- F-4 · advisory · src/sync/binding.ts:225 · The bare-404 branch (`setContract(…, 1)` then `return contractRefusal()`) is still written three times: lines 225, 316 and 376. Round-1 F-4 is still open (Q2, boilerplate).
- F-5 · advisory · src/sync/outbound.ts:166 · `pushUnderContract` still repeats the 409 step-down that `fetchPage` writes inline at src/sync/inbound.ts:592. Round-1 F-3 is still open (Q2).
- F-6 · advisory · src/sync/state.ts:261 · `export { NAME_STATES, type NameState, nameFlagKey }` still re-exports names that every src caller imports from `src/sharing/types.ts`. Round-1 F-7 is still open (Q8, unused export).
- F-7 · advisory · src/sharing/store.ts:235 · The `entry === undefined` throw still guards a case the `SetLevelRefusal` key type rules out. It throws loudly, so it hides nothing. Round-1 F-8 is still open (Q9).
- F-8 · advisory · src/team/store.ts:1013 · `currentItemsUnder` still only forwards to `nameCountsOf` for its one caller, src/cli/commands/serve.ts:520. Round-1 F-11 is still open (Q5).
- F-9 · advisory · src/sync/servers.ts:462 · The contract that brought in shared names is still a bare `2` with no named constant. It appears at servers.ts:462, binding.ts:222 and 311, state.ts:520, team/routes.ts:69 and ProjectsView.vue:162 (`?? 2) < 2`). Round-1 F-12 is still open (Q3/Q6).
- F-10 · advisory · src/cli/commands/share.ts:307 · `plural()` is fixed. On a create or join at `all`, though, the imported count still prints twice: once on the `would leave:` line (288) and again after the bind (307-308). Round-1 F-13 is partly fixed (Q6).
- F-11 · advisory · ui/src/components/ProjectsView.vue:174 · `levelPhrase` and the create/join questions (lines 183-184 and 311) still copy `levelPhrase` and the questions in src/cli/commands/share.ts:211 and 283-284. `hasField` is still repeated inline in the template. Round-1 F-14 is still open (Q2).
- F-12 · advisory · src/team/routes.ts:550 · When the `id` the client sent is already in use, `POST /v1/names` still quietly makes a new one and answers 201, with nothing saying why the creator's id was not kept. Round-1 F-15 is still open (Q9).
- F-13 · advisory · README.md:458 · "Lowering a level withdraws … the next sync takes it back" still leaves out the held-withdrawal case (D-10). Round-1 F-17 is still open (Q11).
- F-14 · advisory · src/sharing/types.ts:70 · The `NameState` doc says each flag is "cleared by a bind or by Nothing". This diff also clears the flags on server removal (ledger.ts:842) and on a restore (backup.ts:238), so the comment is now incomplete (Q10/Q11).
- F-15 · advisory · src/sharing/format.ts:20 · "every other change reads `<what> <old> → <new>`, as before" narrates the change ("as before") instead of saying why (Q10).

Round-1 findings resolved in this cut:
- F-1 (the upheld defect: one contract rule, `spokenAfterMe`, with one deadline)
- F-5 (the inbound.ts:172 comment now says the row is never flagged)
- F-6 (`ALIAS_KINDS` now builds `PREFIXES`, `TEAM_KINDS`, `isTeamAlias` and `TEAM_ALIAS_SQL`)
- F-9 (the duplicate `as !== null` test is gone)
- F-10 (`prefixLength` is gone)
- F-16 (`RESULT_SHAPES` now pins `contractRefusal` and `nameConflict`, and ADR 0027:102 records it)

## Outside the change
- docs/adr/0027-sync-client.md:44 · "a 409 on the contract stops it" no longer holds in full, since a 409 with a lower accepted value now steps the row down and repeats once. The diff did not write this line.

## Not answerable
- Q7 (dependencies) · I did not read `review/inputs.json` in this round, and no manifest is in `files.txt`, so no added dependency was found to judge.
