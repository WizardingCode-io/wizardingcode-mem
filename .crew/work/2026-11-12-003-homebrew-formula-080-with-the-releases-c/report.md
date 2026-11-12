# Report: Homebrew formula: 0.8.0 with the release's checksums. packaging/homebrew/wizardi

- Work: `2026-11-12-003-homebrew-formula-080-with-the-releases-c`
- Type: chore. Kind: feature (from work_type chore). Route: fast (chore in one spot, clear request, no risk area)
- CTO plan: none
- Packs: none
- Checklists: none read
- Verdict: **Proven**

## Knowledge

- K-376 · validated-solution · "Homebrew formula: 0.7.0 with the release's checksums. packaging/homebrew/wizardi" · alone · stack node, word homebrew, word formula, word release, word checksums, word packaging, word wizardi · unverified 0.76
- K-375 · validated-solution · "Release 0.7.0: version 0.7.0 in package.json and in every file that carries the " · alone · stack node, word release, word packaging · unverified 0.35
- K-363 · validated-solution · "Team server: wizardingcode-mem serve, one Docker image with SQLite and the repos" · alone · stack node, word release · unlikely 0.06
- K-319 · validated-solution · "Record why the drain skips a turn (saved, empty, not-worth, no-title) in turns.l" · alone · stack node, word release · unlikely 0.03
- K-382 · validated-solution · "CI slack for the two perf budgets without one. tests/perf/budgets.test.ts holds " · alone · stack node · unlikely 0.04
- K-381 · validated-solution · "Share a project without a git remote. Today a project can be set above Nothing o" · alone · stack node · unlikely 0.04
- K-372 · validated-solution · "Part 7 of the knowledge and team journey, the runbook: docs/runbooks/team-server" · alone · stack node · unlikely 0.05
- K-371 · validated-solution · "Part 6 of the knowledge and team journey, the sync client: wizardingcode-mem kee" · alone · stack node · unlikely 0.06
- K-346 · validated-solution · "Sharing policy: per project local only, knowledge only, or knowledge and memory;" · alone · stack node · unlikely 0.04
- K-343 · validated-solution · "Knowledge for the agent: MCP tools (search, get, propose, update, taxonomy), the" · alone · stack node · unlikely 0.05
- Learned: not yet

## Acceptance criteria

| Id | Kind | Criterion | Test-first |
| :- | :- | :- | :- |
| AC-1 | observed | packaging/homebrew/wizardingcode-mem.rb has version 0.8.0, every url under releases/download/v0.8.0/, and for each of the four assets the sha256 that the release's checksums.txt publishes; checked by comparing the file with the checksums downloaded from the release | observed: passes after (the checksums live on the release, not in the repository: the proof downloads checksums.txt from the v0.8.0 release and compares every asset's sha256, the version and the urls with the formula) |

## Gates

| Gate | Target | Status | Command | Duration | Log |
| :- | :- | :- | :- | -: | :- |
| secrets | . | pass | `built-in secret scan` | 33 ms |  |
| prose | . | pass | `built-in prose scan` | 33 ms |  |
| build | . | pass | `bun run build` | 2499 ms | logs/build-_-1794489076767.txt |
| test | . | pass | `bun run test` | 211270 ms | logs/test-_-1794489079292.txt |
| lint | . | pass | `bun run lint` | 949 ms | logs/lint-_-1794489290562.txt |
| typecheck | . | pass | `bun run typecheck` | 766 ms | logs/typecheck-_-1794489291512.txt |

## Verifications

| What | Ref | Answer | Confidence | Model | At |
| :- | :- | :- | -: | :- | :- |
| knowledge | K-376 | yes 0.76 | - | jev-1.14.0 | 2026-11-12T13:03:55.536Z |
| knowledge | K-375 | no 0.65 | - | jev-1.14.0 | 2026-11-12T13:03:55.536Z |
| knowledge | K-363 | no 0.94 | - | jev-1.14.0 | 2026-11-12T13:03:55.536Z |
| knowledge | K-319 | no 0.97 | - | jev-1.14.0 | 2026-11-12T13:03:55.536Z |
| knowledge | K-382 | no 0.96 | - | jev-1.14.0 | 2026-11-12T13:03:55.536Z |
| knowledge | K-381 | no 0.96 | - | jev-1.14.0 | 2026-11-12T13:03:55.536Z |
| knowledge | K-372 | no 0.95 | - | jev-1.14.0 | 2026-11-12T13:03:55.536Z |
| knowledge | K-371 | no 0.94 | - | jev-1.14.0 | 2026-11-12T13:03:55.536Z |
| knowledge | K-346 | no 0.96 | - | jev-1.14.0 | 2026-11-12T13:03:55.536Z |
| knowledge | K-343 | no 0.95 | - | jev-1.14.0 | 2026-11-12T13:03:55.536Z |

Fingerprint: sha256:be7035a189133c05a6748d4760be3979e0a26f7e438e752d7ec25bf7936e65fb
