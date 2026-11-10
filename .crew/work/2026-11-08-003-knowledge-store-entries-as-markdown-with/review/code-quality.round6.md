# code-quality findings for 2026-11-08-003-knowledge-store-entries-as-markdown-with
reviewer: review-code-quality
read: 8 files, 25 hunks. I read the round-six commit (probes/round-six-change.patch) in full, plus the core/git.ts hunk of review/diff.patch. As the code stands now, I read:
- repo.ts lines 60-230 and 1138-1170
- resolve.ts lines 95-337
- checks.ts lines 570-840
- git.ts lines 1-120
- knowledge.ts lines 195-345
- index-store.ts lines 520-600
- store.ts lines 745-772

## Findings
- F-1 · advisory · src/modules/knowledge/repo.ts:197 · Q9/Q3: the new refusal replaces the real `readdirSync` error with an assumed cause.
  - Any code other than ENOENT (EACCES, but also EIO, EMFILE or ENOMEM) becomes "cannot be listed … make it readable", and the errno is dropped.
  - Because it is code `invalid`, `inEachRepo` sets a transient fault aside as a refusal instead of stopping the command as a fault.
  - Failing closed is right, and it is what round five asked for. The message just names a cause it did not check. Appending `error.code` would keep the cause.
- F-2 · advisory · src/modules/knowledge/repo.ts:180 · Q10: the walk's doc (180-188) and `refuseForeign`'s doc (139-140) say a `.git` holding "anything but regular files and folders" is refused. Neither mentions the one exception the code now makes at 207 (`FSMONITOR_SOCKET`). Only the constant's own doc (174-176) and the ADR say so.
  - CLAUDE.md:22 repeats the unqualified wording.
- F-3 · advisory · src/modules/knowledge/repo.ts:82 · Q3: `refuseLinkedRoots` also refuses a plain file (or anything else that is not a folder) at `knowledge/` or `knowledge/projects/`, as its doc and message say. The name says only "linked".
  - `refuseLinksInside` (189) has the same mismatch: it refuses sockets, FIFOs and folders that cannot be listed as well. A name like `refuseNonFolderRoots` or `refuseForeignEntries` would match what they do.
  - On the question asked: the rule is written once (repo.ts:82-92). The three call sites (resolve.ts:204, resolve.ts:287, checks.ts:610) only invoke it.
  - The doctor's call is not redundant. Its no-database path, `unmapped()` → `foldersByHand`/`projectFolders`, never reaches `scanRepos`. With a database the rule runs twice, which is harmless.
- F-4 · advisory · src/core/git.ts:58 · Q2: `headOfGitDir` repeats `readGitInfo`'s HEAD parsing in the same file: read HEAD, match `ref:`, SHA test, `resolveRef`.
  - The diff now adds the "only under refs/" rule (63-66) to one copy only, so the two parsers in one file follow different rules. The duplicated part is three lines.
- F-5 · advisory · src/cli/commands/knowledge.ts:235 · Q6: `list` and `adopt` now print each repository's lines inside the work they hand to `inEachRepo`, but `rebuild` still collects every result and prints only after the loop.
  - So a fault in a later repository still loses the lines for repositories already rebuilt, whose index rows are already replaced.
  - `rebuildAll` (index-store.ts:577) owning the loop is why. The three commands no longer agree on when a result is said.
- F-6 · advisory · src/modules/knowledge/repo.ts:1143 · Q5/Q8, carried: `readIntent` is still a one-line forwarder to `readRecord`, and only tests import it.
- F-7 · advisory · src/modules/knowledge/repo.ts:1161 · Q5, carried: `keepBytes`' default `name = keptFileName()` and its return value are still used only by tests. store.ts:851 passes `keptName` and ignores the result.
- F-8 · advisory · src/modules/knowledge/store.ts:760 · Q2, carried: `adopt` still repeats `underLeases`'s nesting (store.ts:179): the root lease, then open, then the repository's own lease unless it is the root.
- F-9 · advisory · src/modules/knowledge/repo.ts:306 · Q4/Q5, carried: three knobs are still set only by tests:
  - `GitOptions.timeoutMs`
  - `resolveRepo`'s `folderName` (resolve.ts:201)
  - `DoctorContext.gitVersion` (checks.ts:96)
- F-10 · advisory · src/store/db.ts:216 · Q8, carried: `moduleVersion` and `readEntry` (store.ts:687) are still exports that only tests import.
- F-11 · advisory · src/doctor/checks.ts:578 · Q2, carried: `foldersByHand` and `projectFolders` (589) still copy resolve.ts's folder listing (`projectFolders`, resolve.ts:108).

## Outside the change
- src/core/git.ts:111 · `readGitInfo` (memory's hook path, untouched by the diff) still follows any `ref:` in HEAD, including one that climbs out of the git directory. The rule added to `headOfGitDir` was not applied there (debt).
- src/cli/commands/history.ts:214 · `db: db as Db` casts a database that may be null. The change repeats the pattern at src/doctor/checks.ts:617 (debt, carried).

## Not answerable
- Q7 · The commit adds no dependency, and inputs.json was not consulted beyond that.
- Q2/Q4 for test hunks · I read the tests only in this commit's hunks; I found nothing there under this rubric.

Checked as asked:
- **Upheld defect, fixed.** `refuseLinksInside` (repo.ts:195-201) returns only on ENOENT and refuses otherwise. The tone of its message is F-1.
  - The socket exception is narrow: top level of `.git`, exact name, `isSocket()`.
  - `core.fsmonitor=false` is passed on every call (repo.ts:356), so the constant's doc is true.
- **The security gate's second defect.** `refuseLinkedRoots` runs before every listing or creation under `knowledge/` that I found:
  - `resolveRepo`, which every `openRepo`/`ensureRepo` reaches
  - `scanRepos`, and so `listRepos` and `inEachRepo`
  - the doctor
  - `ensureParents` (resolve.ts:186) is reached only from `resolveRepo`, after the check.
  - Thrown from `listRepos`, the refusal sits outside `inEachRepo`'s per-repository try. It reaches `run`'s catch and exits 1. It is not swallowed.
- **errors.ts.** `isRefusal`'s doc now matches the code: `adopt`'s agent refusal (store.ts:758) is a "request it cannot take".
- **Round-five advisories:**
  - F-2 (commitChange doc and CLAUDE.md), F-4 (the dead `Refused` list) and F-5 (refuseForeign's doc) are fixed.
  - F-3 is fixed for `list` and `adopt` but not for `rebuild` (F-5 above).
  - The carried items still stand, as F-6 to F-11.
- **headOfGitDir.** The doc says "Null before the first commit, or when this is no git directory"; the inline comment at 61-62 covers the extra null case, so I did not file it.

Files read, all under /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/:
- src/modules/knowledge/repo.ts
- src/modules/knowledge/resolve.ts
- src/modules/knowledge/index-store.ts
- src/modules/knowledge/store.ts
- src/doctor/checks.ts
- src/core/git.ts
- src/cli/commands/knowledge.ts
- .crew/work/2026-11-08-003-knowledge-store-entries-as-markdown-with/probes/round-six-change.patch
- .crew/work/2026-11-08-003-knowledge-store-entries-as-markdown-with/review/code-quality.round5.md
- .crew/work/2026-11-08-003-knowledge-store-entries-as-markdown-with/review/ruling.round5.json
