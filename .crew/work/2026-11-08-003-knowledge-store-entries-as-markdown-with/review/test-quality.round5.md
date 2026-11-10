# test-quality findings for 2026-11-08-003-knowledge-store-entries-as-markdown-with
reviewer: review-test-quality
read: 4 test files (the round-five hunks of tests/unit/knowledge-repo.test.ts, tests/unit/knowledge-index.test.ts, tests/unit/knowledge-resolve.test.ts and tests/integration/knowledge-cli.test.ts, read against repo.ts, index-store.ts, store.ts, errors.ts and src/cli/commands/knowledge.ts), 19 criteria

## Findings
- F-1 · advisory · tests/integration/knowledge-cli.test.ts:541 · The "a fault still does" half does not hold what its name says, so round four's F-4(a) is still open (Q1, Q6).
  - The mutant: `isRefusal` widened to any `KnowledgeError` (errors.ts:268). Under it, the missing-git fault is set aside per repository instead of stopping the command.
  - `adoptAll` still reaches `inEachRepo`, because `gitUserName` swallows the failure, and `requireGit` inside `adopt` throws code `git`.
  - Every assertion still passes: exit 1 (refused is not empty), stderr contains "git", stdout is empty (the "nothing" line is suppressed because refused is not empty).
  - What the mutant changes is stderr. It becomes `wizardingcode-mem: knowledge/workspace: git ...` plus the same for `knowledge/shared`. The real code prints the fault once, with no repository prefix.
  - One assertion would kill it: `expect(fault.stderr).not.toContain("knowledge/")`.
  - This test was never seen red, and nothing else in the suite holds the refusal/fault split either.
- F-2 · advisory · tests/unit/knowledge-index.test.ts:693 · The test holds only the line break. The code (store.ts `CONTROL`) and the ADR promise every control character becomes `?`. Narrowing the regex to `/\n/g` leaves the suite green; a tab or `\x1b` in the file name would hold it. The test was seen red and does hold the line-break rule. Its assertions read the real `git log`, not a stub.
- F-3 · advisory · src/modules/knowledge/repo.ts:1068 · No test holds the removal of the read cap (`NO_CAP` for the record and the kept bytes).
  - If the cap came back, for example as the default `ENTRY_MAX_BYTES` of 256 KiB, the suite would stay green. `restoreKept` would then return silently on kept bytes over the cap, and an interrupted adopt of a few large entries would lose the person's bytes.
  - A test that adopts two or more entries near the entry cap, interrupts the adopt and reopens would hold it.
  - Not named by any criterion (AC-18 covers the in-process commit failure), hence advisory.
- F-4 · advisory · src/modules/knowledge/repo.ts:1325 · The second half of round four's F-3 is still open: no test holds `underOwnLease`'s `started` rule (a `locked` raised once the step has begun is thrown, not swallowed).
  - Dropping `started ||` leaves every test green.
  - The new test at tests/unit/knowledge-repo.test.ts:1197 holds only the first half: a rejected record is left alone and nothing is said while another live process holds the lease. It does fail if `underOwnLease` is replaced by a direct call, or if the not-started `locked` is thrown.
- F-5 · advisory · src/cli/commands/knowledge.ts:236 · `inEachRepo`'s rule for a listed folder with no repository (no result, not refused) is held only indirectly.
  - In `rebuildAll`, the rebuild test at tests/unit/knowledge-index.test.ts:457 checks the result keys.
  - Nothing tests what the commands print for such a folder: `rebuild`'s "not a repository" line, or `list`/`adopt` staying silent and printing "nothing" only when every folder is like that. There is no test anywhere that matches "not a repository" for knowledge.
- F-6 · advisory · tests/unit/knowledge-repo.test.ts:1611 · The links test holds "nothing is written through it" but not "before git runs" from its name (Q6).
  - It uses no stub git to show that no git call ran, so moving `refuseLinksInside` after `checkRepoConfig` or `revertInterrupted` would keep it green.
  - Otherwise it holds the walk well:
    - Each of the ten places is checked on its own (code `invalid` and the link's own path in the message).
    - `anything-else`, `COMMIT_EDITMSG` and `HEAD` are reached by nothing but the walk.
    - `logs/HEAD`, `refs/heads/main` and `objects/pack` are below the first level, so a walk that stopped at `.git`'s top level fails on each.
    - `objects/pack` also fails if the object-folder exception were widened to skip `objects/` itself.
    - Seen red (AC-19).
- F-7 · advisory · src/modules/knowledge/store.ts:842 · Carried (round four F-5): no test holds the order "record first (842), then kept bytes (851)" in `adoptIn`. Swapping the two lines leaves the suite green.
- F-8 · advisory · tests/unit/knowledge-index.test.ts:299 · Carried: no test adds a file during a write's `git add` and `git commit`. The ADR states this window as a known limit.
- F-9 · advisory · tests/unit/knowledge-index.test.ts:314 · Carried (Q5): the rebuild-order test depends on the internal renewal count.
- F-10 · advisory · tests/unit/knowledge-store.test.ts:440 · Carried (AC-8): only the `git --version` probe times out; no git call inside the write does. At tests/unit/knowledge-repo.test.ts:539 only the "timed out" message is checked, not that the process is gone.
- F-11 · advisory · tests/unit/knowledge-repo.test.ts:316 · Carried (AC-2): the parent's `.gitignore` holds `data/`, so the parent's empty status proves little. The ceiling guard is held by the environment test.
- F-12 · advisory · tests/unit/knowledge-repo.test.ts:547 · Carried (AC-13): clipping is checked on the thrown message, not on the log line.
- F-13 · advisory · tests/unit/knowledge-resolve.test.ts:85 · Carried (AC-2): the gained-remote test resolves through the `knowledge_repos` row, not through the manifest.

No defects. Each new or changed test, read against the code:
- **Template assertions (knowledge-repo.test.ts:153).**
  - Without `--template=`, git copies its built-in template (`hooks/`, `info/`, `description`) and the assertions fail. This closes round four's F-1.
  - Caveat: this relies on the machine's git shipping a template directory, which is true of the usual macOS and Linux builds.
- **Record as a link or a folder (knowledge-repo.test.ts:1172).**
  - The link half now goes through the walk.
  - The folder half fails without `recursive: true` in `clearIntent`: `rmSync` throws on the non-empty folder, so `openRepo` throws. This closes round four's F-2.
- **Folder at a kept-bytes name (knowledge-repo.test.ts:1222).** It fails without `recursive` in `dropKept`. Seen red.
- **Every repository refused (knowledge-cli.test.ts:544).**
  - For `list` and `adopt`, dropping `all.refused.size === 0` prints the "nothing" line and `stdout === ""` fails.
  - For all three commands, the error is said with the repository's prefix.
  - This closes round four's F-4(c).
- **Adopt refused in one repository (knowledge-cli.test.ts:518, first half).** The refusal comes from inside `adopt` (a nested repository), not at opening. Outside `inEachRepo`'s try, the throw would escape before any line is printed, so stdout would lack `knowledge/workspace: adopted 1 change`. This closes round four's F-4(b).
- **Resolve, the "git commit" assertion (knowledge-resolve.test.ts:196).**
  - With the stub's `failOnce: "restore"`, the round-four `learnAliases` threw the undo's error, so this fails.
  - It also holds `learnAliases` going through `commitChange`, together with the existing put-back assertions at lines 197 to 203.
  - Seen red.

Nothing is true by construction: every assertion reads what real git or the store left on disk, or the command's real output. Fixtures use neutral names (`the-persons-file`, `the-persons-folder`, `kept-aside`, `someone else`, `example.invalid`).

## Outside the change
- none

## Not answerable
- Q7 (mutation) · no mutation report was named for this item. The survivors above were found by reading the code, not by running a tool.
- Whether the template assertions at knowledge-repo.test.ts:153 go red on a git built without a template directory · this depends on the git build, and no run with `--template=` removed was recorded.
