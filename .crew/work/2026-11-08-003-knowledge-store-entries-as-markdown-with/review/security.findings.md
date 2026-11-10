# security findings for 2026-11-08-003-knowledge-store-entries-as-markdown-with
reviewer: review-security
read: 11 files, risk areas: data-migration, personal-data

## Findings
- F-1 · advisory · src/modules/knowledge/repo.ts:253 · Carried from rounds six to eight and still open: the `.git` walk skips the folders inside `objects/`, and `configArgs` sets neither `gc.auto=0` nor `maintenance.auto=false`. A detached auto-gc started by the store's own commit could delete files through a linked `objects/info/commit-graphs`. My reading of git here is reasoned, not run, and the harm falls outside the named risk areas.
- F-2 · advisory · src/doctor/checks.ts:739 · Carried from round eight: a name someone dropped under `knowledge/projects/` (which can carry terminal escape sequences) still reaches doctor's warnings and `resolve.ts`'s refusals on stderr without being escaped. This is output hardening outside the risk areas.
- F-3 · advisory · src/modules/knowledge/repo.ts:211 · Carried from round eight: `refuseForeign`'s `mustBe` (`catch { return; }`) and `existsOnDisk` still treat any lstat failure as "nothing there". This round's comments now state that limit (lines 170-186, and ADR 0024), and `isDirectory` is no longer exported. Every caller I traced still fails closed later (`kindAt` in `resolveRepo`, `headOf` returning null, `kindAt(.git)` in doctor), so this is hardening only.
- F-4 · advisory · src/modules/knowledge/resolve.ts:257 · Carried from round eight: between `refuseForeign` and `mkdirSync`/`git init` on a name that vanishes, no second check runs. Using it needs write access to the person's 0700 data directory at that exact moment.
- F-5 · advisory · src/modules/knowledge/repo.ts:715 · New with this round's guard, and of the same kind as F-4: `taxonomyFor` checks the root folder with `kindAt`, then reads `<folder>/taxonomy.md` by path. `readRegularFile` refuses a link only at the last component, so a link swapped in at the root's name between the two calls would be followed for this one read. It is read only, the file is capped, and it needs write access to the 0700 data directory at that moment.
- F-6 · advisory · src/modules/knowledge/index-store.ts:549 · Carried from rounds six to eight: a leftover lock reads as a git fault, and the intent record is read with no size cap. Both affect availability only.
- F-7 · advisory · src/modules/knowledge/index-store.ts:599 · data-migration, the reason is stated: the new refusal covers only a data directory with no `knowledge/` folder. Where two data directories share one database and the second has its own `knowledge/`, `rebuild` there still deletes the first's rows, and a path-only project then comes back only as an orphan (`known-limits-round-nine.md` (a)). ADR 0024 "Known limits" states this limit and its reason, the files are never touched, and the index can be rebuilt from them. This is a limit with a stated reason, not a destructive step without one.

## Outside the change
none

## Not answerable
- Static-analysis input · no report path was given.
- F-1 · not run. Two questions stay open: does a store commit start a detached `maintenance run --auto` on git 2.32 or 2.54 once loose objects pass the threshold, and would `-c gc.auto=0 -c maintenance.auto=false` stop it?
- Windows · not run, as the session states. Open: `kindAt` and `namesIn` on EPERM (now also on `taxonomyFor`'s new check and `rebuildAll`'s new `kindAt(root)`); whether a junction at a root's or a project's name reads as "other" through `lstat`; `headOfGitDir` on `..\` and drive-relative refs.
- The two-data-directory cases · the probes use one process with two stores, not two real processes with `WIZARDINGCODE_MEM_STORE_DIR` set.

### This round's commit against the questions
- **Round eight's F-5 is closed** (`taxonomyFor` had no guard of its own). `taxonomyFor` (repo.ts:712-718) now returns null unless `kindAt` finds a real folder at the root's name, and it refuses (does not read the name as absent) when the name cannot be looked at. The callers that can be reached:
  - The write path (`store.ts:198`) turns null into `missing`, and `ensureRepo` → `openRepo` → `refuseForeign` has already refused the link at the root.
  - `readTaxonomy` (taxonomy.ts:26) turns null into `missing`.
  - Rebuild and doctor go through `taxonomyOrNull` and check the entries against no taxonomy, while the root is refused by name in the same run.
  - Nothing is read through the link. Mutant 6 in `round-nine-mutations.md` is killed by the doctor test and by the rebuild test.
- **The `rebuildAll` refusal (index-store.ts:597-604)** runs before `inEachRepo` and before any DELETE.
  - It counts rows by the scope asked for, so a scope with no rows is not refused.
  - It uses `kindAt`: a root that cannot be looked at throws (fails closed), and a link at the root is still caught by `refuseLinkedRoots` in `listRepos`.
  - The deletion loop is unchanged: it still deletes only rows whose name has nothing at it.
  - Mutants 3 to 5 are killed. `rebuild-under-another-data-directory.md` showed every row lost before this change; the new test shows the rows kept.
- **The earlier closures still hold.** Making `isDirectory` file-private changes no caller's behaviour. The commit does not touch `refuseLinkedRoots`, `refuseForeign`, `refuseLinksInside`, `checkRepoConfig`, `ownPath`, `reachedByFolders` or the git runner. It adds no git call, no configuration source and no hook path.
- **data-migration.** The commit touches no migration, schema or `module-schemas.ts`. `rebuild` now keeps rows in one more case and never forgets more than before.
- **personal-data.** The author's name gains no new write, log line or output. The new refusal message holds a path and a count, not the name. The test fixture's author "Zoë" is not a credential.

Files:
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/modules/knowledge/repo.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/modules/knowledge/index-store.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/modules/knowledge/taxonomy.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/modules/knowledge/store.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/doctor/checks.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.crew/work/2026-11-08-003-knowledge-store-entries-as-markdown-with/probes/round-nine-change.patch
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.crew/work/2026-11-08-003-knowledge-store-entries-as-markdown-with/probes/round-nine-mutations.md
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.crew/work/2026-11-08-003-knowledge-store-entries-as-markdown-with/probes/rebuild-under-another-data-directory.md
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.crew/work/2026-11-08-003-knowledge-store-entries-as-markdown-with/probes/known-limits-round-nine.md
