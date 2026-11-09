# security findings for 2026-11-08-003-knowledge-store-entries-as-markdown-with
reviewer: review-security
read: 9 files, risk areas: data-migration, personal-data

## Findings
- F-1 · defect · src/modules/knowledge/repo.ts:168 · `refuseLinksInside` lets the repository through whenever it cannot read a folder. `readdirSync` throws, `catch { return; }` swallows it, and nothing under that folder is checked. **Who:** the dropper. **With what:** a `.git` carried with mode 0300 (write and search, no read) holding round four's links: `COMMIT_EDITMSG` → `~/.zshrc`, or `objects` and `refs` linked into another repository. A simpler variant needs only `.git/logs` at 0100 holding `HEAD` → a file of the dropper's choosing. **What they get:** every round-four outcome again. git writes the commit message into the person's file, appends a reflog line with the person's name (author.ts) to the chosen file, or commits onto another repository's branch. git does not need to list `.git` to do any of this, and the check before it never sees the links. An archive or a sync carries a folder's mode just as it carries a link, so this is inside the dropper model. **Verified from code:** the swallow (repo.ts:166-170); nothing else lists `.git` before git runs (`mustBe` and `checkRepoConfig` only `lstat` or open paths by name, which works with search permission alone). **Reasoned, not run:** git commits normally with `.git` at 0300. **Fix:** fail closed. Any readdir error other than ENOENT refuses the repository, as `readRegularFile` already does for `config`.
- F-2 · defect · src/modules/knowledge/resolve.ts:232 · The folders above a repository are never checked: only the repository folder's last component is `lstat`ed. **Who:** the dropper. **With what:** a link at `<data dir>/knowledge/projects` (directly under `knowledge/`) pointing to any folder X. **What they get:** every project repository the store creates afterwards is made inside X. That means its manifest, its entries (`author`, `decided_by`) and commits carrying the person's name, in a folder outside the data directory that the dropper chose, for example one that is synced or shared. This is personal data written outside the store, the same harm as round four's reflog variant. `projectFolders` also reads X's subfolders as project repositories. **Verified from code:**
  - `openRepo` calls `refuseForeign` only when `found` is non-null (repo.ts:721-722), and a new project has none.
  - `resolveRepo`'s `taken` (resolve.ts:228-231) and `ensureParents`' recursive `mkdirSync` (resolve.ts:185-188) follow the link.
  - `createRepository` then runs `git init` there (repo.ts:631-634).
  - `knowledge/workspace` as a link is refused and tested (knowledge-repo.test.ts:1505); `knowledge/projects` as a link is neither refused nor tested.
  
  `<data dir>/knowledge` as a link redirects every repository the same way. **Fix:** refuse a link at `knowledge/` and `knowledge/projects/` (`lstat` each parent) before listing or creating.
- F-3 · advisory · src/modules/knowledge/repo.ts:174 · The walk does not list the files inside `objects/pack`, `objects/info` or the fan-out folders. A link there is not a write path (git creates objects with mkstemp and renames them; reasoned). It is, though, a read path into another repository: `pack-*.pack`/`.idx` or a loose object linked to another repository's. ADR 0024 refuses `objects/info/alternates` for exactly that reason. Two more effects:
  - git "freshens" an existing loose object with `utime` through the link, touching an outside file's mtime.
  - `objects/info/commit-graphs` can be a linked folder.
  
  `git commit` also starts `git maintenance run --auto`, and gc in its default detached mode. Dropping about 28 hex-named files in `objects/17` is enough to trigger it. That process outlives `runGit`'s 15 s kill and the lease, and its repack copies linked objects into the repository's own pack. Nothing leaves the machine in this part, but the sync (ADR 0026) would push those objects. Close it before then: walk those folders too (cheap), and pass `-c maintenance.auto=false -c gc.auto=0`. Reasoned, not run.
- F-4 · advisory · src/core/git.ts:61 · `headOfGitDir` (added by this diff) joins HEAD's `ref:` text onto the git directory unchecked. `ref: ../../../../../../dev/zero` makes `readFileSync` read without end on every `openRepo`, `list` and `doctor`; `/dev/tty` blocks. Any outside file can be probed for "holds a hash". This runs before git and after `refuseForeign`, which never reads HEAD's content. The effect is availability only. Verified from code; the unbounded read on a character device is reasoned. **Fix:** accept only `refs/...` names with no `..` and read them with `readRegularFile`.
- F-5 · advisory · src/modules/knowledge/index-store.ts:337 · Several dropped states make git fail with code `git`, not with a refusal:
  - a leftover `index.lock` or `refs/heads/main.lock`
  - `MERGE_HEAD` or `CHERRY_PICK_HEAD` (git refuses a partial commit)
  - a folder at `COMMIT_EDITMSG`, `logs/HEAD` or `index`
  
  `inEachRepo` rethrows anything that is not a refusal, so `rebuild` and `adopt` stop for every repository, and so does `list` when `ensureFresh` runs git. `runGit`'s own SIGKILL at the timeout can leave an `index.lock` behind with no dropper at all. The effect is availability only. Reasoned.
- F-6 · advisory · src/modules/knowledge/repo.ts:1068 · With `NO_CAP`, a dropped multi-gigabyte `wizardingcode-op.json` is read whole into memory on every open before it is rejected. The `catch` contains the failure, so the effect is availability (memory) only. Verified from code. A cap that is checked before the read and set far above the size an adopt can reach (or derived from the kept files' sizes) would keep round four's fix.
- F-7 · advisory · src/cli/commands/knowledge.ts:142 · The adopt commit message now replaces control characters. Refusal messages and `problem` lines, however, print dropped file names raw to stderr and stdout: a `.git/<ESC]…>` link name or an entry name. That lets a dropper send terminal escape sequences. This is hardening outside the named risk areas.

## Outside the change
none

## Not answerable
- Static-analysis input · no report path was given.
- Q1, F-1 · not run: with `chmod 0300 .git` and `.git/COMMIT_EDITMSG` → a victim file, or with `chmod 0100 .git/logs` and `logs/HEAD` → a victim file, does `writeEntry` on git 2.32 to 2.54 succeed and write through the link?
- Q1/Q4, F-2 · not run: with `knowledge/projects` → an outside folder and no project repository yet, does `writeEntry` for a project create `<outside>/<hash>/` holding the entry and a commit authored with the person's name?
- Q1, F-3 · not run:
  - does `git commit` with 28 files in `objects/17` start a detached gc on 2.54?
  - which commit-graph paths does that gc write?
  - does `git cat-file` resolve an object through a pack linked into `objects/pack`?
- Q1, F-4 · not run: does Bun's `readFileSync` on `/dev/zero` grow without end, rather than fail?
- Bun's `readdirSync(withFileTypes)` on a file system that reports `DT_UNKNOWN`: does every entry then read as "not a regular file" (failing closed, so refusing good repositories) or is it resolved by `lstat`?

Round four checked against the current code:
- **R4 F-1 and F-2 (links in .git):** closed for a readable `.git`. Verified from code (repo.ts:152, 162-184) and by probes/security-round-five.md. They are reopened by F-1 above through mode bits.
- **R4 F-3 (`dropKept`):** closed. It now passes `recursive` (repo.ts:1163), and `KEPT_NAME` admits no `/`. A folder at that name with mode 0300 still makes `rmSync` throw a non-KnowledgeError, which is the F-5 class (availability).
- **R4 F-4 (rows of a refused repository):** unchanged in code. ADR 0024 now states it under Erasure. It stays advisory, and must be resolved before any reader exposes the index to an agent.

Reasoned answers to the class questions:
- **Hard links:** an archive or a sync can only link members to each other, so reaching an outside file takes a local process of the person's own user, which could write the file directly. That is outside the dropper model. Inside the repository, `COMMIT_EDITMSG` or `logs/HEAD` hard-linked to `.git/config` changes the config after `checkRepoConfig`. The message's first line (`knowledge: …`) and a reflog line (a hex id followed by a space) are both bad config lines to git, so later calls die and the next open refuses. No setting can be formed.
- **No program can be run from:**
  - `info/attributes` and work-tree `.gitattributes`: no driver can be configured, and with HOME unset there is no XDG attributes or ignore file.
  - `.gitignore` and `info/exclude`: they only hide files from `adopt`.
  - `shallow`, `info/grafts`, `refs/replace/*`, `packed-refs`, `index` (fsmonitor and the untracked cache are pinned off) and the commit-graph: these change what git believes about history or the tree inside the repository, nothing outside it.
  
  git's own refname checks keep a symbolic ref in HEAD from escaping. The store's `headOfGitDir` does not (F-4).
- **Check-then-use window:** none without a live process. Nothing between `refuseForeign` and the git calls creates a link, and the detached gc of F-3 creates none.
- **data-migration:** untouched since round four, so the round-four reading stands. The `DELETE FROM meta` in migration 6 runs after the pre-migration backup, with its reason stated.
- **personal-data:** the name goes into commits, entries and the index, with a synthetic `.invalid` email, as before. The new exposures are F-1 (the reflog through mode bits) and F-2 (project repositories outside the data directory).

Files: /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/modules/knowledge/repo.ts, /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/modules/knowledge/resolve.ts, /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/core/git.ts, /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/modules/knowledge/index-store.ts, /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/cli/commands/knowledge.ts
