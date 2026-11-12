# test-quality findings for 2026-11-12-006-the-client-learns-of-a-release-and-its-s
reviewer: review-test-quality
read: 12 test files, 11 criteria

## Findings
- F-1 · defect · tests/integration/update-command.test.ts:86 · AC-13 ("a check that throws does not change its exit code"): the test named for it gives `distill` a `fetch` that throws, but `latestRelease` catches that and turns it into `offline`. The second case, a folder where the state file should be, is caught inside `checkForRelease` and comes back as `result.error`. So no test makes the check throw out of `checkForRelease`, and the `try/catch` around it in `src/cli/commands/distill.ts:30-45` is never run. Remove that guard and every test still passes (Q1). A test whose `now` dependency throws, for example `deps.now = () => { throw … }`, inside that guard while the drain itself succeeds would fail on reversion.
- F-2 · advisory · tests/unit/update-reconcile.test.ts:50 · AC-23 ("whose real path is the staged binary's"): `decide` is only given two identical strings. The `realpathSync` step in `reconcile` (`src/update/reconcile.ts:88-89`), which turns a symlinked staged path into the process's real path, is not exercised by any test, unit or e2e. Pointing the e2e at a symlink to the staged binary would cover it.
- F-3 · advisory · tests/e2e/update-reconcile.test.ts:101 · AC-31 ("no command but `install` stages a binary"): only `status` is run from a newer copy against an older staged file. `doctor`, `update` and `ui` are never shown to leave the staged file unchanged. This holds today because none of them calls `stageBinary`, but nothing pins it.
- F-4 · advisory · tests/e2e/install-forward.test.ts:1247 · AC-18 ("`install` hands over through the same function"): the test checks a side effect (`WIZARDINGCODE_MEM_HANDED=1` reaches the staged binary), not that the call goes through `handOver`. If `install` built its own spawn with `handedEnv`, the test would still pass. That is fine as behaviour, but the test's comment claims more than its assertion proves (Q5/Q6).
- F-5 · advisory · tests/unit/settings.test.ts:1733 · AC-29 (the key): the two new tests create temporary directories with `mkdtempSync` and never remove them. This is debt in fixture hygiene; it does not weaken any assertion.

## Outside the change
none

## Not answerable
- Mutation (Q7) · no mutation report was named for this item.
