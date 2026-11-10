# test-quality findings for 2026-11-08-003-knowledge-store-entries-as-markdown-with
reviewer: review-test-quality
read: 3 test files (the round-seven hunks of tests/unit/knowledge-index.test.ts, tests/unit/knowledge-repo.test.ts and tests/unit/doctor-knowledge.test.ts, read against index-store.ts, resolve.ts, repo.ts, core/git.ts, doctor/checks.ts and tests/helpers/knowledge.ts), 19 criteria

## Findings
- F-1 · advisory · src/modules/knowledge/index-store.ts:594 · AC-7 (Q1): no test holds the loop's own `kindAt`. Going back to `isDirectory` there leaves the suite green.
  - In all three cases of the new test (knowledge-index.test.ts:462-481), `rebuildAll` throws inside `inEachRepo` → `scanRepos` (`refuseLinkedRoots`, or `projectFolders` via `namesIn`/`kindAt`) before the loop runs.
  - Once the scan succeeds, it has already `lstat`ed every row path (workspace, shared, each `projects/<name>`). So the loop is the only guard only when a folder becomes unreadable between the scan and the loop.
  - A stub git that runs `chmod` on `knowledge/projects` during the workspace's rebuild would hold it. Otherwise, record the loop as defence in depth.
- F-2 · advisory · tests/unit/knowledge-index.test.ts:477 · AC-7 (Q1): the "knowledge folder itself" case does not hold `refuseLinkedRoots`' new `kindAt` (src/modules/knowledge/repo.ts:156).
  - If it goes back to `existsOnDisk && !isDirectory`, `scanRepos`' `kindAt(workspace)` (resolve.ts:292) still throws `invalid`, and so does `namesIn(projects)`. The case stays green.
  - Line 156 is the only guard on `openRepo(store, WORKSPACE)` with no `create`: `resolveRepo` falls to `isDirectory` (resolve.ts:209, catch-all), and `refuseForeign`'s `mustBe` swallows the error. With line 156 reverted, a `knowledge/` at 000 reads as "no repository" (null) instead of a refusal.
  - Adding `expect(codeOf(() => openRepo(store, WORKSPACE))).toBe("invalid")` to that case would hold it.
- F-3 · advisory · tests/unit/knowledge-repo.test.ts:1769 · The `[\\:]` clause at src/core/git.ts:69 is held by no case on any platform (Q1), not just "on this system".
  - `refs\heads\main` (1768) is caught by the `parts[0] !== "refs"` clause, because it has no `/`.
  - `refs/heads/..\..\..\not-a-ref` climbs one level too far. Even with `\` as a separator (Windows), it resolves to `knowledge/workspace/not-a-ref`, not `.git/not-a-ref`. That file does not exist, so it gives null without the rule. `refs/heads/..\..\not-a-ref` would reach the hash planted at line 1760.
  - `refs/heads/a:b` (1770): on POSIX, the path is the folder made at line 1761, so the read fails with EISDIR and gives null either way. On Windows, `mkdirSync` of `a:b` is likely to throw before the loop runs.
- F-4 · advisory · tests/unit/knowledge-index.test.ts:466 · Q6: the new refusal messages carry the errno (`unseen`, repo.ts:111, and `refuseLinksInside`, repo.ts:240, both at round six's code-quality request), but no assertion checks for `EACCES`. Only the path is checked, so dropping the code from either message leaves the suite green.
- F-5 · advisory · tests/unit/knowledge-repo.test.ts:1658 · Carried (round six F-2). The fixture leaves no intent record, so moving `refuseForeign` after `revertInterrupted` still survives.
- F-6 · advisory · src/cli/commands/knowledge.ts:258 · Carried (round six F-5). No test holds that `adopt` and `list` print as each repository finishes.
- F-7 · advisory · src/modules/knowledge/repo.ts:1360 · Carried. No test holds `underOwnLease`'s `started ||` rule.
- F-8 · advisory · src/cli/commands/knowledge.ts:239 · Carried. Nothing tests what the commands print for a listed folder with no repository.
- F-9 · advisory · src/modules/knowledge/store.ts:842 · Carried. Swapping record-first and kept bytes in `adoptIn` leaves the suite green.
- F-10 · advisory · tests/unit/knowledge-index.test.ts:299 · Carried. No test adds a file during a write's git calls; this is a stated known limit.
- F-11 · advisory · tests/unit/knowledge-index.test.ts:314 · Carried (Q5). The rebuild-order test depends on the internal renewal count.
- F-12 · advisory · tests/unit/knowledge-store.test.ts:440 · Carried (AC-8). Only the version probe times out, and the test does not check that the process is gone.
- F-13 · advisory · tests/unit/knowledge-repo.test.ts:316 · Carried (AC-2). The parent's `.gitignore` weakens the empty-status proof.
- F-14 · advisory · tests/unit/knowledge-repo.test.ts:547 · Carried (AC-13). Clipping is checked on the thrown message, not on the log line.
- F-15 · advisory · tests/unit/knowledge-resolve.test.ts:85 · Carried (AC-2). The test resolves through the `knowledge_repos` row, not through the manifest.

No defects. The questions asked, answered against the code:

**The index test (knowledge-index.test.ts:444) holds round six's data defect.**
- Under the old code, `rebuildAll` returned normally at mode 000 and 600, so `codeOf` gave null and line 465 failed. It was seen red.
- Keeping only the new `projectFolders`, with the loop, `scanRepos`' workspace check and `refuseLinkedRoots` all reverted, still passes every case:
  - At 000, `namesIn` throws.
  - At 600, the per-name `kindAt` throws.
  - At root 000, `namesIn(projects)` throws EACCES.
- Reverting `projectFolders` alone (`namesIn` back to catch-all `[]`, or the filter back to `isDirectory`) is killed at line 467: `openRepo(store, ref)` then finds no folder and returns null, not `invalid`. In that state the loop's `kindAt` would still make `rebuildAll` throw. So `projectFolders` is held, and the loop and `scanRepos` are not (F-1, F-2).
- `rows()` compares counts only. That is enough for "no row forgotten", since the only harm is a delete.

**The doctor test (doctor-knowledge.test.ts:263) closes round six's F-1.**
- With `storeDir` elsewhere, `db` is null, so `scanRepos` never runs and checks.ts:610 is the only guard.
- Without it, `unmapped()` → `projectFolders(dataDir)` lists `abc` through the link. Either the status is `ok` (the status assertion fails) or a warning names `abc` (line 275 fails).

**The socket test (knowledge-repo.test.ts:1705) closes round six's F-3.**
- Dropping `folder === gitDir` lets the socket in `refs/` through, which fails line 1726.
- Dropping `entry.isSocket()` lets the link of that name through, which fails lines 1731-1732.

**Which HEAD cases (knowledge-repo.test.ts:1762) hold which clause:**

| Case | Holds |
|---|---|
| `not-a-ref` | the `refs` clause alone, which closes round six's F-4 (`.git/not-a-ref` holds the real hash) |
| `refs/../<climbing>` | the `..` clause alone |
| `<climbing>` | killed only if both of those clauses go |
| `refs\heads\main` | nothing beyond the `refs` clause |
| `..\` and `a:b` cases | nothing (F-3) |

**Linked data directory (knowledge-repo.test.ts:1740).** It reads real disk state and would fail if the check reached the data directory itself (for example `lstat` of `dataDir`, or a realpath compare).

**Nothing is true by construction.** Fixtures are neutral (`path:/work/site`, `abc`, `outside-projects`, `data-by-another-name`).

## Outside the change
- none

## Not answerable
- Q7 (mutation) · no mutation report was named. The survivors above were found by reading the code.
- Whether the AC-7 refusal is held on Windows or as root · the index test returns early there (knowledge-index.test.ts:445). A CI that runs as root (a container) holds no part of round six's data defect, and no such run was recorded.
- Windows behaviour of the HEAD test · not run. By reading, `mkdirSync(".../a:b")` at knowledge-repo.test.ts:1761 likely throws there.

Paths reviewed:
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/unit/knowledge-index.test.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/unit/knowledge-repo.test.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/unit/doctor-knowledge.test.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/modules/knowledge/index-store.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/modules/knowledge/resolve.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/modules/knowledge/repo.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/core/git.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/doctor/checks.ts
