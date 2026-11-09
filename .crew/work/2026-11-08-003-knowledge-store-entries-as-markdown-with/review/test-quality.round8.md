# test-quality findings for 2026-11-08-003-knowledge-store-entries-as-markdown-with
reviewer: review-test-quality
read: 3 test files (the round-eight hunks of tests/unit/knowledge-index.test.ts, tests/unit/knowledge-resolve.test.ts and tests/unit/doctor-knowledge.test.ts, read against resolve.ts, index-store.ts, repo.ts and doctor/checks.ts, with probes/round-eight-mutations.md), 19 criteria

## Findings
- F-1 · defect · src/modules/knowledge/resolve.ts:268 · AC-2 (Q7, mutant found by reading): no test holds the `&& headOf(path) === null` clause, which keeps the engine from writing a manifest into a repository that has commits.
  - Drop the clause and the manifest-deleted steps still pass: tests/unit/knowledge-resolve.test.ts:307-309 and tests/unit/knowledge-index.test.ts:597-599.
  - The engine would then put a fresh `knowledge.json` back with no record and no commit, and `learnAliases` sees the same aliases and stays silent. Both tests check only `relative` and `state()` (rows, entry count, folder names), never whether the file came back.
  - The probe's mutation 8 covers only the emptied-folder side. One assertion kills it: `expect(existsSync(manifest)).toBe(false)` after the create at knowledge-index.test.ts:598.
- F-2 · defect · src/doctor/checks.ts:587 · AC-10 and ADR 0024's "doctor lists the folders by the same rules, with and without a database" (Q7, mutant found by reading): `foldersByHand`'s change from `isDirectory` to `kindAt(path) !== "absent"` has no test.
  - Every new doctor test puts the link or file at a project's name (doctor-knowledge.test.ts:317-335). No doctor test puts a link or a file at `knowledge/workspace` or `knowledge/shared`.
  - Without a database, going back to `isDirectory` drops the workspace from `found` and says nothing. That is the same with-and-without-database disagreement round seven upheld, here for the fixed scopes.
  - The probe did not mutate this line. One more case in the link test (doctor-knowledge.test.ts:318), at the workspace's name with `storeDir: elsewhere`, kills it.
- F-3 · advisory · src/modules/knowledge/resolve.ts:261-263 · Q1: the `!create` return and `ensureParents` after `refuseForeign` cover a name that went away between the listing and the look. That is a race no test drives. Defence in depth, as the comment says.
- F-4 · advisory · src/modules/knowledge/repo.ts:85-88 · Q6: the permissions hint now appears only for EACCES/EPERM. No test shows a refusal with another code (say ENOTDIR's neighbours, EIO or ELOOP) leaving the hint out. Mostly hard to provoke; the EACCES side is held by the new assertions.
- F-5 · advisory · tests/unit/knowledge-index.test.ts:619 · Q1: for the listable-but-not-searchable case (0o600), the test skips `ensureFresh`, and repo.ts:852 `fingerprintOf` still swallows. A refresh at 0o600 is held only by the rebuild path. This matches the documented design (repo.ts:847-851), so it is not a defect.
- F-6 · advisory · tests/unit/knowledge-repo.test.ts:1769 · Carried (round seven F-3). The `[\\:]` clause at src/core/git.ts:69 is held by no case on any platform.
- F-7 · advisory · tests/unit/knowledge-repo.test.ts:1658 · Carried. The fixture leaves no intent record, so moving `refuseForeign` after `revertInterrupted` survives.
- F-8 · advisory · src/cli/commands/knowledge.ts:258 · Carried. No test holds that `adopt` and `list` print as each repository finishes.
- F-9 · advisory · src/modules/knowledge/repo.ts:1360 · Carried. No test holds `underOwnLease`'s `started ||` rule.
- F-10 · advisory · src/cli/commands/knowledge.ts:239 · Carried. Nothing tests what the commands print for a listed folder with no repository.
- F-11 · advisory · src/modules/knowledge/store.ts:842 · Carried. Swapping record-first and kept bytes in `adoptIn` leaves the suite green.
- F-12 · advisory · tests/unit/knowledge-index.test.ts:299 · Carried. No test adds a file during a write's git calls (a stated known limit).
- F-13 · advisory · tests/unit/knowledge-index.test.ts:314 · Carried (Q5). The rebuild-order test depends on the internal renewal count.
- F-14 · advisory · tests/unit/knowledge-store.test.ts:440 · Carried (AC-8). Only the version probe times out, and the test does not check that the process is gone.
- F-15 · advisory · tests/unit/knowledge-repo.test.ts:316 · Carried (AC-2). The parent's `.gitignore` weakens the empty-status proof.
- F-16 · advisory · tests/unit/knowledge-repo.test.ts:547 · Carried (AC-13). Clipping is checked on the thrown message, not on the log line.
- F-17 · advisory · tests/unit/knowledge-resolve.test.ts:85 · Carried (AC-2). The test resolves through the row, not through the manifest.

Round seven's advisories that this commit closed:
- F-2 (refuseLinkedRoots' kindAt) is now held by knowledge-index.test.ts:483 (`openRepo(store, WORKSPACE)` is `invalid`).
- F-4 (no errno asserted) is now held by the EACCES assertions in all three files.
- F-1 (the removal loop's kindAt) is now held for a link or a file: mutation 1 is killed, because the scan sets the name aside but no longer refuses before the loop. Only the unreadable-between-scan-and-loop race is still unheld.

Round seven's two upheld defects, checked against the new tests:
- Doctor listing (checks.ts:590). doctor-knowledge.test.ts:298-315 runs both 000 and 600, with a database and without one. With the old catch-all `[]`, the no-database check gave "ok", so the test fails on reversion (mutation 9 confirms).
- Link or file at a project's folder (index-store.ts:594). knowledge-index.test.ts:511-542 checks the rows, the entry count and the folder listing before and after, plus the write refusal and the recovery once the folder is put back. With the round-seven code the rows are deleted and `refused` is empty, so it fails on reversion (mutations 1-4).

Nothing is true by construction: every assertion reads disk state, database rows or what doctor prints, never a stub's own answer. Fixtures are neutral (`path:/x`, `path:/work/site`, `gitdir:/x/.git`, `moved-aside`, `outside`, `Zoë`).

## Outside the change
- none

## Not answerable
- Q7 for lines outside the round-eight commit · the hand mutation report (probes/round-eight-mutations.md) mutates only this commit's lines; F-1 and F-2 were found by reading, and neither was run.
- The permission cases on Windows or as root · knowledge-index.test.ts:567/603 and doctor-knowledge.test.ts:298/337 return early there, and no such run was recorded. In that environment nothing holds the unreadable-folder rules.

Paths reviewed:
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/unit/knowledge-index.test.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/unit/knowledge-resolve.test.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/unit/doctor-knowledge.test.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/modules/knowledge/resolve.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/modules/knowledge/repo.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/modules/knowledge/index-store.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/doctor/checks.ts
