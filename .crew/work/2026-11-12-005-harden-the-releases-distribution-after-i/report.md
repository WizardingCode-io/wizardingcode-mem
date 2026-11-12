# Report: Harden the release's distribution after its first review (follow-up of 2026-11-1

- Work: `2026-11-12-005-harden-the-releases-distribution-after-i`
- Type: feature. Kind: feature (from work_type feature). Route: full (risk areas: infra)
- CTO plan: none
- Packs: none
- Checklists: auth (1 file)
- Verdict: **Proven**

## Spec review

- done: round 1 clean.

The file: `spec-review/consolidated.md`.

## Knowledge

- K-383 · validated-solution · "Homebrew formula: 0.8.0 with the release's checksums. packaging/homebrew/wizardi" · alone · stack node, word release · likely 0.83
- K-390 · validated-solution · "The release publishes everywhere by itself, and <data dir>/bin has one owner tha" · alone · stack node, word release, word 2026 · unverified 0.75
- K-363 · validated-solution · "Team server: wizardingcode-mem serve, one Docker image with SQLite and the repos" · alone · stack node, word release, word first · unverified 0.27
- K-335 · validated-solution · "Knowledge store: entries as Markdown with frontmatter (kind knowledge, strategy," · alone · stack node, word first, word follow · unlikely 0.15
- K-381 · validated-solution · "Share a project without a git remote. Today a project can be set above Nothing o" · alone · stack node, word 2026 · unverified 0.22
- K-376 · validated-solution · "Homebrew formula: 0.7.0 with the release's checksums. packaging/homebrew/wizardi" · alone · stack node, word release · unverified 0.74
- K-375 · validated-solution · "Release 0.7.0: version 0.7.0 in package.json and in every file that carries the " · alone · stack node, word release · unverified 0.49
- K-372 · validated-solution · "Part 7 of the knowledge and team journey, the runbook: docs/runbooks/team-server" · alone · stack node, word first · unverified 0.31
- K-371 · validated-solution · "Part 6 of the knowledge and team journey, the sync client: wizardingcode-mem kee" · alone · stack node, word first · unverified 0.22
- K-346 · validated-solution · "Sharing policy: per project local only, knowledge only, or knowledge and memory;" · alone · stack node, word first · unverified 0.47
- Learned: not yet

## Acceptance criteria

| Id | Kind | Criterion | Test-first |
| :- | :- | :- | :- |
| AC-6 | behavior | The distribute job of release.yml has timeout-minutes: 5. | red then green |
| AC-9 | behavior | commitAndPush, given a token, replaces the encoded credential with *** in every text git answers: the sentence of a failed tag read, clone, push, rebase and second push, and the lines of a dry run. A text without the value comes back byte for byte, and with no token nothing is replaced. | red then green |
| AC-11 | behavior | The push.ts command asks git for the github.com repositories only: for each target the log of git shows ls-remote --tags of https://github.com/<GITHUB_REPOSITORY>.git and clone --quiet of the github.com repository of the target, and the path given in PUSH_REMOTE or PUSH_ORIGIN nowhere, on and off a runner. | red then green |
| AC-12 | behavior | editTap and editMarketplace are exported, and commitAndPush with them writes the formula and both manifests to a local repository; a second run for the tap answers already-at with no second commit, and a manifest at a higher version is left alone. | red then green |
| AC-17 | preserve | On a stub git the push.ts command keeps its wiring: --target tap ends with exit 0, empty standard error and the summary tap: written, 9.9.9; --target marketplace runs the marketplace edit and writes marketplace: written, 9.9.9; a moved tag ends with exit 1 and the summary tap: failed: v9.9.9 no longer names the commit that was judged. | passing before and after (3 → 3 pass) |
| AC-19 | behavior | The push.ts command, given a token, lets the encoded credential into none of its output: when git fails quoting the header, standard output, standard error and the summary file carry *** in its place and the summary says tap: failed; on a dry run whose git output quotes the header, the printed lines carry *** and the summary says tap: would write 9.9.9 (dry run). | red then green |
| AC-20 | behavior | The release runbook says what to do when the dispatch job is cut: one paragraph under Repeating a target names the minutes release.yml sets, cites gh run list --workflow distribute.yml, and says what a second run for the same tag does at each target (already published, already at, latest moved again) and the exception after a write was reverted by hand. | red then green; the red recorded 2 times (the latest decides) |
| AC-21 | behavior | In docs/real-use/findings.md the rows of 2026-11-12 that this item answers cite item 2026-11-12-005, say what was done (the redaction; PUSH_REMOTE and PUSH_ORIGIN removed; timeout-minutes) and no longer have the status deferred; the file names what stays open: the reading of a staged binary version moved to the client update item, GIT_CONFIG_GLOBAL not isolated for the git of the token, no time limit on the git calls of push.ts, MARKETPLACE_TOKEN inherited by the calls without the header. | red then green; the red recorded 2 times (the latest decides) |
| AC-22 | behavior | ADR 0029 and the Releasing line of CLAUDE.md say that push.ts redacts the encoded credential by exact match from every text git answers, and that the push.ts command takes no destination from its environment; the ADR also says the runner masks the base64 of a secret itself and why no ::add-mask:: line is printed. | red then green; the red recorded 2 times (the latest decides) |

## Gates

| Gate | Target | Status | Command | Duration | Log |
| :- | :- | :- | :- | -: | :- |
| secrets | . | pass | `built-in secret scan` | 30 ms |  |
| prose | . | pass | `built-in prose scan` | 32 ms |  |
| build | . | pass | `bun run build` | 2673 ms | logs/build-_-1794505453192.txt |
| test | . | pass | `bun run test` | 208657 ms | logs/test-_-1794505455891.txt |
| lint | . | pass: 1 untouched file with problems, none of the item's | `bun run lint` | 95 ms | logs/lint-_-1794505664548.txt |
| typecheck | . | pass | `bun run typecheck` | 358 ms | logs/typecheck-_-1794505664643.txt |

## Judgement gates

| Gate | Verdict | Reviewer | Findings | Tokens |
| :- | :- | :- | -: | -: |
| code-quality | proven | review-code-quality | 4 | 78894 |
| test-quality | proven | review-test-quality | 2 | 75131 |
| security | proven | review-security | 4 | 76560 |
| risk | proven | review-risk | 3 | 85774 |
| architecture | proven | review-architecture | 0 | 80779 |
| infra | proven | review-infra | 4 | 74259 |

- code-quality: tests/unit/release-docs.test.ts:10 Upheld as advisory. `parseYaml` is copied word for word from tests/unit/deploy-files.test.ts:10. Duplicated test boilerplate falls under question 2, which the rubric treats as advisory. (advisory)
- code-quality: tests/integration/release-push.test.ts:397 Upheld as advisory. The fake checksums file (REQUIRED_ASSETS without checksums.txt, mapped to repeat(64) digests) is also built by the new `checksums()` helper in tests/integration/release-commands.test.ts. This is test fixture logic written twice (question 2). (advisory)
- code-quality: tests/integration/release-commands.test.ts:381 Upheld as advisory. `gitStub`'s option `quote?: "clone"` can take only one value, so it is a boolean written as a literal type. Its name also does not say that it makes the clone fail (questions 3 and 5). Naming in a test helper does not make the code wrong. (advisory)
- code-quality: docs/real-use/findings.md:56 Upheld as advisory. The rewritten security row drops the old row's claim that Actions masks the raw secret only, and does not say that this claim was corrected (question 11). The row is closed, and ADR 0029 now gives the source (ValueEncoders.cs), so the record is not left wrong. (advisory, outside the change)
- test-quality: tests/unit/release-docs.test.ts:166 Upheld as advisory. AC-22's ADR test checks only for the bare token "`::add-mask::`". It does not check that the ADR says the runner masks a secret's base64 itself, or why no such line is printed. The test still fails when the change is reverted, so this is partial coverage under question 1, not a missing test. (advisory)
- test-quality: tests/unit/release-docs.test.ts:145 Upheld as advisory. The findings-row test checks "`PUSH_REMOTE`" and "`timeout-minutes`" but not "`PUSH_ORIGIN`". It checks the open time-limit item only by the loose phrase "time limit". This is partial coverage under question 1. The test fails on revert. (advisory)
- security: scripts/release/push.ts:39 Upheld as advisory. `redact` covers only the base64 header form, not the raw MARKETPLACE_TOKEN. No path in the diff prints the raw token: git is never handed it, and the runner masks it as a registered secret. ADR 0029 states the exact-match limit, so this is hardening only. (advisory)
- security: scripts/release/push.ts:117 Lowered to advisory as debt outside the change. `gitEnv(token, process.env)` passes the inherited environment to the token's git calls, and only the inherited GIT_CONFIG_KEY_n is overwritten. A home .gitconfig, GIT_CONFIG_GLOBAL or system configuration can still steer that git. The diff does not add this, and docs/real-use/findings.md records it as deferred. (advisory)
- security: scripts/release/push.ts:101 Lowered to advisory as debt outside the change. The git calls that carry no header still inherit MARKETPLACE_TOKEN. This is recorded as deferred in docs/real-use/findings.md. (advisory)
- security: .github/workflows/distribute.yml:140 Lowered to advisory as debt outside the change. The file is not in the diff. The git calls of push.ts have no time limit of their own beyond the job's. This is recorded as deferred. (advisory, outside the change)
- risk: docs/runbooks/release.md:64 Upheld as advisory. The cut-job paragraph rests on two values nobody has measured: that the dispatch finishes within 5 minutes, and that a late-accepted run appears within a minute. The harm is bounded, because a second run writes nothing the first already wrote. A cut is visible as a red release.yml. spec.md states the rollback as a revert on main. No rollback or dependency is missing from the spec or plan, so there is no defect. (advisory, outside the change)
- risk: .github/workflows/distribute.yml:128 Lowered to advisory as debt outside the change. The file is not in the diff. The headerless git calls inherit MARKETPLACE_TOKEN and the global and system git configuration, and they have no time limit of their own. The item records all three as deferred in docs/real-use/findings.md, and the diff does not widen them. (advisory, outside the change)
- risk: docs/real-use/findings.md:73 Dropped as a finding and noted as advisory. Line 73 is not a line of the diff (the hunk ends at line 60), and the note states a known unknown that the item itself records as deferred: whether the runner masks a secret's base64 in the step summary. It names no rubric failure in the change. (advisory, outside the change)
- infra: .github/workflows/release.yml:156 Upheld as advisory. Nobody has measured whether `timeout-minutes: 5` on the dispatch-only job is enough, so a slow API day may show a false red. The rollback is stated, and the runbook gives the recovery steps (docs/runbooks/release.md, the new paragraph). This is the reviewer's own advisory under Q4. (advisory)
- infra: scripts/release/push.ts:91 Upheld as advisory. `redact` matches only the exact base64 of the credential, not the raw token. git is never handed the raw value, and ADR 0029 states the limit (Q2). This is the same point as security F-1. (advisory)
- infra: .github/workflows/release.yml:1 Lowered to advisory as debt outside the change. release.yml still references its actions by moving tag, and its checkouts keep credentials under a workflow-level contents: write. The diff does not touch these lines, and docs/real-use/findings.md already records them as deferred. (advisory)
- infra: scripts/release/push.ts:117 Lowered to advisory as debt outside the change. The calls without the header inherit MARKETPLACE_TOKEN, the token's git is not isolated from global and system configuration, and the git calls have no time limit of their own. The item names all three as deferred. (advisory)

## Verifications

| What | Ref | Answer | Confidence | Model | At |
| :- | :- | :- | -: | :- | :- |
| knowledge | K-390 | yes 0.75 | - | jev-1.14.0 | 2026-11-12T17:10:23.721Z |
| knowledge | K-363 | no 0.73 | - | jev-1.14.0 | 2026-11-12T17:10:23.721Z |
| knowledge | K-335 | no 0.85 | - | jev-1.14.0 | 2026-11-12T17:10:23.721Z |
| knowledge | K-383 | yes 0.83 | - | jev-1.14.0 | 2026-11-12T17:10:23.721Z |
| knowledge | K-381 | no 0.78 | - | jev-1.14.0 | 2026-11-12T17:10:23.721Z |
| knowledge | K-376 | yes 0.74 | - | jev-1.14.0 | 2026-11-12T17:10:23.721Z |
| knowledge | K-375 | no 0.51 | - | jev-1.14.0 | 2026-11-12T17:10:23.721Z |
| knowledge | K-372 | no 0.69 | - | jev-1.14.0 | 2026-11-12T17:10:23.721Z |
| knowledge | K-371 | no 0.78 | - | jev-1.14.0 | 2026-11-12T17:10:23.721Z |
| knowledge | K-346 | no 0.53 | - | jev-1.14.0 | 2026-11-12T17:10:23.721Z |
| validator | complete-gap-round v1 | no 0.64 | 0.36 | jev-1.14.0 | 2026-11-12T17:26:39.024Z |
| validator | complete-gap-round v2 | yes 0.58 | 0.58 | jev-1.14.0 | 2026-11-12T17:26:39.025Z |

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

- Rounds: judgement 1 of 2, validation 4 of 2
- Runtimes: claude (context at start: enforced; the status line per prompt: enforced; the denial of engine files: enforced; the denial of forbidden commands: enforced; the hold at Stop: enforced; the roles' answers filed: enforced; the roles read-only: enforced)

## Validations

| What | By | Verdict | Returns | Round | File |
| :- | :- | :- | -: | -: | :- |
| spec | lead-devops | returned | 1 | 1 | conclave/lead-devops.md |
| spec | lead-architects | returned | 2 | 1 | conclave/lead-architects.md |
| spec | lead-security | returned | 2 | 1 | conclave/lead-security.md |
| spec | lead-qa | returned | 4 | 1 | conclave/lead-qa.md |
| spec | lead-security | validated | 0 | 2 | conclave/lead-security-reply.md |
| spec | lead-architects | validated | 0 | 2 | conclave/lead-architects-reply.md |
| spec | lead-devops | validated | 0 | 2 | conclave/lead-devops-reply.md |
| spec | lead-qa | returned | 1 | 2 | conclave/lead-qa-reply.md |
| spec | lead-qa | validated | 0 | 3 | conclave/lead-qa-reply.round2.md |
| spec | lead-security | validated | 0 | 3 | conclave/lead-security-reply.md |
| spec | lead-architects | validated | 0 | 3 | conclave/lead-architects-reply.md |
| spec | lead-devops | validated | 0 | 3 | conclave/lead-devops-reply.md |
| spec | lead-security | validated | 0 | 4 | conclave/lead-security-reply.md |

## Roles

| Role | Model | Personality | At | Tokens | Answer | Filed by |
| :- | :- | :- | :- | -: | :- | :- |
| goldfish-structural | claude-opus-5-5 | - | 2026-11-12T17:12:53.497Z | 43722 | spec-review/brainstorm-goldfish-structural.md | hook |
| goldfish-comprehension | claude-opus-5-5 | - | 2026-11-12T17:12:58.840Z | 39166 | spec-review/brainstorm-goldfish-comprehension.md | hook |
| goldfish-zoom-out | claude-opus-5-5 | - | 2026-11-12T17:13:04.811Z | 62828 | spec-review/brainstorm-goldfish-zoom-out.md | hook |
| goldfish-codebase | claude-opus-5-5 | - | 2026-11-12T17:13:49.447Z | 77144 | spec-review/brainstorm-goldfish-codebase.md | hook |
| goldfish-readiness | claude-opus-5-5 | - | 2026-11-12T17:14:26.760Z | 82453 | spec-review/brainstorm-goldfish-readiness.md | hook |
| goldfish-design | claude-opus-5-5 | - | 2026-11-12T17:14:29.551Z | 71069 | spec-review/brainstorm-goldfish-design.md | hook |
| tech-lead | claude-fable-5-2 | - | 2026-11-12T17:20:59.532Z | 79092 | conclave/lead-devops.md | hook |
| tech-lead | claude-fable-5-2 | - | 2026-11-12T17:21:04.638Z | 85366 | conclave/lead-architects.md | hook |
| tech-lead | claude-fable-5-2 | - | 2026-11-12T17:21:21.976Z | 87448 | conclave/lead-security.md | hook |
| tech-lead | claude-fable-5-2 | - | 2026-11-12T17:21:29.995Z | 87888 | conclave/lead-qa.md | hook |
| tech-lead | claude-fable-5-2 | - | 2026-11-12T17:24:17.082Z | 100240 | conclave/lead-security-reply.round2.md | hook |
| tech-lead | claude-fable-5-2 | - | 2026-11-12T17:24:18.625Z | 98749 | conclave/lead-architects-reply.round2.md | hook |
| tech-lead | claude-fable-5-2 | - | 2026-11-12T17:24:18.811Z | 91981 | conclave/lead-devops-reply.round2.md | hook |
| tech-lead | claude-fable-5-2 | - | 2026-11-12T17:24:48.229Z | 118563 | conclave/lead-qa-reply.round2.md | hook |
| tech-lead | claude-fable-5-2 | - | 2026-11-12T17:26:23.580Z | 130702 | conclave/lead-qa-reply.md | hook |
| tech-lead | claude-fable-5-2 | - | 2026-11-12T17:27:03.493Z | 106414 | conclave/lead-security-reply.round3.md | hook |
| tech-lead | claude-fable-5-2 | - | 2026-11-12T17:27:05.534Z | 104902 | conclave/lead-architects-reply.md | hook |
| tech-lead | claude-fable-5-2 | - | 2026-11-12T17:27:06.536Z | 100215 | conclave/lead-devops-reply.md | hook |
| goldfish-zoom-out | claude-opus-5-5 | - | 2026-11-12T17:28:31.928Z | 48505 | spec-review/goldfish-zoom-out.md | hook |
| goldfish-structural | claude-opus-5-5 | - | 2026-11-12T17:29:26.924Z | 29701 | spec-review/goldfish-structural.md | hook |
| goldfish-style | claude-opus-5-5 | - | 2026-11-12T17:29:31.401Z | 31979 | spec-review/goldfish-style.md | hook |
| goldfish-design | claude-opus-5-5 | - | 2026-11-12T17:30:54.253Z | 60797 | spec-review/goldfish-design.md | hook |
| goldfish-codebase | claude-opus-5-5 | - | 2026-11-12T17:33:28.382Z | 108033 | spec-review/goldfish-codebase.md | hook |
| goldfish-readiness | claude-opus-5-5 | - | 2026-11-12T17:33:35.626Z | 91414 | spec-review/goldfish-readiness.md | hook |
| tech-lead | claude-fable-5-2 | - | 2026-11-12T17:37:16.508Z | 212493 | conclave/lead-security-reply.md | hook |
| review-architecture | claude-opus-5-5 | - | 2026-11-12T17:49:22.781Z | 70355 | review/architecture.findings.md | hook |
| review-infra | claude-opus-5-5 | - | 2026-11-12T17:49:30.578Z | 63835 | review/infra.findings.md | hook |
| review-code-quality | claude-opus-5-5 | - | 2026-11-12T17:49:30.637Z | 68470 | review/code-quality.findings.md | hook |
| review-security | claude-opus-5-5 | - | 2026-11-12T17:49:30.671Z | 66136 | review/security.findings.md | hook |
| review-risk | claude-opus-5-5 | - | 2026-11-12T17:49:32.506Z | 75350 | review/risk.findings.md | hook |
| review-test-quality | claude-opus-5-5 | - | 2026-11-12T17:49:42.946Z | 64707 | review/test-quality.findings.md | hook |
| judge | claude-opus-5-5 | - | 2026-11-12T17:50:26.581Z | 62543 | review/ruling.json | hook |

## Decisions

- spec approved by the validator (rule: complete-gap-round) (2026-11-12T17:26:39.027Z): counted, a person was present
- AC-3 (behavior) removed (2026-11-12T17:18:30.516Z): Off a runner, or with no token, the push.ts command prints no ::add-mask:: line.
- AC-1 (behavior) removed (2026-11-12T17:22:38.158Z): commitAndPush, given a token, replaces the encoded credential with *** in every text git answers: a failure sentence and the lines of a dry run carry no encoded value.
- AC-2 (behavior) removed (2026-11-12T17:22:38.215Z): On a runner with a token, the first line of standard output of the push.ts command is ::add-mask:: followed by the encoded credential, on a dry run too; when git fails quoting the header, neither standard error nor the summary file carries the encoded value.
- AC-4 (behavior) removed (2026-11-12T17:22:38.272Z): The push.ts command asks git for the github.com repositories only, with PUSH_REMOTE and PUSH_ORIGIN set in its environment, on and off a runner.
- AC-5 (behavior) removed (2026-11-12T17:22:38.327Z): editTap and editMarketplace are exported, and commitAndPush with them writes the formula and the two manifests to a local repository; a manifest at a higher version is left alone.
- AC-7 (behavior) removed (2026-11-12T17:22:38.383Z): The release runbook says what to do when the dispatch job is cut: it names the five minutes, cites gh run list --workflow distribute.yml, and says a second run for the same tag changes nothing.
- AC-8 (preserve) removed (2026-11-12T17:22:38.438Z): Off a runner, or with no token, the push.ts command prints no ::add-mask:: line and the encoded credential is in none of its output.
- AC-14 (behavior) removed (2026-11-12T17:25:49.771Z): docs/real-use/findings.md says what this item did (the mask and the redaction, PUSH_REMOTE and PUSH_ORIGIN removed, timeout-minutes), points the version rule of a staged binary to the next item, and has an open row naming the git of the token not isolated from global and system configuration and no time limit on the git calls of push.ts.
- AC-10 (behavior) removed (2026-11-12T17:34:16.309Z): On a runner with a token, the first line of standard output of the push.ts command is ::add-mask:: followed by the encoded credential: on a dry run too, and when VERSION is not set. When git fails quoting the header, the encoded value is in standard output once (that line), and in neither standard error nor the summary file; the summary file never carries the ::add-mask:: line.
- AC-16 (preserve) removed (2026-11-12T17:34:16.357Z): With no header quoted by git, the push.ts command prints no line starting ::add-mask:: in three cases: off a runner with a token, on a runner with no token, and neither.
- AC-18 (behavior) removed (2026-11-12T17:34:16.407Z): In docs/real-use/findings.md the rows of 2026-11-12 that this item answers no longer have the status deferred: each cites item 2026-11-12-005 and says what was done (the redaction and the mask; PUSH_REMOTE and PUSH_ORIGIN removed; timeout-minutes). The version rule of a staged binary is a row that names piece 2. A row with the status deferred names GIT_CONFIG_GLOBAL, the missing time limit on the git calls of push.ts and MARKETPLACE_TOKEN inherited by the calls without the header. The two advisories of the old row this item does not touch stay deferred.
- AC-15 (behavior) removed (2026-11-12T17:34:16.456Z): ADR 0029 and the Releasing line of CLAUDE.md say that the encoded credential is redacted and masked by exact match, so another form of the credential needs its own, and that the push.ts command takes no destination from its environment.
- AC-13 (behavior) removed (2026-11-12T17:34:16.505Z): The release runbook says what to do when the dispatch job is cut: it names the minutes release.yml sets, cites gh run list --workflow distribute.yml, and says what a second run for the same tag does at each target (already published, already at, latest moved again) and the exception after a write was reverted by hand.

## Waits

- for the roles (2026-11-12T17:48:59.851Z), not proven: judgement gate code-quality not run
- for the roles (2026-11-12T17:49:37.566Z), not proven: judgement gate code-quality not run
- for the roles (2026-11-12T17:50:01.003Z), not proven: judgement gate code-quality not run

Fingerprint: sha256:e30bab5b9627aa38319283314d767f6cd89b1631fc2d10af4d6213218c25d195
