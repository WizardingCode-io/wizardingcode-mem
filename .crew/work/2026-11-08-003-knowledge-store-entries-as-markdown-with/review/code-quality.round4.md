# code-quality findings for 2026-11-08-003-knowledge-store-entries-as-markdown-with
reviewer: review-code-quality
read: 9 files, 31 hunks. I read the round-four commit (probes/round-four-change.patch) in full. I also read, as they stand now: repo.ts lines 50-310 and 620-1237, store.ts lines 170-370 and 800-942, index-store.ts lines 1-40 and 540-584, knowledge.ts lines 205-350, and checks.ts lines 570-720. Inputs: round three's findings and ruling.

## Findings
- F-1 · defect · src/modules/knowledge/repo.ts:658 · `learnAliases` now writes out a second copy of `commit`'s failure rule (store.ts:298-344), and the copy behaves differently. The rule is: write the record with the written hashes, write the file, stage, commit; on failure, `undoStaged` then `clearIntent`; when the undo itself fails, leave the record. `commit` puts the undo in its own try (store.ts:332-342), so it keeps the record and rethrows the commit's error. At repo.ts:676-680 an `undoStaged` failure escapes instead, and its error replaces the commit's. The comment at 677 says the record stays but not that the original error is lost. A change to this rule now has to be made in both places (Q2, logic duplicated; Q6, error handling differs from the neighbour). The fix is to move `commit`'s record/write/stage/commit/undo core into repo.ts so both callers use it.
- F-2 · defect · src/cli/commands/knowledge.ts:250 · The rule "open each listed repository of the scope, set aside a `KnowledgeError` with code `invalid` as a refusal of that one repository, go on with the rest" is written twice. One copy is `opened` (knowledge.ts:250-262), with its predicate `isRefusal` (224). The other is `rebuildAll` (index-store.ts:555-566), with the same predicate written inline at index-store.ts:564. If the set of errors that count as a refusal changes, both copies must change (Q2, logic duplicated: an error classification, the same kind of rule as round three's upheld lease rule). One exported predicate, or one shared opener in the module, would do.
- F-3 · advisory · src/modules/knowledge/repo.ts:1003 · In `readRecord`, the local `rejected` is also the base of the accepted result at 1013 (`{ ...rejected, intent: … }`), so on that line the name says the opposite of what is returned. The scope is local, so this is an advisory (Q3).
- F-4 · advisory · src/modules/knowledge/repo.ts:1017 · `readIntent` is now a one-line forwarder to `readRecord`, and only tests import it (the knowledge-repo, knowledge-store and knowledge-index tests). The code uses `readRecord` (Q5/Q8).
- F-5 · advisory · src/modules/knowledge/repo.ts:1035 · Only tests call `keepBytes` without a name or read its return value. store.ts:906 passes `keptName` and ignores the result, so the default `name = keptFileName()` and the return exist for tests (Q5).
- F-6 · advisory · src/modules/knowledge/repo.ts:945 · `INTENT_OPERATIONS` is still exported, and no file imports it (Q8). This is carried from round three's F-5; `ownPath` is no longer exported, so that half is fixed.
- F-7 · advisory · src/modules/knowledge/repo.ts:133 · The single `mustBe` message turns a `.git` gitfile into "…/.git is not a folder; the knowledge store never follows one out of its own repository". When the thing found is not a link, "one" refers to nothing. The old wording "a file, not a folder", which said what a gitfile is, is gone (Q3/Q10).
- F-8 · advisory · src/modules/knowledge/repo.ts:271 · The `NO_CONFIG` comment ("on every system") and the hooks-path comment at 301-303 ("on any system") state as fact what ADR 0024 marks as not run on Windows ("They were not run on Windows, where the binary is also built"). The code comments drop the ADR's scope limit (Q11, new prose, not a rewrite, so advisory).
- F-9 · advisory · src/modules/knowledge/repo.ts:156 · The new `max` cap reuses the message `over ${max / 1024} KiB`, so the record cap prints as "65536 KiB" (Q3, wording).
- F-10 · advisory · src/doctor/checks.ts:577 · `foldersByHand` and `projectFolders` (588) still copy resolve.ts's folder listing (Q2; carried, not acted on).
- F-11 · advisory · src/modules/knowledge/store.ts:815 · `adopt` still repeats `underLeases`'s nesting from store.ts:187-204: the root lease, then open, then the repository's own lease unless it is the root (Q2; carried).
- F-12 · advisory · src/modules/knowledge/repo.ts:238 · These are still knobs only tests set (Q4/Q5; carried):
  - `GitOptions.timeoutMs`
  - `resolveRepo`'s `folderName` (resolve.ts:200)
  - `DoctorContext.gitVersion` (checks.ts:95)
  checks.ts:645 still builds its own formatting of the minimum git version.
- F-13 · advisory · src/store/db.ts:216 · `moduleVersion` and `readEntry` (src/modules/knowledge/store.ts:745) are still exports that only tests import (Q8; carried).

## Outside the change
- src/cli/commands/history.ts:214 · `db: db as Db` casts a database that may be null. The diff repeats this pattern at src/doctor/checks.ts:614 (debt, carried).

## Not answerable
- Q2/Q4 for the round-four test hunks beyond what the findings needed · I read the test changes only in the commit's hunks. Only knowledge-repo.test.ts:1136 uses the stub-git `prepend` option, and that is a test helper, so there is no finding.
- Q7/Q9 · No dependency was added, and none of the new code is a fallback that hides a cause. `underOwnLease` lets through only a `locked` raised before the step starts, and its doc comment says so.

Checked as asked:
- **Upheld round-three defect, fixed.** `underOwnLease` (repo.ts:1226-1236) is now the one carrier of the lease rule, and `holds` and `leaseHeldElsewhere` are gone. Nested holding is handled inside `withRepoLeases` by `mine.has` (1195). The `started` flag keeps a `locked` raised after the step starts from being swallowed, which is the case the old direct branch covered.
- **Facts given in the brief that check out:**
  - `supportPaths` and `ensureSupportFolders` are gone, and nothing references them.
  - `configArgs(repo)` exists.
  - `REFUSED_FILES` is a table and includes alternates.
  - `ONLY_INIT` is a constant.
  - `checkRepoConfig`'s closure is inlined.
  - `refuseForeign` is one loop over `OWN_LAYOUT`.
  - `reachedByFolders` is used by `undoStaged`, `restoreKept` and `stateOf`.
  - `ownPath` is no longer exported.
  - `index-store` uses `isDirectory`.
  - `adopt` writes its record before `keepBytes`.
  - The CLI's three commands collect refusals, and `run` exits 1 when there are any.
  - Migration 6 has one `DELETE`, and its lease prefix matches `KNOWLEDGE_LEASE_PREFIX`.
- **Round-three advisories:**
  - Fixed: F-2 (the white-space comment), F-4 (the submodule comment), F-6 (the repeated refusals in `refuseForeign`), F-7 (the inline lstat).
  - F-3: the closure and the repeated message tail are fixed. The white-space class is still written twice, in `CONFIG_SPACE` and inside `CONFIG_HEADER`, which is minor.
  - F-5: half fixed (see F-6 above).
  - F-8 to F-11: not acted on, carried here as F-10 to F-13.

Files read, under /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/:
- src/modules/knowledge/repo.ts, src/modules/knowledge/store.ts, src/modules/knowledge/index-store.ts, src/cli/commands/knowledge.ts, src/doctor/checks.ts
- .crew/work/2026-11-08-003-knowledge-store-entries-as-markdown-with/probes/round-four-change.patch
- .crew/work/2026-11-08-003-knowledge-store-entries-as-markdown-with/review/code-quality.round3.md
- .crew/work/2026-11-08-003-knowledge-store-entries-as-markdown-with/review/ruling.round3.json
