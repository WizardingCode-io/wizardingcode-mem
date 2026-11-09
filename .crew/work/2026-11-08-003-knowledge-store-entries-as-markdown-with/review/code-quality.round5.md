# code-quality findings for 2026-11-08-003-knowledge-store-entries-as-markdown-with
reviewer: review-code-quality
read: 7 files, 22 hunks. I read the round-five commit (probes/round-five-change.patch) in full. As the code stands now, I read:
- repo.ts lines 110-220, 625-706 and 930-1250
- store.ts lines 205-310 and 698-922
- index-store.ts lines 530-610
- knowledge.ts lines 195-343

I also read the round-four findings and ruling.

## Findings
- F-1 · defect · src/modules/knowledge/repo.ts:168 · Q9: the new `refuseLinksInside` swallows every `readdirSync` error and returns, so the cause is hidden.
  - The only case that needs the catch is a `.git` (or subfolder) that is absent.
  - A folder that can be searched but not listed (mode 0300 on `.git/refs`, which whoever dropped the folder controls) makes the walk skip it without a word.
  - git can still go through that folder by name, for example to a linked `refs/heads/main`. That is exactly the case this guard exists to refuse.
  - The fix is to return only on ENOENT and treat any other error as a refusal.
- F-2 · advisory · src/modules/knowledge/repo.ts:1008 · Q10/Q2: `commitChange`'s doc says it is "the one place the failure rule lives", and CLAUDE.md:21 says "the write, its record and its undo in `commitChange`". The code does not bear that out.
  - `adoptIn` (store.ts:842-885) still writes its own sequence: record, write, stage/remove, commit, then on failure an undo plus `clearIntent` inside an inner try, keep the record, rethrow the first error.
  - Its undo has to differ (unstage plus `restoreKept`, not `undoStaged`), and both copies now agree on which error the caller sees and on keeping the record. So this is not round four's defect again.
  - But the prose claims one place where there are two. Either say adopt keeps its own frame, or let `commitChange` take the undo.
- F-3 · advisory · src/modules/knowledge/index-store.ts:563 · Q1: `inEachRepo` collects every result before the CLI prints anything (knowledge.ts:254-264).
  - Suppose a later repository raises a fault that is not a refusal (git or locked). Adopts that already committed in earlier repositories are then never reported.
  - Before this round, `adoptAll` printed each result as it came.
  - The doc at 547 says a fault "stops the command". It does not say that earlier results are lost with it.
- F-4 · advisory · src/cli/commands/knowledge.ts:217 · Q5: `Refused` collects the relative path of each refused repository, but only `refused.length > 0` is ever read (knowledge.ts:327). The names pushed at 222 are dead data. A count or a boolean would do.
- F-5 · advisory · src/modules/knowledge/repo.ts:121 · Q10: `refuseForeign`'s doc says it refuses a repository "whose `.git` holds a link". `refuseLinksInside` (175-179) refuses anything that is not a regular file or a folder (a FIFO or a socket as well), so the doc says less than the code does.
- F-6 · advisory · src/modules/knowledge/repo.ts:306 · Q11: the rewritten `NO_CONFIG` comment drops the old claim that git "maps the name to the null device where there is no such path". The claim was unsourced and was removed rather than marked `[source?]`.
  - The replacement, "Run on macOS; not run on Windows", states the same uncertainty as a scope limit, so this is advisory.
  - The rubric's wording would make the removal itself a defect. The judge decides.
- F-7 · advisory · src/modules/knowledge/repo.ts:1108 · Q5/Q8, carried: `readIntent` is still a one-line forwarder to `readRecord`, and only tests import it (knowledge-repo, knowledge-store and knowledge-index tests).
- F-8 · advisory · src/modules/knowledge/repo.ts:1126 · Q5, carried: `keepBytes`' default `name = keptFileName()` and its return value are still used only by tests. store.ts:851 passes `keptName` and ignores the result.
- F-9 · advisory · src/modules/knowledge/store.ts:760 · Q2, carried: `adopt` still repeats `underLeases`'s nesting (store.ts:179): the root lease, then open, then the repository's own lease unless it is the root.
- F-10 · advisory · src/modules/knowledge/repo.ts:273 · Q4/Q5, carried: three knobs are still set only by tests:
  - `GitOptions.timeoutMs`
  - `resolveRepo`'s `folderName` (resolve.ts:200)
  - `DoctorContext.gitVersion` (checks.ts:95)
- F-11 · advisory · src/store/db.ts:216 · Q8, carried: `moduleVersion` and `readEntry` (store.ts:687) are still exports that only tests import.
- F-12 · advisory · src/doctor/checks.ts:577 · Q2, carried: `foldersByHand` and `projectFolders` (588) still copy resolve.ts's folder listing (`projectFolders`, resolve.ts:107).

## Outside the change
- src/cli/commands/history.ts:214 · `db: db as Db` casts a database that may be null. The change repeats the pattern at src/doctor/checks.ts:614 (debt, carried).

## Not answerable
- Q2/Q4 for test hunks beyond the round-five commit · I read the tests only in this commit's hunks. The one oddity is the round-trip at knowledge-resolve.test.ts:1065-1070 (`codeOf(() => { throw failure; })` where `failure.code` would do). That is test style, not a finding.
- Q7 · The commit adds no dependency.

Checked as asked:
- **Upheld defect 1, fixed.** `commitChange` (repo.ts:1014-1059) holds the record, write, stage, commit and undo. `store.commit` (store.ts:283-288) adds only the fingerprint check. `learnAliases` (repo.ts:693-702) calls `commitChange` and then `clearIntent`. When the undo itself fails, both callers now keep the record and rethrow the first error. The `Commit` type is gone, and nothing references it.
- **Upheld defect 2, fixed.**
  - `opened` and the CLI's predicate are gone.
  - `isRefusal` (errors.ts:28) is the one classifier, used only by `inEachRepo` (index-store.ts:565).
  - `rebuildAll`, `list` and `adoptAll` all go through `inEachRepo`.
  - The `locked` check in `list` (knowledge.ts:276) is a different rule, not a copy.
- **Round-four advisories:**
  - Fixed: F-3 (`rejected` and `kept` are named apart, repo.ts:1093-1104), F-6 (`INTENT_OPERATIONS` is no longer exported), F-7 (`mustBe` names a link and a wrong kind apart), F-8 (both comments are scoped to macOS), F-9 (the cap is gone, `NO_CAP`).
  - Not acted on: F-4, F-5, F-10 to F-13, carried here as F-7 to F-12.
  - `dropKept` with `recursive` is consistent with `clearIntent`.
- **`CONTROL` in store.ts:705.** It is used once. `.replace` with a `g` regex is correct, and the biome-ignore names its reason.

Files read, all under /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/:
- src/modules/knowledge/repo.ts
- src/modules/knowledge/store.ts
- src/modules/knowledge/index-store.ts
- src/modules/knowledge/errors.ts (in the patch)
- src/cli/commands/knowledge.ts
- .crew/work/2026-11-08-003-knowledge-store-entries-as-markdown-with/probes/round-five-change.patch
- .crew/work/2026-11-08-003-knowledge-store-entries-as-markdown-with/review/code-quality.round4.md
- .crew/work/2026-11-08-003-knowledge-store-entries-as-markdown-with/review/ruling.round4.json
