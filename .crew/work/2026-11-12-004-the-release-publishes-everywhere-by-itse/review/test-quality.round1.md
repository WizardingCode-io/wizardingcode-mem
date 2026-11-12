# test-quality findings for 2026-11-12-004-the-release-publishes-everywhere-by-itse
reviewer: review-test-quality
read: 9 test files, 21 criteria

## Findings
- F-1 · advisory · tests/integration/release-push.test.ts:180 · AC-72 says the writer refuses a commit the tag no longer names "for a lightweight and for an annotated tag", but the only annotated refusal tried uses `v9.9.9`, a tag that does not exist. Peeling is proven by the passing `v1.0.1` case and by `tagNames`. Still, a mutant that skips the comparison when a peeled `^{}` line is present would survive. `commitAndPush(options(change, { tag: "v1.0.1", version: "1.0.1", sha: "0".repeat(40) }))` expected to throw "no longer names" would kill it.
- F-2 · advisory · tests/unit/release-lib.test.ts:263 · AC-64 says "when either manifest's entry is at a higher version it writes neither". Only the agents manifest is made higher in `editManifests`. The current code is symmetric (it collects `higher` from both edits), but a mutant that checks only the agents edit survives. The claude-higher case is unproven here and in release-commands.test.ts:467, where both manifests are higher.
- F-3 · advisory · tests/unit/release-lib.test.ts:255 · AC-64's "fails for an entry whose `ref` is not a version tag" is asserted only for the agents manifest. The claude manifest's `source.ref` check, its `version` field being a non-version, and a missing `ref` (the criterion's "or that is missing" read as ref) have no assertion.
- F-4 · advisory · tests/integration/release-commands.test.ts:97 · AC-65 says "a `v99.0.0` on a branch commit … change[s] no decision". No test has such a tag. The property rests only on the stub answering for the exact argument string `tag --merged origin/main --list v*`. The test fails if plan.ts drops `--merged`, so it still fails on reversion, but it holds the command's spelling, not the outcome.
- F-5 · advisory · tests/unit/deploy-files.test.ts:3862 (diff line; file's `latest` test) · AC-70 asks for `latest`'s first step to "fail when a needed job did not succeed". The test only checks that the `run:` text contains the sentence and `exit 1`. Running that script with `NPM=success TAP=failure MARKETPLACE=success` and a temporary `GITHUB_STEP_SUMMARY`, then asserting exit 1 and the "tap did not succeed" line, would prove the behaviour, not just the spelling.

## Outside the change
none

## Not answerable
- Mutation (question 7) · no mutation report was named for this item; nothing was read.

Notes on the rest (no findings):
- AC-57 / AC-58: `tests/unit/version-order.test.ts` runs every pair through `olderThan`, the generated `plugins/opencode/binary.js` and the shell block. It also compares the shim against `OLDER_JS` and install.sh against the template, byte for byte.
- AC-59 to AC-62 each have a test that fails on reversion: `npm-shim.test.ts:121`, the `stageBinary` block of `install.test.ts`, `tests/e2e/install-forward.test.ts` (the notice is printed once with two agents, and `called.txt` shows one call with the same arguments) and `install-script.test.ts:805-843`.
- AC-63, AC-66 to AC-69, AC-71 and AC-73 have direct assertions on the decisions and the command outputs.
- The fixtures use neutral names (`o/r`, `test@example.invalid`). The marketplace fixtures copy the project's own public manifests, not a client's.
- The observed reason for AC-74 to AC-77 holds. These are prose documents. `tests/unit/team-runbook.test.ts` checks only that the paths the runbook cites exist, so it would not fail if the runbook's citation of the release runbook were missing. A test of a document's sentences would be a snapshot of the text, not proof of what it says.

Files: /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/integration/release-push.test.ts, /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/unit/release-lib.test.ts, /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/integration/release-commands.test.ts, /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/unit/deploy-files.test.ts
