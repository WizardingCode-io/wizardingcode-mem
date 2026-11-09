# test-quality findings for 2026-11-08-003-knowledge-store-entries-as-markdown-with
reviewer: review-test-quality
read: 3 test files (the round-nine hunks of tests/unit/knowledge-index.test.ts, tests/unit/knowledge-resolve.test.ts and tests/unit/doctor-knowledge.test.ts, read against index-store.ts `rebuildAll`, repo.ts `taxonomyFor`, store.ts `underLeases`, the CLI's `rebuild` and the fixture helper, with probes/round-eight-two-mutants.md and probes/round-nine-mutations.md), 19 criteria

## Findings
- F-1 · advisory · tests/unit/knowledge-index.test.ts:618 · Q6, the new rebuild refusal (ADR 0024: "`rebuild` refuses and says both"): the test checks only the code `invalid` and the root's path in the message. Neither of the two things the person is told is asserted: run rebuild under the other data directory, or make the folder again, empty. No test drives it through `knowledge rebuild` either (exit code, stderr). Rewording the message to drop either hint leaves the suite green. The refusal itself is held (mutations 3-5 are killed).
- F-2 · advisory · tests/unit/knowledge-index.test.ts:634 · Q1: the rebuild-side taxonomy test covers only the workspace's root, and only a link there. The same line serves the shared root through `rootOf`, and a file at the root's name. Mutation 6 is still killed, and doctor-knowledge.test.ts:351-353 covers the file case, so this is coverage breadth, not a gap in the rule.
- F-3 · advisory · src/modules/knowledge/resolve.ts:261-263 · Carried (round eight F-3). The race between the listing and the look is not driven by any test.
- F-4 · advisory · src/modules/knowledge/repo.ts:85-88 · Carried (round eight F-4). No test shows the permissions hint left out for a code other than EACCES/EPERM.
- F-5 · advisory · tests/unit/knowledge-index.test.ts:572 · Carried (round eight F-5). At 0o600 only the rebuild path holds a refresh, by documented design.
- F-6 · advisory · tests/unit/knowledge-repo.test.ts:1769 · Carried. The `[\\:]` clause at src/core/git.ts:69 is held by no case.
- F-7 · advisory · tests/unit/knowledge-repo.test.ts:1658 · Carried. No intent record in the fixture, so moving `refuseForeign` after `revertInterrupted` survives.
- F-8 · advisory · src/cli/commands/knowledge.ts:258 · Carried. No test holds that `adopt` and `list` print as each repository finishes.
- F-9 · advisory · src/modules/knowledge/repo.ts:1360 · Carried. No test holds `underOwnLease`'s `started ||` rule.
- F-10 · advisory · src/cli/commands/knowledge.ts:239 · Carried. Nothing tests the `not a repository` line.
- F-11 · advisory · src/modules/knowledge/store.ts:842 · Carried. Swapping record-first and kept bytes in `adoptIn` leaves the suite green.
- F-12 · advisory · tests/unit/knowledge-index.test.ts:299 · Carried. No test adds a file during a write's git calls (a stated known limit).
- F-13 · advisory · tests/unit/knowledge-index.test.ts:314 · Carried (Q5). The rebuild-order test depends on the internal renewal count.
- F-14 · advisory · tests/unit/knowledge-store.test.ts:440 · Carried (AC-8). Only the version probe times out, and the process is not checked gone.
- F-15 · advisory · tests/unit/knowledge-repo.test.ts:316 · Carried (AC-2). The parent's `.gitignore` weakens the empty-status proof.
- F-16 · advisory · tests/unit/knowledge-repo.test.ts:547 · Carried (AC-13). Clipping is checked on the thrown message, not on the log line.
- F-17 · advisory · tests/unit/knowledge-resolve.test.ts:85 · Carried (AC-2). It resolves through the row, not the manifest.

Round eight's two upheld defects, checked against this round's tests:
- **resolve.ts:268 (`&& headOf(path) === null`): closed.**
  - knowledge-index.test.ts:602-603 asserts that the manifest is still absent after `openRepo(..., { create })`.
  - It also asserts the positive side that git shows the deletion: `status(...)` equals `[" D knowledge.json"]`. So the test is not true by absence alone.
  - knowledge-resolve.test.ts:312 adds the same absence check after `resolveRepo(..., { create: person })`.
  - round-nine-mutations.md mutation 1 is killed by both tests.
- **checks.ts:587 (`foldersByHand` with `kindAt(path) !== "absent"`): closed.**
  - doctor-knowledge.test.ts:336-365 puts a link, then a file, at `knowledge/workspace`, and runs doctor both with a database and with `storeDir: elsewhere`.
  - It asserts the warning names the path and its kind, that the counts are the project's alone ("1 repository, 1 entry"), and that the project's entry is not flagged through the link's taxonomy.
  - Mutation 2 is killed. The shared scope goes through the same line and is not exercised separately (advisory-level only, not filed).

The rules this commit adds:
- **The `rebuildAll` refusal (index-store.ts:597-604).**
  - It is held by knowledge-index.test.ts:606-632, which uses one shared database (the fixture's `store({ dataDir })` keeps `fx.db`) and a second, empty data directory.
  - For each scope the index holds, the test checks the refusal code, that rows, entry count and folders are unchanged, and that the first data directory still rebuilds and resolves.
  - It checks that a scope with no rows (`shared`) is not refused, which kills the "count unfiltered by scope" mutant.
  - It checks that an empty `knowledge/` made by hand forgets the rows while the first directory's folders stay.
  - Mutations 3, 4 and 5 are each killed.
- **`taxonomyFor`'s `kindAt(folder) !== "folder"` return (repo.ts:715).**
  - It is held by knowledge-index.test.ts:634-653 and doctor-knowledge.test.ts:336-365.
  - Both use a valid taxonomy behind the link that lacks the entry's area. The index test asserts it parses without a problem, so the fixture cannot pass vacuously.
  - With the old line the project's entry gets a problem. Mutation 6 is killed by both tests.
  - The write path is not weakened by the null return: `underLeases` opens the root first (store.ts:194), and that refuses the link by name.
- **`isDirectory` made module-private, and the comments on `existsOnDisk`:** no behaviour to test.

Nothing in this commit is true by construction. Every new assertion reads disk state (`existsSync`, git status, folder listings), database rows, rebuild results or doctor's printed detail, never a stub's answer. The two negative assertions (`existsSync(...) === false`, `not.toContain("in-the-project")`) are each shown live by a killed mutant. Fixtures are neutral (`path:/work/site`, `path:/x`, `moved-aside`, `another-data-directory`, `Zoë`, area `sales`).

## Outside the change
- none

## Not answerable
- Q7 for lines neither round eight nor round nine touched · round-nine-mutations.md mutates only round eight's two named lines and this commit's four rules, and the rest of the suite was not run against them.
- The permission cases on Windows or as root · knowledge-index.test.ts:567/656 and doctor-knowledge.test.ts:298/368 return early there, and no such run was recorded. In that environment nothing holds the unreadable-folder rules.

Paths reviewed:
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/unit/knowledge-index.test.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/unit/knowledge-resolve.test.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/unit/doctor-knowledge.test.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/modules/knowledge/index-store.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/modules/knowledge/repo.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/modules/knowledge/store.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/cli/commands/knowledge.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/helpers/knowledge.ts
