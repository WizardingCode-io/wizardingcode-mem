# architecture findings for 2026-11-10-001-team-server-wizardingcode-mem-serve-one
reviewer: review-architecture
read: the rubric; review/architecture.round5.md and review/ruling.round5.json; the file headers in review/diff.patch (63 paths); the full hunk of tests/unit/knowledge-git-host.test.ts (diff.patch:11704-11812, a new file of 103 lines); src/team/mirror.ts:1-30 in the current tree; docs/real-use/findings.md:44

The round-5 state holds:
- **What changed since round 5.** The only source change is biome's formatting of tests/unit/knowledge-git-host.test.ts. That file is a test. It imports only the knowledge store's public runner (`commitPaths`, `ensureRepo`, `GitHost`, `gitEnv`, `knowledgeRoot`, `runGit` from src/modules/knowledge/repo.ts) and the test helpers. It holds no SQL, no contract and no schema, so it crosses no boundary the base draws. Formatting cannot move a boundary or change a model, a contract or an integration.
- **The round-5 advisory.** It is unchanged. src/team/mirror.ts:25 still imports `deviceAlias`, `memoryFeedUid` and `parseFeedUid` from ./push.ts. It is recorded as deferred at docs/real-use/findings.md:44 ("the feed-uid helpers live in `push.ts` while the folder keeps key formats in `ids.ts`").
- **Everything else.** It is as round 5 found it, since none of it changed. Every SQL statement is in src/team/store.ts, which team-store-boundary.test.ts checks. types.ts is still a leaf. Nothing new is shared between processes. ADR 0026's data model matches the `meta` keys mirror.ts keeps.

## Findings
- F-1 · advisory · src/team/mirror.ts:25 · Carried from rounds 4 and 5, and recorded as deferred in docs/real-use/findings.md:44. The feed-uid helpers (`deviceAlias`, `memoryFeedUid`, `parseFeedUid`) stay in the push handler, and the mirror imports them from there. The base is silent on where they belong, so this is a convention point, not a boundary crossed.

## Outside the change
none

## Not answerable
none
