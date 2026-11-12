# code-quality findings for 2026-11-11-005-share-a-project-without-a-git-remote-tod
reviewer: review-code-quality
read: 12 files, 97 file sections of the diff (round 3: I re-read the round-2 fix sites and the rollback hunk, and re-checked each finding still open)

## Findings
- F-1 · advisory · docs/runbooks/team-server.md:81 · The new rollback sentence says `wizardingcode-mem share names` "lists the names the copy will lose". It actually lists every current name, not the ones the copy lacks. Its "Before the `cp`" timing also comes after the block's `docker compose stop server`, so at that point no member can read `/v1/names`. This is a claim the command does not back, and a step order that does not work (Q11).
- F-2 · advisory · src/sync/binding.ts:134 · Still open from round 2 (F-2). `bindMessage`'s `unknown-name` and `exists` sentences point to CLI flags ("--create makes it, or pick one from share names", "run without --create to join it", line 136). The viewer shows these sentences through src/ui/api.ts:1191 and ProjectsView.vue:361 (Q1).
- F-3 · advisory · src/sync/ledger.ts:842 · Still open from round 2 (F-3). The `names.<state>` flags are cleared in a third place, and backup.ts:238 writes its own `'names.%'` next to `nameFlagKey` (Q2, boilerplate).
- F-4 · advisory · src/sync/binding.ts:227 · Still open from round 2 (F-4). The bare-404 branch (`setContract(…, 1)` then `return contractRefusal()`) is still written three times, at lines 227, 318 and 378 (Q2, boilerplate).
- F-5 · advisory · src/sync/outbound.ts:166 · Still open from round 2 (F-5). `pushUnderContract` repeats the 409 step-down that src/sync/inbound.ts `fetchPage` writes inline (Q2).
- F-6 · advisory · src/sync/state.ts:261 · Still open from round 2 (F-6). `export { NAME_STATES, type NameState, nameFlagKey }` re-exports names that src callers import from src/sharing/types.ts (Q8, unused export).
- F-7 · advisory · src/sharing/store.ts:235 · Still open from round 2 (F-7). The `entry === undefined` throw guards a case the key type rules out. It throws loudly, so it hides nothing (Q9).
- F-8 · advisory · src/team/store.ts:1013 · Still open from round 2 (F-8). `currentItemsUnder` only forwards to `nameCountsOf` for its one caller, serve.ts:520 (Q5).
- F-9 · advisory · src/sync/servers.ts:462 · Still open from round 2 (F-9). The contract that brought shared names is still a bare `2`, at servers.ts:462, binding.ts:222 and 311, and ProjectsView.vue:162 (`?? 2) < 2`) among others (Q3/Q6).
- F-10 · advisory · src/cli/commands/share.ts:307 · Still open from round 2 (F-10). On a create or join at `all`, the imported count prints twice (Q6).
- F-11 · advisory · ui/src/components/ProjectsView.vue:174 · Partly fixed. `hasField` is now one function (line 153), and `listedName` now uses `NAME_PREFIX` (line 168). But `levelPhrase` and the create and join questions (lines 183-184 and 311) still copy the CLI's text in src/cli/commands/share.ts (Q2).
- F-12 · advisory · src/team/routes.ts:550 · Still open from round 2 (F-12). When the creator's `id` is already in use, `POST /v1/names` quietly makes a new id and still answers 201 (Q9).
- F-13 · advisory · README.md:458 · Still open from round 2 (F-13). The withdrawal sentence leaves out the held-withdrawal case (D-10) (Q11).
- F-14 · advisory · src/sharing/format.ts:20 · Still open from round 2 (F-15). "every other change reads `<what> <old> → <new>`, as before" narrates the change ("as before") instead of saying why (Q10).

Round-2 findings resolved in this cut:
- Round-2 F-1. `heldByContract`'s doc comment is back on its function (servers.ts:460), and `CONTRACT_READ_MS` has only its own comment (servers.ts:430).
- Round-2 F-14. The `NameState` doc (src/sharing/types.ts:67-72) now lists all four places the flags are cleared: a bind, Nothing, the server's removal and a restore.
- The architecture advisory on `listedName`'s hand-written `name:` prefix is fixed (ProjectsView.vue:168).
- The dock sentences changed this round are fine. The capitalisation step at ProjectsView.vue:352-353 carries a comment that says why: the route writes lowercase sentences with no full stop, as in binding.ts:113.

## Outside the change
- docs/adr/0027-sync-client.md:44 · "a 409 on the contract stops it" no longer holds in full, since a 409 with a lower accepted value now steps the row down and repeats once. The diff did not write this line.

## Not answerable
- Q7 (dependencies) · I did not read `review/inputs.json`, and no manifest is listed in `files.txt`, so I found no added dependency to judge.
