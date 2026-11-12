# test-quality findings for 2026-11-12-004-the-release-publishes-everywhere-by-itse
reviewer: review-test-quality
read: 10 test files, 20 criteria

## Findings
- F-1 · advisory · tests/unit/release-lib.test.ts:486 · AC-66 ("not held when there is no previous plain release"): the one case with `previous: null` also passes `atPrevious: "missing"`. The `"missing"` branch already returns not held, so deleting `input.previous === null ||` from `decideHold` (scripts/release/lib.ts:528) leaves the test green. `plan.ts:127` always pairs the two today, so what a caller sees still holds. A case with `previous: null` and a readable contract source as `atPrevious` would make this branch the one under test.
- F-2 · advisory · tests/unit/deploy-files.test.ts:281 · AC-70 (latest's first step fails when a needed job did not succeed): the `step()` helper creates a fresh `mkdtempSync` folder on each of its three calls and never removes it. The assertions are sound; the test just leaves temporary folders behind on every run.

## Outside the change
none

## Not answerable
none

Notes for the judge (no further findings):
- For each behavior criterion, a test fails if the behaviour is reverted:
  - AC-57: tests/unit/version-order.test.ts:12-40 checks the whole fixture against all three implementations, including null, "garbage" and rc.9 vs rc.10.
  - AC-58: tests/unit/version-order.test.ts:54-66.
  - AC-59: tests/integration/npm-shim.test.ts:110-133, which pins the exact stderr line and checks that nothing is downloaded.
  - AC-60: tests/integration/install.test.ts:416-447, which covers every replace case plus kept/force.
  - AC-61: tests/e2e/install-forward.test.ts:66-87, which checks the single handover call by its arguments and exit code 7.
  - AC-62: tests/integration/install-script.test.ts:125-163, with `--force` both before and after `--download-only`.
  - AC-63 to AC-68 and AC-73: tests/unit/release-lib.test.ts, with the commands in tests/integration/release-commands.test.ts.
  - AC-69 to AC-71: tests/unit/deploy-files.test.ts:166-370. The latest step's shell is actually run.
  - AC-72: tests/integration/release-push.test.ts, against real bare repositories, both tag kinds.
  - AC-78: tests/unit/release-docs.test.ts, which checks both directions between the runbook and `summaryLine`.
- No test passes by construction:
  - The stubbed git, gh and npm programs only supply inputs. The assertions are on the scripts' own output, summary and exit code.
  - The marketplace fixtures are inputs whose bytes are compared after an edit and its reversal.
  - Fixture names are neutral, with one exception: the token's `holders` list (deploy-files.test.ts:364-369) names the project's own repositories. That is the workflow's real target, not a client.
- The observed reason for AC-74 and AC-76 holds for their prose. Each part of those documents that a test can check is either held by AC-78 or already deferred in docs/real-use/findings.md:68 (ADR 0029's citations).
- Not repeated here because findings.md:68 already defers them: the hand-typed outcome list in release-docs.test.ts, a flag matched anywhere in a command's module, and the missing outcome test for `v99.0.0` on a branch.

Files: /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/unit/release-lib.test.ts, /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/scripts/release/lib.ts, /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/unit/deploy-files.test.ts
