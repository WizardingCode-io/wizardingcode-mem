# code-quality findings for 2026-11-08-003-knowledge-store-entries-as-markdown-with
reviewer: review-code-quality
read: 6 files, 16 hunks. I read the round-seven commit (probes/round-seven-change.patch) in full, along with round six's findings and ruling. As the code stands now, I read repo.ts 60-280, 560-585, 690-830 and 960-985; resolve.ts 100-337; index-store.ts 520-615; and checks.ts 570-760.

## Findings
- F-1 · defect · src/doctor/checks.ts:590 · Q6: the doctor's own `projectFolders` (590-598) still catches every error and returns `[]`. It also filters names with `isDirectory` (595), which answers false on every error. Its neighbours now throw on the same disk.
  - With `knowledge/projects` at mode 000, `readdirSync` fails with EACCES. At mode 600, every `lstat` of a name fails. Either way the no-database path (`unmapped()`, 660-670) reports no project repository, and no warning names the folder.
  - With a database, the same disk reaches `scanRepos`, then `namesIn` and `kindAt`. That path refuses and becomes a warning naming the folder.
  - So one check gives two answers on the same disk, depending on whether a database exists. This is the "errors swallowed where the neighbours throw" case.
  - It also contradicts two pieces of prose this commit wrote. The ADR line says a folder that "cannot be looked at or listed refuses the command". CLAUDE.md:22 says the doctor reads "under the same guards".
  - Nothing is deleted (the doctor only reads), so the harm is a false clean report, not data loss.
  - Fix: `namesIn` and `kindAt` here, as resolve.ts:113-118 does.
- F-2 · advisory · src/modules/knowledge/repo.ts:154 · Q2/Q5: `isDirectory` (154-160) and `existsOnDisk` (163-170) are `kindAt(p) === "folder"` and `kindAt(p) !== "absent"` with every error read as "no". The module now asks one question three ways, and the two older forms are still the majority. Callers left on the fail-open forms where `kindAt`'s rule belongs:
  - resolve.ts:209. `resolveRepo` checks the workspace and shared folders with `isDirectory`, but `scanRepos` checks the same paths with `kindAt` (resolve.ts:292). A lookup fault other than EACCES (EIO, ELOOP) makes `openRepo` return null ("no repository") where `scanRepos` refuses. EACCES itself is caught earlier: `refuseLinkedRoots` needs the same search bit on `knowledge/`.
  - repo.ts:972. `reachedByFolders` still writes `existsOnDisk(folder) && !isDirectory(folder)`, which is exactly `kindAt(folder) === "other"`. That is the pattern this commit replaced in `refuseLinkedRoots`. It does two `lstat` calls and fails open: true, "reached", on any error.
  - repo.ts:198 and 186-188. `refuseForeign` starts with `existsOnDisk`, and `mustBe` catches every `lstat` error and returns. A guard here passes on an error. `refuseLinksInside`'s `readdirSync` of `.git` refuses later, so I found no path that gets through.
  - repo.ts:574. `checkRepoConfig`'s refused-file test is `existsOnDisk`, so an `objects/info/alternates` behind an unsearchable `objects/info` (a folder the walk skips) reads as absent. git, running as the same user, cannot read it either.
  - repo.ts:825, used by 801. `headOf` reads an unseeable `.git` as no commit, so `openRepo` without `create` returns null. `refuseForeign` at 796 refuses that case first.
  - checks.ts:583, 723 and 734. In the doctor: `foldersByHand`; the warning "is not a git repository", which misnames an unseeable `.git`; and the `continue` that skips `refuseForeign` for it.
  - None of these is a data-loss path I could reach today, because an earlier `kindAt`/`namesIn`/walk refusal covers each one. Each stays correct only through that ordering.
- F-3 · advisory · src/modules/knowledge/repo.ts:236 · Q2: `unseen`'s rule is written twice. The `.git` walk keeps its own catch (236-241).
  - The two copies differ: the walk treats only ENOENT as "not there", `unseen` treats ENOENT and ENOTDIR that way, and their messages differ.
  - `unseen(folder, error)` would do it in one call.
- F-4 · advisory · src/modules/knowledge/repo.ts:82 · Q3/Q9: `unseen`'s message says "check the permissions of that folder and of the ones above it" for every errno other than ENOENT and ENOTDIR, including EIO, ELOOP, ENAMETOOLONG and EMFILE. The errno is now named (round six's F-1 is fixed), but the advice still assumes a cause the code never checked.
  - The name `unseen` describes neither what it returns (a refusal, or null) nor its rule.
- F-5 · advisory · src/modules/knowledge/index-store.ts:592 · Q10: the comment says "Only a folder that is not there is gone". The test at 594 is `=== "folder"`, so an "other" result (a link or a file at the row's path) also has its rows forgotten.
  - `scanRepos` skips such a path (`kindAt(...) === "folder"`, resolve.ts:118 and 292), so `rebuild` neither refuses it nor reports it, and silently drops its rows. Every other entry point refuses the same link through `refuseForeign`.
  - Either the comment should say links and files are forgotten too, or the test should be `=== "absent"`.
  - The behaviour is not new: `isDirectory` did the same. The comment is new, and claims more than the code does.
- F-6 · advisory · src/modules/knowledge/repo.ts:119 · Q3, carried from round six's F-3: `refuseLinkedRoots` now also refuses a root it cannot look at (through `kindAt`), so the name says even less than the function does. The same goes for `refuseLinksInside` at 229.
- F-7 · advisory · src/cli/commands/knowledge.ts:235 · Q6, carried from round six's F-5: `rebuild` still prints after `rebuildAll` returns.
  - This commit adds a new way for that to lose output. A `kindAt` refusal in the removal loop (index-store.ts:594) is thrown after `inEachRepo` has rebuilt every repository.
  - The results already computed are then dropped with the throw, and the person sees none of them.
- F-8 · advisory · src/modules/knowledge/repo.ts:1184 · Q5/Q8, carried: `readIntent` still only forwards to `readRecord`, and only tests import it.
- F-9 · advisory · src/modules/knowledge/repo.ts:1199 · Q5, carried: only tests use `keepBytes`' default name and its return value.
- F-10 · advisory · src/modules/knowledge/store.ts:760 · Q2, carried: `adopt` still repeats `underLeases`'s lease nesting.
- F-11 · advisory · src/modules/knowledge/repo.ts:347 · Q4/Q5, carried: only tests set these three knobs: `GitOptions.timeoutMs`, `resolveRepo`'s `folderName` (resolve.ts:201) and `DoctorContext.gitVersion`.
- F-12 · advisory · src/store/db.ts:216 · Q8, carried: only tests import the exports `moduleVersion` and `readEntry`.
- F-13 · advisory · src/doctor/checks.ts:578 · Q2, carried: `foldersByHand` and `projectFolders` still copy resolve.ts's folder listing. F-1 is what that copy now costs.

## Outside the change
- src/core/git.ts:111 · `readGitInfo` (the hooks' reader, untouched by the diff) still follows any `ref:` in HEAD. The doc at git.ts:50-52 now says so, which settles round six's F-4 as documented debt.
- src/cli/commands/history.ts:214 · `db: db as Db` casts a database that may be null, and the change repeats it at src/doctor/checks.ts:617 (debt, carried).

## Not answerable
- Q7 · The commit adds no dependency, and I did not consult inputs.json beyond that.
- Q2/Q4 for the test hunks · I read the tests only in this commit's hunks, and found nothing there under this rubric. The silent skip as root or on win32 at knowledge-index.test.ts:445 belongs to the test-quality gate.

Checked as asked:
- **Three ways to one question:** yes (F-2). `kindAt` can express both of the older functions. The fail-open forms are left in 13 places across repo.ts, resolve.ts and checks.ts.
  - The only place where swallowing reaches a person's report is the doctor's no-database listing (F-1).
- **`unseen` written once:** no (F-3). The `.git` walk keeps its own copy with a different set of "not there" errnos.
- **headOfGitDir (git.ts:66-68):** the `named` predicate is correct, and the doc and inline comment match it.
  - For `refs\heads\main`, the first part is `refs\heads\main`, which is not `refs`, so it reads as null.
- **refuseLinkedRoots' new message, and the socket wording in both docs (round six's F-2):** fixed and accurate.

Files read, all under /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/:
- src/modules/knowledge/repo.ts
- src/modules/knowledge/resolve.ts
- src/modules/knowledge/index-store.ts
- src/doctor/checks.ts
- .crew/work/2026-11-08-003-knowledge-store-entries-as-markdown-with/probes/round-seven-change.patch
- .crew/work/2026-11-08-003-knowledge-store-entries-as-markdown-with/review/code-quality.round6.md
- .crew/work/2026-11-08-003-knowledge-store-entries-as-markdown-with/review/ruling.round6.json
