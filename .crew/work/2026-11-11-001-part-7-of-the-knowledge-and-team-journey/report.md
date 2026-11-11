# Report: Part 7 of the knowledge and team journey, the runbook: docs/runbooks/team-server

- Work: `2026-11-11-001-part-7-of-the-knowledge-and-team-journey`
- Type: chore. Kind: feature (from work_type chore). Route: fast (chore in one spot, clear request, no risk area)
- CTO plan: none
- Packs: none
- Checklists: none read
- Verdict: **Proven**

## Knowledge

- K-363 · validated-solution · "Team server: wizardingcode-mem serve, one Docker image with SQLite and the repos" · alone · stack node, word part, word knowledge, word team, word server · likely 0.85
- K-371 · validated-solution · "Part 6 of the knowledge and team journey, the sync client: wizardingcode-mem kee" · alone · stack node, word part, word knowledge, word team, word journey, word server · unverified 0.45
- K-346 · validated-solution · "Sharing policy: per project local only, knowledge only, or knowledge and memory;" · alone · stack node, word part, word knowledge, word team, word server · unverified 0.72
- K-343 · validated-solution · "Knowledge for the agent: MCP tools (search, get, propose, update, taxonomy), the" · alone · stack node, word part, word knowledge, word team · unverified 0.5
- K-335 · validated-solution · "Knowledge store: entries as Markdown with frontmatter (kind knowledge, strategy," · alone · stack node, word part, word knowledge, word team · unverified 0.56
- K-319 · validated-solution · "Record why the drain skips a turn (saved, empty, not-worth, no-title) in turns.l" · alone · stack node, word knowledge, word docs · unverified 0.3
- K-316 · validated-solution · "Memory quality: knowledge, not records of a session (spec docs/superpowers/specs" · alone · stack node, word knowledge, word docs · unverified 0.54
- K-311 · validated-solution · "T-4 of 2026-10-15-001-memory-quality-knowledge-not-records-of: AC-5: heuristic j" · alone · stack node, word knowledge · unverified 0.36
- K-179 · documentation · "https://inertiajs.com/docs/v3/advanced/server-side-rendering · The SSR server is only required in production." / "To fully " · alone · word docs, word server · unlikely 0.1
- K-203 · documentation · "https://www.postgresql.org/docs/current/textsearch-tables.html · Another approach is to create a separate `tsvector` column t" · alone · word docs · unlikely 0.13
- Learned: not yet

## Acceptance criteria

| Id | Kind | Criterion | Test-first |
| :- | :- | :- | :- |
| AC-1 | behavior | docs/runbooks/team-server.md exists and tests/unit/team-runbook.test.ts proves its references against the code: every wizardingcode-mem command it cites is one the CLI knows (the command in src/cli/main.ts, the subcommand in that command's usage text), every WIZARDINGCODE_* variable it names is read somewhere under src/, every repository file it names exists, and every server log event it names is one src/team writes; the test fails on a name the code does not know. | red then green |
| AC-2 | observed | The runbook covers, in this order, the operator's side (the one-time step that makes the ghcr package public or the docker login that reads it, the first start and the bootstrap code in the log, invitations and roles, the upgrade, the rollback, the restore of the volume and serve instance renew, the lease's 30-second window, the log's events) and the member's side (joining from a fresh machine, the first run and status, the token file's place outside the store's backups, a revoked device and share server rejoin, a client restore with sync --once and share server resume, doctor's warnings); README's sync section, CLAUDE.md's team server bullet and ADR 0026 and 0027 point at it; a person reads each step against the command's usage. | observed: passes after (A document a person reads: docs/runbooks/team-server.md has the operator's side first (the one-time ghcr step, the first start and the bootstrap code, invitations and members, upgrade, rollback, the restore of the volume and serve instance renew, the lease's 30 seconds, the log's events) and the member's side after (joining from a fresh machine, the first run and status, the token file outside the store's backups, a revoked device and rejoin, a client restore with sync --once and resume, doctor, leaving, the client's log); README's sync section, CLAUDE.md's team server bullet, ADR 0026 and ADR 0027 point at it. The command run here is the test that holds its order, its links and every name it cites to the code; each step was read against the command's usage text in src/cli/commands/.) |

## Gates

| Gate | Target | Status | Command | Duration | Log |
| :- | :- | :- | :- | -: | :- |
| secrets | . | pass | `built-in secret scan` | 31 ms |  |
| prose | . | pass | `built-in prose scan` | 35 ms |  |
| build | . | pass | `bun run build` | 2988 ms | logs/build-_-1794394586074.txt |
| test | . | pass | `bun run test` | 199224 ms | logs/test-_-1794394589087.txt |
| lint | . | pass: 1 untouched file with problems, none of the item's | `bun run lint` | 95 ms | logs/lint-_-1794394788311.txt |
| typecheck | . | pass | `bun run typecheck` | 380 ms | logs/typecheck-_-1794394788408.txt |

## Verifications

| What | Ref | Answer | Confidence | Model | At |
| :- | :- | :- | -: | :- | :- |
| knowledge | K-371 | no 0.55 | - | jev-1.14.0 | 2026-11-11T10:50:58.970Z |
| knowledge | K-363 | yes 0.85 | - | jev-1.14.0 | 2026-11-11T10:50:58.970Z |
| knowledge | K-346 | yes 0.72 | - | jev-1.14.0 | 2026-11-11T10:50:58.970Z |
| knowledge | K-343 | yes 0.50 | - | jev-1.14.0 | 2026-11-11T10:50:58.970Z |
| knowledge | K-335 | yes 0.56 | - | jev-1.14.0 | 2026-11-11T10:50:58.970Z |
| knowledge | K-319 | no 0.70 | - | jev-1.14.0 | 2026-11-11T10:50:58.970Z |
| knowledge | K-316 | yes 0.54 | - | jev-1.14.0 | 2026-11-11T10:50:58.970Z |
| knowledge | K-311 | no 0.64 | - | jev-1.14.0 | 2026-11-11T10:50:58.970Z |
| knowledge | K-179 | no 0.90 | - | jev-1.14.0 | 2026-11-11T10:50:58.970Z |
| knowledge | K-203 | no 0.87 | - | jev-1.14.0 | 2026-11-11T10:50:58.970Z |

Fingerprint: sha256:52c8d26ffeb4d7788bdcbc9582d2cf94f669374ded0fb2aa44319d520b927c81
