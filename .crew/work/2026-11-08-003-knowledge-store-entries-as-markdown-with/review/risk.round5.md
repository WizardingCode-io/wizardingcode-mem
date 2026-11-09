# risk findings for 2026-11-08-003-knowledge-store-entries-as-markdown-with
reviewer: review-risk
read: spec, plan (as read in round four, not re-read), 6 files

## Findings
- F-1 · advisory · src/modules/knowledge/repo.ts:175 · The new walk refuses a repository if anything under `.git/` is not a regular file or folder, and one real source of that is git itself. On macOS, a person whose own git has `core.fsmonitor=true` and runs any git command in a knowledge repository leaves a Unix socket at `.git/fsmonitor--daemon.ipc`. That command could be run by hand while editing for `adopt`, or by an editor's git integration.
  - **What happens.** Every open of that repository is then refused. If it is the workspace repository, every project write is refused too, because `ensureRepo` opens the root first (repo.ts:742).
  - **How it is seen.** The failure shows at once: the error names the path, and `doctor` warns (src/doctor/checks.ts:735). No data is written or lost.
  - **What undoes it is incomplete.** The message says only "remove it". While the person's daemon runs, and their tools keep calling git, the socket comes back. The real fix is `git fsmonitor--daemon stop` and then removing it.
  - **Not git's own doing here.** The store's own git never creates the socket, because `core.fsmonitor=false` (repo.ts:323) and `GIT_CONFIG_NOSYSTEM=1` (repo.ts:293).
  - **Not stated.** ADR 0024 does not name this case. The refusal message could name fsmonitor when the entry is a socket, and Known limits could say so.
- F-2 · advisory · src/modules/knowledge/repo.ts:168 · The cost of the walk does not grow with history.
  - **Why it stays flat.** Folders under `objects/` are never entered (repo.ts:174), so loose objects and packs are not read. The store makes no branches, and `logs/HEAD` is one file. So each open lists the top of `.git/`, `refs/` and `logs/`, plus up to 256 object-folder names. That is 44 ms at p50 for a whole write (probes/security-round-five.md).
  - **What would grow it.** Only folders a person's tool adds under `.git/`, such as `lfs/` or `worktrees/`. The store creates neither.
  - **One silent gap.** A folder inside `.git/` that cannot be read is skipped without a word (repo.ts:169-170). Its contents go unchecked, and nothing is logged.
- F-3 · advisory · src/modules/knowledge/repo.ts:547 · Moving the commit into `commitChange` changes nothing for the writes that already used the rule.
  - **Existing writes.** `commit` now only calls it (store.ts:783). `absolute` and the new `join(repo.path, ...split("/"))` are the same expression (store.ts:170).
  - **What `learnAliases` gains (repo.ts:693).** Its manifest hash is now taken from the exact text written. When the undo also fails, the commit's error is now the one thrown, not the undo's. tests/unit/knowledge-resolve.test.ts pins this, and the record is left for the next open.
  - **What remains, as before.** A failed alias commit inside `openRepo` (repo.ts:734) fails the write the person actually asked for. The staged manifest is put back only at the next open.
- F-4 · advisory · src/modules/knowledge/repo.ts:1210 · Round four's F-3 is closed. ADR 0024's "What the later parts add" now says a new operation that leaves a record ships in the same release as the code that reads it, and the report no longer blames another writer. One leftover: the same words, "not one this version of the store writes", now also cover a record that is corrupt JSON and a folder at the record's path. In those cases they point at a version mismatch that is not the cause.
- F-5 · advisory · src/modules/knowledge/index-store.ts:337 · Carried from round four's F-2, not acted on. `inEachRepo` sets aside only `invalid`. A `locked` lease or a git timeout in one repository's `adopt` still stops the repositories after it. A partial result still exits 1, the same as a total failure (src/cli/commands/knowledge.ts:142-146), so a later caller such as the viewer cannot tell the two apart from the exit code.
- F-6 · advisory · src/modules/knowledge/repo.ts:1247 · Carried from round four's F-7. For an adopt, "was undone" still lists paths that were only unstaged.
  - **What changed.** Removing the cap (`NO_CAP`, repo.ts:1085) closes round four's F-1 for any realistic adopt.
  - **What remains.** At the extreme the folder caps allow (5,000 × 256 KiB, base64, about 1.7 GB of kept bytes), the whole file is read and given to `JSON.parse`. If that fails, it lands in the same early `return` in `restoreKept` (repo.ts:1146). The bytes are then not written back, and the report still says "was undone".
- F-7 · advisory · .crew/work/2026-11-08-003-knowledge-store-entries-as-markdown-with/spec.md:317 · The spec's risks section says that for "a corrupt repository (a person edited `.git`…) `rebuild` reads the working tree". With the new refusal, `rebuild` sets such a repository aside instead. Its index rows, the author name among them, stay as they were last indexed. ADR 0024's Erasure paragraph now says this; the spec does not.
  - **Carried from round four's F-9.** A refused workspace repository still stops every project write, and the only way back is by hand. The new refusal cause widens this (F-1). The rollback in spec.md:321 is still manual, and the backup taken before migration 6 still rotates away under `BACKUPS_KEPT = 2`.
- F-8 · advisory · src/modules/knowledge/repo.ts:310 · Carried from round four's F-5. Data directories from earlier builds of this branch keep `knowledge/.no-hooks/`, `.template/` and `.gitconfig-empty`. Nothing reads them, and nothing removes them.
- F-9 · advisory · src/store/db.ts:317 · Carried from round four's F-8, and stated in ADR 0024's Known limits. The module migration pass is not contained, and `doctor` does not warn when the module schema is behind.

## Outside the change
- biome.json · In this worktree `bun run lint` processes 0 files, and the engine records the gate as passed. This round, coverage came only from the session running biome over the folders by name. Debt.
- tests/perf/large-project.test.ts · The p95 flakiness predates this item. It can hide a regression on the hook path. Debt.
- src/store/db.ts:132 · The upgrade runner waits up to 10 s under `BEGIN IMMEDIATE`. This predates the item. Debt.

## Not answerable
- Q1, what else outside the store leaves something non-regular in `.git/` · Nothing was run with GUI clients (Fork, Tower, Sourcetree, GitHub Desktop), Git LFS or other git versions to show what they leave there. F-1's fsmonitor socket comes from reading git's documented behaviour, not from a run. Only links were tested (tests/unit/knowledge-repo.test.ts), never a socket or a named pipe.
- Q1/Q5, the three git mechanisms on Windows and on git versions between 2.32 and 2.54 · Carried. Nothing was run outside macOS with git 2.54.0. The comments at repo.ts:306-308 and 466-467 now say so.
- Q1, git or a person's tool adding a line to `.git/config` on its own · Carried. Still not confirmed. Such a line refuses that repository, and if it is the workspace's, every project write (F-7).
