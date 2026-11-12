# architecture findings for 2026-11-11-005-share-a-project-without-a-git-remote-tod
reviewer: review-architecture
read: the rubric; architecture.round1.md and ruling.round1.json; CLAUDE.md (the diff's hunks, including the new "Shared names" bullet); ADR 0028 (whole: identity, the name of a project, the two-phase bind, the contract spoken, the schemas and rollbacks, the boundary, What building changed, Known limits); ADR 0027:102 as amended; src/team/contract.ts (RESULT_SHAPES, the fingerprint, the answer types); src/team/routes.ts (the names routes and the error handler with IDS_ON); src/team/auth.ts checkContract; src/sync/client.ts (failureOf, retryAfterMs); src/sync/binding.ts (whole, from the diff); src/sync/servers.ts (the diff hunk: spokenAfterMe, lowerContract, CONTRACT_READ_MS, heldByContract); src/core/identity.ts (whole); src/sync/inbound.ts recreatedName; src/cli/commands/share.ts (imports and the names-held lines); ui/src/components/ProjectsView.vue (imports and prefix uses); tests/unit/sync-boundary.test.ts hunk; tests/unit/team-contract.test.ts shape pins. 97 files in files.txt; the diff index read and the round-2-relevant hunks read in full. Grep checks for the contract rule (`Math.min(CONTRACT`, spokenAfterMe, lowerContract), `ALIAS_KINDS` readers, `accepted` and `retryAfterSec`, and the viewer's SQL on project_aliases and sharing_levels.

## Findings
- F-1 · advisory · src/team/contract.ts:259 · Round 1's F-5 still stands. `FeedItemShape.nameId` is typed as required (`string | null`), but a contract-1 server never sends it. `recreatedName` (src/sync/inbound.ts:176) tests only `=== null`, so an `undefined` would get past that test. Today nothing reaches it, because names are held at contract 1. Type the field `nameId?: string | null`, or normalise `undefined` to `null` when the page is read.
- F-2 · advisory · src/sync/servers.ts:461 (with src/sync/binding.ts:222, :311, :379) · ADR 0028 makes contract 2 the one that brought names. `heldByContract` (`server.contract < 2`) and binding's `< 2` checks write that as a bare literal, with no named constant beside `CONTRACT` and `ACCEPTED_CONTRACTS`. Also, the doc comment "Whether an alias is held out of the sync while the server speaks 1" at servers.ts:430 now sits above `CONTRACT_READ_MS`, separated from the function it describes.
- F-3 · advisory · ui/src/components/ProjectsView.vue:168 · `listedName` builds `` `name:${slug}` `` by hand, though the page already imports `NAME_PREFIX` from the identity leaf (line 9). This is what is left of round 1's F-4: one literal prefix outside the leaf.

The upheld round-1 defect is resolved, so it is not raised again here:
- src/team/contract.ts:109 and :111 pin `contractRefusal` (with `accepted`) and `nameConflict` (with `name`).
- `RefusalShape` (contract.ts:298) drops `retryAfterSec` and gains `name?: NameItemShape`.
- The fingerprint was repinned, and tests/unit/team-contract.test.ts:46-47 pins both shapes.
- The server's 409s match these shapes: routes.ts:546, auth.ts:48, and IDS_ON adds the ids on 409.
- ADR 0027:102 is now in the past tense, and ADR 0028:57 names the pins.

Round 1's other advisories are also settled:
- F-2: identity.ts builds `isTeamAlias`, `stripTeamPrefix`, `PREFIXES` and `TEAM_ALIAS_SQL` from `ALIAS_KINDS`.
- F-3: share.ts:521 calls `heldByContract`.
- F-6: ADR 0028 "What building changed" records the per-row assembly in routes.ts.
- F-7: ADR 0028:33 and CLAUDE.md name the `slugCore` export.
- F-8: ADR 0028:33 makes the sharing store the one writer of a `name:` row in `project_aliases`.

The round-1 fixes add no new boundary crossing:
- The contract rule is one function. `spokenAfterMe` and `lowerContract` in servers.ts are applied by run.ts:102, binding.ts:203 and join.ts:165, with one deadline, `CONTRACT_READ_MS`.
- binding.ts is on the sync-boundary quiet list and names no sharing table.

## Outside the change
- src/sync/client.ts:103 · `retryAfterMs` still falls back to a body `retryAfterSec`. The server has always moved that value to `Retry-After` (routes.ts:647), so the fallback reads a field no server sends. This is harmless debt from contract 1.
- src/mcp/tools.ts:88, src/mcp/links-tool.ts:61 · Inline `SELECT name FROM projects` lookups, with no shared helper. `share status` (src/cli/commands/share.ts:525) repeats the pattern.
- src/core/project.ts:87, src/links/suggest.ts:42, src/modules/knowledge/resolve.ts:29 · Literal `remote:`/`gitdir:` prefixes outside the identity leaf. They ask about git remotes and folders, not team identity, so they stay on purpose (a non-goal of the spec).

## Not answerable
none
