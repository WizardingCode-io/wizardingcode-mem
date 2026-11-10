# test-quality findings for 2026-11-08-003-knowledge-store-entries-as-markdown-with
reviewer: review-test-quality
read: 4 test files (the round-six hunks of tests/unit/knowledge-repo.test.ts, tests/unit/knowledge-index.test.ts, tests/unit/doctor-knowledge.test.ts and tests/integration/knowledge-cli.test.ts, read against repo.ts, resolve.ts, core/git.ts, doctor/checks.ts, store.ts, cli/commands/knowledge.ts and tests/helpers/stub-git.ts and knowledge.ts), 19 criteria

## Findings
- F-1 · advisory · src/doctor/checks.ts:610 · Doctor's own `refuseLinkedRoots` call is not held by the new test at tests/unit/doctor-knowledge.test.ts:248 (Q1).
  - That test has a database, so `scanRepos` (checks.ts:675) throws the same refusal. The error is not "no such table", so it is rethrown, and the `knowledge` wrapper (checks.ts:831) turns it into the same `warn` naming the projects path.
  - Deleting line 610 therefore leaves the test green.
  - Line 610 is the only guard when there is no database. In that path, `unmapped()` lists `knowledge/projects` through the link by hand, and no test runs it.
  - A full revert is killed: with no refusal anywhere, the clean workspace gives `ok`, not `warn`.
- F-2 · advisory · tests/unit/knowledge-repo.test.ts:1658 · Round five's F-6 is only partly closed.
  - The stub records every git call, and the version is cached per PATH (repo.ts:440). So removing the refusal from `openRepo` makes git run, the dump appears, and the test fails.
  - But the fixture leaves no intent record, so `revertInterrupted` runs no git. Moving `refuseForeign` from repo.ts:755 to after `revertInterrupted` (repo.ts:766) keeps the test green.
  - A record left in `.git` before the write would hold "before git runs" for the revert step too. Moving it after `checkRepoConfig` is harmless, since that function runs no git.
- F-3 · advisory · src/modules/knowledge/repo.ts:207 · The socket test (knowledge-repo.test.ts:1705) holds the name: renaming the socket to `another.ipc` is refused, so letting any socket through fails it. It does not hold the other two conditions on that line.
  - Dropping `entry.isSocket()` lets a link named `fsmonitor--daemon.ipc` at the top of `.git` through.
  - Dropping `folder === gitDir` lets a socket of that name in any subfolder through.
  - Either way the suite stays green, against the test name's "and no other". The harm is low, since the store's git passes `core.fsmonitor=false`.
- F-4 · advisory · tests/unit/knowledge-repo.test.ts:1735 · Two of the four refs, and one clause of the check, hold nothing.
  - `/etc/hosts` gives null without the new check: `join(gitDir, "/etc/hosts")` stays under `.git` and does not exist.
  - `refs/heads/../../config` gives null without it too: `.git/config` is not a hash.
  - The `parts[0] !== "refs"` clause (src/core/git.ts:64) is held by no case, because both climbing refs also contain `..`. Dropping that clause leaves the test green.
  - The `..` clause is held: fx.dataDir is `<fx.dir>/data` (tests/helpers/knowledge.ts:38), so both climbing refs reach `an-outside-file` and return its hash without the check.
- F-5 · advisory · src/cli/commands/knowledge.ts:258 · New promise: each repository's line is printed as its adopt ends, so what was adopted before a later fault has been said. No test holds it, and the same goes for `list` printing as it goes (knowledge.ts:284).
  - The fault half at tests/integration/knowledge-cli.test.ts:538 faults in the first repository (no git at all), so stdout is empty under either code.
  - Going back to collect-then-print leaves the suite green.
  - A test where the workspace adopts and a later repository then faults (a lease held elsewhere, say) would hold it.
- F-6 · advisory · src/modules/knowledge/repo.ts:1360 · Carried (round five F-4): no test holds `underOwnLease`'s `started ||` rule.
- F-7 · advisory · src/cli/commands/knowledge.ts:239 · Carried (round five F-5): nothing tests what the commands print for a listed folder with no repository (`rebuild`'s "not a repository", `list`/`adopt` staying silent).
- F-8 · advisory · src/modules/knowledge/store.ts:842 · Carried (round five F-7): swapping record-first (842) and kept bytes (851) in `adoptIn` leaves the suite green.
- F-9 · advisory · tests/unit/knowledge-index.test.ts:299 · Carried: no test adds a file during a write's git calls. This is a stated known limit.
- F-10 · advisory · tests/unit/knowledge-index.test.ts:314 · Carried (Q5): the rebuild-order test depends on the internal renewal count.
- F-11 · advisory · tests/unit/knowledge-store.test.ts:440 · Carried (AC-8): only the version probe times out, and the test does not check that the process is gone.
- F-12 · advisory · tests/unit/knowledge-repo.test.ts:316 · Carried (AC-2): the parent's `.gitignore` weakens the empty-status proof.
- F-13 · advisory · tests/unit/knowledge-repo.test.ts:547 · Carried (AC-13): clipping is checked on the thrown message, not on the log line.
- F-14 · advisory · tests/unit/knowledge-resolve.test.ts:85 · Carried (AC-2): the test resolves through the `knowledge_repos` row, not through the manifest.

No defects. The questions asked, answered against the code:
- **Unlistable folder (knowledge-repo.test.ts:1677).**
  - It fails if the walk again returns on every error.
  - Under that mutant, `.git` at 0300 or `logs/` at 0100 is skipped silently. `checkRepoConfig` and `headOf` read by name and pass. git then writes COMMIT_EDITMSG through the link, or appends the reflog line to `logs/HEAD`, so the victim assertion (line 556) or the code assertion fails.
  - The message assertion also pins the folder that could not be listed.
  - The ENOENT branch is held elsewhere: knowledge-repo.test.ts:340-344 runs `ensureRepo` on a repository folder with no `.git`, and that throws if ENOENT refuses.
- **Linked roots (knowledge-repo.test.ts:1743).**
  - Keeping the check only in `resolveRepo`: `listRepos` (line 1757 and in the root loop) lists the empty linked folder without throwing, and `codeOf` returns null, so the test fails.
  - Keeping the check only in `scanRepos`: the project write resolves the workspace, then `resolveRepo(project)` makes the folder through the link (`ensureParents` at resolve.ts:234). `writeEntry` never calls `listRepos`, so the write succeeds and `outside` is not empty.
  - Checking only `knowledge/`, or only `knowledge/projects`, also fails. The `isDirectory` it relies on is `lstat`-based (repo.ts:117).
- **Socket (line 1705).** It fails if any socket were let through (`another.ipc` is a real socket). It was seen red before the exemption existed. The gaps are in F-3.
- **The five tests never seen red, each read with its behaviour removed:**
  - **Refused before git (1658):** fails if the refusal is removed (F-2 for the reorder).
  - **Control characters (knowledge-index.test.ts:703):** narrowing `CONTROL` (store.ts:705) to `/\n/` fails, and so does dropping `\x7f`.
  - **Large adopt (708):** the kept file is one JSON of base64 bytes, about 546 KiB for the two entries. That is over `ENTRY_MAX_BYTES`, so a cap brought back in `restoreKept` makes `readRegularFile` throw. The catch returns and the files stay rewritten, so line 498 fails.
    - Line 495 asserts the interrupted state, so the restore is the reopen's, not the in-process undo's.
    - It does not hold `NO_CAP` on the record (repo.ts:1120): the record is small.
  - **CLI fault (knowledge-cli.test.ts:542):** widening `isRefusal` prints `knowledge/workspace: …` on stderr, so it fails. This closes round five's F-1.
  - **Doctor (248):** a full revert fails, but doctor's own line does not (F-1).
- **Nothing is true by construction.** Every assertion reads what real git or the store left on disk, a stub's own record of git being called, or the command's real output. Fixtures use neutral names (`the-persons-file`, `the-persons-folder`, `outside-projects`, `abc`, `kept-aside`).

## Outside the change
- none

## Not answerable
- Q7 (mutation) · no mutation report was named for this item. The survivors above were found by reading the code, not by running a tool.
- Whether the unlistable-folder test holds on Windows or as root · it returns early there (knowledge-repo.test.ts:1678), so on those platforms no test holds the rule. No run there was recorded.

Paths reviewed: /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/unit/knowledge-repo.test.ts, /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/unit/knowledge-index.test.ts, /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/unit/doctor-knowledge.test.ts, /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/integration/knowledge-cli.test.ts, /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/modules/knowledge/repo.ts, /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/modules/knowledge/resolve.ts, /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/core/git.ts, /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/doctor/checks.ts, /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/cli/commands/knowledge.ts
