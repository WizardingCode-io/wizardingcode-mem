# security findings for 2026-11-10-002-part-6-of-the-knowledge-and-team-journey
reviewer: review-security
read: 14 files, risk areas: auth, personal-data, data-migration, public-api

## Findings
- F-1 · advisory · src/modules/knowledge/author.ts:52 · Partly closed since round 2: the hook's received lines (contribute.ts:167-169) now go through `provenanceOf` and `refOfHit` in received-ref.ts, which pass member and server names through `agentName`. What is still open: the sync writer's git author still uses the server-supplied `writer.member.name`, and `writer.member.id` inside the email, as sent (`remote.member` from conflicts.ts:127). The same unchecked name is also stored as the ledger `reason` (conflicts.ts:147). Only a hostile or compromised server could send control characters here, since the team server's `checkName` refuses line breaks, so this is boundary hardening (personal-data).
- F-2 · advisory · src/sync/inbound.ts:136 · Unchanged from round 2. Pull-page items (`payload.title`/`body`/`createdAt`, `member.id`/`name`, `seq`) are used without a shape check where they enter. `client.ts:240` also reads the whole answer body with `response.text()` and no size cap. Path components are still well checked (`naming.ts`), and a throw sets the row aside, so this is hardening of the client's reading of the `/v1` answers (public-api).
- F-3 · advisory · src/sync/inbound.ts:215 · Unchanged. A received memory row is filed under whichever enabled local project holds `item.remoteAlias` (`projectIdOf`), with no `aliasBoundTo` check against the sending server; the entry path does make that check (line 319). The brief and the prompt keep the row out, and the audience is only the receiving member (personal-data).
- F-4 · advisory · src/sync/inbound.ts:261 · Unchanged. Received memories become ordinary `memories` rows. `memory_search`, the viewer and `findNeighbours` apply no mute or binding check. So a muted member's note can reach the agent through search, and with TypeSafe on it can be sent to the model provider as a consolidation neighbour (personal-data).
- F-5 · advisory · src/backup/backup.ts:359 · Unchanged. After a restore whose copy names servers that are no longer listed, deleting those servers' received copies (`pendingDeletion`) waits for the sync's next start. With no listed server, `startSync` answers `no-server`, so the erasure waits for a manual `sync --once`, which the CLI tells the person to run (personal-data).
- F-6 · advisory · src/cli/commands/share.ts:415 · Unchanged. `--code <code>` takes the invitation code on argv, where shell history and `ps` expose it. The usage lines (66-67) advertise only `--code`; the no-echo `askSecret` prompt is used only when `--code` is absent (auth).
- F-7 · advisory · src/sync/join.ts:281 · Unchanged. `share server remove` only forgets the token locally. The device stays valid on the server until an admin revokes it, so an earlier copy of `servers.json` still authenticates. The person is told this (auth).
- F-8 · advisory · src/ui/servers-api.ts:287 · Unchanged. `resumeRoute`'s yes computes the previews again and releases what exists at that moment, not what the person was shown. `addServerRoute`'s yes (line 144) confirms whatever row is pending for the URL. Nothing beyond the policy is sent (auth).

Checked and clean in this round's changes:
- `setServerLists` (src/sharing/store.ts:519-573) now refuses an unconfirmed widening inside `withWrite`. An empty server list means nothing is allowed (policy.ts:243-247), so going from empty to a list counts as a widening, and no narrowing is misread as one.
- The viewer's server actions now log `source: "viewer"`.
- The 200 `ok: false` answers of `POST /api/servers` are behind the viewer's bearer token (server.ts:279-282). The viewer's client raises them as route errors (`okOrThrow`, ui/src/api.ts:311-314), so a refusal is never read as a join.
- `GET /api/servers`'s `serversUnavailable` answer (server.ts:529-534) carries no token. The logged `TokenFileError` messages (servers.ts:39-50) name the path and the problem, never the file's contents.

## Outside the change
- src/mcp (memory_search) · An existing tool that this diff does not touch. It reads `memories` with no notion of received, muted or unbound rows; it is the reader behind F-3 and F-4. This is debt.
- src/distill/consolidate.ts:50 · An unchanged neighbour search over every active memory of a project, which now also covers teammates' copies (F-4). This is debt.

## Not answerable
- public-api: does a test pin the client's reading of the `/v1` answers (`FeedItemShape`, `PullPageShape`, `JoinAnswer`) · Still unconfirmed: I did not establish that the `RESULT_SHAPES` fingerprint in src/team/contract.ts covers the hand-written answer types the client relies on. The architecture gate's advisory on contract.ts:236 says `RESULT_SHAPES.refusal` lacks `accepted` and `retryAfterSec`.

Files referenced (absolute):
/Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/modules/knowledge/author.ts
/Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/modules/knowledge/received-ref.ts
/Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/modules/knowledge/contribute.ts
/Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/sync/conflicts.ts
/Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/sync/inbound.ts
/Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/sync/client.ts
/Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/sync/servers.ts
/Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/sync/join.ts
/Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/sharing/store.ts
/Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/sharing/policy.ts
/Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/ui/servers-api.ts
/Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/ui/server.ts
/Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/ui/src/api.ts
/Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/backup/backup.ts
/Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/cli/commands/share.ts
