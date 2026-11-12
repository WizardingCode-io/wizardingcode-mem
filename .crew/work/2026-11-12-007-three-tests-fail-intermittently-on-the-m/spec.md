# No git process outlives the call that started it

## Problem

A commit made by the knowledge store or by the team server's mirror ends by starting `git maintenance run --auto --quiet --detach`. That process is still writing under `.git/objects` (it takes and removes `maintenance.lock`) after the runner has returned, so whatever the caller does next to the repository races with it. A recursive removal that loses the race stops half way: with an error where the caller did not ask for `force`, in silence where it did. On GitHub's macOS runner 275 of 300 removals of a freshly committed repository fail (`probes/runner-removal.md`); three tests of the suite fail intermittently for it and block the required check `check (macos-latest)`, and the mirror's rebuild can be cut short in silence on a host where the race is lost. `analysis.md` has the origin and the blast radius.

## Design

Decision D-1, the author's, on 2026-11-12: maintenance runs in the foreground, so that git keeps compacting a repository and nothing runs after the call. Two parts:

1. No git command starts maintenance by itself. The one runner's settings (`configArgs` in `src/modules/knowledge/repo.ts`, which every git call of the store and of the mirror passes) gain `maintenance.auto=false`, with `maintenance.autoDetach=false` and `gc.autoDetach=false` under it: the first stops a commit from starting `git maintenance run --auto` (git 2.29 and later; the store needs 2.32), the other two keep the maintenance below, and the gc task of an older git, from detaching.
2. The runner runs it, after the commit. `commitPaths`, the one function that commits (seven call sites: two in `repo.ts`, one in `store.ts`, four in `src/team/mirror.ts`), ends with a call of its own through `runGit`: `git maintenance run --auto --quiet`. Git decides by its own thresholds whether anything is due; the call returns when git has stopped writing. The call has the environment of the commit it follows, identity included. Nothing it throws is the commit's, which landed, so nothing it throws changes what the caller does next:
   - A git that fails, and a call killed at the timeout (`GitTimeoutError`), are logged by `runGit`, as every git failure is.
   - A lease lost at the call's renewal is raised by `host.renew` before git is started, so no git runs without the lease. In the store it is a `KnowledgeError` with code `locked`: the write that landed returns and is not undone by `commitChange`. In the mirror it is `MirrorLeaseLostError`: the revision whose commit landed is recorded as exported, and the run meets the lost lease at its own next git call, where it stops as it does today; a run with no git call left ends.
   - An error of any other kind is logged under the host's scope.

   The build changed this rule. The spec the leads first validated let an error that is not a `KnowledgeError` go on to the caller. The test of the mirror showed what that did: the run stopped between a commit that had landed and the record of its revision, and the next run tried the same commit again, which git refuses as empty, on every run after. A commit and its record must not be parted by the housekeeping.

The first draft of this spec put the maintenance inside the commit (`autoDetach=false` alone). The security lead's reading of the code showed the cost: a repack that passed the runner's timeout would be reported as a failed commit, and `commitChange` would then undo a commit that had landed (`undoStaged` removes a created entry from the index and the disk while HEAD keeps it). With the maintenance in a call of its own, the commit's own window is what it was before this change, and a slow repack can no longer fail a write. D-1's answer stands: foreground, git keeps compacting, nothing runs after the call.

The settings are passed with `-c` on each call, never written to `.git/config`, which `checkRepoConfig` keeps to the settings `git init` writes.

The tests' own git (`realGit` in `tests/helpers/stub-git.ts`), which commits by hand into repositories the tests then remove, passes `maintenance.auto=false`: a test's own commit starts nothing.

The proof asks git what it ran. The tests' stub (`stubGit`) gains a behaviour `traceTo`, which sets `GIT_TRACE` to a file for the git it forwards to; `gitEnv`, the product's closed environment, is not widened.

Measured (`probes/runner-removal.md`, run 3): on the runner, 0 of 150 removals fail after commits made with `maintenance.auto=false`, and the lock is never present after a commit. On the author's machine (git 2.54.0): a commit with the three settings traces no maintenance command; `git maintenance run --auto --quiet` given the three settings and `gc.auto=1`, with the gc threshold crossed, repacks 245 loose objects into packs before it returns, leaving no `maintenance.lock` and no `gc.pid`, and with nothing due it runs no child command.

Alternatives rejected:

- `maintenance.auto=false` and no call of the runner's own (no maintenance at all): loose objects would pile up for ever. Not chosen by the author.
- Maintenance inside the commit (`autoDetach=false` alone): the first draft, rejected for the undo of a landed commit above.
- Leaving the product as it is and making only the tests wait or retry: the mirror's rebuild keeps its silent half removal.
- Removing twice, or a removal written by hand: measured, the hand-written one fails as often (115 of 150), and a second attempt only hides a process that is still writing.

## Acceptance criteria

- AC-6: Every git call of the knowledge store carries `maintenance.auto=false`, `maintenance.autoDetach=false` and `gc.autoDetach=false`. The trace git itself writes of a store write, taken through the stub's `traceTo`, holds one `git maintenance run --auto --quiet` command for each commit, started by the runner after the commit, and no git command with `--detach`; a trace without the maintenance command fails the test.
- AC-7: The same of a mirror run that commits: every call carries the three settings, and the trace holds the runner's maintenance command after each commit and no `--detach`.
- AC-8: A maintenance call that fails, and one that passes the timeout, do not fail the write: the entry is written and committed, the tree equals HEAD, and the failure is in the log.
- AC-12: A lease lost at the maintenance call. In the store, the write returns, the entry is written and committed and the tree equals HEAD. In the mirror, no git runs without the lease, the revision that landed is recorded, the run stops with its lost-lease error at its next git call, and the next run commits no revision twice.
- AC-13: With work due (two loose objects in the folder git samples, and `gc.auto=1` given by the host), the runner's call after a commit, carrying the three settings, packs the loose objects before `commitPaths` returns.
- AC-9: The tests' own git reads `maintenance.auto` as `false`.
- AC-10: ADR 0024 and `CLAUDE.md` name the three settings and the runner's own maintenance call. ADR 0024 says, where it speaks of housekeeping (the paragraph on what `.git` may hold, and Known limits), that the housekeeping still runs, now started by the runner after a commit and in the foreground; the known limit stays open in its words: the files inside the folders of `objects/` are not checked, the housekeeping removes and rewrites files there, and the sync part is to close it.
- AC-11 (preserve): `tests/unit/knowledge-repo.test.ts`, `tests/unit/knowledge-git-host.test.ts` and `tests/integration/team-mirror.test.ts` pass as before.

On every git the store accepts (2.32 and later) the explicit maintenance command exists and the trace shows it, so AC-6 and AC-7 assert the same on each: no skip by version.

## Risks

- A maintenance call that passes the runner's timeout (15 s for the store, 60 s for the mirror) is killed by `SIGKILL`, which reaches git's own process and not the children it started (`git repack`, `git pack-objects`): those may go on writing until they end, and the killed process leaves `.git/objects/maintenance.lock`, with which git skips later maintenance of that repository until the file is removed. The write is not failed by it (AC-8). Before this change the same process ran detached with no bound at all, and a killed one left the same lock. Not measured at the size where a repack takes seconds: git's threshold is 6,700 loose objects, about 2,000 writes of the store.
- Each commit now costs one more git process, run to its end: the same process a commit started before, no longer in the background. Not measured apart from the suite's own budgets.

Rollback: remove the three settings and the call.

## What is not proven

- That the three tests no longer fail on the runner: the probe shows the race gone for a repository made by plain git calls with the setting, and its case C (the store's own repository) never failed even without it. The evidence is the suite's runs on the runner after the change, cited by number in the delivery.
- Why the author's machine never loses the race.

## Out of scope

- The other tests that run git by themselves (`tests/unit/sharing-store.test.ts`, the release commands' tests): none removes a repository it then reads.
- `scripts/release/push.ts`, which commits in a clone the workflow throws away.
- Removing a stale `maintenance.lock`, and killing a timed-out git's children.
- The unchecked files inside the folders of `.git/objects/` (ADR 0024, Known limits).
- The latency test `tests/perf/budgets.test.ts` and the 2,000-entry write budget, which also failed on the runner on 2026-11-12, for load: another cause, another item.
