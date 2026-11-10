# data findings for 2026-11-08-003-knowledge-store-entries-as-markdown-with
reviewer: review-data
read: 8 files. These were the rubric, review/data.round8.md, probes/round-nine-change.patch (whole), and the probes known-limits-round-nine.md, rebuild-under-another-data-directory.md and project-folder-with-no-repository.md. In the code: src/modules/knowledge/index-store.ts:500-633, src/modules/knowledge/resolve.ts:55-304 and src/modules/knowledge/repo.ts:112-157. Migration 0006, the migration runner, every table and every index are unchanged this round. Risk areas: data-migration (personal-data unchanged).

## Findings
- F-1 · advisory · src/modules/knowledge/resolve.ts:236 · A write for a project, under a data directory with no `knowledge/` folder, still repoints that project's row and deletes its entry and proposal rows. This is the same disk state that round nine now refuses in `rebuildAll` (Rubric Q1, availability).
  - **How it happens.** `projectFolders` reads the absent root as no names (`namesIn` returns `[]` on ENOENT). So `matchProject` returns `taken: null`.
  - **Then the new folder.** The `taken` loop (:243-246) counts the row's own name as taken through `rowAt`. The write therefore makes `<name>-2` under the second data directory.
  - **Then the repoint.** `saveRow` (:66-78) runs a DELETE on the row's entries and proposals, and points the row at the new folder.
  - **Why the new refusal does not hold.** The write also creates `knowledge/` (`ensureParents`, :194). After it, `rebuild` under that directory is no longer refused, and it forgets the other rows.
  - **Effect on a path-only project.** Its tie to the first folder is lost. That folder comes back only as an orphan.
  - **What the ADR says.** ADR 0024's new limit attributes this outcome only to "a `knowledge/` folder of its own". It does not name the write path where there is no `knowledge/` folder, and nothing guards that path.
  - **Why advisory.** The files are never touched. The store is not yet reachable from a hook, tool or view, so only `knowledge write` from a shell reaches it. The case is the same class the judge held to advisory in round eight.
  - **Possible fix.** Before any `create` in `resolveRepo`, apply the same test as `rebuildAll`: `knowledge/` absent while `knowledge_repos` holds rows. Or state the write case in the known limit.
- F-2 · advisory · src/core/git.ts:68 · Carried, unchanged. A HEAD naming a ref with `..`, `\` or `:` reads as no commit, and the rows stay as last indexed (Rubric Q3, Q5).
- F-3 · advisory · src/modules/knowledge/migrations/0006_knowledge_store.sql:19 · Carried, unchanged. The `DELETE FROM meta` of the withdrawn module's keys cannot be undone. Its reason is stated at :17-18, and it runs after the pre-upgrade backup (Rubric Q1).
- F-4 · advisory · src/modules/knowledge/store.ts:302 · Carried, unchanged. `settle` takes the fingerprint after the commit. ADR 0024 states this as a known limit (Rubric Q3).
- F-5 · advisory · src/store/db.ts:75 · Carried. The one-time `VACUUM INTO` backup under the write lock has not been timed on a store that ran the withdrawn module (Rubric Q6).
- F-6 · advisory · src/modules/knowledge/resolve.ts:98 · Carried. `project_aliases` is read by `project_id`, which has no index. The read is off the hook path and the table is small (Rubric Q2).

My round-eight F-1 (`rebuild` under a data directory with no `knowledge/` folder deleted every knowledge row) is closed for `rebuild`. The check is at src/modules/knowledge/index-store.ts:597-604:
- `kindAt(knowledgeRoot)` returns `"absent"` and rows of the scope exist, so the command throws before `inEachRepo` and before the removal loop. No `saveRow`, no `rebuildRepo` DELETE and no removal DELETE runs.
- A root that cannot be looked at makes `kindAt` throw a refusal. A link or a file at the root is not `"absent"`, and `listRepos` then refuses through `refuseLinkedRoots`. Neither case reaches a DELETE.
- A data directory that is itself absent reads as an absent root, so it is refused too.
- A scope with no rows is not refused, and it has nothing to forget.
- The new test shows the refusal, that nothing is lost, and the forgetting once an empty `knowledge/` is made by hand.
- The removal loop re-reads the rows after the rebuilds, as before. Each row is still deleted only on `"absent"` at its own name.

Other paths that delete or repoint a row, checked against this commit:
- **`taxonomyFor` (repo.ts).** It now returns null where a link or a file is at the root's name. A project's entries are then indexed against no taxonomy. That changes only their `problem` field, the root is refused by name in the same run, and no row is lost.
- **`isDirectory`.** It is now module-private, and its behaviour is unchanged.
- **One disk state beyond F-1.** `knowledge/` is present but `knowledge/projects/` is absent (removed whole, or a second data directory holding only the workspace). There, `rebuild` forgets every project row. This sits inside the new known limit ("a `knowledge/` folder of its own") and the rule that only a name with nothing at it is gone. I note it only because the new refusal guards the top folder and not `projects/`.

Personal data: no column, table, retention or erasure text changed this round.

## Outside the change
- src/store/migrations/0001_init.sql:14 · `project_aliases` has no index on `project_id`. This is debt (advisory).

## Not answerable
- Q1 (F-1) · I reasoned the write under a data directory with no `knowledge/` folder from the code and did not run it. Probe (a) in known-limits-round-nine.md runs the same repoint to `-2`, but with an empty `knowledge/` folder present, and against one process and one database handle.
- Q1 · The probes and tests cover macOS only. Linux, Windows and a real two-process install with `WIZARDINGCODE_MEM_STORE_DIR` set were not run.
- Q6 Availability · Carried: the first open's backup and drops under the write lock have not been timed on a real store that ran the withdrawn module.
