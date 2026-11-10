# Probe: the four suites of AC-13, run before any code of this item

AC-13 is a preserve criterion: the hook snapshots, the MCP tool list snapshots, the module migration suite and the perf budgets keep passing. The engine records a preserve criterion with a run before the change and one after. It refused the run before:

```
the watched sources already differ from the item's base (src/cli/commands/compact.ts, src/cli/commands/doctor.ts, src/cli/commands/knowledge.ts, +24 more): a before recorded now is not a baseline; record it before the change, or make AC-13 observed with the reason
```

The reason is the item's base. This item was started on 2026-11-09 for its spec while part 1 (item 2026-11-08-003, the knowledge store) was still being built, so its base is the commit both started from (`62780aa`). Part 1 is proven and committed on this branch since (`9f2f8f3`), and the engine cannot move an item's base.

So the baseline was taken by hand, on 2026-11-09, at commit `9f2f8f3` with one line of this item in the tree (the two sharing keys deleted from the environment in `tests/preload.ts`, which none of the four suites reads):

```
$ ./node_modules/.bin/bun test tests/unit/hook-snapshots.test.ts tests/unit/mcp-tools-list.test.ts tests/unit/module-migrations.test.ts tests/perf/budgets.test.ts
 49 pass
 0 fail
 21 snapshots, 544 expect() calls
Ran 49 tests across 4 files. [14.72s]
```

What it shows: before this item's code, the four suites pass: 49 tests, 21 snapshots.

What it does not show: an engine record. AC-13 is recorded as observed at the end of the build, with this reason, against the same command; the number of tests in `tests/unit/module-migrations.test.ts` grows by the cases this item adds there (Phase B of the plan), and the snapshot count must stay 21.
