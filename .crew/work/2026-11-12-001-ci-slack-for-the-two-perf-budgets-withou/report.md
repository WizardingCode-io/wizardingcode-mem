# Report: CI slack for the two perf budgets without one. tests/perf/budgets.test.ts holds 

- Work: `2026-11-12-001-ci-slack-for-the-two-perf-budgets-withou`
- Type: chore. Kind: feature (from work_type chore). Route: fast (chore in one spot, clear request, no risk area)
- CTO plan: none
- Packs: none
- Checklists: none read
- Verdict: **Proven**

## Knowledge

- K-381 · validated-solution · "Share a project without a git remote. Today a project can be set above Nothing o" · alone · stack node, word without, word tests, word test, word holds · unlikely 0.04
- K-371 · validated-solution · "Part 6 of the knowledge and team journey, the sync client: wizardingcode-mem kee" · alone · stack node, word without, word test, word holds · unlikely 0.04
- K-363 · validated-solution · "Team server: wizardingcode-mem serve, one Docker image with SQLite and the repos" · alone · stack node, word without, word tests, word holds · unlikely 0.04
- K-372 · validated-solution · "Part 7 of the knowledge and team journey, the runbook: docs/runbooks/team-server" · alone · stack node, word tests, word test · unlikely 0.04
- K-346 · validated-solution · "Sharing policy: per project local only, knowledge only, or knowledge and memory;" · alone · stack node, word without, word holds · unlikely 0.03
- K-343 · validated-solution · "Knowledge for the agent: MCP tools (search, get, propose, update, taxonomy), the" · alone · stack node, word without, word holds · unlikely 0.04
- K-375 · validated-solution · "Release 0.7.0: version 0.7.0 in package.json and in every file that carries the " · alone · stack node, word tests · unlikely 0.06
- K-316 · validated-solution · "Memory quality: knowledge, not records of a session (spec docs/superpowers/specs" · alone · stack node, word without · unlikely 0.04
- K-311 · validated-solution · "T-4 of 2026-10-15-001-memory-quality-knowledge-not-records-of: AC-5: heuristic j" · alone · stack node, word holds · unlikely 0.04
- K-376 · validated-solution · "Homebrew formula: 0.7.0 with the release's checksums. packaging/homebrew/wizardi" · alone · stack node · unlikely 0.03
- Learned: not yet

## Acceptance criteria

| Id | Kind | Criterion | Test-first |
| :- | :- | :- | :- |
| AC-1 | observed | With CI=1 the two tests announce and hold the budgets with the slack (the rebuild median of five measurements under 125 ms, the semantic median under 100 ms); without CI they announce 50 ms and 40 ms: checked by running both tests with and without CI=1 and reading the names and the measured lines | observed: passes after (the slack is read from the test names the junit report of each run carries and from the measured lines, with CI=1 and without; no assertion of the suite can read its own names); the observed recorded 3 times (the latest decides) |
| AC-2 | preserve | The two perf tests keep passing on this machine with the budgets unchanged at 50 ms (the rebuild) and 40 ms (the semantic median) when CI is unset | passing before and after (2 → 2 pass) |

## Gates

| Gate | Target | Status | Command | Duration | Log |
| :- | :- | :- | :- | -: | :- |
| secrets | . | pass | `built-in secret scan` | 30 ms |  |
| prose | . | pass | `built-in prose scan` | 32 ms |  |
| build | . | pass | `bun run build` | 2916 ms | logs/build-_-1794486438661.txt |
| test | . | pass | `bun run test` | 217329 ms | logs/test-_-1794486441604.txt |
| lint | . | pass | `bun run lint` | 321 ms | logs/lint-_-1794486658933.txt |
| typecheck | . | pass | `bun run typecheck` | 364 ms | logs/typecheck-_-1794486659254.txt |

## Verifications

| What | Ref | Answer | Confidence | Model | At |
| :- | :- | :- | -: | :- | :- |
| knowledge | K-381 | no 0.96 | - | jev-1.14.0 | 2026-11-12T12:10:44.247Z |
| knowledge | K-371 | no 0.96 | - | jev-1.14.0 | 2026-11-12T12:10:44.247Z |
| knowledge | K-363 | no 0.96 | - | jev-1.14.0 | 2026-11-12T12:10:44.247Z |
| knowledge | K-372 | no 0.96 | - | jev-1.14.0 | 2026-11-12T12:10:44.247Z |
| knowledge | K-346 | no 0.97 | - | jev-1.14.0 | 2026-11-12T12:10:44.247Z |
| knowledge | K-343 | no 0.96 | - | jev-1.14.0 | 2026-11-12T12:10:44.247Z |
| knowledge | K-375 | no 0.94 | - | jev-1.14.0 | 2026-11-12T12:10:44.247Z |
| knowledge | K-316 | no 0.96 | - | jev-1.14.0 | 2026-11-12T12:10:44.247Z |
| knowledge | K-311 | no 0.96 | - | jev-1.14.0 | 2026-11-12T12:10:44.247Z |
| knowledge | K-376 | no 0.97 | - | jev-1.14.0 | 2026-11-12T12:10:44.247Z |

Fingerprint: sha256:7a406d01eeee6c08a8637a9ffd2f4ea43912ba6df3cb176e54494dd3bc1d6e14
