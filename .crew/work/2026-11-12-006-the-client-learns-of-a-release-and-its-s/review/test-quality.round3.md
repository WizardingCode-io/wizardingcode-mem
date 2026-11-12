

## Clarifications
- # test-quality findings for 2026-11-12-006-the-client-learns-of-a-release-and-its-s
  reviewer: review-test-quality
  read: 12 test files, 12 criteria
  
  ## Findings
  - F-1 · advisory · tests/unit/update-report.test.ts:228 · AC-32: the test "its owner runs the staged file" passes the folder owner's uid, but when the suite runs as root (Linux /tmp, a container) that uid is 0, so `mayRunStaged` refuses and the test fails. It is skipped only on Windows, while `tests/e2e/update-reconcile.test.ts:61` also skips as root. Separately, `me` is taken from the owner of `tmpdir()`, not from the process, which makes the "another user" case read oddly; that case still holds, since `me + 4242` cannot be the folder's owner in a normal run.
  - F-2 · advisory · tests/unit/update-reconcile.test.ts:50 · AC-23 (real path): `decide` is still only given identical strings, and the `realpathSync` step in `gather` is not exercised (round 1's F-2, recorded as deferred).
  - F-3 · advisory · tests/e2e/update-reconcile.test.ts:101 · AC-31 ("no command but `install` stages a binary"): only `status` is shown not to stage (round 1's F-3, deferred).
  - F-4 · advisory · tests/e2e/install-forward.test.ts:1247 · AC-18 ("`install` through the same function"): the test asserts that the guard variable reaches the staged binary, not that `handOver` is the function used (round 1's F-4, deferred).
  - F-5 · advisory · tests/unit/settings.test.ts:1733 · AC-29: the temporary directories are still never removed (round 1's F-5, deferred).
  
  Both of round 2's defects are resolved:
  - **F-1 (staged file never run as root or for another user).** `describe("stagedFacts")` (tests/unit/update-report.test.ts:211) uses a staged script that leaves a trace. Root and another user get `refused: true`, no version and no trace; the owner gets `1.2.3` and a trace. If the guard were forced to allow, the refused cases would fail on both the facts and the trace.
  - **F-2 (a report that cannot be built is said in `status`).** The test "a report that cannot be built is said with its reason, and status goes on" (tests/integration/update-command.test.ts:279) gives `status` a build that throws and asserts the exact line `update: not checked: …` right after the version line. A `status` that swallowed the error would fail it.
  
  ## Outside the change
  none
  
  ## Not answerable
  - Mutation (Q7) · no mutation report was named for this item.
