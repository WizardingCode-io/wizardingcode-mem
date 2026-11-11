# architecture findings for 2026-11-10-002-part-6-of-the-knowledge-and-team-journey
reviewer: review-architecture
read: the rubric; my round 5 findings (review/architecture.round5.md) and all of the judge's round 5 rulings (review/ruling.round5.json); the sixth-round bullet in docs/adr/0027-sync-client.md (line 98); the new leaf ui/src/sharing-text.ts in full; how ui/src/components/settings/Sharing.vue imports and uses it (lines 9 and 92-100), next to how the other viewer leaves (format, links, markdown) are imported; src/team/contract.ts (ENTRY_UID at line 26, which only parseEntryUid reads at line 37, RESULT_SHAPES at lines 74-104, RefusalShape at line 269); src/modules/knowledge/tools.ts lines 205-290 (the received scope built inline at 213 and 284) and every ReceivedScope caller in contribute.ts and received-ref.ts; the imports of tests/unit/team-validate.test.ts (lines 1-16); a grep of src/sync for its SQL over the knowledge tables. Across the round 5 to round 6 changes that is 6 files (ui/src/sharing-text.ts, ui/src/components/settings/Sharing.vue, src/team/contract.ts, src/modules/knowledge/tools.ts, tests/unit/team-validate.test.ts, docs/adr/0027-sync-client.md).

## Findings
- F-1 · advisory · src/sync/outbound.ts:322 · Carried unchanged from round 2, and the judge kept it as an advisory in round 5. The sync still runs its own SQL over the knowledge module's tables: `knowledge_repos` here, `knowledge_entries` at outbound.ts:379 and conflicts.ts:69, and `knowledge_proposals` at conflicts.ts:172. sync-boundary.test.ts pins only the sharing tables, so no test guards this coupling to the module's schema. Fix: move these reads into the module (index-store.ts or store.ts) and call them from the sync. (Q1)
- F-2 · advisory · src/team/contract.ts:104 · Carried unchanged from round 2. `RefusalShape` (contract.ts:269) declares `accepted` and `retryAfterSec`, and the client reads both, but `RESULT_SHAPES.refusal`, the list the contract fingerprint pins, names only `error`, `instance` and `serverId`. Fix: add the optional refusal keys to the pinned list (a contract bump), or check each answer type against its RESULT_SHAPES entry. (Q3)

The round 6 changes stay inside the base:
- **`serverChange`** is a leaf with no imports in ui/src/, beside format.ts, links.ts and markdown.ts. Sharing.vue imports it the way those leaves are imported (`"../../sharing-text"`, no extension, as the Vue files do with `../../format`). The rule now lives in one place, used by both the card and its test.
- **`ENTRY_UID`** is no longer exported. `parseEntryUid` stays the one parser in contract.ts that every reader imports, so the grammar is unchanged and no reader is affected.
- **The received scope** is built inline (`{ projectId }`) at tools.ts:213 and :284, the same way contribute.ts:238 builds it. The ReceivedScope contract in index-store.ts:920 is unchanged.
- **tests/unit/team-validate.test.ts** imports `parseEntryUid` from src/team/validate.ts again, as the base did. validate.ts re-exports it from contract.ts, so the server's tests keep the base's import while the client and server share one parser.
- **The ADR** has a bullet for every one of these changes (0027:98).

## Outside the change
- none

## Not answerable
- none
