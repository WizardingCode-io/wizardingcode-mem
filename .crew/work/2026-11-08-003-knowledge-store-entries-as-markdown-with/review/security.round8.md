# security findings for 2026-11-08-003-knowledge-store-entries-as-markdown-with
reviewer: review-security
read: 8 files, risk areas: data-migration, personal-data

## Findings
- F-1 · advisory · src/modules/knowledge/repo.ts:245 · Carried from rounds six and seven, unchanged. The `.git` walk still skips the folders inside `objects/`, and `configArgs` still sets neither `gc.auto=0` nor `maintenance.auto=false`. A detached auto-gc started by the store's own commit could still delete files through a linked `objects/info/commit-graphs`. My reading of git's behaviour is reasoned, not run, and the harm falls outside the named risk areas.
- F-2 · advisory · src/doctor/checks.ts:739 · This widens round seven's F-2 (round six's F-6). `doctor` now runs `refuseForeign` on every name listed under `knowledge/projects/`, links and files included, and puts `${relative}: ${error.message}` into its warning. So a name someone dropped there (it can carry terminal escape sequences) now reaches doctor's output in two more cases: a link at the name, and a file at the name. `resolve.ts:118`, which runs `kindAt` on each listed name, still puts that name into a refusal on stderr. I checked this in the code. It is output hardening outside the named risk areas.
- F-3 · advisory · src/modules/knowledge/repo.ts:200 · `refuseForeign`'s `mustBe` (`catch { return; }`) and `existsOnDisk` (line 214) still treat any lstat failure as "nothing there". In a repository folder that can be listed but not searched, every layout entry passes unchecked. That goes against this commit's own rule that what cannot be seen is never taken for absent. Every caller I traced still fails closed afterwards:
  - With `create`, `resolveRepo`'s `kindAt(<folder>/knowledge.json)` (resolve.ts:268) throws EACCES before `writeManifest`.
  - Without `create`, `headOf` reads null and `openRepo` returns null. `rebuildAll` then keeps the rows, because `kindAt` on the folder says "folder".
  - In `doctor`, `kindAt(.git)` throws and becomes a warning.

  So nothing is written or read through the folder. This is hardening only.
- F-4 · advisory · src/modules/knowledge/resolve.ts:257 · There is a time-of-check gap, of the same kind the new-name path at lines 243-248 already had. A name that is listed as present and then vanishes takes this path: `refuseForeign` returns, `ensureParents` runs `mkdirSync(recursive)`, `writeManifest` runs, then `openRepo` → `createRepository` → `git init`. No second `refuseForeign` runs between the `mkdir` and git. A link put at the name inside that window would be followed. Exploiting it needs write access to the person's mode-0700 data directory at the exact moment, so it is advisory.
- F-5 · advisory · src/modules/knowledge/taxonomy.ts:24 · Round six's F-3 (round seven's F-4), still not acted on and unchanged by this commit: `taxonomyFor` has no root or foreign-folder guard of its own.
- F-6 · advisory · src/modules/knowledge/index-store.ts:549 · Round six's F-4 and F-5 (round seven's F-5), still not acted on and unchanged by this commit: a leftover lock reads as a git fault, and the intent record is read with no size cap. Both affect availability only.

## Outside the change
none

## Not answerable
- Static-analysis input · no report path was given.
- F-1 · not run. Still open:
  - Does a store commit start a detached `maintenance run --auto` on git 2.32 or 2.54 when the loose objects are past the threshold?
  - Do the two `-c` settings stop it?
- Windows · not run, as the session states:
  - `kindAt` and `namesIn` on EPERM, and whether a junction at `knowledge/projects/<name>` reads as "other" through `lstat`.
  - `headOfGitDir` on `..\` and drive-relative refs.

### This round's commit against the questions
- **Read, written or created through a link, or outside the store's folders.** Verified from the code and the patch: nothing new is.
  - `projectFolders` (resolve.ts:117) now lists links and files but never reads through them. It reads the manifest only when `kindAt` says "folder".
  - `matchProject` now takes the row's name before the manifest check. A link or a file at that name therefore reaches `resolveRepo`, where line 257 (`kindAt` is not "folder") calls `refuseForeign` and the command is refused by name. No second folder is made: the `taken` check at line 244 now uses `kindAt`, which refuses on EACCES rather than reading the name as free.
  - The one new write is `writeManifest` into a folder that a project's row names and that was emptied by hand (line 268). It runs only after `openRepo`'s first `resolveRepo(…, {})` call and `refuseForeign(found.path)` (repo.ts:811-812). It runs only when `lstat` finds no `knowledge.json` and `headOf` finds no `.git` folder with a HEAD. It writes through `writeFileAtomic` (an exclusive temp file, then a rename), so never through a link left at the name.
  - The manifest it writes holds the same aliases a new repository's manifest holds, inside the same folder under `<data dir>/knowledge/projects/`. Personal data goes nowhere new.
  - In `doctor`, every listed name passes `refuseForeign` before anything under it is read. A name it refuses goes into `unread` and is never handed to `readRepoFiles`, `readRegularFile` or `statusOf`. Round seven's F-3 (doctor read an unlistable folder as empty) is closed.
- **The earlier rounds' closures still hold.**
  - `refuseLinkedRoots` still runs first in `resolveRepo` (resolve.ts:211), `scanRepos` (resolve.ts:318) and `doctor` (checks.ts:615).
  - `refuseLinksInside`, `checkRepoConfig`, `ownPath` and `reachedByFolders` were not touched.
  - The commit adds no git call, no configuration source and no hook path.
- **data-migration.** The commit touches no migration, schema or `module-schemas.ts`. `rebuildAll` (index-store.ts:595) now deletes rows only for a name with nothing at it, so it keeps rows more often, never less. An entries or proposals folder that cannot be listed now refuses through `namesIn` in `listFolder` and `lookAt` in `readListed`, before any row is replaced. Round five's reading of migration 6, with its reason recorded in ADR 0024, stands.
- **personal-data.** The author's name gains no new write. Refusal and warning messages carry paths and errno codes, not the name.

Files:
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/modules/knowledge/resolve.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/modules/knowledge/repo.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/modules/knowledge/index-store.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/doctor/checks.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.crew/work/2026-11-08-003-knowledge-store-entries-as-markdown-with/probes/round-eight-change.patch
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.crew/work/2026-11-08-003-knowledge-store-entries-as-markdown-with/review/security.round7.md
