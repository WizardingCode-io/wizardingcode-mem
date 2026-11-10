# Probe: the three suites of AC-12, run before any code of this item

AC-12 is a preserve criterion: the hook snapshots, the memory-alone MCP tool list snapshots and the perf budgets keep passing. The engine records a preserve criterion with a run before the change and one after. This item's base commit is `62780aa` (the commit it was started from, for its spec, while part 1 was still being built), and part 1 and six phases of the sharing policy are committed on this branch since. The engine cannot move an item's base, so a run recorded now is not a baseline to it (the same refusal as the sharing policy's, `.crew/work/2026-11-09-002-sharing-policy-per-project-local-only-kn/probes/baseline-before-the-change.md`).

So the baseline was taken by hand, on 2026-11-09, at commit `39d62f9` (the sharing policy's phases A to F committed; its phase G in the tree uncommitted, touching no file these suites read), with no code of this item in the tree:

```
$ ./node_modules/.bin/bun test tests/unit/hook-snapshots.test.ts tests/unit/mcp-tools-list.test.ts tests/perf/budgets.test.ts
 38 pass
 0 fail
 21 snapshots, 485 expect() calls
Ran 38 tests across 3 files. [16.41s]
```

What it shows: before this item's code, the three suites pass: 38 tests, 21 snapshots.

What it does not show: an engine record. AC-12 is recorded as observed at the end of the build, with this reason, against the same command; the snapshot count must stay 21 and the memory-alone tool list byte for byte, while the perf corpus grows by the three knowledge repositories the plan adds.
