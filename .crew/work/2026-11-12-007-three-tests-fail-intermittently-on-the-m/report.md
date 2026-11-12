# Report: Three tests fail intermittently on the macOS runner and block the required check

- Work: `2026-11-12-007-three-tests-fail-intermittently-on-the-m`
- Type: fix. Kind: issue (from work_type fix). Route: standard (fix, scope level 1, clear request; personal data in lines not read for risk (test or excluded): email (tests/unit/knowledge-maintenance.test.ts))
- CTO plan: none
- Packs: none
- Checklists: none (A fix inside the one git runner's settings: no endpoint, permission, payment, upload, migration, third party, link, deletion path of the product, merge or screen changes)
- Verdict: **Not proven**

## Not proven

- judgement gate code-quality not run on the current code
- judgement gate test-quality not run on the current code

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
| AC-6 | behavior | Every git call of the knowledge store carries maintenance.auto=false, maintenance.autoDetach=false and gc.autoDetach=false; the trace git itself writes of a store write, taken through the stub's traceTo, holds one git maintenance run --auto --quiet command for each commit, started by the runner after the commit, and no git command with --detach; a trace without the maintenance command fails the test. | red then green; the green recorded 2 times (the latest decides) |
| AC-7 | behavior | A mirror run that commits: every git call carries the three settings, and git's own trace holds the runner's maintenance command after each commit and no --detach. | red then green; the green recorded 2 times (the latest decides) |
| AC-8 | behavior | A maintenance call that fails, and one that passes the timeout, do not fail the write: the entry is written and committed, the tree equals HEAD, and the failure is in the log. | red then green; the green recorded 2 times (the latest decides) |
| AC-9 | behavior | The tests' own git reads maintenance.auto as false. | red then green; the green recorded 2 times (the latest decides) |
| AC-10 | behavior | ADR 0024 and CLAUDE.md name the three settings and the runner's own maintenance call; ADR 0024 says in both places it speaks of housekeeping that it still runs, started by the runner after a commit in the foreground, and keeps the known limit open: unchecked files inside the folders of objects/, housekeeping that removes and rewrites files there, the sync part to close it. | red then green; the red recorded 2 times (the latest decides); the green recorded 2 times (the latest decides) |
| AC-11 | preserve | tests/unit/knowledge-repo.test.ts, tests/unit/knowledge-git-host.test.ts and tests/integration/team-mirror.test.ts pass as before. | passing before and after (105 → 105 pass) |
| AC-12 | behavior | A lease lost at the maintenance call: in the store, the write returns, the entry is written and committed and the tree equals HEAD; in the mirror, the run stops with its lost-lease error, as at any other git call. | red then green; the green recorded 2 times (the latest decides) |
| AC-13 | behavior | With work due (two loose objects in the folder git samples, and gc.auto=1 given by the host), the runner's call after a commit, carrying the three settings, packs the loose objects before commitPaths returns. | red then green; the green recorded 2 times (the latest decides) |

## Gates

| Gate | Target | Status | Command | Duration | Log |
| :- | :- | :- | :- | -: | :- |
| secrets | . | pass | `built-in secret scan` | 38 ms |  |
| prose | . | pass | `built-in prose scan` | 40 ms |  |
| build | . | pass | `bun run build` | 2562 ms | logs/build-_-1794516891273.txt |
| test | . | pass | `bun run test` | 210969 ms | logs/test-_-1794516893866.txt |
| lint | . | pass: 1 untouched file with problems, none of the item's | `bun run lint` | 93 ms | logs/lint-_-1794517104835.txt |
| typecheck | . | pass | `bun run typecheck` | 378 ms | logs/typecheck-_-1794517104928.txt |

## Judgement gates

| Gate | Verdict | Reviewer | Findings | Tokens |
| :- | :- | :- | -: | -: |
| code-quality | not proven (earlier code) | review-code-quality | 4 | 107410 |
| test-quality | not proven (earlier code) | review-test-quality | 3 | 118326 |

- code-quality: tests/integration/team-mirror-maintenance.test.ts:55 Upheld as a defect under question 2: the diff writes the same logic twice. The `recordArgsTo` parser `callsIn` appears here and again in tests/unit/knowledge-maintenance.test.ts (`callsIn`, beside it). The `GIT_TRACE` line parser is inlined in this file's first test and appears again as `tracedCommands` in knowledge-maintenance.test.ts. The check that each commit is followed by maintenance (`commands.forEach(... index % 2 ...)`) is also written in both new test files. These are multi-line parsers and checks, not boilerplate. The diff adds `traceTo` to tests/helpers/stub-git.ts, which already owns both record formats, so one reader there would replace the copies. (defect, verified by Jev (0.97))
- code-quality: src/modules/knowledge/repo.ts:958 Kept as an advisory (questions 10 and 11, precision of a new comment; no old fact is dropped). The `maintain` docstring describes 'a lease lost at the call's renewal' as met by the caller at its next call. That holds only for the store's `KnowledgeError`. The mirror's `MirrorLeaseLostError` (src/team/mirror.ts:99, extends Error, thrown from the renew at mirror.ts:395) falls to the `logError` branch and is logged as an error of another kind. The comment should name the two cases separately. (advisory)
- code-quality: src/modules/knowledge/repo.ts:970 Kept as an advisory (question 10): the comment 'one call apart, nothing else' does not say why the maintenance call carries the commit's identity, when `maintenance run` writes no commit. One clause giving the reason would read better. (advisory)
- code-quality: tests/integration/team-mirror.test.ts:522 Lowered to an advisory as debt outside the change: the same record parser (`.split("\t\n")`) is already inlined here and at line 570, on lines this diff did not write. The single reader suggested for the defect at team-mirror-maintenance.test.ts:55 would absorb it too. (advisory, outside the change)
- test-quality: tests/unit/knowledge-maintenance.test.ts:233 Upheld as a defect under question 1. The reviewer cited line 529, a line of diff.patch; the file's own line is 233 (`const paragraphs = adr.split("\n").filter(...)`). AC-10 is a behavior criterion and requires the ADR's paragraph on what `.git` may hold to say that the housekeeping still runs, started by the runner after a commit and in the foreground. The test checks only that `paragraphs.length >= 2`, which was already true before the change. Only the Known-limits paragraph is checked for 'started by the runner after a commit, in the foreground'. The `.git` paragraph (diff.patch line 21, which the diff does not change) still says only 'in its own housekeeping, removes'. No assertion fails when that clause of AC-10 is reverted or missing. (defect, verified by Jev (0.96))
- test-quality: tests/integration/team-mirror-maintenance.test.ts:251 Kept as an advisory (questions 1 and 5). The steal is triggered by the next `now()` read after the second commit. Without the maintenance call, the same steal would happen at the next revision's renewal and the assertions would still pass. The test does fail if the swallowing of the lease error is reverted (commits would be 0, not 1), so AC-12's 'recorded' clause is proven. That the call exists is held by AC-7's trace test. (advisory)
- test-quality: tests/unit/knowledge-maintenance.test.ts:479 Kept as an advisory. AC-13's red under a whole revert is a race: the commit's own detached maintenance may pack before the assertions run. The test does fail every time when the runner's call is removed and the settings are kept. Writing three loose objects where the spec says two is harmless for the `gc.auto=1` threshold. (advisory)

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
| defect | code-quality tests/integration/team-mirror-maintenance.test.ts:55 | yes 0.97 | 0.97 | jev-1.14.0 | 2026-11-12T20:53:09.940Z |
| defect | test-quality tests/unit/knowledge-maintenance.test.ts:233 | yes 0.96 | 0.96 | jev-1.14.0 | 2026-11-12T20:53:09.940Z |

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

- Rounds: judgement 1 of 2, validation 3 of 2
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
| review-code-quality | claude-opus-5-5 | - | 2026-11-12T20:51:26.045Z | 72562 | review/code-quality.findings.md | hook |
| review-test-quality | claude-opus-5-5 | - | 2026-11-12T20:52:11.974Z | 83478 | review/test-quality.findings.md | hook |
| judge | claude-opus-5-5 | - | 2026-11-12T20:52:57.459Z | 69696 | review/ruling.json | hook |

## Decisions

- spec approved by the validator (rule: complete-gap-round) (2026-11-12T20:33:32.857Z): counted, a person was present
- AC-1 (behavior) removed (2026-11-12T20:30:42.743Z): Every git call of the knowledge store carries maintenance.autoDetach=false and gc.autoDetach=false, and a write of the store, traced by git itself, runs no git command with --detach.
- AC-2 (behavior) removed (2026-11-12T20:30:42.800Z): Every git call of a mirror run carries the two settings, and a run that commits, traced by git itself, runs no git command with --detach.
- AC-3 (behavior) removed (2026-11-12T20:30:42.856Z): The tests' own git reads maintenance.autoDetach and gc.autoDetach as false.
- AC-4 (behavior) removed (2026-11-12T20:30:42.912Z): ADR 0024 and CLAUDE.md name the two settings, and ADR 0024 no longer says that the store leaves git's housekeeping as it is.
- AC-5 (preserve) removed (2026-11-12T20:30:42.967Z): tests/unit/knowledge-repo.test.ts, tests/unit/knowledge-git-host.test.ts and tests/integration/team-mirror.test.ts pass as before.

## Waits

- for the roles (2026-11-12T20:43:04.662Z), not proven: gates have not run
- for the roles (2026-11-12T20:50:47.252Z), not proven: judgement gate code-quality not run
- for the roles (2026-11-12T20:51:40.031Z), not proven: judgement gate code-quality not run
- for the roles (2026-11-12T20:52:20.682Z), not proven: judgement gate code-quality not run

## Objections

- O-1 (advisory, raised by gap-round) open: The commit that crosses git's threshold waits for the repack inside the runner's timeout; a repack that exceeded it would report a failure for a commit that landed. Not measured at that size.
- O-2 (advisory, raised by gap-round) open: The end of the three failures cannot be shown on the author's machine: the evidence is the runner's probe and the suite's later runs there.

Fingerprint: sha256:4e2086ed585d473b5fd5e3b27d1fe9547b6e77957afefe8cd9c546756dbb8505
