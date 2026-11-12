# Gap round

No checklist of the ten kinds fits: the change is three settings in the one git runner, one call after a commit, the tests' own git, and their documents. The reason is on the item's record.

## Assumed by good practice

- The settings go on every call through `-c`, in `configArgs`, and are never written to a repository's `.git/config`: `checkRepoConfig` refuses a setting outside `ALLOWED_SETTINGS`. Held by AC-6 and AC-7 (every call carries them) and AC-11 (the configuration tests pass as before).
- The proof asks git itself what it ran (`GIT_TRACE`, through the tests' stub and never through the product's environment), beside the arguments the runner passed, and it asserts a positive: the maintenance command is in the trace. AC-6, AC-7.
- A maintenance that fails never costs the person a write that landed. AC-8.
- The tests' own git starts no maintenance, so that a test never removes a repository a process is still writing in. AC-9.
- The documents say what the store now does with git's housekeeping, and keep the known limit open. AC-10.

## Decisions only the user can make

- D-1, answered by the author on 2026-11-12: maintenance in the foreground, over no maintenance at all and over a change to the tests alone. The options were shown with their costs. After the leads' first reading the mechanism changed inside that answer: the maintenance is a call of the runner's own after the commit, not a part of the commit, so that a slow repack cannot be reported as a failed commit (the spec's Design says why). The author is told of it in the delivery.

## Proposals

none

## Warnings

- O-1: a maintenance call that passes the runner's timeout is killed; the children git started may go on until they end, and the killed process leaves `maintenance.lock`, with which git skips later maintenance of that repository. The write is not failed (AC-8). Before the change the same process ran with no bound. Not measured at the size where a repack takes seconds. Advisory: the spec's Risks section says it.
- O-2: the change cannot be proven on the author's machine to end the three failures: they never happen there. The evidence is the probe on the runner and the suite's runs on the runner after the change. Advisory.
