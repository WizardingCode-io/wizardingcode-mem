# code-quality findings for 2026-11-10-002-part-6-of-the-knowledge-and-team-journey
reviewer: review-code-quality
read: 8 files, 7 hunks

## Findings
- F-1 · advisory · ui/src/components/settings/Sharing.vue:99 · The card decides whether a `server:<id>` row is a mute with its own `/^mute/` test on `change.old` to pick the fallback name. This repeats, in looser form, the `/^mute(?::(.+))?$/` reading that now lives in `serverChange` (ui/src/sharing-text.ts:10). So what a mute row looks like is written in two files, and only one of them is tested (Q2).

## Outside the change
- none

## Not answerable
- Q1 to Q10 for the hunks this round did not reach · I read only the code behind the sixth round's changes and their callers: ui/src/sharing-text.ts, ui/src/components/settings/Sharing.vue (the `lastChange` computed), tests/unit/ui-sharing-text.test.ts, src/team/contract.ts (the uid grammar and `parseEntryUid`), src/team/validate.ts (the re-export and its users), tests/unit/team-validate.test.ts (the import), src/modules/knowledge/tools.ts (the received scope) and ADR 0027's sixth-round bullet. Everything else is as round 5 left it, and I did not read it again.
- Q11 (prose a rewrite changes) · I did not compare the CLAUDE.md, README.md or ADR 0024 to 0026 hunks against their old text. ADR 0027:98 is new text, not a rewrite, and each of its claims matches the code as it is now.
- Round 5's advisories, checked in the current code · F-2 is resolved: validate.ts:37's re-export is now used, because tests/unit/team-validate.test.ts:3-8 imports `parseEntryUid` from validate.ts. F-3 is fixed: `ENTRY_UID` (contract.ts:26) is a module-private const. F-4 is fixed: `receivedScope` is gone, and tools.ts:213 and 284 build `{ projectId }` inline. F-1 (`RECEIVED_VISIBLE` writing the binding conditions of `boundAliasesOf` again in SQL, index-store.ts:957) still stands as an advisory and is not repeated as a finding.
