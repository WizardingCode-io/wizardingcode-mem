# Analysis

## Origin

The git runner `runGit` and its settings (`configArgs` in `src/modules/knowledge/repo.ts`) were written in item `2026-11-08-003` (the knowledge store, ADR 0024, commit `4200ff2`), and the team server's mirror took the same runner in `2026-11-10-001` (`mirrorHost` in `src/team/mirror.ts`). ADR 0024 records the gap as a known limit: "the store does not turn off git's own housekeeping (`gc.auto`, `maintenance.auto`)", read from git's source by a reviewer and not reproduced, since the one run made with git 2.54.0 started no gc. The decision to leave it was that item's; no later item changed it. The tests' own git (`realGit` in `tests/helpers/stub-git.ts`) dates from the same item and has the same gap.

No root cause in the knowledge base names these paths: the ten entries `knowledge.md` lists are validated solutions of the items that wrote the files, none about git's housekeeping.

## Cause

A `git commit` ends by starting `git maintenance run --auto --quiet --detach`. That process outlives the commit: it takes `.git/objects/maintenance.lock` and removes it when it ends. The runner returns when the commit does, so the caller goes on while git is still writing in the repository. A recursive removal of the repository that runs meanwhile lists the lock and finds it gone; Bun's `rmSync` then stops with `ENOENT` and leaves the tree half removed, and with `force: true` it stops the same way and reports nothing.

Measured on the macOS runner (`probes/runner-removal.md`): 275 of 300 removals of a freshly committed repository fail; none fails when the commits ran with `maintenance.autoDetach=false` and `gc.autoDetach=false`, and the lock is then never present after the commit. The three failures of the suite are this one race:

- `tests/unit/knowledge-migration-7.test.ts:303`: `rmSync(project.path, { recursive: true })` throws `ENOENT … lstat '<the project folder>'`.
- `tests/unit/knowledge-index.test.ts:699`: `rmSync(shared.path, { recursive: true, force: true })` returns with the folder still there, so `rebuildAll` still finds `knowledge/shared`.
- `tests/integration/team-mirror.test.ts:762`: `runMirror(…, { rebuild: true })` under a read-only parent does not throw: its `rmSync(root, { recursive: true, force: true })` stopped silently, half way, before it reached the root it cannot remove.

Not established: why the author's machine never fails (the same detached command starts there), and which step of Bun turns a missing child into an `ENOENT` for the root.

## Blast radius

The defect is in the product, not only in the tests. `runMirror`'s rebuild and `replayFolders` (`src/team/mirror.ts`) remove repositories with `force: true` right after runs that commit: a removal cut short is silent, and the rebuild then replays into a half-removed repository. The mirror's lease is released while git's process may still write. The store's guards (`refuseForeign`, `statusOf`, the intent record's undo) read a repository's files on the assumption that no git call is running.

What the fix must not break: every git call of the store and of the mirror goes through `configArgs`, so a setting added there reaches all of them; `checkRepoConfig` refuses a `.git/config` that holds anything outside `ALLOWED_SETTINGS`, so the settings must be passed with `-c`, never written to the repository. With maintenance in the foreground, the commit that crosses git's threshold (6,700 loose objects by default) waits for the repack inside the runner's timeout (15 s for the store, 60 s for the mirror): a timeout there reports a failure for a commit that landed. The tests that record the runner's arguments (`tests/unit/knowledge-git-host.test.ts`, `tests/integration/team-mirror.test.ts`) and the whole of `tests/unit/knowledge-repo.test.ts` must stay green.
