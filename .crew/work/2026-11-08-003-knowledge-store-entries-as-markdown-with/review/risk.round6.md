# risk findings for 2026-11-08-003-knowledge-store-entries-as-markdown-with
reviewer: review-risk
read: spec, plan (as read in earlier rounds; this round only spec.md:310-324 was re-read), 9 files (probes/round-six-change.patch, probes/fsmonitor-socket.md, review/risk.round5.md, review/ruling.round5.json, src/modules/knowledge/repo.ts, src/core/git.ts, src/doctor/checks.ts, src/cli/commands/knowledge.ts, src/modules/knowledge/index-store.ts)

## Findings
- F-1 · advisory · src/modules/knowledge/repo.ts:305 · Someone who linked `knowledge/` to another disk or a synced folder on purpose now has every knowledge command fail, and has no stated safe way back. Linking the folder elsewhere is a common way to do what spec.md:319 suggests, which is to back the folder up "like any folder".
  - **What they see.** The failure shows at once and nothing is written: every command fails with the path named (src/cli/commands/knowledge.ts:338-342), and `doctor` warns "could not be checked" (src/doctor/checks.ts:610, 831-836).
  - **What the message says.** It says only "Remove it". If the person does that and then writes, the next write creates a new, empty workspace repository. A later `rebuild` then drops the index rows of every repository it no longer finds (index-store.ts:573-575). The files are still at the link's target, so moving them back and running `rebuild` recovers everything.
  - **What works and is not said.** A data directory that is itself a link, or one moved with `WIZARDINGCODE_HOME`, works. `isDirectory` and `existsOnDisk` use `lstat`, which only looks at the last part of the path (repo.ts:117-133). Neither the message nor ADR 0024's "must be folders themselves" paragraph says this is the way out.
- F-2 · advisory · src/modules/knowledge/repo.ts:196 · Every listing error other than ENOENT becomes the same refusal ("cannot be listed … make it readable"), with code `invalid`.
  - **Where the wording is right.** It fits EACCES. On a backup restore it rarely refuses a state git could still work in:
    - Restore tools that drop file modes leave folders at 0755, which can be listed.
    - A restore done as root leaves folders the person can neither list nor write, so git would have failed there anyway. The refusal is just earlier and names the folder.
  - **Where it points at the wrong cause.**
    - EIO on a failing disk.
    - EMFILE.
    - EPERM from macOS privacy protection, when the data directory is linked into ~/Documents or iCloud Drive and the binary runs under an app without access.
  - **How those are handled.** Because the code is `invalid`, `inEachRepo` sets the repository aside as a refusal (index-store.ts:565). The CLI writes no log line for a `KnowledgeError` (knowledge.ts:338). So a disk fault reaches the person as a permissions hint, with nothing in the log.
- F-3 · advisory · src/modules/knowledge/repo.ts:351 · `configArgs` does not turn off `gc.auto`. Reasoned, not run.
  - **When it triggers.** After roughly 6,700 loose objects, meaning thousands of writes and not the first hour, one of the store's commits starts `git gc --auto`.
  - **What that does.** By default it detaches, so it outlives runGit's 15 s kill and the repository's lease. A write that overlaps it can hit `packed-refs.lock` or a ref lock and fail with code `git`. `commitChange` undoes it, and a retry works.
  - **What it does not break.** gc leaves only regular files (`gc.pid`, `gc.log`, `packed-refs`), so the `.git` walk lets them through. After `pack-refs`, the HEAD reader still finds the commit in `packed-refs` (src/core/git.ts:46).
  - **What is missing.** The ADR's latency table does not cover the write that triggers it.
- F-4 · advisory · src/modules/knowledge/index-store.ts:565 · Carried from round four's F-2 and round five's F-5, not acted on.
  - **Locked or slow.** A `locked` lease or a git timeout in one repository still stops the repositories after it.
  - **Exit code.** A partial result exits 1, the same as a total failure (src/cli/commands/knowledge.ts:331, 342).
  - **What did change.** The lines for earlier repositories are now printed as each one finishes (knowledge.ts:154-167, 186-202), so what was adopted before the fault is no longer lost.
- F-5 · advisory · src/modules/knowledge/repo.ts:1282 · Carried. For an adopt, "was undone" also lists paths that were only unstaged. At the extreme size, if `JSON.parse` of the kept bytes fails, the bytes are not written back, and the report still says "was undone".
- F-6 · advisory · src/modules/knowledge/repo.ts:1245 · Carried. "Not one this version of the store writes" also covers a record that is corrupt JSON and a folder at the record's path. In both cases it points at a version mismatch that is not the cause.
- F-7 · advisory · .crew/work/2026-11-08-003-knowledge-store-entries-as-markdown-with/spec.md:317 · Carried. The spec's risks section still says `rebuild` reads a corrupt repository's working tree. The code now sets such a repository aside, and its rows stay as last indexed.
  - **New this round.** spec.md:319 still says the folder is backed up "like any folder", without the new constraint that `knowledge/` and `knowledge/projects/` must be real folders (F-1).
  - **Rollback.** It is stated at spec.md:321 and done by hand.
  - **Where the newer text is.** ADR 0024 records the newer behaviour and says it is later than the spec.
- F-8 · advisory · src/store/db.ts:317 · Carried, and stated in Known limits. The module migration pass is not contained. Earlier builds of this branch leave folders behind (`knowledge/.no-hooks/`, `.template/`, `.gitconfig-empty`); nothing reads them and nothing removes them.

No defect found this round. On the questions asked:
- **The socket exception is the right width.** It requires the exact name, the top of `.git`, and `isSocket()` (repo.ts:207), which matches what probes/fsmonitor-socket.md observed. The daemon's `.git/fsmonitor--daemon/cookies/` holds a folder and regular files, and the walk handles it without a race: it reads entry kinds from the listing rather than a stat per file, and a folder that vanishes returns ENOENT.
- **The HEAD restriction refuses no healthy state.** It only applies to `ref:` lines, which git itself writes under `refs/` (src/core/git.ts:63-66), and only the knowledge module calls `headOfGitDir`.
- **No state a healthy repository reaches on its own was found to be refused.** Checked:
  - gc: leaves only regular files.
  - A crash: leaves `*.lock` files, which are regular files.
  - stash, rebase and worktree run by hand: they leave regular files and folders.
- **Running `git maintenance register` by hand adds settings that the allow list refuses.** That was already a stated limit.

## Outside the change
- biome.json:1 · Debt. In this worktree `bun run lint` processes 0 files, and the engine records the gate as passed. Coverage this round came only from the session running biome over the folders by name.
- tests/perf/large-project.test.ts:1 · Debt, and it predates this item. The p95 flakiness can hide a regression on the hook path.
- src/store/db.ts:132 · Debt, and it predates this item. The upgrade runner waits up to 10 s under `BEGIN IMMEDIATE`.

## Not answerable
- Q1, which other tools leave something in `.git/` that is neither a file nor a folder · Only git 2.54.0 on macOS with fsmonitor was run. Nothing was run on Linux (where git's fsmonitor backend and socket may differ), with `fsmonitor.socketDir`, with GUI clients, or with Git LFS.
- Q1, the listing refusal under macOS privacy protection or on a network or synced file system · Nothing shows which error a data directory linked into ~/Documents or iCloud Drive actually returns, under an agent app without access (F-2).
- Q1/Q3, a detached auto gc running alongside a store write · Not run. The point at which gc triggers and the lock failure it may cause are reasoned from git's defaults (F-3).
