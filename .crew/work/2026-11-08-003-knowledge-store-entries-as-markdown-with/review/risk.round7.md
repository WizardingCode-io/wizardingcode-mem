# risk findings for 2026-11-08-003-knowledge-store-entries-as-markdown-with
reviewer: review-risk
read: spec and plan as read in earlier rounds (not re-read this round); 9 files: probes/round-seven-change.patch, probes/rebuild-unsearchable-root-fixed.md, review/risk.round6.md, review/ruling.round6.json, src/modules/knowledge/resolve.ts, src/modules/knowledge/index-store.ts, src/modules/knowledge/errors.ts, src/doctor/checks.ts, src/cli/commands/knowledge.ts (plus the ADR 0024 lines and the test file, by search)

## Findings
- F-1 · defect · src/modules/knowledge/index-store.ts:594 · If a project's repository folder has been replaced by a link or a file, `rebuild` silently deletes that repository's rows. This breaks the rule the commit sets out to keep ("Only a folder that is not there is gone", docs/adr/0024-knowledge-module.md:88). For a project with no remote, the folder is then lost to the project for good. Nothing reports it and nothing undoes it.
  - **Two lines cause it.** `projectFolders` keeps only `kindAt(...) === "folder"` (src/modules/knowledge/resolve.ts:118), so the link is never opened, refused or listed, not even as an orphan (resolve.ts:332-334). The deletion loop then forgets every row whose path is not `"folder"`, which covers `"other"` as well as `"absent"`.
  - **Why it cannot be undone.** A manifest is only rematched through `remote:` or `gitdir:` aliases (resolve.ts:28, 157). A `path:`-only project's row is its only tie to its folder, which is the consequence the data judge ruled a defect in round six. Putting the real folder back leaves an orphan with no command to reattach it.
  - **The write path has the same gap. Reasoned, not run.** `resolveRepo` for a project does not find the linked folder either (resolve.ts:223). It counts the name as taken (resolve.ts:230-233) and creates `<name>-2`. `saveRow` then repoints the row there and deletes its index rows (resolve.ts:70-76). A `write` therefore lands in a new, empty repository with no message. This contradicts ADR 0024:85, which says "a repository folder that is a link" is refused before anything is written.
  - **How it is reached.** A person's action, not a state the store gets into by itself. It is still the likeliest next step for someone told at repo.ts:127 not to link `knowledge/`.
  - **Not tested.** No test covers a link at a project repository's path.
  - **Fix.** Delete rows only when the path is `"absent"`. When it is `"other"`, refuse it and name it, in `projectFolders` and in the deletion loop.
- F-2 · advisory · src/modules/knowledge/repo.ts:111 · The new refusal behaves correctly when a folder is only briefly unreadable, but it leaves no trace afterwards.
  - **How it behaves.** A sync or backup tool holding a folder, macOS privacy protection or a network disk now stops `rebuild`, `list`, `adopt` and project-scope writes. A workspace write is stopped only when `knowledge/` itself cannot be searched (repo.ts:122). The command writes nothing (probes/rebuild-unsearchable-root-fixed.md) and names the folder and the errno. Running it again once the folder is readable works, so it clears by itself. No healthy state the store reaches by itself is refused: ENOENT and ENOTDIR are the only errors read as "not there" (repo.ts:108), and children of `projects/` only need their parent to be searchable.
  - **What is missing.** The refusal is code `invalid`, so the CLI writes no log line (src/cli/commands/knowledge.ts:338). The exit code is 1, as for every other failure (knowledge.ts:342). The hint is still "check the permissions" even for EIO, and an EPERM from macOS privacy protection is not a permissions bit either.
  - **Impact today.** Fine while only a person at a shell runs these commands. Once a hook or MCP tool calls the store, the errno will be visible only to whoever reads that tool's output.
- F-3 · advisory · src/doctor/checks.ts:590 · Without a database, `doctor` and the commands disagree about the same folder.
  - **What doctor does.** Its own `projectFolders` (checks.ts:589-598) and `foldersByHand` (checks.ts:583) still read an unlistable `knowledge/projects` as empty. So `doctor` with no database reports "ok" with fewer repositories.
  - **What the commands do.** They refuse that same folder.
  - **Where doctor does warn.** With a database it does, because `scanRepos` throws first (checks.ts:675, 831-836).
- F-4 · advisory · src/modules/knowledge/index-store.ts:594 · `kindAt` can throw inside the deletion loop, after `inEachRepo` has already rebuilt the repositories. This needs a folder to become unreadable between the listing and the loop.
  - **What gets lost.** `rebuildAll` throws instead of returning, so the CLI prints none of the rebuild lines (knowledge.ts:234-235). Rows for absent folders that came earlier in the loop are already deleted, each in its own transaction.
  - **Recovery.** A rerun completes it.
- F-5 · advisory · src/modules/knowledge/repo.ts:351 · Carried from round six's F-3, not acted on. `configArgs` does not set `gc.auto=0`. Reasoned; probes/auto-gc.md did not reproduce a detached gc. A write that collides with one is undone, and a retry works.
- F-6 · advisory · src/modules/knowledge/index-store.ts:565 · Carried, not acted on.
  - **Locked or slow.** A `locked` lease or a git timeout in one repository still stops the repositories after it.
  - **Exit code.** A partial result exits 1, the same as a total failure (knowledge.ts:331, 342).
- F-7 · advisory · src/modules/knowledge/repo.ts:1282 · Carried. For an adopt, "was undone" also lists paths that were only unstaged, and it still says "undone" when the kept bytes fail `JSON.parse` and are not written back.
- F-8 · advisory · src/modules/knowledge/repo.ts:1245 · Carried. "Not one this version of the store writes" also covers a corrupt record and a folder at the record's path, and points at a version mismatch that is not the cause.
- F-9 · advisory · .crew/work/2026-11-08-003-knowledge-store-entries-as-markdown-with/spec.md:317 · Carried. The spec's risks section has not been updated.
  - **What is stale.** It still describes `rebuild` reading a corrupt repository's working tree, and backing the folder up "like any folder" (spec.md:319).
  - **What the newer text says.** ADR 0024:87-88 now gives the newer rules: real folders, the data directory may be linked, and "not there" versus "cannot be looked at".
  - **Rollback.** Stated at spec.md:321, and done by hand.
- F-10 · advisory · src/store/db.ts:317 · Carried, and stated in Known limits. The module migration pass is not contained. Folders left by earlier branch builds (`knowledge/.no-hooks/`, `.template/`, `.gitconfig-empty`) are never removed.

On the questions asked:
- **Round six's F-1 is resolved.** The refusal at repo.ts:127 now names the way out (link or move the data directory), ADR 0024:87 says the same, and the test at knowledge-repo.test.ts (around line 1739) holds that a linked data directory works.
- **Round six's F-2 is resolved as far as the errno goes.** The walk's refusal now carries the errno (repo.ts:237-240). It stays code `invalid` with no log line (F-2).
- **The first hour, from the messages alone.**
  - **Understandable.** A linked root, an unreadable folder and a foreign `.git` each print the folder and the reason, and write nothing.
  - **Not understandable: F-1.** A link at one project's repository produces no message at all, on `rebuild` or on `write`.

## Outside the change
- biome.json:1 · Debt. In this worktree `bun run lint` processes 0 files, and the engine records the gate as passed. This round, coverage came only from the session running biome over the folders by name.
- tests/perf/large-project.test.ts:1 · Debt, and it predates this item. The p95 test is flaky and can hide a regression on the hook path.
- src/store/db.ts:132 · Debt, and it predates this item. The upgrade runner waits up to 10 s under `BEGIN IMMEDIATE`.

## Not answerable
- Q1, which errno macOS privacy protection, iCloud Drive or a network file system actually returns, and for how long · No probe ran under an agent app without access, or on a synced or network volume. Only EACCES from mode bits was run (probes/rebuild-unsearchable-root-fixed.md), so whether those cases clear by themselves on a rerun is reasoned, not observed.
- Q1/Q3, F-1's write path · Reasoned from resolve.ts:223-243 and 62-85. No probe linked a project repository's folder and ran `write` or `rebuild`.
- Q1/Q3, a detached auto gc running alongside a store write · Not run (F-5).
