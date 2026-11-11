# security findings for 2026-11-10-002-part-6-of-the-knowledge-and-team-journey
reviewer: review-security
read: 11 files, risk areas: auth, personal-data, data-migration, public-api

## Findings
- F-1 · advisory · src/sync/inbound.ts:137 · Unchanged. Pull-page items (`payload.title`/`body`/`createdAt`, `member.id`/`name`, `seq`) get no shape check where they enter, and `client.ts` reads the whole answer body with no size cap. Path components are still checked (`naming.ts`), entry uids now go through the server's strict `parseEntryUid` (a uid that does not parse is skipped), and a throw sets the row aside (public-api).
- F-2 · advisory · src/sync/inbound.ts:216 · Unchanged. A received memory is filed under whichever enabled local project holds `item.remoteAlias` (`projectIdOf`), with no `aliasBoundTo` check against the sending server. The entry path makes that check (`readsRange`, line 320), and so do the knowledge reads (`RECEIVED_VISIBLE`). The brief and the prompt keep the row out, and only the receiving member can see it (personal-data).
- F-3 · advisory · src/sync/inbound.ts:262 · Unchanged. Received memories become ordinary `memories` rows. `memory_search`, the viewer and `findNeighbours` apply no mute or binding check, so a muted member's note can reach the agent through search and, with TypeSafe on, can go to the model provider as a consolidation neighbour (personal-data).
- F-4 · advisory · src/backup/backup.ts:359 · Unchanged. After a restore whose copy names servers that are no longer listed, deleting their received copies waits for a manual `sync --once`, since `startSync` answers `no-server`. The CLI tells the person to run it (personal-data).
- F-5 · advisory · src/cli/commands/share.ts:421 · Unchanged. `--code <code>` is still accepted and advertised, and on argv the invitation code shows in shell history and `ps`. When `--code` is absent the code is asked with no echo, and the usage text says so (auth).
- F-6 · advisory · src/sync/join.ts:281 · Unchanged. `share server remove` only forgets the token locally. The device stays valid on the server until an admin revokes it, so an earlier copy of `servers.json` still authenticates. The person is told this (auth).
- F-7 · advisory · src/ui/servers-api.ts:287 · Unchanged. `resumeRoute`'s yes releases what exists at that moment, not the preview the person was shown, and `addServerRoute`'s yes confirms whatever row is pending for the URL. Nothing beyond the policy is sent (auth).

Checked and clean in this round's changes:
- `RECEIVED_VISIBLE` (src/modules/knowledge/index-store.ts:949-961): its one parameter is the project id. A project item shows only when an enabled project's non-local level for that server has `bound_alias = x.remote_alias`, and that alias is still one of the project's aliases (`a.alias = l.bound_alias`). This is `boundAliasesOf`'s rule. A null project id (`--global`) shows no project items. The server must be listed, confirmed and unmuted, and muted members stay out. No caller passes an alias any more (tools.ts:115, contribute.ts:238), so the read cannot widen.
- Round 4's F-1 is closed. `identityOf` (src/modules/knowledge/author.ts:58-64) puts a member id outside `MEMBER_ID` into `GIT_AUTHOR_EMAIL` as a 16-hex hash, and the author name is `agentName(name)` or that id.
- The applied row's reason (src/sync/conflicts.ts:138) can fall back to the raw member id. Its only reader, `provenanceOf` (src/modules/knowledge/received-ref.ts:23), passes it through `agentName` before it reaches the agent, and `entryLine` adds `inert`. Nothing raw reaches the hook's text.
- `parseEntryUid` (src/team/contract.ts:36-49) is the server's previous grammar moved unchanged. The server's acceptance does not change (public-api). On the client a uid that does not parse is skipped on upsert. On a tombstone, `readsRange` gives false and the copy is deleted by uid, so erasure of an earlier copy is not blocked (personal-data).

## Outside the change
- src/mcp (memory_search) · An existing tool this diff does not touch. It reads `memories` with no notion of received, muted or unbound rows, and it is the reader behind F-2 and F-3. This is debt.
- src/distill/consolidate.ts:50 · An unchanged neighbour search over every active memory of a project, which now also covers teammates' copies (F-3). This is debt.

## Not answerable
- public-api: does a test pin the client's reading of the `/v1` answers (`FeedItemShape`, `PullPageShape`, `JoinAnswer`) · Still not established. I did not confirm that the `RESULT_SHAPES` fingerprint in src/team/contract.ts covers the hand-written answer types the client relies on. The architecture gate's carried advisory says `RESULT_SHAPES.refusal` lacks `accepted` and `retryAfterSec`.

Files referenced (absolute):
/Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/modules/knowledge/index-store.ts
/Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/modules/knowledge/author.ts
/Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/modules/knowledge/received-ref.ts
/Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/modules/knowledge/contribute.ts
/Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/modules/knowledge/tools.ts
/Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/team/contract.ts
/Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/sync/conflicts.ts
/Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/sync/inbound.ts
