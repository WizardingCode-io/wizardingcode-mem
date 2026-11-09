# code-quality findings for 2026-11-08-003-knowledge-store-entries-as-markdown-with
reviewer: review-code-quality
read: 9 files, 12 hunks. I read the round-nine commit (probes/round-nine-change.patch) in full. I read the current code at index-store.ts 295-320 and 560-633, repo.ts 160-245, 585-610, 700-760 and 815-876, store.ts 180-206, taxonomy.ts 15-72, and core/git.ts 60-72. I also read round eight's findings and ran a grep for the callers of `isDirectory`, `existsOnDisk`, `taxonomyFor`, `readTaxonomy` and `knowledgeRoot`.

## Findings
- F-1 · advisory · src/modules/knowledge/repo.ts:172 · Q11/Q6, the rest of round eight's F-2. The new doc says `isDirectory` is "never [used] to decide whether a repository is there", and CLAUDE.md and ADR 0024 line 48 ("none decides whether a repository is there") say the same. That does not hold.
  - `headOf` (repo.ts:853) decides with `isDirectory(.git)` and then `headOfGitDir`, which reads a HEAD it cannot read as "no commit".
  - `openRepo` (repo.ts:829-830) uses that answer to decide "a folder with no repository in it": it returns null, and with `create` it re-runs `createRepository` on a repository that has history.
  - `resolveRepo`'s manifest rule (resolve.ts:268) uses the same answer.
  - Only a manual chmod of HEAD reaches this, and `rebuildAll`'s removal loop still keeps the rows (`kindAt` at index-store.ts:612). That is why I file it as advisory, as round eight's ruling did.
  - The fix is one of two: narrow the sentence to "a repository's folder", or say that a commit's presence is read fail-open.
- F-2 · advisory · src/modules/knowledge/taxonomy.ts:28 · Q3. Since `taxonomyFor` (repo.ts:715) now returns null for a link or a file at the root's name, `readTaxonomy` reports that case as "there is no workspace knowledge repository yet". That is the "not there" reading the rule forbids.
  - Today the only caller in the product (taxonomy.ts:66-68) runs `ensureRepo` first, and `ensureRepo` refuses the link by name. So the message is reachable only from the tests.
- F-3 · advisory · src/modules/knowledge/resolve.ts:257 · Q2, carried from round eight's F-3 unchanged: the project branch repeats the fixed-scope guard at 216-221.
- F-4 · advisory · src/doctor/checks.ts:598 · Q2, carried from round eight's F-4: `projectFolders` is still a copy of resolve.ts:116-127.
- F-5 · advisory · src/modules/knowledge/repo.ts:249 · Q2, carried from round eight's F-5: the `.git` walk still has its own catch.
- F-6 · advisory · src/modules/knowledge/repo.ts:82 · Q3, carried: the name `unseen` still says nothing of what the function does.
- F-7 · advisory · src/modules/knowledge/repo.ts:135 · Q3, carried: `refuseLinkedRoots` and `refuseLinksInside` are still named for links only.
- F-8 · advisory · src/cli/commands/knowledge.ts:235 · Q6, carried: a `kindAt` refusal in the removal loop (index-store.ts:612) still drops results that were already computed.
- F-9 · advisory · src/modules/knowledge/repo.ts:1203 · Q5/Q8, carried: `readIntent` only forwards to `readRecord`, and only tests import it.
- F-10 · advisory · src/modules/knowledge/repo.ts:1218 · Q5, carried: only tests use `keepBytes`' default name and return value.
- F-11 · advisory · src/modules/knowledge/store.ts:760 · Q2, carried: `adopt` repeats `underLeases`' lease nesting.
- F-12 · advisory · src/modules/knowledge/repo.ts:363 · Q4/Q5, carried: three knobs are set only by tests (`GitOptions.timeoutMs`, `resolveRepo`'s `folderName`, `DoctorContext.gitVersion`).
- F-13 · advisory · src/store/db.ts:216 · Q8, carried: `moduleVersion` and `readEntry` are exports only tests import.

Closed or checked this round:
- **Round eight's F-1:** closed. `isDirectory` is module-private (repo.ts:175), and its doc and `existsOnDisk`'s now state their fail-open reading and where they may be used.
- **`rebuildAll` (index-store.ts:585-604):** one job, and the refusal comes before any work.
  - The `held` closure replaces the old query rather than adding a copy of it. It is run again after `inEachRepo`, which is correct because the rebuild can add rows.
  - The refusal is a `KnowledgeError` like its neighbours'. The comment says why, not what changed, and the doc matches the code: a scope with no rows is not refused, and the tests hold that.
- **`taxonomyFor` (repo.ts:712-727):** the `kindAt` guard throws when the root cannot be looked at, as the store's other guards do. Every caller is behind `openRepo`/`ensureRepo` (store.ts:188-198) or behind `taxonomyOrNull`, which turns a refusal into null for rebuild and doctor. The doc matches the code.
- **The prose:**
  - The CLAUDE.md rewrite drops no fact and narrows round eight's overclaim, though not all of it (F-1).
  - ADR 0024 keeps the old three cases and the "rows stay" paragraph. It adds a fourth case and four known limits, and the limit on the manifest line says plainly that the difference "has no reason of its own".
  - I found no invented source, no narration, and no debug leftover.
- **The test hunks:** the two new rule tests (knowledge-index.test.ts:597-601, knowledge-resolve.test.ts:311-312), the rebuild refusal test and the two link-taxonomy tests have no dead path or duplicated logic of concern under this rubric. The copied taxonomy-stripping block in the doctor and index tests is test boilerplate.

## Outside the change
- src/core/git.ts:23 · `isDirectory` (statSync, every error read as false) feeds `readGitInfo`, which the diff did not touch (debt, carried).
- src/cli/commands/history.ts:214 · `db: db as Db` casts a database that may be null, and the change repeats it at src/doctor/checks.ts:622 (debt, carried).

## Not answerable
- Q7 · This commit adds no dependency, and I did not consult inputs.json beyond that.
- The Windows behaviour of the new `kindAt` guard in `taxonomyFor` and of the `rebuildAll` refusal · it was not run on Windows, and the session says so.
