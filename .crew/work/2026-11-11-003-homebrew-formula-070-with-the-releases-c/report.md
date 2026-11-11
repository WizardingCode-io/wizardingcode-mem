# Report: Homebrew formula: 0.7.0 with the release's checksums. packaging/homebrew/wizardi

- Work: `2026-11-11-003-homebrew-formula-070-with-the-releases-c`
- Type: chore. Kind: feature (from work_type chore). Route: fast (chore in one spot, clear request, no risk area)
- CTO plan: none
- Packs: none
- Checklists: none read
- Verdict: **Proven**

## Knowledge

- K-375 · validated-solution · "Release 0.7.0: version 0.7.0 in package.json and in every file that carries the " · alone · stack node, word release, word packaging · unverified 0.57
- K-363 · validated-solution · "Team server: wizardingcode-mem serve, one Docker image with SQLite and the repos" · alone · stack node, word release · unlikely 0.1
- K-319 · validated-solution · "Record why the drain skips a turn (saved, empty, not-worth, no-title) in turns.l" · alone · stack node, word release · unlikely 0.06
- K-372 · validated-solution · "Part 7 of the knowledge and team journey, the runbook: docs/runbooks/team-server" · alone · stack node · unlikely 0.09
- K-371 · validated-solution · "Part 6 of the knowledge and team journey, the sync client: wizardingcode-mem kee" · alone · stack node · unlikely 0.1
- K-346 · validated-solution · "Sharing policy: per project local only, knowledge only, or knowledge and memory;" · alone · stack node · unlikely 0.09
- K-343 · validated-solution · "Knowledge for the agent: MCP tools (search, get, propose, update, taxonomy), the" · alone · stack node · unlikely 0.07
- K-335 · validated-solution · "Knowledge store: entries as Markdown with frontmatter (kind knowledge, strategy," · alone · stack node · unlikely 0.08
- K-316 · validated-solution · "Memory quality: knowledge, not records of a session (spec docs/superpowers/specs" · alone · stack node · unlikely 0.07
- K-311 · validated-solution · "T-4 of 2026-10-15-001-memory-quality-knowledge-not-records-of: AC-5: heuristic j" · alone · stack node · unlikely 0.07
- Learned: not yet

## Acceptance criteria

| Id | Kind | Criterion | Test-first |
| :- | :- | :- | :- |
| AC-1 | observed | packaging/homebrew/wizardingcode-mem.rb has version 0.7.0, every url under releases/download/v0.7.0/, and for each of the four assets the sha256 that the release's checksums.txt publishes; checked by comparing the file with the checksums downloaded from the release. | observed: passes after (A packaging file a person checks against the release: the check compares packaging/homebrew/wizardingcode-mem.rb with the checksums.txt downloaded from the GitHub release v0.7.0 (the version line, the four urls under releases/download/v0.7.0/, and each asset's sha256), and the tap WizardingCode-io/homebrew-wizardingcode receives the same file on its branch wizardingcode-mem-0.7.0.) |

## Gates

| Gate | Target | Status | Command | Duration | Log |
| :- | :- | :- | :- | -: | :- |
| secrets | . | pass | `built-in secret scan` | 24 ms |  |
| prose | . | pass | `built-in prose scan` | 29 ms |  |
| build | . | pass | `bun run build` | 2534 ms | logs/build-_-1794401741149.txt |
| test | . | pass | `bun run test` | 194508 ms | logs/test-_-1794401743709.txt |
| lint | . | pass: 1 untouched file with problems, none of the item's | `bun run lint` | 105 ms | logs/lint-_-1794401938219.txt |
| typecheck | . | pass | `bun run typecheck` | 384 ms | logs/typecheck-_-1794401938325.txt |

## Verifications

| What | Ref | Answer | Confidence | Model | At |
| :- | :- | :- | -: | :- | :- |
| knowledge | K-375 | yes 0.57 | - | jev-1.14.0 | 2026-11-11T12:54:55.706Z |
| knowledge | K-363 | no 0.90 | - | jev-1.14.0 | 2026-11-11T12:54:55.706Z |
| knowledge | K-319 | no 0.94 | - | jev-1.14.0 | 2026-11-11T12:54:55.706Z |
| knowledge | K-372 | no 0.91 | - | jev-1.14.0 | 2026-11-11T12:54:55.706Z |
| knowledge | K-371 | no 0.90 | - | jev-1.14.0 | 2026-11-11T12:54:55.706Z |
| knowledge | K-346 | no 0.91 | - | jev-1.14.0 | 2026-11-11T12:54:55.706Z |
| knowledge | K-343 | no 0.93 | - | jev-1.14.0 | 2026-11-11T12:54:55.706Z |
| knowledge | K-335 | no 0.92 | - | jev-1.14.0 | 2026-11-11T12:54:55.706Z |
| knowledge | K-316 | no 0.93 | - | jev-1.14.0 | 2026-11-11T12:54:55.706Z |
| knowledge | K-311 | no 0.93 | - | jev-1.14.0 | 2026-11-11T12:54:55.706Z |

Fingerprint: sha256:a426983e4e5878ec935bed6dbe49edc65b7994abe66f3791bed7496816030fea
