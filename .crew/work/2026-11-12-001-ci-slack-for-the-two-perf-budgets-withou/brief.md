# Brief

## Request

CI slack for the two perf budgets without one. tests/perf/budgets.test.ts holds a rebuild's write transaction at 2000 entries to 50 ms on one measurement, and tests/perf/semantic.test.ts holds the median of a global search by meaning over 65000 memories to 40 ms, with no slack on CI, while the hook budgets in the same file hold the median with a 2.5 slack on a CI runner (CI=1). On GitHub's macos-latest runner the rebuild took 70, 59 and 64 ms and the search 47 ms in three runs of PR 35 and in the push run of #34, so check (macos-latest) fails and the ruleset blocks the merge. The fix: the rebuild is measured five times and its median held, and both budgets carry the file's SLACK (2.5 on CI, 1 on a developer's machine), so the budgets on a developer's machine stay 50 ms and 40 ms.
