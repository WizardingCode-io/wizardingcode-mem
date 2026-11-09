# architecture findings for 2026-11-08-003-knowledge-store-entries-as-markdown-with
reviewer: review-architecture
read: the rubric; my round-eight findings (review/architecture.round8.md); probes/round-nine-change.patch in full (one commit, 7 files: CLAUDE.md, ADR 0024, index-store.ts, repo.ts, three test files); probes known-limits-round-nine.md and rebuild-under-another-data-directory.md. For the code as it stands: repo.ts:95-233 (lookAt, kindAt, namesIn, refuseLinkedRoots, isDirectory, existsOnDisk, refuseForeign), :253-282 (refuseLinksInside), :593-608 (checkRepoConfig), :705-854 (taxonomyFor, createRepository, openRepo, ensureRepo, headOf), :999-1006 (reachedByFolders); resolve.ts:140-272 (matchProject, resolveRepo); taxonomy.ts:1-70; store.ts:185-205. I grepped every remaining isDirectory/existsOnDisk/headOf/refuseForeign/taxonomyFor call under src/, and ADR 0024:88-96 and :183. The rest of the 45-file diff is as round eight reviewed it.

## Findings
- F-1 · advisory · docs/adr/0024-knowledge-module.md:92 · The new fourth bullet sits under the lead-in at :88, "Where the store decides whether a repository is there … four things are never read as nothing". After the bullets the ADR says "In each case the index rows stay as they were", and that before these rules "a write gave the project a second, empty folder". The code keeps the fourth case only in `rebuildAll` (index-store.ts:101-108). A write does not keep it.
  - A write under a data directory with no `knowledge/` folder, while the index holds repositories, goes ensureRepo → resolveRepo (resolve.ts:211-254).
  - `refuseLinkedRoots` lets an absent root through. `projectFolders` finds nothing, so `matchProject` falls through to "no folder".
  - `ensureParents` creates `knowledge/`. The project gets `<name>-2`, because its own row holds `<name>` (resolve.ts:243-246). `saveRow` then moves the project's row to the new folder.
  - The folder now exists, so the next `rebuild` there is no longer refused, and it forgets the first data directory's rows. For a path-only project, the first folder is then an orphan for good (the first known limit).
  - probes/known-limits-round-nine.md (a) shows the same write behaviour when the second directory has an empty `knowledge/`.
  - The known limit at :183 names the write only for "where the second data directory has a `knowledge/` folder of its own". The no-folder case, which the bullet calls covered, has the same write.
  - CLAUDE.md is accurate here: it says only that "`rebuild` refuses".

  This is the same pattern as round eight's F-1: the document says more than the code does (rubric Q5/Q6). The setup is declared unsupported, so I keep it advisory. Fix, either way:
  - word :88/:92 so the fourth case is `rebuild`'s alone, and add to the known limit at :183 that a write in this state makes `knowledge/` and moves the project's row; or
  - give `resolveRepo` the same guard when `create` is set: refuse where `kindAt(knowledgeRoot) === "absent"` and `knowledge_repos` holds rows. The first write on a fresh data directory has no rows, so it is unaffected.
- F-2 · advisory · src/modules/knowledge/taxonomy.ts:26 · `taxonomyFor` now returns null when a link or a file is at the root's name (repo.ts:715). The exported `readTaxonomy` turns that null into "missing: there is no workspace knowledge repository yet". So this one reader reports a link as "no repository", where ADR 0024:90 says a link at a repository's name is refused by name. The only caller today is `change` (taxonomy.ts:66-68), which runs `ensureRepo` first, and `openRepo` there refuses the link by name. No current path is affected. A later part (an MCP tool, the viewer) that calls `readTaxonomy` directly would get the wrong answer. Fix: have `readTaxonomy` call `refuseForeign` on the root folder when `kindAt` is "other", or say in its doc comment that it is to be called only after the root has been opened.
- F-3 · advisory · src/modules/knowledge/repo.ts:29 · Carried, unchanged: the function-level import cycles repo.ts↔resolve.ts and repo.ts↔author.ts. This round adds no edge (index-store.ts already imported from repo.ts).
- F-4 · advisory · .crew/work/2026-11-08-003-knowledge-store-entries-as-markdown-with/spec.md:130 · Carried: the spec's Design is not amended for the row-first rule, nor now for the index belonging to one data directory. ADR 0024:3 declares itself the later text, so no boundary is crossed.

What the caller asked me to check, beyond the findings:
- Round eight's F-1 is closed. CLAUDE.md:22 and ADR 0024:88/:94 now name the places that ask with `lookAt`/`kindAt`/`namesIn`: the two roots, a repository's name, `entries/`, `proposals/` and the names in them. They say `isDirectory`/`existsOnDisk` remain only inside a repository, behind a refusal. I checked every remaining call:
  - refuseForeign:222/226 runs only after a `kindAt` in resolveRepo, or on a folder resolveRepo listed with `kindAt`/`namesIn`. checks.ts:734 is under the doctor's own `kindAt` listing.
  - headOf:853 in openRepo:829 runs after refuseForeign → refuseLinksInside, which refuses an unlistable `.git` and so an unsearchable repository folder. At resolve.ts:268 the same ordering holds through openRepo:824.
  - checkRepoConfig:598, createRepository:734/744, reachedByFolders:1003, the intent record:1189 and adopt at store.ts:792 are all inside an opened repository.
  - `isDirectory` is no longer exported (repo.ts:175).
  - The wording matches the code.
- Round eight's F-2 is closed as documented. The fixed scopes' manifest rewrite (resolve.ts:222) against the project's `headOf` guard (:268) is now a known limit (ADR 0024:183 block, "The workspace's and the shared repository's manifest …"). It says the difference has no reason of its own, and probe (b) confirms ` M knowledge.json` is left uncommitted. Stating the difference instead of changing it is within the ADR's authority.
- The `rebuildAll` refusal (index-store.ts:89-108) fits the base:
  - It throws `KnowledgeError("invalid")` before `inEachRepo`, so the whole command is refused and nothing is forgotten. That matches ADR :92 for `rebuild`.
  - It respects the `scope` filter: a scope with no rows is not refused, which is tested.
  - It names both remedies, including the two environment variables of ADR 0010.
  - No table, column, error code or exported type changed shape.
- The `taxonomyFor` change (repo.ts:712-727) matches ADR :94: no taxonomy is read through a link at the root's name, and the root is refused by name in the same run. See F-2 for the one reader that does not open the root first.

## Outside the change
- src/core/git.ts:111 · readGitInfo, the hooks' reader, still follows any `ref:` in HEAD. It predates this item. Debt, carried.
- ui/src/api.ts:92 · The viewer's SettingKey type omits WIZARDINGCODE_MODULES and WIZARDINGCODE_MEM_AUTHOR. Debt, carried.
- docs/adr/0019-one-engine.md:38 · Ruling F2 and "Not in this ADR" still read as open, with no forward reference to ADR 0024. Debt, carried.
- docs/adr/0010-settings-storage-and-backups.md:9 · ADR 0010 still uses the retired `SHIBAOX_*` names. ADR 0024 and the new rebuild message now send readers to `WIZARDINGCODE_MEM_DATA_DIR`/`WIZARDINGCODE_HOME`, which that ADR describes under the old names. Debt, carried.

## Not answerable
- Contracts (rubric Q3) for the later parts' MCP tools and viewer routes · Part 1 defines no route, tool or event payload. There is no contract file to check `readTaxonomy`, `KnowledgeStore`, `InEachRepo` or `Writer` against, beyond spec.md, the plan and ADR 0024.
- Two real processes sharing one store directory (`WIZARDINGCODE_MEM_STORE_DIR`) · The probes use one process and one database handle with two stores, so I could not see the write behaviour in F-1 under a real install. It follows from reading resolve.ts:236-254.
- Windows behaviour of `lookAt`/`namesIn` and of the new refusal's `kindAt(root)` · Windows was not run.
