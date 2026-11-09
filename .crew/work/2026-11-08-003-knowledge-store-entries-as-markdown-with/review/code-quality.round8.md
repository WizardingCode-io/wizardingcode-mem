# code-quality findings for 2026-11-08-003-knowledge-store-entries-as-markdown-with
reviewer: review-code-quality
read: 9 files, 33 hunks. The round-eight commit (probes/round-eight-change.patch) was read in full. Current code read: checks.ts 575-853, repo.ts 70-270, 715-865, resolve.ts 100-360, index-store.ts 320-410 and 520-616, git.ts 20-72, plus round seven's findings and ruling and probes/round-eight-mutations.md.

## Findings
- F-1 · advisory · src/modules/knowledge/repo.ts:170 · Q8: this commit removed the last importers of the exported `isDirectory` (checks.ts and resolve.ts), so it is now an export nothing imports. It is still the fail-open form that the commit's own CLAUDE.md rule retires. Keep it module-private or replace its remaining callers (722, 819, 841, 991) with `kindAt`.
- F-2 · advisory · src/modules/knowledge/resolve.ts:268 · Q6/Q11: the new rule ("a repository that has commits keeps the manifest it has, or lacks") decides "is a repository here?" with `headOf`. `headOf` (repo.ts:841) asks `isDirectory`, and `headOfGitDir` reads an unreadable HEAD as "no commit".
  - So a listable `.git` whose HEAD cannot be read, with the manifest deleted, gets a fresh `knowledge.json` written into a repository that has history.
  - The CLAUDE.md line this commit wrote says something else: "wherever the answer decides whether a repository, or a file of one, is there, the disk is asked with `lookAt`, `kindAt` and `namesIn`". That claim also does not hold for `refuseForeign`'s `existsOnDisk` and `mustBe` (repo.ts:199-214), `reachedByFolders` (991), `readIntent` (1177) and `adopt` (store.ts:792).
  - Reaching it takes two manual changes (the manifest deleted and HEAD chmodded), and git fails right after, so this is advisory as round seven's F-5 overclaim was. Either narrow the sentence or route `headOf` through `lookAt`.
- F-3 · advisory · src/modules/knowledge/resolve.ts:257 · Q2: the project branch (257-264) re-implements the fixed-scope guard at 216-221 line for line (`kindAt !== "folder"` → `refuseForeign` → `if (!create) return null` → `ensureParents`), and its own comment says "here as for the fixed scopes".
  - The new-folder branch's early return (249-254) also repeats the final return at 271.
  - One helper would hold the "refused by name, never created through" rule in one place, as CLAUDE.md asks for the store's other rules.
  - It is four lines of logic rather than boilerplate. I file it as advisory, in line with round seven's ruling on the copied `unseen` rule.
- F-4 · advisory · src/doctor/checks.ts:598 · Q2, carried from round seven's F-13: the doctor's `projectFolders` is still a copy of resolve.ts:116-127. It now uses the same `namesIn` and `kindAt`, so the two copies agree in behaviour, but two copies remain.
  - With no database, it lists `knowledge/projects` twice: once through `unmapped()` (667) and again at 728.
- F-5 · advisory · src/modules/knowledge/repo.ts:249 · Q2, carried from round seven's F-3 and unchanged: the `.git` walk keeps its own catch. It treats only ENOENT as "not there" and has its own message, where `unseen(folder, error)` would do.
- F-6 · advisory · src/modules/knowledge/repo.ts:82 · Q3, the rest of round seven's F-4: the hint is now given only for EACCES or EPERM, so the advice part is closed. The name `unseen` still describes neither what the function returns (a refusal, or null) nor its rule.
- F-7 · advisory · src/modules/knowledge/repo.ts:135 · Q3, carried from round seven's F-6: the doc now says `refuseLinkedRoots` also refuses a root it cannot look at, but the name still says only "linked". The same goes for `refuseLinksInside` (245).
- F-8 · advisory · src/cli/commands/knowledge.ts:235 · Q6, carried from round seven's F-7: `rebuild` still prints only after `rebuildAll` returns. A `kindAt` refusal in the removal loop (index-store.ts:595) still drops results that were already computed.
- F-9 · advisory · src/modules/knowledge/repo.ts:1203 · Q5/Q8, carried: `readIntent` only forwards to `readRecord`, and only tests import it.
- F-10 · advisory · src/modules/knowledge/repo.ts:1218 · Q5, carried: only tests use `keepBytes`' default name and its return value.
- F-11 · advisory · src/modules/knowledge/store.ts:760 · Q2, carried: `adopt` repeats `underLeases`' lease nesting.
- F-12 · advisory · src/modules/knowledge/repo.ts:363 · Q4/Q5, carried: only tests set three knobs, `GitOptions.timeoutMs`, `resolveRepo`'s `folderName` (resolve.ts:208) and `DoctorContext.gitVersion`.
- F-13 · advisory · src/store/db.ts:216 · Q8, carried: `moduleVersion` and `readEntry` are exports only tests import.

Closed since round seven:
- **Round seven F-1, the upheld defect at checks.ts:590:** closed.
  - `projectFolders` (598-604) now lists with `namesIn` and `kindAt` and swallows nothing.
  - A refusal there reaches `knowledge()`'s wrapper (843-852) as this check's warning, with or without a database.
  - The doctor's own loop (731-742) now runs `refuseForeign` before it looks under a name. It asks `.git` with `kindAt`, and does not count a refused repository (751).
  - The unlistable entries folder (776-796) is now a per-repository warning, not an empty count.
  - Round-eight mutations 9-11 are killed.
- **Round seven F-5, the comment at index-store.ts:592:** closed. The test is now `!== "absent"` (595), and the comment matches it, as does `rebuildAll`'s doc (571-575).
- **Round seven F-2 (fail-open callers):** narrowed. resolve.ts's fixed-scope check (216) and new-name check (244) and the doctor's checks (587, 603, 616, 735) now use `kindAt`. The callers that remain are listed under F-1 and F-2 above.
- **The listing and readListed:** `listFolder` and `readListed` (index-store.ts:333-363) no longer swallow; their docs match the code, and so does `readRepoFiles`' doc.
- **The fingerprint comment:** the new comment at repo.ts:847-850 says why `fingerprintOf` keeps its catch, and the test at knowledge-index.test.ts:845 holds the 600-mode exception it implies.
- **The prose:** I found no fact, hedge or scope limit dropped. The ADR keeps the old "row is the only tie" fact and the data-directory note, now made precise per the architecture ruling. The `refuseLinkedRoots` message change is accurate.

## Outside the change
- src/core/git.ts:23 · `isDirectory` (statSync, every error read as false) feeds `readGitInfo`, which the diff did not touch (debt).
- src/cli/commands/history.ts:214 · `db: db as Db` casts a database that may be null, and the change repeats it at src/doctor/checks.ts:622 (debt, carried).

## Not answerable
- Q7 · This commit adds no dependency. I did not consult inputs.json beyond that.
- Q2/Q4 for the test hunks · I read the tests only in this commit's hunks and found nothing there under this rubric. The silent early return as root or on win32 (doctor-knowledge.test.ts:625, 664; knowledge-index.test.ts:793, 829) belongs to the test-quality gate.
