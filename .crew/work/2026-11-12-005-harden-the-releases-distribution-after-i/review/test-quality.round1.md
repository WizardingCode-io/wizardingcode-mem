# test-quality findings for 2026-11-12-005-harden-the-releases-distribution-after-i
reviewer: review-test-quality
read: 4 test files, 9 criteria

## Findings
- F-1 · advisory · tests/unit/release-docs.test.ts:166 · AC-22 also requires the ADR to say that the runner masks a secret's base64 itself, and why no `::add-mask::` line is printed. The test only looks for the bare token "`::add-mask::`", so an ADR that dropped the masking explanation, or even said such a line is printed, would still pass. The test does fail if the whole change is reverted, so this is partial coverage (rubric question 1), not a missing test.
- F-2 · advisory · tests/unit/release-docs.test.ts:145 · AC-21 says the answered rows name both `PUSH_REMOTE` and `PUSH_ORIGIN` as removed. The test checks only "`PUSH_REMOTE`" and "`timeout-minutes`", so a row that left out `PUSH_ORIGIN` would pass. It also checks the open "time limit" item by that loose phrase alone, not tied to the git calls of push.ts (rubric question 1, partial).

## Outside the change
none

## Not answerable
- Mutation (rubric question 7) · the prompt named no mutation report, and the profile has no Stryker or Infection for this stack.

Notes on the criteria with no finding (checked against the code, not repeated as findings):
- **AC-6:** `deploy-files.test.ts` asserts `timeout-minutes` is 5.
- **AC-9:** the `test.each` in `release-push.test.ts` covers the tag read, clone, push, rebase (`pull`) and second push. The scripted runner returns the quoted header as raw text, and each case asserts `***` is there and the encoded value is not, so all five fail if the `exec` wrapper is reverted. The dry-run test has the same property. Byte-for-byte and no-token behaviour are each pinned against real git output and against `QUOTED` coming back unchanged.
- **AC-11:** the four parameterised cases set `PUSH_REMOTE` and `PUSH_ORIGIN` to `elsewhere.git` and assert the log never names it. They fail on revert, off a runner.
- **AC-12:** `editTap` and `editMarketplace` are imported and run against local bare repositories, including the already-at case with one commit and the left-alone case.
- **AC-17:** the stub-git tests check the exit code, empty standard error and the summary text, and that the marketplace edit really ran (through `committed.json`).
- **AC-19:** the stub prints the real `GIT_CONFIG_VALUE_0` that push.ts built. Its red, recorded after the code with the redaction switched off (`probes/lint-by-name.md`), is consistent with the assertions.
- **AC-20:** the test reads the number of minutes from `release.yml` itself and checks each target's answer.

Files reviewed:
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/unit/release-docs.test.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/integration/release-push.test.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/integration/release-commands.test.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/unit/deploy-files.test.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/scripts/release/push.ts
