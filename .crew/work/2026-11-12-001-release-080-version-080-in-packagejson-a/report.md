# Report: Release 0.8.0: version 0.8.0 in package.json and in every file that carries the 

- Work: `2026-11-12-001-release-080-version-080-in-packagejson-a`
- Type: chore. Kind: feature (from work_type chore). Route: full (chore in one spot, clear request, no risk area; raised to full: the change touches secrets paths)
- CTO plan: none
- Packs: none
- Checklists: none read
- Verdict: **Proven**

## Knowledge

- K-375 · validated-solution · "Release 0.7.0: version 0.7.0 in package.json and in every file that carries the " · alone · stack node, word release, word version, word package, word json, word file, word carries · likely 0.84
- K-363 · validated-solution · "Team server: wizardingcode-mem serve, one Docker image with SQLite and the repos" · alone · stack node, word release, word version, word json, word file, word carries · unlikely 0.09
- K-381 · validated-solution · "Share a project without a git remote. Today a project can be set above Nothing o" · alone · stack node, word version, word file, word carries · unlikely 0.06
- K-376 · validated-solution · "Homebrew formula: 0.7.0 with the release's checksums. packaging/homebrew/wizardi" · alone · stack node, word release, word version, word file · unverified 0.64
- K-335 · validated-solution · "Knowledge store: entries as Markdown with frontmatter (kind knowledge, strategy," · alone · stack node, word version, word json, word file · unlikely 0.07
- K-372 · validated-solution · "Part 7 of the knowledge and team journey, the runbook: docs/runbooks/team-server" · alone · stack node, word package, word file · unlikely 0.08
- K-371 · validated-solution · "Part 6 of the knowledge and team journey, the sync client: wizardingcode-mem kee" · alone · stack node, word json, word file · unlikely 0.1
- K-346 · validated-solution · "Sharing policy: per project local only, knowledge only, or knowledge and memory;" · alone · stack node, word version, word file · unlikely 0.06
- K-319 · validated-solution · "Record why the drain skips a turn (saved, empty, not-worth, no-title) in turns.l" · alone · stack node, word release, word version · unlikely 0.05
- K-343 · validated-solution · "Knowledge for the agent: MCP tools (search, get, propose, update, taxonomy), the" · alone · stack node, word version · unlikely 0.06
- Learned: not yet

## Acceptance criteria

| Id | Kind | Criterion | Test-first |
| :- | :- | :- | :- |
| AC-1 | preserve | The suite keeps passing with the version at 0.8.0 (the plugin packaging tests read the version from package.json) | passing before and after (24 → 24 pass) |

## Gates

| Gate | Target | Status | Command | Duration | Log |
| :- | :- | :- | :- | -: | :- |
| secrets | . | pass | `built-in secret scan` | 35 ms |  |
| prose | . | pass | `built-in prose scan` | 37 ms |  |
| build | . | pass | `bun run build` | 4564 ms | logs/build-_-1794482763358.txt |
| test | . | pass | `bun run test` | 210616 ms | logs/test-_-1794482767953.txt |
| lint | . | pass | `bun run lint` | 952 ms | logs/lint-_-1794482978569.txt |
| typecheck | . | pass | `bun run typecheck` | 949 ms | logs/typecheck-_-1794482979521.txt |
| deps | . | pass: 12 known before, none new | `bun audit --json` | 563 ms | logs/deps-_-1794482980470.txt |
| test | npm | pass | `../node_modules/.bin/bun test ../tests/integration/npm-shim.test.ts` | 380 ms | logs/test-npm-1794482981034.txt |
| deps | npm | pass | `npm audit --audit-level=high --json` | 564 ms | logs/deps-npm-1794482981414.txt |
| test | plugins/opencode | pass | `../../node_modules/.bin/bun test ../../tests/unit/opencode-plugin.test.ts ../../tests/integration/plugins-packaging.test.ts` | 181 ms | logs/test-plugins_opencode-1794482981978.txt |
| deps | plugins/opencode | pass: 6 known before, none new | `bun audit --json` | 542 ms | logs/deps-plugins_opencode-1794482982159.txt |

## Judgement gates

| Gate | Verdict | Reviewer | Findings | Tokens |
| :- | :- | :- | -: | -: |
| code-quality | proven | review-code-quality | 1 | 46962 |
| test-quality | proven | review-test-quality | 3 | 44597 |
| security | proven | review-security | 2 | 46037 |
| risk | proven | review-risk | 3 | 44951 |
| architecture | proven | review-architecture | 1 | 46441 |

- code-quality: packaging/homebrew/wizardingcode-mem.rb:8 Advisory (debt, outside the change): the Homebrew formula still says version "0.7.0" with v0.7.0 URLs and checksums (read at lines 8, 13 and 17). The file is not in the diff, and the brief states the formula follows the release with its checksums once the v0.8.0 assets exist, as commit #32 did for 0.7.0. The reviewer raised no finding on a line of the diff: the 11 hunks each change one version string and nothing else, and no code-quality question fails. (advisory, outside the change)
- test-quality: tests/integration/plugins-packaging.test.ts:40 Advisory (debt, outside the change): F-1 kept at the reviewer's severity. AC-1 is a preserve criterion; its evidence names four test files run before and after (24 pass each time, evidence.json), and the named tests do exercise the version: npm-shim.test.ts:86 pins npm/package.json to the root version, cli.test.ts:9 pins `--version` to package.json, plugins-packaging.test.ts:40 serves the OpenCode plugin a binary of pkg.version. So rubric question 3 is met and nothing is a defect. The gap the reviewer names, that no test asserts the regenerated manifests and the shims' pinned VERSION equal package.json, is in test files the diff did not touch and is debt. (advisory, outside the change)
- test-quality: .env.example:4 Advisory: F-2 named the file but no line; the file has one changed line, 4, where I place it. No test asserts WIZARDINGCODE_MEM_VERSION in .env.example. This answers no rubric question as a defect: the only criterion is preserve, and the rubric's defects for preserve are named tests that do not touch the preserved behaviour, which is not the case here. A test of the tag would be hardening; kept as the reviewer's advisory. (advisory)
- test-quality: tests/integration/plugins-packaging.test.ts:115 Advisory (debt, outside the change): the test reads plugins/opencode/package.json but asserts no `version` against the root version; the same gap as F-1, in a file the diff did not touch. (advisory, outside the change)
- security: scripts/templates/wizardingcode-mem.sh:40 Advisory (debt, outside the change): the WIZARDINGCODE_MEM_RELEASE_BASE override changes where the shim fetches the binary and its checksums.txt from the same base. The template is not in the diff and the diff changes only VERSION in its three generated copies; the URL base and the checksum check are unchanged. Existing behaviour, not introduced here. (advisory, outside the change)
- security: .env.example:4 Advisory, dropped as a finding: the reviewer's release-ordering note names no line and answers no security question (it says itself the fetch fails closed and is not a security defect). Recorded at the compose tag line it describes; the same window is the risk gate's F-1. No credential appears in the diff; the secrets gate passed on the change. (advisory)
- risk: .env.example:4 Advisory: F-1 upheld at the reviewer's severity. Between the merge and the v0.8.0 tag's image job, `compose pull` on a copied .env.example fails loudly on a missing image, and the shims at plugin/wizardingcode-mem.sh:13, its codex and cursor copies and plugins/opencode/binary.js:7 fail open until the release exists, which is the hooks' stated convention. Rubric question 5's defect is a dependency the spec does not state; there is no spec on this route and brief.md line 5 states it: the tag v0.8.0 on main builds the binaries, the image and the release, and the formula follows. A stated, loud dependency is not a defect; tagging right after the merge is the mitigation the reviewer names. (advisory)
- risk: .github/workflows/release.yml:23 Advisory (debt, outside the change): release.yml is not in the diff, so F-2 cannot be a defect on a line of the change. Its open question is answered: docs/runbooks/team-server.md has "### Upgrade" at line 61 and "### Rollback" at line 72 (third-level headings, which a search for second-level ones missed). I read them: the upgrade copies team.db to /data/backups/team-<ms>-v<n>-<pid>.db before the schema 2 migration, and the rollback restores that copy, sets WIZARDINGCODE_MEM_VERSION back to the previous tag, keeps the newer file as team-before-rollback.db and removes the -wal and -shm files; the names created since the copy are the stated loss. The rollback exists and is manual, which the rubric calls advisory. The tag check at release.yml:23 stops a tag that does not match package.json (0.8.0 here). (advisory, outside the change)
- risk: packaging/homebrew/wizardingcode-mem.rb:8 Advisory (debt, outside the change): the formula stays at 0.7.0 with 0.7.0 checksums until its own step after the v0.8.0 assets exist; brew users stay on 0.7.0 meanwhile. Not in the diff; the brief states the formula follows the release. (advisory, outside the change)
- architecture: packaging/homebrew/wizardingcode-mem.rb:8 Advisory (debt, outside the change): the Homebrew formula names 0.7.0 with 0.7.0 URLs and checksums; the diff did not touch it and the checksums are known only after the release assets exist, as the history (#31 then #32) shows. The reviewer raised no finding on a line of the diff: the three generated .sh copies share one blob (e20196b), every generated file changes only its version line, no 0.7.0 string remains in a generated file, and the diff touches no schema, contract or integration. (advisory, outside the change)

## Verifications

| What | Ref | Answer | Confidence | Model | At |
| :- | :- | :- | -: | :- | :- |
| knowledge | K-375 | yes 0.84 | - | jev-1.14.0 | 2026-11-12T11:15:15.648Z |
| knowledge | K-363 | no 0.91 | - | jev-1.14.0 | 2026-11-12T11:15:15.648Z |
| knowledge | K-381 | no 0.94 | - | jev-1.14.0 | 2026-11-12T11:15:15.648Z |
| knowledge | K-376 | yes 0.64 | - | jev-1.14.0 | 2026-11-12T11:15:15.648Z |
| knowledge | K-335 | no 0.93 | - | jev-1.14.0 | 2026-11-12T11:15:15.648Z |
| knowledge | K-372 | no 0.92 | - | jev-1.14.0 | 2026-11-12T11:15:15.648Z |
| knowledge | K-371 | no 0.90 | - | jev-1.14.0 | 2026-11-12T11:15:15.648Z |
| knowledge | K-346 | no 0.94 | - | jev-1.14.0 | 2026-11-12T11:15:15.648Z |
| knowledge | K-319 | no 0.95 | - | jev-1.14.0 | 2026-11-12T11:15:15.648Z |
| knowledge | K-343 | no 0.94 | - | jev-1.14.0 | 2026-11-12T11:15:15.648Z |

## Team

- Primary team: backend (the session)

| Seat | Team | Reason |
| :- | :- | :- |
| researcher | researchers | full route |
| review-code-quality | backend | full route |
| review-test-quality | qa | full route |
| review-security | security | full route |
| review-risk | architects | full route |
| review-architecture | architects | full route |
| lead-qa | qa | full route |
| lead-security | security | full route |
| lead-architects | architects | full route |
| judge |  | a gate is planned |

- Rounds: judgement 1 of 2, validation 0 of 2
- Runtimes: claude (context at start: enforced; the status line per prompt: enforced; the denial of engine files: enforced; the denial of forbidden commands: enforced; the hold at Stop: enforced; the roles' answers filed: enforced; the roles read-only: enforced)

## Roles

| Role | Model | Personality | At | Tokens | Answer | Filed by |
| :- | :- | :- | :- | -: | :- | :- |
| review-code-quality | claude-sonnet-5-5 | - | 2026-11-12T11:30:48.905Z | 32246 | review/code-quality.findings.md | hook |
| review-security | claude-sonnet-5-5 | - | 2026-11-12T11:30:50.512Z | 31321 | review/security.findings.md | hook |
| review-test-quality | claude-sonnet-5-5 | - | 2026-11-12T11:30:52.174Z | 29881 | review/test-quality.findings.md | hook |
| review-architecture | claude-sonnet-5-5 | - | 2026-11-12T11:30:53.301Z | 31725 | review/architecture.findings.md | hook |
| review-risk | claude-sonnet-5-5 | - | 2026-11-12T11:30:55.632Z | 30235 | review/risk.findings.md | hook |
| judge | claude-fable-5-1 | - | 2026-11-12T11:33:19.488Z | 73580 | review/ruling.json | hook |

## Waits

- for the roles (2026-11-12T11:30:43.073Z), not proven: judgement gate code-quality not run
- for the roles (2026-11-12T11:31:16.575Z), not proven: judgement gate code-quality not run

Fingerprint: sha256:d3d3ed6a5ee8aae07756352b242f1c6ae4e901cb7490dbb6cd8830ac7a1278ac
