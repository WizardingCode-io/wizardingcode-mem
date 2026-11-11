# code-quality findings for 2026-11-10-002-part-6-of-the-knowledge-and-team-journey
reviewer: review-code-quality
read: 14 files, 22 hunks

## Findings
- F-1 · advisory · src/modules/knowledge/index-store.ts:957 · `RECEIVED_VISIBLE` now agrees with `boundAliasesOf` (it joins `a.alias = l.bound_alias`, matches `l.bound_alias = x.remote_alias` and takes the project id alone), but its EXISTS writes the conditions of `boundAliasesOf` (levels.ts:82-85) again by hand: destination, `level != 'local'`, `disabled = 0`, and the alias still being one of the project's. That leaves two SQL texts of the binding rule that have to be kept in step, since a function cannot be called inside the query (Q2).
- F-2 · advisory · src/team/validate.ts:37 · `export { entryBytes, parseEntryUid }` re-exports `parseEntryUid`, but nothing imports it from validate.ts (push.ts, sync/inbound.ts, sync/outbound.ts and sync/conflicts.ts all import it from contract.ts), so it is an unused second way in to the one parser (Q8).
- F-3 · advisory · src/team/contract.ts:26 · `ENTRY_UID` is exported, but only `parseEntryUid` in the same file reads it, so the grammar is published beside its one parser and nothing uses it (Q8).
- F-4 · advisory · src/modules/knowledge/tools.ts:115 · `receivedScope` only wraps its argument as `{ projectId }`, while contribute.ts:238 and cli/commands/knowledge.ts:231 write the same object inline. With `ReceivedScope` now down to one field, the helper is a layer that only forwards (Q5).

## Outside the change
- none

## Not answerable
- Q1 to Q10 for the hunks this round did not reach · I read only the code behind the fifth round's changes and their callers: src/team/contract.ts, src/team/validate.ts, src/modules/knowledge/index-store.ts (the received reads), tools.ts, contribute.ts, author.ts, src/sharing/levels.ts, src/sync/inbound.ts, ledger.ts, conflicts.ts, outbound.ts (the withdrawal scan), received.ts (reindex and reconcile), src/cli/commands/knowledge.ts (`take`), ui/src/components/settings/Sharing.vue (`serverChange`), src/sync/join.ts (the mute mark) and ADR 0027's fifth-round bullet. I did not re-read the tests, the other ui/src files (Servers.vue's layout change included), scripts/proof/*, backup, move, compact, db, run, spawn, servers, report, the rest of src/team/*, src/ui/* or the migrations.
- Q11 (prose a rewrite changes) · I did not compare the CLAUDE.md, README.md or ADR 0024 to 0026 hunks against their old text. ADR 0027's fifth-round bullet is new text, not a rewrite, and each of its claims matches the code as it is now.
- Round 4's findings, checked in the current code · Fixed: F-1 (`RECEIVED_VISIBLE` reads `l.bound_alias` by project id; `ReceivedScope` is `{ projectId }`; `hostLedAliasOf` is gone), F-2 (one `parseEntryUid` in contract.ts:36, returning a union discriminated on scope; conflicts.ts:13 and validate.ts:23 import it), F-3 (`aliasBoundTo` is `boundAliasesOf(...).includes(alias)`, levels.ts:97), F-4 (reason `agentName(...) || remote.member.id`, conflicts.ts:138), F-5 (both paths call `deletePendingRowsUpTo`, inbound.ts:374 and 494), and F-6 at inbound.ts:320 (the guard is gone). One piece of F-6 still stands as an advisory and is not repeated as a finding: the `alias !== null` and `?? ""` guards at outbound.ts:748-749.
