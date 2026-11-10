# security findings for 2026-11-08-003-knowledge-store-entries-as-markdown-with
reviewer: review-security
read: 13 files, risk areas: data-migration, personal-data

## Findings
- F-1 · advisory · src/modules/knowledge/repo.ts:205 · Carried from round five's F-3, with a sharper path. The walk records the kind of each entry directly under `objects/` but does not go into `objects/info`, so `objects/info/commit-graphs` can be a link to a folder of the person's. A dropper can add about 28 regular files to `objects/17`, which passes every check and trips git's auto-gc estimate. The store's own `git commit` then starts `git maintenance run --auto` (detached on recent git). Its non-split commit-graph write runs `expire_commit_graphs`, which unlinks `commit-graph-chain` and every older `*.graph` file in that folder, so through the link it deletes files in the person's folder, and the process outlives `runGit`'s timeout and the lease. What I verified from code: the folder is not walked (repo.ts:205), and `configArgs` (repo.ts:350-375) sets neither `gc.auto` nor `maintenance.auto`. What I reasoned and did not run: git's gc and commit-graph behaviour. This contradicts ADR 0024's "not a way to write" for that folder. The fix costs nothing per open, unlike the 4-8 ms listing: add `-c gc.auto=0 -c maintenance.auto=false`. They reach child processes through GIT_CONFIG_PARAMETERS. Personal data is not exposed, and the harm is outside the named risk areas, so this is advisory.
- F-2 · advisory · src/core/git.ts:63 · `headOfGitDir` splits the ref on `/` only. On Windows, a binary the store ships but never ran there, `ref: refs/..\..\..\outside` passes the rule (parts `refs`, `..\..\..\outside`), and `join` then resolves it out of `.git`. That brings back round five's F-4 on that platform: an outside file is probed for "holds a hash", read with no size cap, or a reserved device name blocks the read. git's own refname rules refuse `\` and `:`. Refuse them here too. On POSIX the rule holds: every part is under `refs/`, and the walk (repo.ts:189-217) refuses any link in `refs/`. Both verified from code; the Windows `join` behaviour is reasoned. The effect is availability and probing only.
- F-3 · advisory · src/modules/knowledge/taxonomy.ts:24 · The exported `readTaxonomy` reaches `taxonomyFor` (repo.ts:645) with no `refuseLinkedRoots` and no `refuseForeign`. `readRegularFile` checks only the last path component, so with `knowledge/` linked it would read `<link target>/workspace/taxonomy.md`. Today its only caller is `change()`, after `ensureRepo` has run both checks (verified from code), so nothing reaches it now. A later part's reader would. Put the guard in `taxonomyFor` itself or in `readTaxonomy`.
- F-4 · advisory · src/modules/knowledge/index-store.ts:337 · Carried from round five's F-5. A leftover `index.lock`, `MERGE_HEAD`, or a folder at `COMMIT_EDITMSG` fails as code `git`, so `inEachRepo` stops the command for every repository. Availability only; not acted on.
- F-5 · advisory · src/modules/knowledge/repo.ts:1068 · Carried from round five's F-6. A dropped intent record is read whole into memory before it is rejected (`NO_CAP`). Availability only; not acted on.
- F-6 · advisory · src/modules/knowledge/repo.ts:209 · Carried from round five's F-7. Refusal messages still include a dropped name raw: the new "cannot be listed" message (:199) and the link/not-a-file message (:211) both put `${path}` built from `entry.name` on stderr, so a dropper can send terminal escape sequences. Verified in the round-six patch. Hardening outside the risk areas.

## Outside the change
none

## Not answerable
- Static-analysis input · no report path was given.
- F-1 · not run, on git 2.32 and 2.54:
  - Does `git commit` with 28 extra files in `objects/17` start `git maintenance run --auto` detached?
  - Does its gc's commit-graph write unlink `commit-graph-chain` and `*.graph` files inside a linked `objects/info/commit-graphs`?
  - Do `-c gc.auto=0 -c maintenance.auto=false` stop it?
- F-2 · not run on Windows: does `headOf` return a value for `ref: refs/..\..\..\<file holding a hash>`?
- Bun's `readdirSync(withFileTypes)` on a file system that reports `DT_UNKNOWN` · not run: does every entry read as neither file nor folder, which refuses good repositories (fails closed), or is the kind resolved by `lstat`?
- `rsync -a` (which includes `--specials`) carrying a dead socket named `fsmonitor--daemon.ipc` · not run. I reasoned it is harmless: see below.

Round five's defects against the current code:
- **Round five's F-1 (a folder that cannot be listed):** closed. I verified from code (repo.ts:193-201) that `readdirSync` errors return only on ENOENT, and every other error throws `invalid`. probes/security-round-six.md shows both cases (mode 0300 on `.git`, mode 0100 on `logs`) refused, with the person's file untouched.
  - The ENOENT exception opens nothing. At the top it means there is no `.git`, and `createRepository` then runs a fresh `git init`. Below the top it is a folder that was listed as a real folder and then vanished, which needs a live process. ENOTDIR, EACCES and ELOOP all refuse.
- **Round five's F-2 (folders above a repository):** closed. I verified from code that `refuseLinkedRoots` (repo.ts:82-92) checks `knowledge/` and `knowledge/projects/` with `lstat`. It runs first in `resolveRepo` (resolve.ts:204) and `scanRepos` (resolve.ts:287), and in the doctor before any listing (checks.ts:610, turned into a warning at :828-837). Every other path reaches one of these first:
  - the CLI's `write`, `accept` and `reject`, through `openRepo` and `resolveRepo`
  - `area add` and `area rename`, through `ensureRepo`
  - `area remove`, through `listRepos` or `ensureRepo`
  - `rebuild`, `adopt` and `list`, through `inEachRepo` and `listRepos`
  - `taxonomyFor` from `store.ts` and `index-store.ts`, which runs only after `openRepo`
  - Leases are database rows (repo.ts:1311-1344), so nothing is written under `knowledge/` before the check.

  Every level is now checked with `lstat`: `knowledge`, `projects`, the repository folder (`mustBe`), the layout entries (`OWN_LAYOUT`), and every entry of `.git` except the contents of `objects/`'s folders. Only `objects/` (F-1) and a live-process race remain.
- **The socket exception:** I verified from code that it applies only at the top of `.git`, only to that exact name, and only when the entry is a socket. A link or a FIFO with that name is refused. What I reasoned and did not run: `open()` on a socket fails with ENXIO, and every store git call passes `core.fsmonitor=false` (repo.ts:356), so git never reaches it. tar does not carry sockets; `rsync -a` can, but only as a dead socket. It opens no write or read path.
- **headOfGitDir:** on POSIX it reads only under `.git/refs` or `packed-refs`, both walked (verified). Windows is open (F-2).

Round five's class conclusion, tested against the code as it stands: it holds, with one change. The round-six diff adds no git call, no configuration source and no file that git reads, and nothing between `refuseForeign` and the git calls creates a link. I still found no way for dropped content to run a program; gc's hooks are pointed at a file. The detached gc is not a program the dropper chooses, but it is the one write-capable process that outlives the check window (F-1). Hard links: round five's reasoning stands, and ADR 0024 now records it.

data-migration: the round-six patch touches no migration or schema file (verified from the patch). Round five's reading stands: migration 6's `DELETE FROM meta` runs after the pre-upgrade backup, with its reason stated.

personal-data: the name goes into commits, entries and the index with a `.invalid` email, as before. The CLI now prints each repository's lines as it goes, to the same terminal as before, so the audience is unchanged. I found no remaining path that writes the name outside `<data dir>/knowledge/`. One exception is reasoned only: F-1's gc deletes files outside the data directory but writes no name there.

Files:
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/modules/knowledge/repo.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/modules/knowledge/resolve.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/modules/knowledge/taxonomy.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/modules/knowledge/index-store.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/core/git.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/doctor/checks.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/cli/commands/knowledge.ts
