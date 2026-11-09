# code-quality findings for 2026-11-08-003-knowledge-store-entries-as-markdown-with
reviewer: review-code-quality
read: 9 files, 46 hunks (all of the round-three commit in probes/round-three-change.patch; the current repo.ts, store.ts, checks.ts, resolve.ts, index-store.ts, util/text.ts and ADR 0024 where those hunks needed context; round two's findings and ruling; inputs.json)

## Findings
- F-1 · defect · src/modules/knowledge/repo.ts:679 · `learnAliases` repeats `revertInterrupted`'s lease rule (repo.ts:1106-1114) line for line: if this store already holds the lease, run directly; otherwise run under `withRepoLeases` and swallow only `locked`. The direct branch matters because it keeps a lost outer lease's `locked` from being swallowed, and neither copy says so. If that rule changes, both copies have to change. One helper would do (Q2, logic duplicated).
- F-2 · advisory · src/modules/knowledge/repo.ts:446 · The comment says "git's white space is these six characters", but `CONFIG_SPACE` (449) and the class inside `CONFIG_HEADER` (450) list five (space, \t, \v, \f, \r). git's sixth, \n, is already removed by the split at 492, and the comment does not say that (Q10).
- F-3 · advisory · src/modules/knowledge/repo.ts:468 · Two things in `checkRepoConfig` that could be simpler:
  - The `refuse` closure now has one caller (521).
  - The throw at 515-518 repeats its tail ("a knowledge repository carries only the settings git init writes") inline.
  - The white-space class is also written twice, in `CONFIG_SPACE` and again inside `CONFIG_HEADER`.
  Otherwise the tokenizer is one job and has no dead branch. Every exit is reached by a test (Q5/Q2, boilerplate).
- F-4 · advisory · src/modules/knowledge/repo.ts:310 · The comment "git never looks into a repository nested in this one" on `diff.ignoreSubmodules=all` / `submodule.recurse=false` claims more than these settings do. `statusOf`'s own comment (repo.ts, above `statusOf`) says only the `--ignore-submodules=all` flag wins over a `.gitmodules` setting (Q10).
- F-5 · advisory · src/modules/knowledge/repo.ts:925 · `INTENT_OPERATIONS` and `ownPath` (854) are exported, but no file imports either one. Only repo.ts uses them, and the test writes out its own list of operations (Q8).
- F-6 · advisory · src/modules/knowledge/repo.ts:158 · `refuseForeign` now repeats the same lstat / `isSymbolicLink() ? "a link" : "not a …"` refusal four times: at 154, 158, 165, and once more in the `kind` helper's callers (Q2, boilerplate).
- F-7 · advisory · src/modules/knowledge/index-store.ts:566 · Now that `isDirectory` is exported from repo.ts:111, this inline `lstatSync(...).isDirectory()` in a try/catch is a fourth copy of it (Q2, boilerplate).
- F-8 · advisory · src/doctor/checks.ts:577 · `foldersByHand` and `projectFolders` (588) still copy the folder listing in resolve.ts. checks.ts:582 is the same line as resolve.ts:289, and 588-594 repeat resolve.ts:114-117 (Q2; carried from round two, not acted on).
- F-9 · advisory · src/modules/knowledge/store.ts:814 · `adopt` still repeats `underLeases`'s nesting from store.ts:186-203: the root lease, then open, then the repository's own lease unless it is the root (Q2; carried, not acted on).
- F-10 · advisory · src/modules/knowledge/repo.ts:265 · These are still knobs only tests set (Q4/Q5; carried, not acted on):
  - `GitOptions.timeoutMs`
  - `resolveRepo`'s `folderName` (resolve.ts:200)
  - `DoctorContext.gitVersion` (checks.ts:95)
  Separately, checks.ts:645 still formats the minimum git version differently from `requireGit` (repo.ts:402).
- F-11 · advisory · src/store/db.ts:216 · `moduleVersion` and `readEntry` (src/modules/knowledge/store.ts:744) are still exports that only tests import (Q8; carried, not acted on).

## Outside the change
- src/cli/commands/history.ts:214 · `db: db as Db` casts a database that may be null. The diff repeats this pattern at src/doctor/checks.ts:614 (debt, carried).

## Not answerable
- Q2/Q4/Q8 for the round-three test hunks beyond what the findings needed · I read the five test files only in the commit's hunks. The `trap` helper was moved up so both describe blocks share it, and it is used in both. I found nothing else there.
- Q7 · inputs.json lists no dependencies. The one phrase, "fall back to" at src/modules/knowledge/resolve.ts:174, is a sort tiebreak, not a fallback path, so there is no finding.

Round-two advisories checked as the code stands now:
- **Fixed:**
  - The triple `isDirectory` (but see F-7 for a fourth copy).
  - The `requireSchema` re-export.
  - The `fileHash` alias.
  - `onDisk`.
  - The shadowed `written`, now `staged`.
  - The taxonomy doc comment.
  - The "changed after" message: adopt now records every path, and the message no longer claims a change.
  - `clipLine`, now `clip(line, 61, "…")`.
  - The `?? ""` fallback, now a cast.
- **Not fixed:** F-8 to F-11 above.

Files read, under /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/:
- src/modules/knowledge/repo.ts, src/modules/knowledge/store.ts, src/modules/knowledge/resolve.ts, src/modules/knowledge/index-store.ts
- src/doctor/checks.ts, src/util/text.ts, docs/adr/0024-knowledge-module.md
- .crew/work/2026-11-08-003-knowledge-store-entries-as-markdown-with/probes/round-three-change.patch
- .crew/work/2026-11-08-003-knowledge-store-entries-as-markdown-with/review/{code-quality.round2.md,ruling.round2.json,inputs.json,files.txt}
