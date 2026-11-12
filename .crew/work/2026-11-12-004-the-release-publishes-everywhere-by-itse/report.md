# Report: The release publishes everywhere by itself, and <data dir>/bin has one owner tha

- Work: `2026-11-12-004-the-release-publishes-everywhere-by-itse`
- Type: feature. Kind: feature (from work_type feature). Route: full (risk areas: infra; personal data in lines not read for risk (test or excluded): email (tests/integration/release-commands.test.ts), email (tests/integration/release-push.test.ts); the change's lines name personal data: password (.github/workflows/distribute.yml) and 1 more)
- CTO plan: none
- Packs: none
- Checklists: sync (1 file), auth (1 file)
- Verdict: **Proven**

## Spec review

- done: round 2 clean.
- Contested zoom-out-1.5-1: The spec says twice that nothing reads `latest` until piece 3 (Non-Goals; Risks "`latest` may lag"), and the code agrees: `compose.yml:6` pins `${WIZARDINGCODE_MEM_VERSION}` and no file uses `:latest`. So the contract hold protects no reader in this piece, yet it adds a source-text parser of `src/team/contract.ts` that fails closed, `previousPlain`, `decideHold`, a third dispatch input, two summary outcomes, a manual-release path and a runbook section. A builder would ship and test a gate for a consumer that does not exist yet, and would freeze its rule before piece 3 has decided how a host follows `latest`. The simpler shape: this piece moves `latest` last and does nothing more; the hold is built in piece 3 next to its reader. D-2 is the author's decision, so the session should confirm it was made knowing that nothing reads `latest` today. (The author was asked this on 2026-11-12 with the fact stated in the question (nothing reads latest today; the compose file pins the version) and with 'in piece 3' as the recommended option, and chose to keep the rule in this piece, corrected, with a manual release of the hold; the spec records it under Alternatives ('The contract rule moved to piece 3. Not taken') and as D-2.) [spec.md:Alternatives]

The file: `spec-review/consolidated.md`.

## Knowledge

- K-363 · validated-solution · "Team server: wizardingcode-mem serve, one Docker image with SQLite and the repos" · alone · stack node, word release, word publishes, word data · unverified 0.27
- K-383 · validated-solution · "Homebrew formula: 0.8.0 with the release's checksums. packaging/homebrew/wizardi" · alone · stack node, word release, word publishes · unverified 0.57
- K-376 · validated-solution · "Homebrew formula: 0.7.0 with the release's checksums. packaging/homebrew/wizardi" · alone · stack node, word release, word publishes · unverified 0.51
- K-371 · validated-solution · "Part 6 of the knowledge and team journey, the sync client: wizardingcode-mem kee" · alone · stack node, word data, word owner · unlikely 0.12
- K-319 · validated-solution · "Record why the drain skips a turn (saved, empty, not-worth, no-title) in turns.l" · alone · stack node, word release, word itself · unlikely 0.08
- K-375 · validated-solution · "Release 0.7.0: version 0.7.0 in package.json and in every file that carries the " · alone · stack node, word release · unverified 0.6
- K-335 · validated-solution · "Knowledge store: entries as Markdown with frontmatter (kind knowledge, strategy," · alone · stack node, word data · unlikely 0.11
- K-382 · validated-solution · "CI slack for the two perf budgets without one. tests/perf/budgets.test.ts holds " · alone · stack node · unlikely 0.1
- K-381 · validated-solution · "Share a project without a git remote. Today a project can be set above Nothing o" · alone · stack node · unlikely 0.08
- K-372 · validated-solution · "Part 7 of the knowledge and team journey, the runbook: docs/runbooks/team-server" · alone · stack node · unlikely 0.17
- Learned: not yet

## Acceptance criteria

| Id | Kind | Criterion | Test-first |
| :- | :- | :- | :- |
| AC-57 | behavior | Every pair of tests/fixtures/version-order.ts gets the same answer from olderThan (src/util/version.ts), from the generated JavaScript older() and from the shell older(); 0.9.0-rc.9 is older than 0.9.0-rc.10, and a have that is not a version is older, in all three. | red then green |
| AC-58 | behavior | The older() in npm/bin/wizardingcode-mem.js equals OLDER_JS byte for byte, and the older() block of scripts/install.sh equals the one in scripts/templates/wizardingcode-mem.sh byte for byte. | red then green |
| AC-59 | behavior | The npm shim, with a newer binary staged, downloads nothing, runs the staged binary with the arguments and exit code passed through, and prints the one line on standard error; with an older binary staged it downloads the package's version. | red then green |
| AC-60 | behavior | stageBinary keeps a staged binary of a higher version and returns it as kept; it replaces a staged binary of an equal or lower version, one that cannot be run, one that exits non-zero on --version, one whose --version output is not a version, and, with force, one of a higher version. | red then green |
| AC-61 | behavior | wizardingcode-mem install with two agents found and a newer binary staged prints the "newer … is already in" line once and hands the install over to the staged binary, which is run once with the same arguments and whose exit code is returned; with --force the staged binary is replaced by the running one, the line is absent, and both agents' hooks point at the staged path. | red then green |
| AC-62 | behavior | scripts/install.sh --download-only with a newer binary staged leaves it in place and says so; --force anywhere among the arguments replaces it; a staged file that answers something other than a version is replaced. | red then green |
| AC-63 | behavior | The formula rendered from the template with a version and a checksums.txt holds that version in every URL and each of the four checksums under its platform's block, and no mark; a checksums.txt lacking one of the four names fails, naming it. | red then green |
| AC-64 | behavior | The marketplace edit changes, in each manifest's text, only the wizardingcode-mem entry's version and ref values and leaves every other byte equal; when either manifest's entry is at a higher version it writes neither and reports it; it fails for an entry whose ref is not a version tag or that is missing. | red then green |
| AC-65 | behavior | The plan's decision refuses, each with its sentence: a ref other than refs/heads/main; a malformed tag; a tag that does not exist; a tag whose commit is not on main; a tag whose version is not its commit's package.json version; a tag whose tree lacks distribute.yml; a plain tag that is not the highest plain tag, and a pre-release tag that is not the highest tag; a release that does not exist; a draft release; a release that lacks an asset (the sentence names it); an environment release that is missing, and one whose rule is not exactly the branch main. It accepts a plain v0.9.1 while a v0.10.0-rc.1 tag exists, and for an accepted tag gives the version, the tag's commit and whether it is a pre-release. The tag list it is given holds only tags merged into main that are version tags: a v99.0.0 on a branch commit and a vnext tag change no decision. | red then green |
| AC-66 | behavior | The hold decision is "held" when the tag's lowest accepted contract is above the previous plain release's CONTRACT; "not held" when it is not, when there is no previous plain release and when the file is missing at it; "held", naming the read that failed, when the constants cannot be read at the tag and when the file is present but unreadable at the previous plain release; and "not held", marked as released by hand, when it would be held and release_hold is true. The parser's reading of the real src/team/contract.ts equals the CONTRACT and ACCEPTED_CONTRACTS the file exports. | red then green |
| AC-67 | behavior | The npm decision exits 1 for a package whose version differs from the tag's; reads a non-empty npm view answer as published, an empty answer or E404 as not published and any other failure as an error; builds npm publish --access public --ignore-scripts, with --tag next for a pre-release and without it for a plain release, and with --dry-run on a dry run; reads a publish refused because the version exists as already published; and adds the trusted-publisher sentence to an authentication failure. | red then green |
| AC-68 | behavior | The token decision maps no token, 401, 403, 404 and a 200 whose push permission is false each to its failure sentence, 200 with fewer than 30 days left to a warning, and 200 with no expiry header to an "expiry unknown" warning and a pass. | red then green |
| AC-69 | behavior | release.yml: docker's tags carry no latest; publish checks out with fetch-depth: 0; a job distribute needs publish, has actions: write, runs gh workflow run distribute.yml --ref main with the tag, and its run: holds no ${{. | red then green |
| AC-70 | behavior | distribute.yml: the only trigger is workflow_dispatch with tag, dry_run and release_hold; top-level permissions is empty; one concurrency group, not cancelled; every job runs on ubuntu-latest with timeout-minutes: 15; npm, tap and marketplace name the environment release and plan and latest name none; only npm has id-token: write and only latest has packages: write; the run is named distribute <tag>; latest needs plan, npm, tap and marketplace; tap, marketplace and latest are conditioned on a plain release, latest on no hold and on not being cancelled, with a first step that fails when a needed job did not succeed, and latest's retag step on no dry run; npm's checkout of the release's tree takes its ref from plan's sha output, and no checkout takes inputs.tag. | red then green |
| AC-71 | behavior | In distribute.yml, no run: script contains ${{; every uses: is pinned to a 40-character commit SHA; every actions/checkout has persist-credentials: false; and secrets.MARKETPLACE_TOKEN appears exactly four times, each in the env: of a step of the jobs tap and marketplace. | red then green |
| AC-72 | behavior | The writer to another repository, run against a local bare repository: an unchanged tree makes no commit and reports "already at"; a changed tree makes one commit wizardingcode-mem <version> and pushes it; a push refused as not fast-forward succeeds after one rebase; a dry run leaves the remote as it was; the git commands and remote URL it builds carry no token, which travels only in the child's environment; and, given a commit the tag no longer names, it refuses before any write, for a lightweight and for an annotated tag. | red then green; the red recorded 2 times (the latest decides); the green recorded 2 times (the latest decides) |
| AC-73 | behavior | summaryLine gives, for each target and outcome of the summary table, exactly that text, the token's three lines, a failed target's line, the plan's refusal and the "not moved" line included; plan writes the three "skipped: pre-release" lines for a pre-release, the "held" line for a hold and its refusal line when it refuses. | red then green |
| AC-74 | observed | docs/runbooks/release.md holds the one-time setup in its order (the ruleset on main checked, with one approval to require once a second person has write access; the ruleset on v* tags; the environment's rule before the secret and any secret found there removed; the token with its date noted; the two trusted publishers), the first release's order (the refused automatic run, the dry run and what it does not prove, the real dispatch), what a run shows, the repeat, the repairs (a release that lacks an asset; a tag whose release failed, which blocks the repeat of the release before it; each of the four external writes' failure message), the way back (install --force; a bad release is fixed by a higher version; do not re-run a run whose write was reverted by hand), the release of a hold, and the limits (a third dispatch replaces a pending one; the dist-tag next; shims already published; the release's assets are not tied to the judged commit, with making releases immutable where the repository's settings offer it; latest can be moved outside the workflow). | observed: passes after (documents: no test can fail first. tests/unit/team-runbook.test.ts checks only that the commands and paths the team runbook cites exist, which it does for the new citation of docs/runbooks/release.md; the content is read by the reviewers.) |
| AC-75 | observed | docs/runbooks/team-server.md says latest moves last and may be held, and cites the release runbook. | superseded by AC-78 (2026-11-12); own record: observed: passes after (documents: no test can fail first. tests/unit/team-runbook.test.ts checks only that the commands and paths the team runbook cites exist, which it does for the new citation of docs/runbooks/release.md; the content is read by the reviewers.) |
| AC-76 | observed | docs/adr/0029-release-distribution.md records the decisions D-1 to D-5 and those carried from 2026-11-11-004, the alternatives and the limits, including that a staged file answering a very high version is replaced only by --force, and that it supersedes the Homebrew row of ADR 0008. | observed: passes after (documents: no test can fail first. tests/unit/team-runbook.test.ts checks only that the commands and paths the team runbook cites exist, which it does for the new citation of docs/runbooks/release.md; the content is read by the reviewers.) |
| AC-77 | observed | CLAUDE.md names the two workflows, the scripts under scripts/release/, the environment, the forward-only rule with install --force, the runbook and the ADR. | superseded by AC-78 (2026-11-12); own record: observed: passes after (documents: no test can fail first. tests/unit/team-runbook.test.ts checks only that the commands and paths the team runbook cites exist, which it does for the new citation of docs/runbooks/release.md; the content is read by the reviewers.) |
| AC-78 | behavior | tests/unit/release-docs.test.ts holds the release's documents to the code: the team runbook and CLAUDE.md cite docs/runbooks/release.md; CLAUDE.md names the two workflows, scripts/release/lib.ts, ADR 0029, install --force and the environment release; every wizardingcode-mem command the release runbook cites is one the CLI knows, with a flag its module names; every repository file it cites exists; and the lines of its 'What a run shows' section are exactly the lines summaryLine can write, none left out. | red then green |

## Gates

| Gate | Target | Status | Command | Duration | Log |
| :- | :- | :- | :- | -: | :- |
| secrets | . | pass | `built-in secret scan` | 40 ms |  |
| prose | . | pass | `built-in prose scan` | 45 ms |  |
| build | . | pass | `bun run build` | 2473 ms | logs/build-_-1794501720788.txt |
| test | . | pass | `bun run test` | 215092 ms | logs/test-_-1794501723289.txt |
| lint | . | pass: 1 untouched file with problems, none of the item's | `bun run lint` | 99 ms | logs/lint-_-1794501938381.txt |
| typecheck | . | pass | `bun run typecheck` | 376 ms | logs/typecheck-_-1794501938481.txt |
| test | npm | pass | `../node_modules/.bin/bun test ../tests/integration/npm-shim.test.ts` | 467 ms | logs/test-npm-1794501938857.txt |
| test | plugins/opencode | pass | `../../node_modules/.bin/bun test ../../tests/unit/opencode-plugin.test.ts ../../tests/integration/plugins-packaging.test.ts` | 170 ms | logs/test-plugins_opencode-1794501939324.txt |

## Judgement gates

| Gate | Verdict | Reviewer | Findings | Tokens |
| :- | :- | :- | -: | -: |
| code-quality | proven | review-code-quality | 4 | 137121 |
| test-quality | proven | review-test-quality | 2 | 123403 |
| security | proven | review-security | 1 | 116145 |
| risk | proven | review-risk | 3 | 177007 |
| architecture | proven | review-architecture | 4 | 150878 |
| infra | proven | review-infra | 2 | 108034 |

- code-quality: scripts/install.sh:95 Upheld as advisory. `version_of` (first line of --version, exit code ignored) and `stagedVersion` in src/install/binary.ts:17-18 (exit 0 and the whole trimmed output must be a version) read a staged binary's version by different rules, so the curl script can keep a binary that `install` replaces. The reviewer raised it as advisory and no rubric question makes it a defect: the order itself is held equal by tests/unit/version-order.test.ts. (advisory)
- code-quality: scripts/release/push.ts:219 Upheld as advisory. The production command reads the test-only overrides PUSH_REMOTE and PUSH_ORIGIN, and only GITHUB_ACTIONS switches them off. That works today. Reaching `commitAndPush` with `remote` and `origin` directly would take the overrides out of the command. Raised as advisory. (advisory)
- code-quality: .github/workflows/release.yml:253 Lowered to advisory as debt outside the change. The moving action tags and the persisted checkout credentials are lines this diff did not add, and docs/real-use/findings.md already defers them. (advisory)
- code-quality: src/store/meta.ts:158 Lowered to advisory as debt outside the change. This file is not in the diff. Its direct use of Bun.semver.order is already deferred. (advisory, outside the change)
- test-quality: tests/unit/release-lib.test.ts:486 Upheld as advisory. AC-66's only `previous: null` case also passes `atPrevious: "missing"`, so deleting `input.previous === null \|\|` from decideHold (scripts/release/lib.ts:528) leaves the test green. plan.ts:127 always pairs the two, so the behaviour a caller sees is still held, which is why this is not a defect. A case with `previous: null` and a readable `atPrevious` would put that branch under test. (advisory)
- test-quality: tests/unit/deploy-files.test.ts:281 Upheld as advisory. The `step()` helper creates a mkdtempSync folder on each call and never removes it. The assertions are sound; this is test hygiene only. (advisory)
- security: scripts/release/push.ts:43 Upheld as advisory. gitEnv puts the base64 form of the Basic Authorization header into GIT_CONFIG_VALUE_0 without `::add-mask::`. The reviewer shows that no current path prints it: git redacts the header and only stderr reaches the ReleaseError sentences. The exposure needs a future trace or debug re-run, so the finding stays advisory, as raised. Masking the encoded value before the first git call would close it. (advisory)
- risk: docs/runbooks/release.md:33 Upheld as advisory. The first real dispatch makes all four outside writes at once on a plain tag, after a dry run that tests none of them. The spec states this (spec.md:219, :272) and names its way back, a higher version, so no rollback or dependency is missing from the item's spec or plan. Making the first tag that carries this item an rc under `next` would lower the exposure. (advisory, outside the change)
- risk: .github/workflows/distribute.yml:104 Upheld as advisory. The first npm publish moves unpinned npx and OpenCode users from 0.4.4 straight to the new version, across every store migration since then. The spec's Risks do not name this group's first-hour exposure, but the way back is stated (a higher version, and a backup restore in the runbook). It is an unnamed exposure with a stated rollback, not a missing rollback or dependency, so it stays advisory, as raised. One line in Risks would cover it. (advisory)
- risk: .github/workflows/release.yml:104 Lowered to advisory as debt outside the change. The moving action tags under a workflow-level contents: write are lines this diff did not add, and docs/real-use/findings.md already defers them. (advisory)
- architecture: docs/adr/0029-release-distribution.md:3 Upheld as advisory. The status line links ADR 0009 as `0009-native-install.md`, but the file is `docs/adr/0009-native-installation.md`. It is a broken citation in a document, not a boundary crossed, so it stays advisory. Fix the link. (advisory, outside the change)
- architecture: scripts/release/lib.ts:1 Upheld as advisory. CLAUDE.md and ADR 0029 call lib.ts 'pure functions', but it also holds `run`, `summary`/`output` and `command`, which have side effects. The base defines no layer that this crosses, so it is a mismatch between description and code, not a defect. Either split those four out or correct the sentence. (advisory)
- architecture: src/store/meta.ts:158 Lowered to advisory as debt outside the change. This file is not in the diff. takeOverLease's direct use of Bun.semver.order is already deferred. (advisory, outside the change)
- architecture: .github/workflows/release.yml:100 Lowered to advisory as debt outside the change. The moving action tags and the persisted credentials are in lines this diff did not introduce, and the item is already deferred in docs/real-use/findings.md. (advisory)
- infra: .github/workflows/release.yml:152 Upheld as advisory. The new `distribute` job (one `gh workflow run` step) has no timeout-minutes, so a stalled dispatch could hold the release run up to the runner's 6-hour default. Every job in distribute.yml sets 15. The reviewer raised it as advisory under Q6 consistency, and it does not fail a gate, secret, permission or rollback question. (advisory)
- infra: .github/workflows/release.yml:20 Lowered to advisory as debt outside the change. The moving action tags and the persisted credentials in jobs this diff did not add are already deferred in docs/real-use/findings.md. (advisory)

## Verifications

| What | Ref | Answer | Confidence | Model | At |
| :- | :- | :- | -: | :- | :- |
| knowledge | K-363 | no 0.73 | - | jev-1.14.0 | 2026-11-12T14:20:02.564Z |
| knowledge | K-383 | yes 0.57 | - | jev-1.14.0 | 2026-11-12T14:20:02.564Z |
| knowledge | K-376 | yes 0.51 | - | jev-1.14.0 | 2026-11-12T14:20:02.564Z |
| knowledge | K-371 | no 0.88 | - | jev-1.14.0 | 2026-11-12T14:20:02.564Z |
| knowledge | K-319 | no 0.92 | - | jev-1.14.0 | 2026-11-12T14:20:02.564Z |
| knowledge | K-375 | yes 0.60 | - | jev-1.14.0 | 2026-11-12T14:20:02.564Z |
| knowledge | K-335 | no 0.89 | - | jev-1.14.0 | 2026-11-12T14:20:02.564Z |
| knowledge | K-382 | no 0.90 | - | jev-1.14.0 | 2026-11-12T14:20:02.564Z |
| knowledge | K-381 | no 0.92 | - | jev-1.14.0 | 2026-11-12T14:20:02.564Z |
| knowledge | K-372 | no 0.83 | - | jev-1.14.0 | 2026-11-12T14:20:02.564Z |
| defect | code-quality scripts/release/push.ts:70 | yes 0.98 | 0.98 | jev-1.14.0 | 2026-11-12T16:15:38.799Z |
| defect | code-quality scripts/release/lib.ts:241 | yes 0.98 | 0.98 | jev-1.14.0 | 2026-11-12T16:15:38.799Z |
| defect | code-quality scripts/release/push.ts:134 | yes 0.87 | 0.87 | jev-1.14.0 | 2026-11-12T16:26:34.485Z |

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
| review-infra | devops | risk area infra |
| lead-qa | qa | full route |
| lead-security | security | full route |
| lead-architects | architects | full route |
| lead-devops | devops | risk area infra |
| judge |  | a gate is planned |

- Rounds: judgement 4 of 2, validation 3 of 2
- Runtimes: claude (context at start: enforced; the status line per prompt: enforced; the denial of engine files: enforced; the denial of forbidden commands: enforced; the hold at Stop: enforced; the roles' answers filed: enforced; the roles read-only: enforced)

## Validations

| What | By | Verdict | Returns | Round | File |
| :- | :- | :- | -: | -: | :- |
| spec | lead-qa | returned | 7 | 1 | conclave/lead-qa.md |
| spec | lead-security | returned | 5 | 1 | conclave/lead-security.md |
| spec | lead-architects | returned | 2 | 1 | conclave/lead-architects.md |
| spec | lead-devops | returned | 5 | 1 | conclave/lead-devops.md |
| spec | lead-qa | validated | 0 | 2 | conclave/lead-qa-reply.md |
| spec | lead-devops | validated | 0 | 2 | conclave/lead-devops-reply.md |
| spec | lead-architects | validated | 0 | 2 | conclave/lead-architects-reply.md |
| spec | lead-security | returned | 1 | 2 | conclave/lead-security-reply.md |
| spec | lead-security | validated | 0 | 3 | conclave/lead-security-reply.md |
| spec | lead-qa | validated | 0 | 3 | conclave/lead-qa-reply.md |
| spec | lead-devops | validated | 0 | 3 | conclave/lead-devops-reply.md |
| spec | lead-architects | validated | 0 | 3 | conclave/lead-architects-reply.md |
| delivery | lead-security | validated | 0 | 1 | conclave/lead-security.delivery.md |
| delivery | lead-qa | returned | 1 | 1 | conclave/lead-qa.delivery.md |
| delivery | lead-architects | returned | 2 | 1 | conclave/lead-architects.delivery.md |
| delivery | lead-devops | returned | 3 | 1 | conclave/lead-devops.delivery.md |

## Gap round

- D-1: The workflow's shape: one release.yml with a plan job and a workflow_dispatch repeat, or release.yml as it is starting a separate dispatch-only distribute.yml (npm, tap, marketplace, latest) whose token and npm publish sit under a GitHub environment 'release' restricted to main? → The separate distribute.yml: release.yml as it is, starting a dispatch-only distribute.yml with the tag; the token and the npm publish under a GitHub environment 'release' restricted to main. (the person, 2026-11-12: chose 'distribute.yml separado e protegido', the default), by the user, relayed by the agent
- D-2: Where the contract rule for the image's latest lives and what it tests: in piece 3 with the server's upgrader; in this piece corrected (latest held when the release's lowest accepted contract is above the previous plain release's CONTRACT, with a dispatch input that releases the hold); or in this piece as D-10 of 2026-11-11-004 worded it (held on any rise of CONTRACT until the next release)? → In this piece, corrected: latest is held when the release's lowest accepted contract is above the previous plain release's CONTRACT, with a dispatch input that releases the hold. (the person, 2026-11-12: chose 'Já na peça 1, corrigida', against the default), by the user, relayed by the agent
- D-3: The weekly scheduled check of the token (token.yml, door.ts): keep it with its limits written, or remove it and leave the check on the release run (a named failure, a warning under 30 days) with GitHub's own expiry email and the date noted at creation as the advance notice? → Remove the weekly check: the release run's check stays (a named failure, a warning under 30 days); the advance notice is GitHub's expiry email and the date noted when the token is created. (the person, 2026-11-12: chose 'Retirar a verificação semanal', against the default), by the user, relayed by the agent
- D-4: A ruleset that reserves creating, updating and deleting v* tags to admins: a mandatory step of the one-time setup, or an optional suggestion in the runbook? → Mandatory in the one-time setup; the workflow still checks that the tag is on main and counts only tags on main. (the person, 2026-11-12: chose 'Obrigatório', the default), by the user, relayed by the agent
- D-5: The ruleset on main requires a pull request and three status checks but zero approvals (read 2026-11-12): write that limit into the spec and the runbook (the barrier is a pull request with green checks; require one approval when a second person has write access), or require one approval now as a setup step? → Write the limit: the barrier is a pull request with green checks, which stops access from a branch or a tag, not someone who can merge to main; the runbook says to require one approval when a second person has write access. (the person, 2026-11-12: chose 'Escrever o limite', the default), by the user, relayed by the agent
- Debate: none

## Roles

| Role | Model | Personality | At | Tokens | Answer | Filed by |
| :- | :- | :- | :- | -: | :- | :- |
| goldfish-structural | claude-opus-5-5 | - | 2026-11-12T14:23:44.683Z | 32256 | spec-review/brainstorm-goldfish-structural.md | hook |
| goldfish-comprehension | claude-opus-5-5 | - | 2026-11-12T14:23:56.176Z | 39466 | spec-review/brainstorm-goldfish-comprehension.md | hook |
| goldfish-zoom-out | claude-opus-5-5 | - | 2026-11-12T14:24:15.568Z | 53069 | spec-review/brainstorm-goldfish-zoom-out.md | hook |
| goldfish-design | claude-opus-5-5 | - | 2026-11-12T14:24:22.045Z | 47660 | spec-review/brainstorm-goldfish-design.md | hook |
| goldfish-readiness | claude-opus-5-5 | - | 2026-11-12T14:24:32.088Z | 52639 | spec-review/brainstorm-goldfish-readiness.md | hook |
| goldfish-codebase | claude-opus-5-5 | - | 2026-11-12T14:24:56.970Z | 73643 | spec-review/brainstorm-goldfish-codebase.md | hook |
| tech-lead | claude-fable-5-2 | - | 2026-11-12T14:33:34.597Z | 68901 | conclave/lead-security.md | hook |
| tech-lead | claude-fable-5-2 | - | 2026-11-12T14:33:53.401Z | 81532 | conclave/lead-devops.md | hook |
| tech-lead | claude-fable-5-2 | - | 2026-11-12T14:34:09.522Z | 99329 | conclave/lead-architects.md | hook |
| tech-lead | claude-fable-5-2 | - | 2026-11-12T14:34:17.674Z | 110687 | conclave/lead-qa.md | hook |
| tech-lead | claude-fable-5-2 | - | 2026-11-12T14:37:46.644Z | 133127 | conclave/lead-qa-reply.round2.md | hook |
| tech-lead | claude-fable-5-2 | - | 2026-11-12T14:37:49.166Z | 104498 | conclave/lead-devops-reply.round2.md | hook |
| tech-lead | claude-fable-5-2 | - | 2026-11-12T14:37:54.415Z | 123647 | conclave/lead-architects-reply.round2.md | hook |
| tech-lead | claude-fable-5-2 | - | 2026-11-12T14:38:00.970Z | 95883 | conclave/lead-security-reply.round2.md | hook |
| tech-lead | claude-fable-5-2 | - | 2026-11-12T14:40:09.082Z | 105715 | conclave/lead-security-reply.md | hook |
| tech-lead | claude-fable-5-2 | - | 2026-11-12T14:40:10.404Z | 143174 | conclave/lead-qa-reply.md | hook |
| tech-lead | claude-fable-5-2 | - | 2026-11-12T14:40:12.288Z | 118893 | conclave/lead-devops-reply.md | hook |
| tech-lead | claude-fable-5-2 | - | 2026-11-12T14:40:14.066Z | 137383 | conclave/lead-architects-reply.md | hook |
| goldfish-zoom-out | claude-opus-5-5 | - | 2026-11-12T14:44:32.161Z | 67776 | spec-review/goldfish-zoom-out.round2.md | hook |
| goldfish-structural | claude-opus-5-5 | - | 2026-11-12T14:45:32.094Z | 40863 | spec-review/goldfish-structural.round2.md | hook |
| goldfish-style | claude-opus-5-5 | - | 2026-11-12T14:45:50.116Z | 45711 | spec-review/goldfish-style.round2.md | hook |
| goldfish-design | claude-opus-5-5 | - | 2026-11-12T14:46:55.495Z | 58862 | spec-review/goldfish-design.round2.md | hook |
| goldfish-readiness | claude-opus-5-5 | - | 2026-11-12T14:51:23.792Z | 116594 | spec-review/goldfish-readiness.round2.md | hook |
| goldfish-codebase | claude-opus-5-5 | - | 2026-11-12T14:51:39.809Z | 141508 | spec-review/goldfish-codebase.round2.md | hook |
| goldfish-zoom-out | claude-opus-5-5 | - | 2026-11-12T15:06:02.529Z | 78059 | spec-review/goldfish-zoom-out.md | hook |
| goldfish-structural | claude-opus-5-5 | - | 2026-11-12T15:07:03.473Z | 40680 | spec-review/goldfish-structural.md | hook |
| goldfish-style | claude-opus-5-5 | - | 2026-11-12T15:07:26.333Z | 49106 | spec-review/goldfish-style.round3.md | hook |
| goldfish-design | claude-opus-5-5 | - | 2026-11-12T15:08:47.212Z | 70542 | spec-review/goldfish-design.md | hook |
| goldfish-style | claude-opus-5-5 | - | 2026-11-12T15:09:57.716Z | 43304 | spec-review/goldfish-style.md | hook |
| goldfish-readiness | claude-opus-5-5 | - | 2026-11-12T15:12:36.967Z | 94934 | spec-review/goldfish-readiness.md | hook |
| goldfish-codebase | claude-opus-5-5 | - | 2026-11-12T15:16:13.275Z | 176195 | spec-review/goldfish-codebase.md | hook |
| review-code-quality | claude-opus-5-5 | - | 2026-11-12T16:13:14.471Z | 108464 | review/code-quality.findings.md | hook |
| review-test-quality | claude-opus-5-5 | - | 2026-11-12T16:13:31.796Z | 112084 | review/test-quality.findings.md | hook |
| review-infra | claude-opus-5-5 | - | 2026-11-12T16:13:43.643Z | 83256 | review/infra.findings.md | hook |
| review-architecture | claude-opus-5-5 | - | 2026-11-12T16:13:46.566Z | 135610 | review/architecture.findings.md | hook |
| review-security | claude-opus-5-5 | - | 2026-11-12T16:13:52.106Z | 96924 | review/security.findings.md | hook |
| review-risk | claude-opus-5-5 | - | 2026-11-12T16:14:31.643Z | 150699 | review/risk.findings.md | hook |
| judge | claude-opus-5-5 | - | 2026-11-12T16:15:31.994Z | 56343 | review/ruling.json | hook |
| review-test-quality | claude-opus-5-5 | - | 2026-11-12T16:23:37.618Z | 104414 | review/test-quality.findings.md | hook |
| review-code-quality | claude-opus-5-5 | - | 2026-11-12T16:23:54.484Z | 122788 | review/code-quality.findings.md | hook |
| review-architecture | claude-opus-5-5 | - | 2026-11-12T16:24:04.569Z | 135949 | review/architecture.findings.md | hook |
| review-infra | claude-opus-5-5 | - | 2026-11-12T16:24:07.510Z | 88646 | review/infra.findings.md | hook |
| review-security | claude-opus-5-5 | - | 2026-11-12T16:24:10.671Z | 97349 | review/security.findings.md | hook |
| review-risk | claude-opus-5-5 | - | 2026-11-12T16:24:50.663Z | 154796 | review/risk.findings.md | hook |
| judge | claude-opus-5-5 | - | 2026-11-12T16:26:03.711Z | 56751 | review/ruling.json | hook |
| review-code-quality | claude-opus-5-5 | - | 2026-11-12T16:34:33.055Z | 131729 | review/code-quality.findings.md | hook |
| review-architecture | claude-opus-5-5 | - | 2026-11-12T16:34:39.964Z | 134736 | review/architecture.findings.md | hook |
| review-infra | claude-opus-5-5 | - | 2026-11-12T16:34:45.599Z | 86575 | review/infra.findings.md | hook |
| review-security | claude-opus-5-5 | - | 2026-11-12T16:35:00.891Z | 105827 | review/security.findings.md | hook |
| review-test-quality | claude-opus-5-5 | - | 2026-11-12T16:35:12.528Z | 131552 | review/test-quality.findings.md | hook |
| review-risk | claude-opus-5-5 | - | 2026-11-12T16:35:47.936Z | 152628 | review/risk.findings.md | hook |
| judge | claude-opus-5-5 | - | 2026-11-12T16:37:10.597Z | 51283 | review/ruling.json | hook |
| tech-lead | claude-fable-5-2 | - | 2026-11-12T16:38:48.139Z | 146660 | conclave/lead-security.delivery.md | hook |
| tech-lead | claude-fable-5-2 | - | 2026-11-12T16:38:58.342Z | 117908 | conclave/lead-architects.delivery.md | hook |
| tech-lead | claude-fable-5-2 | - | 2026-11-12T16:39:08.346Z | 137275 | conclave/lead-qa.delivery.md | hook |
| tech-lead | claude-fable-5-2 | - | 2026-11-12T16:39:44.801Z | 138937 | conclave/lead-devops.delivery.md | hook |
| review-security | claude-opus-5-5 | - | 2026-11-12T16:47:50.021Z | 108696 | review/security.findings.md | hook |
| review-code-quality | claude-opus-5-5 | - | 2026-11-12T16:47:53.920Z | 129672 | review/code-quality.findings.md | hook |
| review-test-quality | claude-opus-5-5 | - | 2026-11-12T16:48:05.970Z | 115954 | review/test-quality.findings.md | hook |
| review-infra | claude-opus-5-5 | - | 2026-11-12T16:48:19.142Z | 100585 | review/infra.findings.md | hook |
| review-architecture | claude-opus-5-5 | - | 2026-11-12T16:48:22.024Z | 143429 | review/architecture.findings.md | hook |
| review-risk | claude-opus-5-5 | - | 2026-11-12T16:50:03.427Z | 169558 | review/risk.findings.md | hook |
| judge | claude-opus-5-5 | - | 2026-11-12T16:50:43.705Z | 44695 | review/ruling.json | hook |

## Decisions

- spec approved by the user, relayed by the agent (2026-11-12T14:40:27.420Z)
- AC-16 (observed) removed (2026-11-12T14:36:48.725Z): docs/runbooks/release.md holds the one-time setup, what a run shows, the repeat, the repair of a release that lacks an asset, the way back and the release of a hold; docs/runbooks/team-server.md says latest moves last and may be held; ADR 0029 records the decisions; CLAUDE.md names the two workflows and the scripts.
- AC-15 (behavior) removed (2026-11-12T14:36:48.783Z): token.yml runs on a weekly schedule and on dispatch, in the environment release, with --fail-under 30.
- AC-14 (behavior) removed (2026-11-12T14:36:48.841Z): distribute.yml: the only trigger is workflow_dispatch with tag, dry_run and release_hold; top-level permissions is empty; one concurrency group, not cancelled; npm, tap and marketplace name the environment release and plan and latest name none; only npm has id-token: write and only latest has packages: write; latest needs plan, npm, tap and marketplace; tap, marketplace and latest are conditioned on a plain release and latest on no hold; no run: script contains an inputs interpolation.
- AC-13 (behavior) removed (2026-11-12T14:36:48.899Z): release.yml: docker's tags carry no latest; publish checks out with fetch-depth 0; a job distribute needs publish, has actions: write and runs gh workflow run distribute.yml --ref main with the tag.
- AC-12 (behavior) removed (2026-11-12T14:36:48.956Z): The token decision maps no token, 401, 403 and 404 each to its failure sentence, 200 with fewer than 30 days left to a warning (a failure with --fail-under 30), and 200 with no expiry header to 'expiry unknown' and a pass.
- AC-11 (behavior) removed (2026-11-12T14:36:49.012Z): The npm decision reads a non-empty npm view answer as published, an empty answer or E404 as not published and any other failure as an error; it publishes a pre-release with --tag next and a plain release without it, and adds the trusted-publisher sentence to an authentication failure.
- AC-10 (behavior) removed (2026-11-12T14:36:49.068Z): The hold decision is held when the tag's lowest accepted contract is above the previous plain release's CONTRACT, not held when it is not, when there is no previous plain release or when the file is missing at it, and held with the failed read named when the constants cannot be read at the tag; the parser reads the real src/team/contract.ts as CONTRACT 2 and accepted 1 and 2.
- AC-9 (behavior) removed (2026-11-12T14:36:49.122Z): The plan's decision refuses, each with its sentence: a ref other than refs/heads/main, a malformed tag, a tag that is not the highest, a tag whose tree lacks distribute.yml, and a release that lacks an asset (the sentence names it); for an accepted tag it gives the version and whether it is a pre-release.
- AC-8 (behavior) removed (2026-11-12T14:36:49.178Z): The marketplace edit changes, in each manifest's text, only the wizardingcode-mem entry's version and ref values, leaves every other byte equal, leaves an entry at a higher version alone and reports it, and fails for an entry whose ref is not a version tag or that is missing.
- AC-7 (behavior) removed (2026-11-12T14:36:49.234Z): The formula rendered from the template with a version and a checksums.txt holds that version in every URL and each of the four checksums under its platform's block, and no mark; a checksums.txt lacking one of the four names fails, naming it.
- AC-6 (behavior) removed (2026-11-12T14:36:49.288Z): scripts/install.sh --download-only with a newer binary staged leaves it in place and says so; with --force it replaces it.
- AC-5 (behavior) removed (2026-11-12T14:36:49.341Z): wizardingcode-mem install with two agents found and a newer binary staged prints the 'newer … is already in' line once, and both agents' hooks point at the staged path; with --force the staged binary is the running one and the line is absent.
- AC-4 (behavior) removed (2026-11-12T14:36:49.395Z): stageBinary keeps a staged binary of a higher version and returns it as kept; it replaces a staged binary of an equal or lower version, one that exits non-zero on --version, and, with force, one of a higher version.
- AC-3 (behavior) removed (2026-11-12T14:36:49.449Z): The npm shim, with a newer binary staged, downloads nothing, runs the staged binary with the arguments and exit code passed through, and prints the one line on standard error; with an older binary staged it downloads the package's version.
- AC-2 (behavior) removed (2026-11-12T14:36:49.507Z): The older() in npm/bin/wizardingcode-mem.js equals OLDER_JS byte for byte, and the older() block of scripts/install.sh equals the one in scripts/templates/wizardingcode-mem.sh byte for byte.
- AC-1 (behavior) removed (2026-11-12T14:36:49.566Z): Every pair of tests/fixtures/version-order.ts gets the same answer from olderThan (src/util/version.ts), from the generated JavaScript older() and from the shell older(); 0.9.0-rc.9 is older than 0.9.0-rc.10 in all three.
- AC-25 (behavior) removed (2026-11-12T14:38:43.328Z): The plan's decision refuses, each with its sentence: a ref other than refs/heads/main; a malformed tag; a tag that does not exist; a tag whose commit is not on main; a tag whose tree lacks distribute.yml; a plain tag that is not the highest plain tag, and a pre-release tag that is not the highest tag; a release that does not exist; a draft release; a release that lacks an asset (the sentence names it); an environment release that is missing, and one whose rule is not exactly the branch main. It accepts a plain v0.9.1 while a v0.10.0-rc.1 tag exists, and for an accepted tag gives the version and whether it is a pre-release.
- AC-30 (behavior) removed (2026-11-12T14:38:43.439Z): distribute.yml: the only trigger is workflow_dispatch with tag, dry_run and release_hold; top-level permissions is empty; one concurrency group, not cancelled; every job runs on ubuntu-latest; npm, tap and marketplace name the environment release and plan and latest name none; only npm has id-token: write and only latest has packages: write; latest needs plan, npm, tap and marketplace; tap, marketplace and latest are conditioned on a plain release, latest on no hold, and latest's retag step on no dry run.
- AC-34 (behavior) removed (2026-11-12T14:38:43.549Z): The writer to another repository, run against a local bare repository: an unchanged tree makes no commit and reports "already at"; a changed tree makes one commit wizardingcode-mem <version> and pushes it; a push refused as not fast-forward succeeds after one rebase; a dry run leaves the remote as it was; and the git commands and remote URL it builds carry no token, which travels only in the child's environment.
- AC-38 (behavior) removed (2026-11-12T15:02:25.056Z): The writer to another repository, run against a local bare repository: an unchanged tree makes no commit and reports "already at"; a changed tree makes one commit wizardingcode-mem <version> and pushes it; a push refused as not fast-forward succeeds after one rebase; a dry run leaves the remote as it was; the git commands and remote URL it builds carry no token, which travels only in the child's environment; and, given a commit the tag no longer names, it refuses before any write.
- AC-37 (behavior) removed (2026-11-12T15:02:25.113Z): distribute.yml: the only trigger is workflow_dispatch with tag, dry_run and release_hold; top-level permissions is empty; one concurrency group, not cancelled; every job runs on ubuntu-latest; npm, tap and marketplace name the environment release and plan and latest name none; only npm has id-token: write and only latest has packages: write; latest needs plan, npm, tap and marketplace; tap, marketplace and latest are conditioned on a plain release, latest on no hold, and latest's retag step on no dry run; npm's checkout of the release's tree takes its ref from plan's sha output, and no checkout takes inputs.tag.
- AC-36 (behavior) removed (2026-11-12T15:02:25.173Z): The plan's decision refuses, each with its sentence: a ref other than refs/heads/main; a malformed tag; a tag that does not exist; a tag whose commit is not on main; a tag whose tree lacks distribute.yml; a plain tag that is not the highest plain tag, and a pre-release tag that is not the highest tag; a release that does not exist; a draft release; a release that lacks an asset (the sentence names it); an environment release that is missing, and one whose rule is not exactly the branch main. It accepts a plain v0.9.1 while a v0.10.0-rc.1 tag exists, and for an accepted tag gives the version, the tag's commit and whether it is a pre-release.
- AC-35 (behavior) removed (2026-11-12T15:02:25.231Z): summaryLine gives, for each target and outcome of the Design's table, exactly that text; plan writes the three "skipped: pre-release" lines for a pre-release and the "held" line for a hold.
- AC-33 (behavior) removed (2026-11-12T15:02:25.290Z): In distribute.yml and token.yml, no run: script contains ${{; every uses: is pinned to a 40-character commit SHA; every actions/checkout has persist-credentials: false; and secrets.MARKETPLACE_TOKEN appears only in the env: of steps of the jobs tap, marketplace and check.
- AC-32 (observed) removed (2026-11-12T15:02:25.349Z): docs/runbooks/release.md holds the one-time setup in its order (the ruleset checked, the environment's rule before the secret, the token with its date noted, the two trusted publishers), the first release's order (the refused automatic run, the dry run, the real dispatch), what a run shows, the repeat, the repair of a release that lacks an asset, the way back (install --force; a bad release is fixed by a higher version; do not re-run a run whose write was reverted by hand), the release of a hold, that a third dispatch replaces a pending one, and that a scheduled workflow may be disabled after 60 days without activity; docs/runbooks/team-server.md says latest moves last and may be held; ADR 0029 records the decisions, the limits and that a staged file answering a very high version is replaced only by --force; CLAUDE.md names the two workflows and the scripts.
- AC-31 (behavior) removed (2026-11-12T15:02:25.407Z): token.yml runs on a weekly schedule and on dispatch; its check job names the environment release, runs token.ts with --fail-under 30, and runs only when the door job, which names no environment, says the environment is ready.
- AC-29 (behavior) removed (2026-11-12T15:02:25.468Z): release.yml: docker's tags carry no latest; publish checks out with fetch-depth: 0; a job distribute needs publish, has actions: write and runs gh workflow run distribute.yml --ref main with the tag.
- AC-28 (behavior) removed (2026-11-12T15:02:25.526Z): The token decision maps no token, 401, 403 and 404 each to its failure sentence, 200 with fewer than 30 days left to a warning (a failure with --fail-under 30), and 200 with no expiry header to an "expiry unknown" warning and a pass.
- AC-27 (behavior) removed (2026-11-12T15:02:25.584Z): The npm decision exits 1 for a package whose version differs from the tag's; reads a non-empty npm view answer as published, an empty answer or E404 as not published and any other failure as an error; builds npm publish --access public --ignore-scripts, with --tag next for a pre-release and without it for a plain release, and with --dry-run on a dry run; and adds the trusted-publisher sentence to an authentication failure.
- AC-26 (behavior) removed (2026-11-12T15:02:25.643Z): The hold decision is "held" when the tag's lowest accepted contract is above the previous plain release's CONTRACT; "not held" when it is not, when there is no previous plain release and when the file is missing at it; "held", naming the read that failed, when the constants cannot be read at the tag and when the file is present but unreadable at the previous plain release; and "not held", marked as released by hand, when it would be held and release_hold is true. The parser's reading of the real src/team/contract.ts equals the CONTRACT and ACCEPTED_CONTRACTS the file exports.
- AC-24 (behavior) removed (2026-11-12T15:02:25.702Z): The marketplace edit changes, in each manifest's text, only the wizardingcode-mem entry's version and ref values, leaves every other byte equal, leaves an entry at a higher version alone and reports it, and fails for an entry whose ref is not a version tag or that is missing.
- AC-23 (behavior) removed (2026-11-12T15:02:25.762Z): The formula rendered from the template with a version and a checksums.txt holds that version in every URL and each of the four checksums under its platform's block, and no mark; a checksums.txt lacking one of the four names fails, naming it.
- AC-22 (behavior) removed (2026-11-12T15:02:25.822Z): scripts/install.sh --download-only with a newer binary staged leaves it in place and says so; --download-only --force replaces it.
- AC-21 (behavior) removed (2026-11-12T15:02:25.882Z): wizardingcode-mem install with two agents found and a newer binary staged prints the "newer … is already in" line once, and both agents' hooks point at the staged path; with --force the staged binary is the running one and the line is absent.
- AC-20 (behavior) removed (2026-11-12T15:02:25.941Z): stageBinary keeps a staged binary of a higher version and returns it as kept; it replaces a staged binary of an equal or lower version, one that exits non-zero on --version, one whose --version output is not a version, and, with force, one of a higher version.
- AC-19 (behavior) removed (2026-11-12T15:02:26.001Z): The npm shim, with a newer binary staged, downloads nothing, runs the staged binary with the arguments and exit code passed through, and prints the one line on standard error; with an older binary staged it downloads the package's version.
- AC-18 (behavior) removed (2026-11-12T15:02:26.062Z): The older() in npm/bin/wizardingcode-mem.js equals OLDER_JS byte for byte, and the older() block of scripts/install.sh equals the one in scripts/templates/wizardingcode-mem.sh byte for byte.
- AC-17 (behavior) removed (2026-11-12T15:02:26.121Z): Every pair of tests/fixtures/version-order.ts gets the same answer from olderThan (src/util/version.ts), from the generated JavaScript older() and from the shell older(); 0.9.0-rc.9 is older than 0.9.0-rc.10 in all three.
- AC-56 (observed) removed (2026-11-12T15:48:33.667Z): docs/runbooks/release.md holds the one-time setup in its order (the ruleset on main checked, the ruleset on v* tags, the environment's rule before the secret and any secret found there removed, the token with its date noted and the push check, the two trusted publishers), the first release's order (the refused automatic run, the dry run, the real dispatch), what a run shows, the repeat, the repair of a release that lacks an asset, the way back (install --force; a bad release is fixed by a higher version; do not re-run a run whose write was reverted by hand), the release of a hold, and the limits (a third dispatch replaces a pending one; the dist-tag next; shims already published; the release's assets are not tied to the judged commit, with making releases immutable where the repository's plan offers it); docs/runbooks/team-server.md says latest moves last and may be held, citing the release runbook; ADR 0029 records the decisions and the limits, including that a staged file answering a very high version is replaced only by --force; CLAUDE.md names the two workflows and the scripts.
- AC-55 (behavior) removed (2026-11-12T15:48:33.718Z): summaryLine gives, for each target and outcome of the summary table, exactly that text; plan writes the three "skipped: pre-release" lines for a pre-release and the "held" line for a hold.
- AC-54 (behavior) removed (2026-11-12T15:48:33.769Z): The writer to another repository, run against a local bare repository: an unchanged tree makes no commit and reports "already at"; a changed tree makes one commit wizardingcode-mem <version> and pushes it; a push refused as not fast-forward succeeds after one rebase; a dry run leaves the remote as it was; the git commands and remote URL it builds carry no token, which travels only in the child's environment; and, given a commit the tag no longer names, it refuses before any write, for a lightweight and for an annotated tag.
- AC-53 (behavior) removed (2026-11-12T15:48:33.820Z): In distribute.yml, no run: script contains ${{; every uses: is pinned to a 40-character commit SHA; every actions/checkout has persist-credentials: false; and secrets.MARKETPLACE_TOKEN appears exactly four times, each in the env: of a step of the jobs tap and marketplace.
- AC-52 (behavior) removed (2026-11-12T15:48:33.874Z): distribute.yml: the only trigger is workflow_dispatch with tag, dry_run and release_hold; top-level permissions is empty; one concurrency group, not cancelled; every job runs on ubuntu-latest with timeout-minutes: 15; npm, tap and marketplace name the environment release and plan and latest name none; only npm has id-token: write and only latest has packages: write; latest needs plan, npm, tap and marketplace; tap, marketplace and latest are conditioned on a plain release, latest on no hold, and latest's retag step on no dry run; npm's checkout of the release's tree takes its ref from plan's sha output, and no checkout takes inputs.tag.
- AC-51 (behavior) removed (2026-11-12T15:48:33.927Z): release.yml: docker's tags carry no latest; publish checks out with fetch-depth: 0; a job distribute needs publish, has actions: write, runs gh workflow run distribute.yml --ref main with the tag, and its run: holds no ${{.
- AC-50 (behavior) removed (2026-11-12T15:48:33.980Z): The token decision maps no token, 401, 403, 404 and a 200 without the push permission each to its failure sentence, 200 with fewer than 30 days left to a warning, and 200 with no expiry header to an "expiry unknown" warning and a pass.
- AC-49 (behavior) removed (2026-11-12T15:48:34.036Z): The npm decision exits 1 for a package whose version differs from the tag's; reads a non-empty npm view answer as published, an empty answer or E404 as not published and any other failure as an error; builds npm publish --access public --ignore-scripts, with --tag next for a pre-release and without it for a plain release, and with --dry-run on a dry run; reads a publish refused because the version exists as already published; and adds the trusted-publisher sentence to an authentication failure.
- AC-48 (behavior) removed (2026-11-12T15:48:34.088Z): The hold decision is "held" when the tag's lowest accepted contract is above the previous plain release's CONTRACT; "not held" when it is not, when there is no previous plain release and when the file is missing at it; "held", naming the read that failed, when the constants cannot be read at the tag and when the file is present but unreadable at the previous plain release; and "not held", marked as released by hand, when it would be held and release_hold is true. The parser's reading of the real src/team/contract.ts equals the CONTRACT and ACCEPTED_CONTRACTS the file exports.
- AC-47 (behavior) removed (2026-11-12T15:48:34.140Z): The plan's decision refuses, each with its sentence: a ref other than refs/heads/main; a malformed tag; a tag that does not exist; a tag whose commit is not on main; a tag whose tree lacks distribute.yml; a plain tag that is not the highest plain tag, and a pre-release tag that is not the highest tag; a release that does not exist; a draft release; a release that lacks an asset (the sentence names it); an environment release that is missing, and one whose rule is not exactly the branch main. It accepts a plain v0.9.1 while a v0.10.0-rc.1 tag exists, and for an accepted tag gives the version, the tag's commit and whether it is a pre-release. The tag list it is given holds only tags merged into main that are version tags: a v99.0.0 on a branch commit and a vnext tag change no decision.
- AC-46 (behavior) removed (2026-11-12T15:48:34.191Z): The marketplace edit changes, in each manifest's text, only the wizardingcode-mem entry's version and ref values and leaves every other byte equal; when either manifest's entry is at a higher version it writes neither and reports it; it fails for an entry whose ref is not a version tag or that is missing.
- AC-45 (behavior) removed (2026-11-12T15:48:34.243Z): The formula rendered from the template with a version and a checksums.txt holds that version in every URL and each of the four checksums under its platform's block, and no mark; a checksums.txt lacking one of the four names fails, naming it.
- AC-44 (behavior) removed (2026-11-12T15:48:34.295Z): scripts/install.sh --download-only with a newer binary staged leaves it in place and says so; --download-only --force replaces it; a staged file that answers something other than a version is replaced.
- AC-43 (behavior) removed (2026-11-12T15:48:34.347Z): wizardingcode-mem install with two agents found and a newer binary staged prints the "newer … is already in" line once, and both agents' hooks point at the staged path; with --force the staged binary is the running one and the line is absent.
- AC-42 (behavior) removed (2026-11-12T15:48:34.398Z): stageBinary keeps a staged binary of a higher version and returns it as kept; it replaces a staged binary of an equal or lower version, one that cannot be run, one that exits non-zero on --version, one whose --version output is not a version, and, with force, one of a higher version.
- AC-41 (behavior) removed (2026-11-12T15:48:34.448Z): The npm shim, with a newer binary staged, downloads nothing, runs the staged binary with the arguments and exit code passed through, and prints the one line on standard error; with an older binary staged it downloads the package's version.
- AC-40 (behavior) removed (2026-11-12T15:48:34.498Z): The older() in npm/bin/wizardingcode-mem.js equals OLDER_JS byte for byte, and the older() block of scripts/install.sh equals the one in scripts/templates/wizardingcode-mem.sh byte for byte.
- AC-39 (behavior) removed (2026-11-12T15:48:34.550Z): Every pair of tests/fixtures/version-order.ts gets the same answer from olderThan (src/util/version.ts), from the generated JavaScript older() and from the shell older(); 0.9.0-rc.9 is older than 0.9.0-rc.10, and a have that is not a version is older, in all three.

## Waits

- for the roles (2026-11-12T16:12:21.341Z), not proven: judgement gate code-quality not run
- for the roles (2026-11-12T16:13:40.260Z), not proven: judgement gate code-quality not run
- for the roles (2026-11-12T16:14:05.229Z), not proven: judgement gate code-quality not run
- for the roles (2026-11-12T16:14:29.224Z), not proven: judgement gate code-quality not run
- for the roles (2026-11-12T16:15:03.382Z), not proven: judgement gate code-quality not run
- for the roles (2026-11-12T16:22:34.674Z), not proven: judgement gate code-quality not run on the current code
- for the roles (2026-11-12T16:24:02.419Z), not proven: judgement gate code-quality not run on the current code
- for the roles (2026-11-12T16:24:29.464Z), not proven: judgement gate code-quality not run on the current code
- for the roles (2026-11-12T16:25:16.839Z), not proven: judgement gate code-quality not run on the current code
- for the roles (2026-11-12T16:33:28.249Z), not proven: judgement gate code-quality not run on the current code
- for the roles (2026-11-12T16:34:57.617Z), not proven: judgement gate code-quality not run on the current code
- for the roles (2026-11-12T16:35:23.342Z), not proven: judgement gate code-quality not run on the current code
- for the roles (2026-11-12T16:36:01.282Z), not proven: judgement gate code-quality not run on the current code
- for the roles (2026-11-12T16:36:30.544Z), not proven: judgement gate code-quality not run on the current code
- for the roles (2026-11-12T16:46:43.071Z), not proven: judgement gate code-quality not run on the current code
- for the roles (2026-11-12T16:48:14.547Z), not proven: judgement gate code-quality not run on the current code
- for the roles (2026-11-12T16:48:38.241Z), not proven: judgement gate code-quality not run on the current code
- for the roles (2026-11-12T16:50:30.076Z), not proven: judgement gate code-quality not run on the current code

## Objections

- O-1 (advisory, raised by gap-round) open: Whether a fine-grained token returns the header github-authentication-token-expiration is not settled by GitHub's documentation (a 2021 changelog only); without it the weekly check says 'expiry unknown' and passes, so the announcement D-9 wants may never fire. The runbook must tell the author to note the expiry date at creation.
- O-2 (advisory, raised by gap-round) open: The documentation does not say whether a job naming an environment from a branch its rule excludes fails or is skipped; the design must not depend on which (plan refuses a ref other than main first).

Fingerprint: sha256:86f7ad96ab943b005d1fbf41ae3c5c4f5d454b65f5a89668cb620155cd5cd3cb
