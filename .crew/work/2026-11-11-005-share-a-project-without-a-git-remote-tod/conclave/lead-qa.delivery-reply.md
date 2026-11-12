# qa lead's validation of 2026-11-11-005-share-a-project-without-a-git-remote-tod: delivery
verdict: validated
## Returns
none
## Notes
- R-1 (lint) is closed by a recorded run, though not by the gate. `probes/lint-by-folder.md:5-14` records `./node_modules/.bin/biome check src tests scripts`: it checked 485 files, found 0 errors, and exited 0. It was run again on the final tree after the delivery returns. The warnings are named and none is in a file this item added or changed. The engine's lint row still rests on a run that checked 0 files (`report.md:58`, `logs/lint-_-1794479039825.txt`). Only the person can change the profile command (`crew profile set`, for example to biome by folder); until then, the lint proof for an item built in a worktree is this probe file, not the gate row. `ui/src` is excluded from biome and is covered only by the Vite build inside the test gate.
- R-2 (the three plan cases) is closed:
  - `tests/integration/sync-names.test.ts:234-274`: 100 name-bound levels are seeded, the main pull's `projects=` lists exactly those 100, the project's name is absent from it, a `scope=project` pull names it, and the extras cursors hold `[NAME, ALIAS]`.
  - `tests/integration/sync-names.test.ts:295-299`: after the `name` push refusal, `held: 0`, `readHold` is null, there are no refusals, and `failures`/`retryAt` are untouched. A D-10 hold on a `name` refusal would fail this test.
  - `tests/integration/share-names-cli.test.ts:68-108`: `--server` naming the other server exits 1 with `bound to s2`, the request-event count is unchanged (so the refusal comes before any request), and the row stays bound.
- The test gate passed on the final tree. `logs/test-_-1794478824681.txt:78-82` shows 3284 pass, 4 skip, 0 fail across 210 files, and `report.md:57` points at that log. The fingerprint at `report.md:354` equals `evidence.json:2` and every later gate record. The earlier perf-budget failures (`tests/perf/budgets.test.ts`, prompt hook p95) are explained as machine load. The item does not touch the hook path, and the last run passed.
- AC-47 (preserve): the latest `after` is 3225 passing (`evidence.json:24`) against 3109 before (`evidence.json:14`), 0 fail.
- Judgement round 4: `review/ruling.json` records test-quality as proven with no findings, and `review/test-quality.findings.md:5-21` shows that each new case fails when its behaviour is reverted. That includes the architects' `PUT` without `as` case at `tests/integration/ui-sharing.test.ts:1065-1091`, which goes through `prepareBinding`/`commitBinding`. Round 1's F-6 is closed.
- Still advisory and deferred to `docs/real-use/findings.md`:
  - F-1: AC-48 is observed only.
  - F-2: at `share-names-cli.test.ts:253-257`, "no request" for `--as` on a remote project counts only the lookup. Asserting that no `POST /v1/names` is sent would close it.
  - F-3 to F-5: "in parallel" and "unstopped" are not distinguished; the remote is excluded only because of how the fixture is built; the order "after `purged`" has no test.
- The e2e skip stands on the author's recorded decision of 2026-11-09. There are no task briefs.
