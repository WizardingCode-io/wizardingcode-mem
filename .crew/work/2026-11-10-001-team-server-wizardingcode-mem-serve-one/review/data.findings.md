# data findings for 2026-11-10-001-team-server-wizardingcode-mem-serve-one
reviewer: review-data
read: 6 files (review/data.round5.md, review/ruling.round5.json, the rubric, src/team/store.ts:630-654, tests/unit/team-db.test.ts:195-224, docs/real-use/findings.md), plus the diff's file list and its tests/unit/knowledge-git-host.test.ts hunk (diff.patch:11704-11812). I did not re-read the schema and migrations this round. In round 5 they were 0001_team_init.sql, the team opens in src/team/db.ts and src/store/db.ts's busy_timeout. The only change since then is a test formatted by biome, so they still hold. Risk areas: data-migration, personal-data.

## Findings
- F-1 · advisory · tests/unit/team-db.test.ts:202 · Carried from round 5, and the line still matches. The `checkpointWal` test covers only the case with no reader. Two paths are untested: a held reader, where the call should return `false` within the 200 ms wait with the busy timeout put back, and a throw inside the `try`, where the `finally` should restore the timeout. The code at src/team/store.ts:640-647 handles both correctly (rubric question 6, availability). docs/real-use/findings.md:43 records this as deferred.

## Outside the change
none

## Not answerable
- Availability (rubric question 6): whether an upgrade migration of `team.db` holds the write lock across a long step · only migration 1 exists, and it creates a new file.

## Round 5
- The round-5 state holds on the current diff. The only source change since round 5 is tests/unit/knowledge-git-host.test.ts (diff.patch:11704-11812), a new unit test of the git runner's host:
  - It covers the author and committer environment, the ceiling directory, the timeout order, the order of the extra configuration, and `commitPaths` with a committer.
  - It runs no SQL, touches no schema, migration or stored table, and adds no column holding personal data. Its author and server identities are fixtures on `.invalid` domains.
  - It raises no data finding.
- The code cited in round 5 is unchanged and at the same lines:
  - src/team/store.ts:637-648, `checkpointWal`: it reads the timeout at :640, sets the wait at :641, runs TRUNCATE at :643 and restores the timeout in the `finally` at :646.
  - tests/unit/team-db.test.ts:202-212: the test has no reader and no throw.

Paths: /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/team/store.ts, /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/unit/team-db.test.ts, /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/unit/knowledge-git-host.test.ts, /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/docs/real-use/findings.md
