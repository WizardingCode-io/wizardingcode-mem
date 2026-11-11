# security findings for 2026-11-10-002-part-6-of-the-knowledge-and-team-journey
reviewer: review-security
read: 12 files, risk areas: auth, personal-data, data-migration, public-api

## Findings
- F-1 · advisory · src/modules/knowledge/author.ts:56 · Mostly closed since round 3. The git author name (author.ts:55) and the ledger reason (conflicts.ts:149) now go through `agentName`. What is still open: on the own-revision path (`applyOwnRevision`, inbound.ts:147-156), `writer.member.id` goes into `GIT_AUTHOR_EMAIL` (repo.ts:395) as the server sent it. Nothing runs it through `checkComponent("member", …)`, which only the workspace folder path (naming.ts:75) applies. Only a hostile or compromised server could put odd characters in it, so this is boundary hardening (personal-data).
- F-2 · advisory · src/sync/inbound.ts:137 · Unchanged. Pull-page items (`payload.title`/`body`/`createdAt`, `member.id`/`name`, `seq`) are used with no shape check where they enter, and `client.ts` reads the whole answer body with no size cap. Path components are still checked (`naming.ts`), and a throw sets the row aside (public-api).
- F-3 · advisory · src/sync/inbound.ts:216 · Unchanged. A received memory is filed under whichever enabled local project holds `item.remoteAlias` (`projectIdOf`), with no `aliasBoundTo` check against the sending server. The entry path makes that check (line 320), and since this round it is narrowed to the alias the level names. The brief and the prompt keep the row out, and only the receiving member can see it (personal-data).
- F-4 · advisory · src/sync/inbound.ts:262 · Unchanged. Received memories become ordinary `memories` rows. `memory_search`, the viewer and `findNeighbours` apply no mute or binding check. So a muted member's note can reach the agent through search and, with TypeSafe on, can go to the model provider as a consolidation neighbour (personal-data).
- F-5 · advisory · src/backup/backup.ts:359 · Unchanged. After a restore whose copy names servers that are no longer listed, deleting their received copies waits for a manual `sync --once`, since `startSync` answers `no-server`. The CLI tells the person to run it (personal-data).
- F-6 · advisory · src/cli/commands/share.ts:421 · Narrowed. The usage text (lines 66-68) now says the code is asked with no echo when `--code` is absent. `--code <code>` is still accepted and still advertised first, and on argv the invitation code shows in shell history and `ps` (auth).
- F-7 · advisory · src/sync/join.ts:281 · Unchanged. `share server remove` only forgets the token locally. The device stays valid on the server until an admin revokes it, so an earlier copy of `servers.json` still authenticates. The person is told this (auth).
- F-8 · advisory · src/ui/servers-api.ts:287 · Unchanged. `resumeRoute`'s yes releases what exists at that moment, not the preview the person was shown. `addServerRoute`'s yes confirms whatever row is pending for the URL. Nothing beyond the policy is sent (auth).

Checked and clean in this round's changes:
- `aliasBoundTo` (src/sharing/levels.ts:96-106) now requires `l.bound_alias = ?` as well as the alias join. It agrees with `boundAliasesOf`, and its callers (inbound.ts:320, received.ts:388) can only read less than before. Nothing widens.
- The hourly re-apply (inbound.ts:489-497) uses `deletePendingRowsUpTo` (ledger.ts:439-452, `seq <= ?` on one server and one uid). An older failed row, a tombstone or purge included, can no longer come back over a newer revision that applied, and erasure stays satisfiable. A newer row that still fails is kept, and the rows run oldest first.
- `agentName` (src/core/agent-name.ts) strips C0 and DEL and cuts at 80 characters. If that leaves the name empty, the member id stands in, so no commit gets an empty author name.

## Outside the change
- src/mcp (memory_search) · An existing tool this diff does not touch. It reads `memories` with no notion of received, muted or unbound rows, and it is the reader behind F-3 and F-4. This is debt.
- src/distill/consolidate.ts:50 · An unchanged neighbour search over every active memory of a project, which now also covers teammates' copies (F-4). This is debt.

## Not answerable
- public-api: does a test pin the client's reading of the `/v1` answers (`FeedItemShape`, `PullPageShape`, `JoinAnswer`) · Still unconfirmed. I did not establish that the `RESULT_SHAPES` fingerprint in src/team/contract.ts covers the hand-written answer types the client relies on. The architecture gate's carried advisory says `RESULT_SHAPES.refusal` lacks `accepted` and `retryAfterSec`.

Files referenced (absolute):
/Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/modules/knowledge/author.ts
/Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/core/agent-name.ts
/Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/modules/knowledge/repo.ts
/Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/sync/conflicts.ts
/Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/sync/naming.ts
/Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/sync/inbound.ts
/Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/sync/ledger.ts
/Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/sharing/levels.ts
/Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/cli/commands/share.ts
