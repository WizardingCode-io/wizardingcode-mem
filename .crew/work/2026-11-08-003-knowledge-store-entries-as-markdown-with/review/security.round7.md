# security findings for 2026-11-08-003-knowledge-store-entries-as-markdown-with
reviewer: review-security
read: 9 files, risk areas: data-migration, personal-data

## Findings
- F-1 · advisory · src/modules/knowledge/repo.ts:229 · Carried from round six, unchanged. The walk still does not go into `objects/`'s folders, and `configArgs` still sets neither `gc.auto=0` nor `maintenance.auto=false`. A dropper who links `objects/info/commit-graphs` and adds loose files to `objects/17` may still get a detached gc started by the store's own commit, which would delete graph files through the link. I verified from code that both settings are absent (grep finds neither in src/modules/knowledge). probes/auto-gc.md did not reproduce the gc on git 2.54.0, but by its own account it shows nothing about why. My reading of git's source is still reasoned, not run. The harm is outside the named risk areas, so this stays advisory.
- F-2 · advisory · src/modules/knowledge/resolve.ts:118 · New instance of round six's F-6. `kindAt` on `projects/<name>` now throws a refusal that puts the dropped `name` raw on stderr, through `unseen` (repo.ts `${path} cannot be looked at (${code})`). A dropper can reach that message whenever `projects/` is listable but not searchable (mode 0600, the case the new test uses), and it carries terminal escape sequences. The `${code}` part is Node's errno string, which is harmless. Verified from code. This is hardening outside the risk areas.
- F-3 · advisory · src/doctor/checks.ts:589 · The doctor's own `projectFolders` and `foldersByHand` still read an unlistable or unsearchable folder as empty (`catch { return [] }`, and `isDirectory`, which returns false on any error). So `doctor` reports fewer repositories, and says nothing about them, in exactly the state that `rebuild` now refuses. The doctor writes nothing, so no index row is lost, and personal data is not exposed. It goes against the project's rule that the doctor be given each guard `openRepo` gains. Verified from code.
- F-4 · advisory · src/modules/knowledge/taxonomy.ts:24 · Round six's F-3, not acted on. `readTaxonomy` → `taxonomyFor` has no `refuseLinkedRoots` or `refuseForeign` of its own, and its only caller still reaches it after `ensureRepo` (verified).
- F-5 · advisory · src/modules/knowledge/index-store.ts:565 · Round six's F-4 and F-5, not acted on. A leftover lock file stops the command as a `git` fault, and a dropped intent record is read with no cap. Both are about availability only.

## Outside the change
none

## Not answerable
- Static-analysis input · no report path was given.
- F-1 · not run:
  - git 2.32, and git 2.54 with real loose objects past the threshold and a longer wait: does the store's commit start a detached `maintenance run --auto`?
  - Does that run's commit-graph write unlink files through a linked `objects/info/commit-graphs`?
  - Do `-c gc.auto=0 -c maintenance.auto=false` stop it?
- `headOfGitDir` on Windows · not run: does `ref: refs/heads/..\x` and a drive-relative `refs/heads/C:x` now read as null? The unit test covers both strings, but only on POSIX.
- `kindAt` / `namesIn` on errors other than EACCES (EIO, ELOOP on a deep intermediate, Windows EPERM) · not run. From the code I reasoned that every one of them refuses, since only ENOENT and ENOTDIR read as absent.

### Round six's conclusions against the code as it stands
- **The two round-five defects stay closed.** I verified this from code.
  - Unlistable folders: `refuseLinksInside` (repo.ts:233-242) still returns only on ENOENT and refuses everything else, now naming the errno.
  - Folders above a repository: `refuseLinkedRoots` (repo.ts:119-130) still runs first in `resolveRepo` (resolve.ts:204), `scanRepos` (resolve.ts:287) and the doctor (checks.ts:610). It now uses `kindAt`. A link or a file reads as "other" and is refused. A root that cannot be looked at throws through `unseen`. Only ENOENT and ENOTDIR read as absent.
  - ENOTDIR as "absent" opens nothing. For `knowledge/`, it means the data directory is not a folder, and `mkdirSync` then fails. For `knowledge/projects/`, the parent has just been checked to be a folder. In `rebuildAll`'s loop (index-store.ts:594), the ancestors (`knowledge`, `projects`) have been checked by `inEachRepo` → `listRepos` → `scanRepos` before the loop runs. A row is forgotten only when its folder is truly absent, or is a link or a file, as before.
- **Round six's F-2 is closed** (verified from code, git.ts:67-70). Every part must be non-empty, not `.` or `..`, and free of `\` and `:`, under a first part `refs`. The Windows path resolution is reasoned, not run.
- **The new throws from `kindAt` and `namesIn`.** Where the code used to answer a silent "absent", it now refuses with code `invalid`. That fails closed: the command stops, or `inEachRepo` sets aside the one repository and its rows stay. I found no caller where a refusal leads to a write. `resolveRepo` refuses before `ensureParents`, and `rebuildAll` throws before its DELETE loop (`listRepos` runs first), or during the loop before that row's DELETE. Rows deleted earlier in the loop were for folders that were truly absent. Verified from code.
- **The errno in refusal messages.** The message carries Node's code string and the store's own path. The only content a dropper controls is a file name, which is F-2 above and round six's F-6. Verified from code.
- **A data directory that is a link.** Only the person controls it, through `WIZARDINGCODE_HOME` or a link where the data directory sits, which needs write access to the person's own home. Every check is still made under the data directory with `lstat`. A link inside it (`knowledge`, `projects`, a repository folder, the layout entries, `.git` entries) is still refused. No other caller gains a path, so I found nothing it opens. Reasoned from code and from the new test.
- **The class conclusion holds.** I still found no way for dropped content to run a program. The round-seven commit adds no git call, configuration source, hook path or file git reads (verified from the patch). The detached gc (F-1) is still the one reasoned exception, and it deletes files: it does not run a program the dropper chooses.
- **data-migration.** The round-seven commit touches no migration, schema or `module-schemas.ts` (verified from the patch). Round five's reading stands: migration 6's `DELETE FROM meta` runs after the pre-upgrade backup, and its reason is stated. Version 6 has no reversal, and the reason is recorded in ADR 0024. `rebuildAll` keeps rows more often than before, never less often, and the index can be rebuilt from the files.
- **personal-data.** The commit adds no write of the author's name. The name still goes only into commits, entries and the index, with a `.invalid` email. With a linked data directory it lands where the person put their data directory, which by ADR 0024 is the data directory itself. I found no path that writes the name outside `<data dir>/knowledge/` (verified for the commit). The refusal messages carry paths, not the name.

Files:
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/modules/knowledge/repo.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/modules/knowledge/resolve.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/modules/knowledge/index-store.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/modules/knowledge/errors.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/core/git.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/doctor/checks.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.crew/work/2026-11-08-003-knowledge-store-entries-as-markdown-with/probes/round-seven-change.patch
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.crew/work/2026-11-08-003-knowledge-store-entries-as-markdown-with/probes/auto-gc.md
