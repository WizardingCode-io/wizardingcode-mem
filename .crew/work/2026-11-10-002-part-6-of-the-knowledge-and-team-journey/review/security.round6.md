# security findings for 2026-11-10-002-part-6-of-the-knowledge-and-team-journey
reviewer: review-security
read: 8 files, risk areas: auth, personal-data, data-migration, public-api

## Findings
- F-1 · advisory · src/sync/inbound.ts:137 · Unchanged from round 5. Items on a pull page (`payload.title`/`body`/`createdAt`, `member.id`/`name`, `seq`) are not shape-checked where they enter, and `client.ts` reads the whole answer body with no size cap. Path parts are checked (`naming.ts`), entry uids go through the strict `parseEntryUid` (a bad uid is skipped), and an item that throws is set aside (public-api).
- F-2 · advisory · src/sync/inbound.ts:216 · Unchanged. A received memory is filed under whichever enabled local project holds `item.remoteAlias`, with no `aliasBoundTo` check against the server that sent it. The entry path does make that check (`readsRange`), and so does `RECEIVED_VISIBLE`. The brief and the prompt keep the row out, and only the receiving member can see it (personal-data).
- F-3 · advisory · src/sync/inbound.ts:262 · Unchanged. Received memories become ordinary `memories` rows. Neither `memory_search` nor the consolidation neighbours check mute or binding, so a muted member's note can reach the agent through search, and with TypeSafe on it can reach the judge as a neighbour (personal-data).
- F-4 · advisory · src/backup/backup.ts:359 · Unchanged. After a restore, the received copies of servers that are no longer listed are only deleted when someone runs `sync --once` by hand. The CLI tells the person to run it (personal-data).
- F-5 · advisory · src/cli/commands/share.ts:421 · Unchanged. `--code <code>` is still accepted, so an invitation code typed on the command line shows in shell history and `ps`. A no-echo prompt exists for when `--code` is left out, and the usage text names it (auth).
- F-6 · advisory · src/sync/join.ts:281 · Unchanged. `share server remove` only forgets the token on this machine. The device stays valid on the server until an admin revokes it, and the person is told so (auth).
- F-7 · advisory · src/ui/servers-api.ts:287 · Unchanged. The resume and add confirmations act on the state at the moment of the yes, not on the preview the person was shown. Nothing beyond the policy is sent (auth).

Checked and clean in this round's changes:
- ui/src/sharing-text.ts:9-17 · `serverChange` is a pure function over values from the sharing log, with no imports. Its output is shown through Vue text interpolation, so nothing new is injected.
- src/team/contract.ts:26 · `ENTRY_UID` is now private to the file. `parseEntryUid` is unchanged, and so is what the server accepts (public-api).
- src/modules/knowledge/tools.ts:213,284 · The received scope is now built inline as `{ projectId: context.projectId }`. It is the same one-field object `receivedScope` returned, and no alias or caller-supplied value enters it, so `RECEIVED_VISIBLE` cannot widen.
- No request, token, path or SQL changed since round 5.

## Outside the change
- src/mcp (memory_search) · Debt. This existing tool, which the diff does not touch, reads `memories` with no notion of received, muted or unbound rows. It is the reader behind F-2 and F-3.
- src/distill/consolidate.ts:50 · Debt. This unchanged neighbour search runs over every active memory of a project, which now includes teammates' copies (F-3).

## Not answerable
- public-api: does a test pin how the client reads the `/v1` answers (`FeedItemShape`, `PullPageShape`, `JoinAnswer`)? · Still not established. I could not confirm that the `RESULT_SHAPES` fingerprint in src/team/contract.ts covers these hand-written answer types. The architecture gate's carried advisory says `RESULT_SHAPES.refusal` lacks `accepted` and `retryAfterSec`.

Files referenced (absolute):
/Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/ui/src/sharing-text.ts
/Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/team/contract.ts
/Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/modules/knowledge/tools.ts
/Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/sync/inbound.ts
