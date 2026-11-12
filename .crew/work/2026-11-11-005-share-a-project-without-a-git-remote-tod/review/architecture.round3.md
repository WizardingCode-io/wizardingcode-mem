# architecture findings for 2026-11-11-005-share-a-project-without-a-git-remote-tod
reviewer: review-architecture
read: I read the rubric, architecture.round2.md and ruling.round2.json. In the diff I read the index and the runbook hunks (docs/runbooks/team-server.md: erasing a name, upgrade, rollback, naming a project, status). I then checked the round-2 fixes against the current code: src/sync/servers.ts:420-463 (`CONTRACT_READ_MS`, `lowerContract`, `spokenAfterMe`, `heldByContract` with its doc comment); ui/src/components/ProjectsView.vue (`NAME_PREFIX` at :9, :164, :168, and the `exists` branch at :338); src/sharing/types.ts:65-80 (the name-flag doc, `NAME_STATES`, `nameFlagKey`). I grepped for: the bare contract literal `< 2`; `nameId` readers; who uses `nameFlagKey`, and the `'names.%'` literal in src/backup/backup.ts:238; the runbook's claims against the code (`names held (server at contract …)` in src/status/report.ts:213, `removed by the operator` in report.ts:227, share.ts:463 and Servers.vue:67, `namesPerHour: 10` in src/team/server.ts:36). files.txt lists 97 files.

## Findings
- F-1 · advisory · src/team/contract.ts:259 · Carried from round 2's F-1 and not changed. `FeedItemShape.nameId` is typed `string | null` and required, but a contract-1 server never sends it. `recreatedName` (src/sync/inbound.ts:176) tests only `=== null`. Names are held at contract 1, so nothing reaches the gap today. Type the field `nameId?: string | null`, or normalise it to `null` when the page is read.
- F-2 · advisory · src/sync/servers.ts:462 (and src/sync/binding.ts:222, :311, src/sync/state.ts:520, src/team/routes.ts:69) · Carried from round 2's F-2, partly resolved. The doc comment is back above `heldByContract` (servers.ts:460), and `CONTRACT_READ_MS` has its own comment (:430). ADR 0028 says contract 2 brought names. That contract is still a bare `2` in five places, on both the client and the server, with no named constant beside `CONTRACT` and `ACCEPTED_CONTRACTS`.
- F-3 · advisory · src/backup/backup.ts:238 · A restore clears the name flags with its own literal `'names.%'`, outside `nameFlagKey` (src/sharing/types.ts:78). The leaf now documents restore as one of the places that clear the flags (types.ts:70-71), so this is a second spelling of a key format the leaf owns. Neighbouring keys (`sync.%`) are written the same way, so the drift is only in naming. A prefix exported from the leaf would close it.

Round 2's ProjectsView finding (F-3) is resolved: `listedName` (ProjectsView.vue:168) now builds the alias as `` `${NAME_PREFIX}${slug}` ``, and no literal `name:` prefix is left in ui/src. The round-3 additions cross no boundary:
- **The new 409 branch** (ProjectsView.vue:338) reads `reason === "exists"` and `name`, which is the `nameConflict` shape pinned in src/team/contract.ts.
- **The flag doc** matches the code that clears the flags: the bind and Nothing (src/sharing/store.ts:516), the server's removal (src/sync/ledger.ts:842), and a restore (backup.ts:238).
- **The runbook's claims** match the code: `serve purge name`, the status wording, `names held (server at contract 1)`, the doctor warning, and 10 names an hour.

## Outside the change
- src/sync/client.ts:103 · `retryAfterMs` still falls back to a body `retryAfterSec`, a field no server sends. This is debt from contract 1.
- src/mcp/tools.ts:88, src/mcp/links-tool.ts:61 · Project names are still looked up with inline `SELECT name FROM projects`, with no shared helper.
- src/core/project.ts:87, src/links/suggest.ts:42, src/modules/knowledge/resolve.ts:29 · The literal `remote:`/`gitdir:` prefixes sit outside the identity leaf. They answer questions about git, not team identity, and the spec leaves them on purpose.

## Not answerable
none
