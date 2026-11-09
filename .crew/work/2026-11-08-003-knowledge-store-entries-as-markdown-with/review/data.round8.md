# data findings for 2026-11-08-003-knowledge-store-entries-as-markdown-with
reviewer: review-data
read: 8 files. These were: the rubric (as in round seven); review/data.round7.md; probes/round-eight-change.patch (whole); probes/unreadable-repository-folder.md; src/modules/knowledge/index-store.ts:320-615; src/modules/knowledge/resolve.ts (whole); src/modules/knowledge/repo.ts:115-265 and 670-864; src/util/paths.ts (the storeDir lines). Migration 0006, the runner and every table and index are unchanged this round. Risk areas: data-migration (personal-data unchanged).

## Findings
- F-1 · advisory · src/modules/knowledge/index-store.ts:595 · When `knowledge/` is absent as a whole but `knowledge_repos` holds rows, `rebuild` deletes every one of those rows (Rubric Q1, availability).
  - **How it happens.** `scanRepos` finds nothing and `projectFolders` returns `[]` (`namesIn` gives ENOENT as none). Every `row.path` then reads as `"absent"`, so the loop deletes every repository, entry and proposal row.
  - **When the disk is in that state.** The ADR text added this round names it: `WIZARDINGCODE_MEM_DATA_DIR`/`WIZARDINGCODE_HOME` "must then be set in the environment of every agent". Meanwhile `WIZARDINGCODE_MEM_STORE_DIR` from the environment (src/util/paths.ts:34) keeps one database across two data directories. So a `knowledge rebuild` run under the wrong data directory meets exactly this state.
  - **What is lost.** The entry rows are rebuilt from the files once the right directory is back. A project with only a `path:` alias cannot be rebuilt that way: its row is its only tie to its folder (the ADR's own words). That folder comes back as an orphan.
  - **Why advisory.** This is a manual command, the predicate is not new (round eight only narrowed it), and the files survive.
  - **Possible fix.** Refuse the removal loop when the knowledge root itself is absent and rows exist.
- F-2 · advisory · src/core/git.ts:68 · Carried from rounds six and seven, unchanged. A HEAD naming a ref with `..`, `\` or `:` reads as "no commit". Rows stay as last indexed. On a write path, `createRepository` rewrites only the store's own `.gitignore` before git fails (Rubric Q3, Q5).
- F-3 · advisory · src/modules/knowledge/migrations/0006_knowledge_store.sql:19 · Carried, unchanged. The `DELETE FROM meta` of the withdrawn module's keys cannot be undone. Its reason is stated at :17-18, and it runs after the pre-upgrade backup (Rubric Q1).
- F-4 · advisory · src/modules/knowledge/store.ts:302 · Carried, code unchanged. `settle` takes the fingerprint after the commit, so a file added by hand during the write's git calls is counted but not read. This is a known limit stated in ADR 0024 (Rubric Q3).
- F-5 · advisory · src/store/db.ts:75 · Carried. The one-time `VACUUM INTO` backup under the write lock has not been timed on a store that ran the withdrawn module (Rubric Q6).
- F-6 · advisory · src/modules/knowledge/resolve.ts:98 · Carried. `project_aliases` is read by `project_id`, which has no index. This is off the hook path and the table is small (Rubric Q2).

Round seven's F-1 (an unlistable `entries/` replaced a repository's rows with none) is closed.
- `listFolder` (index-store.ts:334) now goes through `namesIn`, and `readListed` (:350) through `lookAt`. Both refuse inside `readRepoFiles`, which `rebuildRepo` calls (:490) before its `withWrite` DELETE (:514). No row is replaced, and no fingerprint is recorded.
- `fingerprintOf` still reads an unlistable folder as 0. That only makes the fingerprint differ, so `ensureFresh` goes to `rebuildRepo`, which refuses. At mode 600 the fingerprint still matches and the index is served as it was. Neither case loses a row.
- The probe's "after" section and the new test show 000, 300 and 600 with rows intact.

Every other path that deletes or repoints an index row, checked against this commit:
- **`rebuildAll`'s removal loop (index-store.ts:595).** It now deletes only on `"absent"`.
  - A link or a file at the name is kept. `inEachRepo` set that repository aside by name.
  - A name that cannot be lstat'd throws before any DELETE.
  - The only remaining trigger is a name with nothing at it, plus the root-absent case in F-1.
- **`saveRow`'s repoint (resolve.ts:66-78).** It is reached from `listRepos` (:297) and `resolveRepo` (:225, 253, 271). It fires only when `matchProject` returns a folder other than the row's.
  - `matchProject` (:159) now takes the row's folder before any manifest check, whenever the row's name appears in `projectFolders`.
  - `projectFolders` (:119-126) now lists every non-dot name, links and files included. It refuses when the folder cannot be listed or a name cannot be lstat'd.
  - So the repoint fires only when nothing is at the row's name. Folder names are hex, so the dot filter cannot hide a row's name.
  - The probe confirms it: the mode 000, mode 600 and unreadable-manifest cases no longer produce `<name>-2`, and the row stays.
- **The new-folder branch (resolve.ts:243-246).** `taken` now uses `kindAt`, so a name that cannot be looked at refuses instead of reading as free.
- **The manifest rewrite in a row's folder emptied by hand (resolve.ts:268).** It fires only on `create`, with the manifest lstat'd as absent and no HEAD.
  - Before it, `openRepo` has run `resolveRepo({})` and `refuseForeign`, and that refuses a folder or `.git` that cannot be listed.
  - It writes only `knowledge.json` into a folder the row already names, and it changes no row.
- **The doctor (checks.ts:583-630).** It is read-only, writes no row, and now uses the same `kindAt`/`namesIn`.

I traced one disk state the commit did not create, and it is unchanged. The row's folder can hold another project's manifest, for example after two folders were swapped by hand. The row still wins without an alias check, as it did before this round (then only if the manifest's scope was `project`). The other project sees that manifest as `claimed`, and its own row goes only if its name is absent. That is the ADR's stated rule, and nothing is lost that the files cannot give back.

Personal data: no column, table, retention or erasure text changed this round.

## Outside the change
- src/store/migrations/0001_init.sql:14 · `project_aliases` has no index on `project_id`. This is debt (advisory).

## Not answerable
- Q1 (F-1) · I reasoned the "knowledge root absent with rows present" case from the code and did not run it. No probe covers a `rebuild` under a second data directory that shares one store directory.
- Q1 · The probes and tests cover macOS only. Linux, a disk fault (EIO), Windows, and `proposals/open/` / `proposals/decided/` made unreadable are not run; the probe says so itself. I judged the proposals folders from the code: they share `listFolder` and `readListed`.
- Q6 Availability · Carried: the first open's backup and drops under the write lock have not been timed on a real store that ran the withdrawn module.
