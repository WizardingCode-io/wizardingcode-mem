

## Clarifications
- # test-quality findings for 2026-11-12-006-the-client-learns-of-a-release-and-its-s
  reviewer: review-test-quality
  read: 12 test files, 12 criteria
  
  ## Findings
  - F-1 · defect · tests/unit/update-report.test.ts:163 · AC-32 ("`status`, `doctor` and `update` do not run the staged file when the command runs as root or when `<data dir>/bin` belongs to another user"): the new tests check `mayRunStaged`'s table and `agentsLine` given a hand-built `StagedFacts` with `refused: true`. Nothing checks that `stagedFacts` (`src/update/report.ts:55-66`) asks `mayRunStaged` and skips `stagedVersion` when it says no. If `stagedFacts` always ran the staged file and set `refused: false`, every test would still pass (Q1; the `agentsLine` case passes because of its own fixture, Q2). Giving `stagedFacts` a seam for uid, owner and platform, as `decide` has, would let one test show the file is not run and the refusal line is printed.
  - F-2 · defect · tests/integration/update-command.test.ts:222 · AC-32 ("a report that cannot be built is said with its reason in `status`, as in `doctor`"): `reportOrReason` is tested on its own, but no test runs `status` with a report that fails to build. If `src/cli/commands/status.ts:17-20` went back to round 1's `try { … } catch { update = undefined }`, which prints nothing, every test would still pass (Q1). A test needs a way to make `status`'s report fail, for example an injectable build or a staged path whose `realpath` fails.
  - F-3 · advisory · tests/unit/update-reconcile.test.ts:50 · AC-23 (real path): `decide` is still only given identical strings, and the `realpathSync` step in `gather` (`src/update/reconcile.ts:81-82`) is not exercised. This was round 1's F-2; it is recorded as deferred in `docs/real-use/findings.md`.
  - F-4 · advisory · tests/e2e/update-reconcile.test.ts:101 · AC-31 ("no command but `install` stages a binary"): only `status` is shown not to stage. This was round 1's F-3, deferred.
  - F-5 · advisory · tests/e2e/install-forward.test.ts:1247 · AC-18 ("`install` through the same function"): the test asserts that the guard variable reaches the staged binary, not that `handOver` is the function used. This was round 1's F-4, deferred.
  - F-6 · advisory · tests/unit/settings.test.ts:1733 · AC-29: the temporary directories are still never removed. This was round 1's F-5, deferred.
  
  Round 1's F-1 (AC-13) is resolved. The case at tests/integration/update-command.test.ts:97 makes `deps.now` throw inside distill's guard: the drain still returns 0 and no state file is written. Without the guard the error would escape `run`, so the test fails on reversion. The new case "a reconciliation whose look throws returns null" (tests/unit/update-reconcile.test.ts:69) also fails if the `try` in `reconcile` is removed.
  
  ## Outside the change
  none
  
  ## Not answerable
  - Mutation (Q7) · no mutation report was named for this item.
