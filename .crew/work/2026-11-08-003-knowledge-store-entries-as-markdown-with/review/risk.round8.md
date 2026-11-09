# risk findings for 2026-11-08-003-knowledge-store-entries-as-markdown-with
reviewer: review-risk
read: spec and plan as read in earlier rounds (not re-read this round); 11 files: probes/round-eight-change.patch, probes/link-at-project-repository-fixed.md, probes/round-eight-mutations.md, probes/unlistable-entries-folder.md, review/risk.round7.md, src/modules/knowledge/resolve.ts, src/modules/knowledge/index-store.ts (rebuildAll, inEachRepo), src/modules/knowledge/repo.ts (openRepo, createRepository, headOf, fingerprintOf), src/core/git.ts (headOfGitDir), src/doctor/checks.ts (knowledgeRepositories)

## Findings
- F-1 · advisory · src/modules/knowledge/index-store.ts:561 · A project folder that is still there but holds no repository keeps its old index rows through `rebuild`, and `rebuild` prints nothing about it.
  - **How it happens.** Someone empties the folder by hand or deletes its `.git`. The row's name now always wins (resolve.ts:159-161), so `scanRepos` lists the folder. `openRepo` without `create` then returns null (repo.ts:817-818), so `inEachRepo` records neither a result nor a refusal. The deletion loop skips it too, because something is at the name (index-store.ts:595).
  - **What is wrong afterwards.** `knowledge_entries` keeps rows for files that no longer exist, and `rebuild` says nothing.
  - **What fixes it.** The next write rebuilds the repository in the same folder (resolve.ts:268) and replaces the rows. `doctor` does say "is not a git repository" (checks.ts:736).
  - **Why advisory.** No hook, tool or view reads the index yet, and round seven's code kept the same rows through the same path.
- F-2 · advisory · src/modules/knowledge/resolve.ts:121 · Any stray non-dot file a person or the OS leaves in `knowledge/projects/` is now a permanent `doctor` warning and an orphan in `rebuild`. Examples are macOS `Icon\r` and Windows `desktop.ini`.
  - **Where.** The listing now keeps names that are not folders (resolve.ts:121; checks.ts:124-128), and `refuseForeign` turns the file into "is not a folder" (checks.ts:734-739).
  - **What it does not do.** It blocks nothing, and the message names the path. It is noise in the first hour, not a fault.
- F-3 · advisory · src/modules/knowledge/index-store.ts:595 · Carried from round seven's F-4. `kindAt` can still throw inside the deletion loop after `inEachRepo` has rebuilt the repositories.
  - **When.** A name becomes unlookable between the listing and the loop.
  - **What is lost.** `rebuildAll` throws instead of returning, so the CLI prints no rebuild lines. Rows of absent folders deleted earlier in the loop stay deleted, each in its own transaction.
  - **Recovery.** A rerun completes it.
- F-4 · advisory · src/modules/knowledge/repo.ts:347 · Carried from round seven's F-2, partly addressed.
  - **Addressed.** The hint now points at permissions only for EACCES and EPERM, and the errno is named everywhere.
  - **Still open.** The refusal is still code `invalid`, so the CLI writes no log line, and the exit code is 1 as for any failure.
- F-5 · advisory · src/modules/knowledge/repo.ts:351 · Carried. `gc.auto=0` is not set. A collision with a detached gc is undone, and a retry works. `headOf` reads `packed-refs` (src/core/git.ts:46), so a pack-refs does not make a repository read as uncommitted.
- F-6 · advisory · src/modules/knowledge/index-store.ts:563 · Carried. A `locked` lease or a git timeout in one repository still stops the ones after it, and a partial result exits 1.
- F-7 · advisory · src/modules/knowledge/repo.ts:1282 · Carried. An adopt's "was undone" still overstates: it lists paths that were only unstaged, and it still says "undone" when the kept bytes fail `JSON.parse` and are not written back.
- F-8 · advisory · src/modules/knowledge/repo.ts:1245 · Carried. "Not one this version of the store writes" still also covers a corrupt record, which points at a version mismatch that is not the cause.
- F-9 · advisory · .crew/work/2026-11-08-003-knowledge-store-entries-as-markdown-with/spec.md:317 · Carried. The spec's "Risks and rollback" section still predates the rules in ADR 0024:87-93 (refusal by name, "only a name with nothing at it is gone"). Rollback is stated at spec.md:321 and is done by hand.
- F-10 · advisory · src/store/db.ts:317 · Carried, and stated in Known limits. The module migration pass is not contained, and leftovers from earlier branch builds are never removed.

On the questions asked:
- **Round seven's F-1 is closed on both paths.**
  - **`rebuild`.** The deletion loop now forgets rows only where the name is `"absent"` (index-store.ts:595). `projectFolders` lists links and files (resolve.ts:116-127), and the row's name wins whatever is at it (resolve.ts:159-161). `inEachRepo` therefore opens the link or file and it is refused by name. The project's row and entry rows stay, and putting the folder back restores the project (probes/link-at-project-repository-fixed.md, for a link and for a file, `path:`-only project).
  - **`write`.** `resolveRepo` calls `refuseForeign` on the row's name when it is not a folder (resolve.ts:257-260). It no longer counts the name as taken and makes `<name>-2`. The probe shows the write refused, one folder, rows unchanged.
  - **Tests.** Both paths are tested in tests/unit/knowledge-index.test.ts and knowledge-resolve.test.ts. Mutations 1-4 and 13 in probes/round-eight-mutations.md are killed.
- **The same fault one level down is also closed.** This is an unreadable repository folder, manifest or `entries/` folder. `listFolder` and `readListed` now go through `namesIn` and `lookAt`, so the rebuild refuses that repository by name instead of replacing its rows with none.
- **Round seven's F-3 (doctor's listing) is resolved.** `doctor` uses the module's `namesIn` and `kindAt` and gives the same warning with and without a database (checks.ts:114-129; tests in doctor-knowledge.test.ts).
- **New write in this commit.** It is resolve.ts:268, a manifest written into the row's folder when that folder has no manifest and no HEAD. It is bounded: `createRepository` stages and commits only `knowledge.json` and `.gitignore` (repo.ts:727-752), so a person's other files in that folder are not committed. A repository that has commits but lost its manifest gets no new one, and `doctor` says "knowledge.json is missing" (checks.ts:756).
- **The first hour.** A link, a file, or an unreadable folder or name each print the path and the errno, and write nothing. The only silent case left is F-1 above.

## Outside the change
- biome.json:1 · Debt. In this worktree `bun run lint` processes 0 files and the engine records the gate as passed. Coverage this round came only from the session running biome over the folders by name.
- tests/perf/large-project.test.ts:1 · Debt, and it predates this item. The p95 test is flaky and can hide a regression on the hook path.
- src/store/db.ts:132 · Debt, and it predates this item. The upgrade runner waits up to 10 s under `BEGIN IMMEDIATE`.

## Not answerable
- Q1, which errno macOS privacy protection, iCloud Drive or a network file system actually returns, and whether it clears on a rerun · Only EACCES from mode bits was run, on macOS. Linux and Windows were not run, and on Windows or as root the permission tests return early and hold nothing.
- Q1/Q3, a project with a `remote:` or `gitdir:` alias whose row's folder is replaced by a link while another folder's manifest matches the remote · Reasoned only, not probed: the row's name wins, and the other folder is reported as ambiguous.
- Q1/Q3, a detached auto gc running alongside a store write · Not run (F-5).
