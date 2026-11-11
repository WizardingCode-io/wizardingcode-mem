# architecture findings for 2026-11-10-002-part-6-of-the-knowledge-and-team-journey
reviewer: review-architecture
read: the rubric; round 4's findings (review/architecture.round4.md) and all of the judge's round 4 rulings (review/ruling.round4.json); docs/adr/0027-sync-client.md from "What building changed from the plan" to the end, including the fifth-round bullet; tests/unit/sync-boundary.test.ts's import rules for src/team; src/modules/knowledge/index-store.ts lines 905-985 (ReceivedScope, hasSharingTables, RECEIVED_VISIBLE, hitOfReceived) and its callers in tools.ts, contribute.ts and received-ref.ts; src/sharing/levels.ts lines 55-161 (boundServerOf, boundAliasesOf, aliasBoundTo, isHostLedAlias, levelOf's bound-alias check); src/team/contract.ts lines 1-110 and 269-276 (ENTRY_UID, EntryUid, parseEntryUid, RESULT_SHAPES.refusal, RefusalShape); the validate.ts hunk of review/diff.patch (lines 5935-5990, the server's parser moved out unchanged); greps over src for parseEntryUid, ENTRY_UID, bound_alias, hostLedAliasOf and the sync's own SQL over the knowledge tables.

## Findings
- F-1 · advisory · src/sync/outbound.ts:322 · Round 2's F-1 is still here, unchanged and kept as an advisory by the judge. The sync runs its own SQL over the knowledge module's tables: `knowledge_repos` here, `knowledge_entries` at outbound.ts:379 and conflicts.ts:69, and `knowledge_proposals` at conflicts.ts:172. sync-boundary.test.ts pins only the sharing tables, so no test guards this coupling to the module's schema. Fix: move these reads into index-store.ts or store.ts and call them from the sync. (Q1)
- F-2 · advisory · src/team/contract.ts:104 · Round 2's F-3 is still here, unchanged. `RefusalShape` (contract.ts:270-275) declares `accepted` and `retryAfterSec`, and the client reads both. `RESULT_SHAPES.refusal`, the list `contractFingerprint` pins, names only `error`, `instance` and `serverId`. Fix: add the optional refusal keys to the pinned list (a contract bump), or check each answer type's keys against its RESULT_SHAPES entry. (Q3)

Round 4's upheld defect is closed. `RECEIVED_VISIBLE` (index-store.ts:949-961) now takes the project id as its one parameter. Its EXISTS uses `boundAliasesOf`'s rule (`a.alias = l.bound_alias`, an enabled project, a level above `local` with the row's server as destination) and ties it to the row with `l.bound_alias = x.remote_alias`. This is the same reading as src/retrieve/received.ts:48 and src/sharing/levels.ts:82-86. `ReceivedScope` is `{ projectId }`, and `hostLedAliasOf` no longer appears anywhere under src.

Round 4's F-4 (placement) is closed. `parseEntryUid` and `ENTRY_UID` sit in src/team/contract.ts beside `entryBytes`. The diff moves them out of validate.ts with the grammar unchanged (validate.ts re-exports both), so the client now parses with the server's strict grammar. Every reader imports this one parser: push.ts, validate.ts, conflicts.ts, inbound.ts and outbound.ts. `EntryUid` is now a union discriminated on the scope. The new import from contract.ts into src/sharing/levels.ts stays inside the boundary: levels.ts imports only a `Db` type and the sharing leaf, src/team already imported src/sharing/types.ts, and sync-boundary.test.ts:98-106 allows src/sync to import only contract.ts from src/team.

`aliasBoundTo` is now `boundAliasesOf(...).includes(alias)`, one rule. The ADR's fifth-round bullet (0027:97) records every one of these changes.

## Outside the change
- none

## Not answerable
- none
