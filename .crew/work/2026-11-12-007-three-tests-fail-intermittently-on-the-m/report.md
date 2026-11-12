# Report: Three tests fail intermittently on the macOS runner and block the required check

- Work: `2026-11-12-007-three-tests-fail-intermittently-on-the-m`
- Type: fix. Kind: issue (from work_type fix). Route: standard (fix, scope level 1, clear request; personal data in lines not read for risk (test or excluded): email (tests/unit/knowledge-maintenance.test.ts))
- CTO plan: none
- Packs: none
- Checklists: none (A fix inside the one git runner's settings: no endpoint, permission, payment, upload, migration, third party, link, deletion path of the product, merge or screen changes)
- Verdict: **Not proven**

## Not proven

- judgement gate code-quality not run
- judgement gate test-quality not run

## Analysis

- Paths: src/modules/knowledge/repo.ts (3 commits), tests/helpers/stub-git.ts (2 commits), src/team/mirror.ts (3 commits)
- Items: 2026-11-09-001-knowledge-for-the-agent-mcp-tools-search "Knowledge for the agent: MCP tools (search, get, propose, update, taxonomy), the" (feature; roles goldfish-comprehension, goldfish-zoom-out, goldfish-design, goldfish-structural, goldfish-readiness, goldfish-codebase, tech-lead, judge, goldfish-style, review-ui-ux, review-security, review-data, review-architecture, review-code-quality, review-risk, review-test-quality; tasks none; decisions 50; mail 1); 2026-11-09-002-sharing-policy-per-project-local-only-kn "Sharing policy: per project local only, knowledge only, or knowledge and memory;" (feature; roles goldfish-comprehension, goldfish-structural, goldfish-zoom-out, goldfish-design, goldfish-readiness, goldfish-codebase, tech-lead, judge, goldfish-style, review-data, review-ui-ux, review-code-quality, review-risk, review-test-quality, review-security, review-architecture; tasks none; decisions 33; mail 1); 2026-11-10-001-team-server-wizardingcode-mem-serve-one "Team server: wizardingcode-mem serve, one Docker image with SQLite and the repos" (feature; roles goldfish-zoom-out, goldfish-comprehension, goldfish-structural, goldfish-readiness, goldfish-design, goldfish-codebase, tech-lead, goldfish-style, review-infra, review-security, review-architecture, review-code-quality, review-risk, review-test-quality, review-data, judge; tasks none; decisions 58; mail 1); 2026-11-10-002-part-6-of-the-knowledge-and-team-journey "Part 6 of the knowledge and team journey, the sync client: wizardingcode-mem kee" (feature; roles goldfish-readiness, goldfish-zoom-out, goldfish-comprehension, goldfish-codebase, goldfish-structural, goldfish-design, tech-lead, goldfish-style, review-code-quality, review-ui-ux, review-architecture, review-risk, review-test-quality, review-security, review-data, judge; tasks none; decisions 254; mail 1); 2026-11-09-003-team-server-wizardingcode-mem-serve-one "Team server: wizardingcode-mem serve, one Docker image with SQLite and the repos" (feature; roles goldfish-comprehension, goldfish-zoom-out, goldfish-structural, goldfish-readiness, goldfish-design, goldfish-codebase; tasks none; decisions 25; mail 0); 2026-11-08-003-knowledge-store-entries-as-markdown-with "Knowledge store: entries as Markdown with frontmatter (kind knowledge, strategy," (feature; roles goldfish-comprehension, goldfish-zoom-out, goldfish-design, goldfish-structural, goldfish-readiness, goldfish-codebase, judge, tech-lead, goldfish-style, review-code-quality, review-risk, review-architecture, review-security, review-test-quality, review-data; tasks none; decisions 59; mail 1); 2026-11-11-002-release-070-version-070-in-packagejson-a "Release 0.7.0: version 0.7.0 in package.json and in every file that carries the" (feature; roles none; tasks none; decisions 1; mail 1); 2026-11-11-003-homebrew-formula-070-with-the-releases-c "Homebrew formula: 0.7.0 with the release's checksums. packaging/homebrew/wizardi" (feature; roles none; tasks none; decisions 1; mail 1); 2026-11-11-005-share-a-project-without-a-git-remote-tod "Share a project without a git remote. Today a project can be set above Nothing o" (feature; roles goldfish-comprehension, goldfish-structural, goldfish-zoom-out, goldfish-readiness, goldfish-design, goldfish-codebase, tech-lead, goldfish-style, review-security, review-data, review-risk, review-code-quality, review-test-quality, review-architecture, review-ui-ux, judge; tasks none; decisions 46; mail 1)

## Knowledge

- K-363 · validated-solution · "Team server: wizardingcode-mem serve, one Docker image with SQLite and the repos" · alone · path src/modules/knowledge/repo.ts, path tests/helpers/stub-git.ts, path src/team/mirror.ts, stack node, word tests, word runner · unlikely 0.1
- K-346 · validated-solution · "Sharing policy: per project local only, knowledge only, or knowledge and memory;" · alone · path src/modules/knowledge/repo.ts, path tests/helpers/stub-git.ts, stack node, word three · unlikely 0.05
- K-343 · validated-solution · "Knowledge for the agent: MCP tools (search, get, propose, update, taxonomy), the" · alone · path src/modules/knowledge/repo.ts, path tests/helpers/stub-git.ts, stack node, word three · unlikely 0.06
- K-390 · validated-solution · "The release publishes everywhere by itself, and <data dir>/bin has one owner tha" · alone · stack node, word three, word tests, word macos, word block · unlikely 0.09
- K-371 · validated-solution · "Part 6 of the knowledge and team journey, the sync client: wizardingcode-mem kee" · alone · path src/modules/knowledge/repo.ts, path src/team/mirror.ts, stack node · unlikely 0.06
- K-335 · validated-solution · "Knowledge store: entries as Markdown with frontmatter (kind knowledge, strategy," · alone · path src/modules/knowledge/repo.ts, path tests/helpers/stub-git.ts, stack node · unlikely 0.05
- K-381 · validated-solution · "Share a project without a git remote. Today a project can be set above Nothing o" · alone · path src/team/mirror.ts, stack node, word tests · unlikely 0.06
- K-394 · validated-solution · "The client learns of a release and its staged binary follows (piece 2 of 2026-11" · alone · stack node, word tests, word check · unlikely 0.06
- K-391 · validated-solution · "Harden the release's distribution after its first review (follow-up of 2026-11-1" · alone · stack node, word three, word runner · unlikely 0.12
- K-382 · validated-solution · "CI slack for the two perf budgets without one. tests/perf/budgets.test.ts holds " · alone · stack node, word tests · unverified 0.43
- Learned: not yet

## Acceptance criteria

| Id | Kind | Criterion | Test-first |
| :- | :- | :- | :- |
| AC-6 | behavior | Every git call of the knowledge store carries maintenance.auto=false, maintenance.autoDetach=false and gc.autoDetach=false; the trace git itself writes of a store write, taken through the stub's traceTo, holds one git maintenance run --auto --quiet command for each commit, started by the runner after the commit, and no git command with --detach; a trace without the maintenance command fails the test. | red then green |
| AC-7 | behavior | A mirror run that commits: every git call carries the three settings, and git's own trace holds the runner's maintenance command after each commit and no --detach. | red then green |
| AC-8 | behavior | A maintenance call that fails, and one that passes the timeout, do not fail the write: the entry is written and committed, the tree equals HEAD, and the failure is in the log. | red then green |
| AC-9 | behavior | The tests' own git reads maintenance.auto as false. | red then green |
| AC-10 | behavior | ADR 0024 and CLAUDE.md name the three settings and the runner's own maintenance call; ADR 0024 says in both places it speaks of housekeeping that it still runs, started by the runner after a commit in the foreground, and keeps the known limit open: unchecked files inside the folders of objects/, housekeeping that removes and rewrites files there, the sync part to close it. | red then green |
| AC-11 | preserve | tests/unit/knowledge-repo.test.ts, tests/unit/knowledge-git-host.test.ts and tests/integration/team-mirror.test.ts pass as before. | passing before and after (105 → 105 pass) |
| AC-12 | behavior | A lease lost at the maintenance call: in the store, the write returns, the entry is written and committed and the tree equals HEAD; in the mirror, the run stops with its lost-lease error, as at any other git call. | red then green |
| AC-13 | behavior | With work due (two loose objects in the folder git samples, and gc.auto=1 given by the host), the runner's call after a commit, carrying the three settings, packs the loose objects before commitPaths returns. | red then green |

## Gates

| Gate | Target | Status | Command | Duration | Log |
| :- | :- | :- | :- | -: | :- |
| secrets | . | pass | `built-in secret scan` | 39 ms |  |
| prose | . | pass | `built-in prose scan` | 41 ms |  |
| build | . | pass | `bun run build` | 2895 ms | logs/build-_-1794516164933.txt |
| test | . | pass | `bun run test` | 216664 ms | logs/test-_-1794516167857.txt |
| lint | . | pass: 1 untouched file with problems, none of the item's | `bun run lint` | 96 ms | logs/lint-_-1794516384521.txt |
| typecheck | . | pass | `bun run typecheck` | 355 ms | logs/typecheck-_-1794516384618.txt |

## Verifications

| What | Ref | Answer | Confidence | Model | At |
| :- | :- | :- | -: | :- | :- |
| knowledge | K-390 | no 0.96 | - | jev-1.14.0 | 2026-11-12T19:49:20.333Z |
| knowledge | K-394 | no 0.97 | - | jev-1.14.0 | 2026-11-12T19:49:20.333Z |
| knowledge | K-391 | no 0.94 | - | jev-1.14.0 | 2026-11-12T19:49:20.333Z |
| knowledge | K-363 | no 0.95 | - | jev-1.14.0 | 2026-11-12T19:49:20.333Z |
| knowledge | K-382 | yes 0.51 | - | jev-1.14.0 | 2026-11-12T19:49:20.333Z |
| knowledge | K-381 | no 0.96 | - | jev-1.14.0 | 2026-11-12T19:49:20.333Z |
| knowledge | K-375 | no 0.96 | - | jev-1.14.0 | 2026-11-12T19:49:20.333Z |
| knowledge | K-372 | no 0.95 | - | jev-1.14.0 | 2026-11-12T19:49:20.333Z |
| knowledge | K-346 | no 0.97 | - | jev-1.14.0 | 2026-11-12T19:49:20.333Z |
| knowledge | K-343 | no 0.97 | - | jev-1.14.0 | 2026-11-12T19:49:20.333Z |
| knowledge | K-363 | no 0.90 | - | jev-1.14.0 | 2026-11-12T20:24:26.547Z |
| knowledge | K-346 | no 0.95 | - | jev-1.14.0 | 2026-11-12T20:24:26.547Z |
| knowledge | K-343 | no 0.94 | - | jev-1.14.0 | 2026-11-12T20:24:26.547Z |
| knowledge | K-390 | no 0.91 | - | jev-1.14.0 | 2026-11-12T20:24:26.547Z |
| knowledge | K-371 | no 0.94 | - | jev-1.14.0 | 2026-11-12T20:24:26.547Z |
| knowledge | K-335 | no 0.95 | - | jev-1.14.0 | 2026-11-12T20:24:26.547Z |
| knowledge | K-381 | no 0.94 | - | jev-1.14.0 | 2026-11-12T20:24:26.547Z |
| knowledge | K-394 | no 0.94 | - | jev-1.14.0 | 2026-11-12T20:24:26.547Z |
| knowledge | K-391 | no 0.88 | - | jev-1.14.0 | 2026-11-12T20:24:26.547Z |
| knowledge | K-382 | no 0.57 | - | jev-1.14.0 | 2026-11-12T20:24:26.547Z |
| validator | complete-gap-round v1 | yes 0.82 | 0.82 | jev-1.14.0 | 2026-11-12T20:33:32.856Z |
| validator | complete-gap-round v2 | yes 0.81 | 0.81 | jev-1.14.0 | 2026-11-12T20:33:32.856Z |

## Team

- Primary team: backend (the session)

| Seat | Team | Reason |
| :- | :- | :- |
| researcher | researchers | standard route |
| review-code-quality | backend | standard route |
| review-test-quality | qa | standard route |
| lead-qa | qa | standard route |
| lead-security | security | standard route |
| judge |  | a gate is planned |

- Rounds: judgement 0 of 2, validation 3 of 2
- Runtimes: claude (context at start: enforced; the status line per prompt: enforced; the denial of engine files: enforced; the denial of forbidden commands: enforced; the hold at Stop: enforced; the roles' answers filed: enforced; the roles read-only: enforced)

## Validations

| What | By | Verdict | Returns | Round | File |
| :- | :- | :- | -: | -: | :- |
| spec | lead-qa | returned | 1 | 1 | conclave/lead-qa.md |
| spec | lead-security | returned | 2 | 1 | conclave/lead-security.md |
| spec | lead-security | validated | 0 | 2 | conclave/lead-security-reply.md |
| spec | lead-qa | returned | 1 | 2 | conclave/lead-qa-reply.md |
| spec | lead-qa | validated | 0 | 2 | conclave/lead-qa-reply.md |
| spec | lead-security | validated | 0 | 2 | conclave/lead-security-reply.md |
| spec | lead-qa | validated | 0 | 3 | conclave/lead-qa-reply.md |
| spec | lead-security | validated | 0 | 3 | conclave/lead-security-reply.md |

## Gap round

- D-1: How does the product's git runner treat git's automatic maintenance, which a commit starts detached? → Em primeiro plano (Recomendado): maintenance.autoDetach=false and gc.autoDetach=false on every call; git keeps compacting, inside the commit, and nothing runs after it, by the user, relayed by the agent
- Debate: none

## Roles

| Role | Model | Personality | At | Tokens | Answer | Filed by |
| :- | :- | :- | :- | -: | :- | :- |
| tech-lead | claude-fable-5-2 | - | 2026-11-12T20:28:45.414Z | 76167 | conclave/lead-security.md | hook |
| tech-lead | claude-fable-5-2 | - | 2026-11-12T20:29:14.273Z | 69415 | conclave/lead-qa.md | hook |
| tech-lead | claude-fable-5-2 | - | 2026-11-12T20:31:43.464Z | 86510 | conclave/lead-security-reply.round2.md | hook |
| tech-lead | claude-fable-5-2 | - | 2026-11-12T20:32:41.393Z | 106879 | conclave/lead-qa-reply.round2.md | hook |
| tech-lead | claude-fable-5-2 | - | 2026-11-12T20:33:24.206Z | 98464 | conclave/lead-security-reply.round3.md | hook |
| tech-lead | claude-fable-5-2 | - | 2026-11-12T20:33:27.230Z | 118089 | conclave/lead-qa-reply.round3.md | hook |
| tech-lead | claude-fable-5-2 | - | 2026-11-12T20:42:51.667Z | 216810 | conclave/lead-security-reply.md | hook |
| tech-lead | claude-fable-5-2 | - | 2026-11-12T20:42:53.285Z | 252591 | conclave/lead-qa-reply.md | hook |

## Decisions

- spec approved by the validator (rule: complete-gap-round) (2026-11-12T20:33:32.857Z): counted, a person was present
- AC-1 (behavior) removed (2026-11-12T20:30:42.743Z): Every git call of the knowledge store carries maintenance.autoDetach=false and gc.autoDetach=false, and a write of the store, traced by git itself, runs no git command with --detach.
- AC-2 (behavior) removed (2026-11-12T20:30:42.800Z): Every git call of a mirror run carries the two settings, and a run that commits, traced by git itself, runs no git command with --detach.
- AC-3 (behavior) removed (2026-11-12T20:30:42.856Z): The tests' own git reads maintenance.autoDetach and gc.autoDetach as false.
- AC-4 (behavior) removed (2026-11-12T20:30:42.912Z): ADR 0024 and CLAUDE.md name the two settings, and ADR 0024 no longer says that the store leaves git's housekeeping as it is.
- AC-5 (preserve) removed (2026-11-12T20:30:42.967Z): tests/unit/knowledge-repo.test.ts, tests/unit/knowledge-git-host.test.ts and tests/integration/team-mirror.test.ts pass as before.

## Waits

- for the roles (2026-11-12T20:43:04.662Z), not proven: gates have not run

## Objections

- O-1 (advisory, raised by gap-round) open: The commit that crosses git's threshold waits for the repack inside the runner's timeout; a repack that exceeded it would report a failure for a commit that landed. Not measured at that size.
- O-2 (advisory, raised by gap-round) open: The end of the three failures cannot be shown on the author's machine: the evidence is the runner's probe and the suite's later runs there.

Fingerprint: sha256:b612519ccae0a4a5b449bcc701a0dc76e2f1ef8d9144869d3fc599701288d293
