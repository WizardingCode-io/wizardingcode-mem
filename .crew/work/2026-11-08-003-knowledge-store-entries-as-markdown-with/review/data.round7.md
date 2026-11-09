# data findings for 2026-11-08-003-knowledge-store-entries-as-markdown-with
reviewer: review-data
read: 9 files. These were: the rubric; review/data.round6.md; probes/round-seven-change.patch (whole); probes/rebuild-unsearchable-root-fixed.md; src/modules/knowledge/repo.ts:150-210 and 821-845; src/modules/knowledge/resolve.ts:180-337; src/modules/knowledge/index-store.ts:320-345 and 490-615; src/modules/knowledge/store.ts:205-254; src/doctor/checks.ts:570-629. I re-read migration 0006 whole. It is unchanged this round, as are the runner (src/store/db.ts, src/store/migration.ts, src/engine/module-schemas.ts) and every table and index. Risk areas: data-migration, personal-data.

## Findings
- F-1 · advisory · src/modules/knowledge/index-store.ts:334 · `listFolder` still treats any `readdirSync` failure as an empty folder, and so does `fingerprintOf` (src/modules/knowledge/repo.ts:840).
  - **What happens.** Take an `entries/` or `proposals/<state>/` folder inside a repository that cannot be listed (mode 000 or 300, or a disk fault). It passes `refuseForeign`, which only lstats it. `rebuildRepo` (index-store.ts:516-524) then deletes every `knowledge_entries` / `knowledge_proposals` row of that repository and writes none. `list` shows the repository as empty and gives no refusal.
  - **Why advisory, not defect.** These rows are derived from files that are still on the disk. The `knowledge_repos` row, the one tie that cannot be rebuilt, survives. The recorded fingerprint counts 0 for that folder, so the first `ensureFresh` after the folder is readable again rebuilds the rows.
  - **Why it still matters.** It contradicts the rule ADR 0024 now states ("A folder under `knowledge/` that cannot be looked at or listed … refuses the command"). The fix is the same as this round's: use `namesIn` here and in `fingerprintOf` (Rubric Q1).
- F-2 · advisory · src/core/git.ts:68 · Carried from round six, made slightly wider. `headOfGitDir` now also reads a HEAD whose ref has `\` or `:` in it as "no commit". Two things follow:
  - **Read paths.** `inEachRepo` gives that repository neither a result nor a refusal, and its rows stay as last indexed.
  - **Write paths.** `openRepo` (repo.ts:801) goes on to `createRepository` (repo.ts:704), which rewrites only the store's own `.gitignore` before git fails.
  - git itself refuses all these HEADs (Rubric Q3, Q5).
- F-3 · advisory · src/modules/knowledge/migrations/0006_knowledge_store.sql:19 · Carried, unchanged. The `DELETE FROM meta` of the withdrawn module's keys cannot be undone. Its reason is stated at :17-18, it runs after the pre-upgrade backup, and the keys have no other writer (Rubric Q1).
- F-4 · advisory · src/modules/knowledge/store.ts:302 · Carried, code unchanged. `settle` takes the fingerprint after the commit. A file added by hand during the write's git calls is counted but not read. This is a stated known limit in ADR 0024 (Rubric Q3).
- F-5 · advisory · src/store/db.ts:75 · Carried. The one-time `VACUUM INTO` backup under the write lock, on a store that ran the withdrawn module, has not been timed (Rubric Q6).
- F-6 · advisory · src/modules/knowledge/resolve.ts:97 · Carried. `project_aliases` is read by `project_id`, which has no index. This is on a write path, off the hook path, and the table is small (Rubric Q2).

What I checked against the facts given:
- **Round six's F-1 is closed on every path that forgets or rewrites rows.**
  - **`rebuildAll`.** `inEachRepo` → `listRepos` → `scanRepos` runs `refuseLinkedRoots` (repo.ts:122, `kindAt`). It then runs `projectFolders` (resolve.ts:113-118, `namesIn` plus `kindAt` per name). All of this happens outside the per-repository try, so a refusal leaves `rebuildAll` before the `SELECT`/`DELETE` loop.
  - **The removal loop.** It skips only on `kindAt(...) === "folder"` (index-store.ts:594), and any other lstat failure throws. So only "absent" or "other" deletes. "Other" is a link or a file where the folder was: the store never reads through it, and a later `resolveRepo` refuses it.
  - **The proof.** The fixed probe and the new test show both 000 and 600 on `knowledge/projects`, and 000 on `knowledge/`, refused with rows intact.
  - **`rebuildRepo` / `ensureFresh`.** They are reached only through `openRepo`. A `.git` that cannot be listed refuses there (repo.ts:234-241, now naming the errno). The remaining gap one level down is F-1 above, and it heals itself.
  - **`resolveRepo`'s `saveRow`.** It runs only after `refuseLinkedRoots`, and for a project only after `projectFolders` has listed and lstat'd every folder.
- **The remaining `isDirectory` / `existsOnDisk` uses** cannot misplace data in practice:
  - **`taken`** (resolve.ts:231) runs after `projectFolders` has shown that `knowledge/projects` can be listed and searched. A false "free" there needs a fault that only hits the candidate's lstat. Even then, `mkdirSync` is recursive on an existing folder and `writeManifest` would overwrite only the manifest. That is a race, not a path a reader can name.
  - **The fixed-scope branch** (resolve.ts:209) runs after `refuseLinkedRoots` has shown `knowledge/` can be searched. The folder path does not change, so no row is misplaced.
  - **`refuseForeign`'s early return** (repo.ts:198) and `mustBe`'s catch-all (repo.ts:187) can only skip a check where git would fail on the same lstat.
  - **The doctor** (checks.ts:583-611) only reads, and it calls `refuseLinkedRoots` first.
- **`headOfGitDir`.** The extra refusal of `\` and `:` removes no row and writes none.
- **Personal data.** No column, table or retention text changed. The ADR now says the data directory itself may be a link. That moves the whole store, author names included, where the person chose, and the test shows writes still land in the real folder. Retention and erasure are as stated in ADR 0024.

## Outside the change
- src/store/migrations/0001_init.sql:14 · `project_aliases` has no index on `project_id`. This is debt (advisory).

## Not answerable
- Q6 Availability · Carried: the first open's backup and drops under the write lock have not been timed on a real store that ran the withdrawn module.
- Q1 (F-1) · I reasoned the unlistable `entries/` case from the code (including the `git status` exit on an unreadable folder) and did not run it. No probe shows `rebuild` or `list` against an `entries/` at mode 000 or 300. The fixed probe also does not cover Linux or a disk fault (EIO), as it says itself.
