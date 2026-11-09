# test-quality findings for 2026-11-08-003-knowledge-store-entries-as-markdown-with
reviewer: review-test-quality
read: 6 test files (knowledge-store, knowledge-repo, knowledge-index, knowledge-resolve, doctor-knowledge, knowledge-cli, where round two changed them), 19 criteria

## Findings
- F-1 · defect · tests/unit/knowledge-index.test.ts:335 · Data's upheld defect, write path (settle has the same order as rebuildRepo). The test adds the hand-made file at the write's first renewal, which is `checkTarget`'s `git status` (store.ts:238, via the renew in runGit at repo.ts:311). That runs before `commit` takes `undisturbed` (store.ts:300), so the test only covers the window the fix closes. A file added at the next renewals, inside `commit`'s `git add` and `git commit` (repo.ts:695/717), lands after the `undisturbed` check. It is then counted in the fingerprint `settle` records (store.ts:360) but is not indexed, and `ensureFresh` never rebuilds. That is the loss the data gate upheld. No test puts the file there, and reading the code, such a test would fail today (rubric Q1).
- F-2 · advisory · tests/unit/knowledge-index.test.ts:314 · The rebuild-order test depends on the internal renewal count (`renewals !== 2`, `expect(renewals).toBe(2)`) and on the order of calls inside rebuildRepo (rubric Q5). It does fail on reversion: if the fingerprint is taken inside the transaction, `late` stays out after `ensureFresh`. But adding one more `renew` would move the file to a point the test does not mean to cover. The write test at line 335 depends on the same thing implicitly.
- F-3 · advisory · tests/unit/knowledge-store.test.ts:439 · Still as in round one (AC-8): at this level only the `git --version` probe times out. No git call inside the write does.
- F-4 · advisory · tests/unit/knowledge-repo.test.ts:342 · Still as in round one (AC-8 "killed"): only the "timed out" message is checked, not that the process is gone.
- F-5 · advisory · tests/unit/knowledge-repo.test.ts:245 · Still as in round one (AC-2): the parent's `.gitignore` holds `data/`, so the parent's `status` is empty whatever happens. The ceiling guard is held only by the environment test at line 395.
- F-6 · advisory · tests/unit/knowledge-repo.test.ts:381 · Still as in round one (AC-13): stderr clipping is checked on the thrown message, not on the log line.
- F-7 · advisory · tests/unit/knowledge-resolve.test.ts:83 · Still as in round one (AC-2 "gains a remote ... through the manifest"): the gained-remote test resolves through the `knowledge_repos` row. The manifest path is covered without a gained remote (line 154). The new test at line 101 does check that the manifest learns the remote in its own commit.

Round one's upheld test-quality defects are closed:
- AC-18, a caller's id: knowledge-store.test.ts:640 passes `id` and `entryId` to a person's write and to an agent's. It checks fresh ids in the result, the files and the index, so it would fail if a caller's id were used.
- AC-15, redaction of title and subject: knowledge-store.test.ts:620 compares the title, the subject and the slug with the redacted values, and checks that the file and the commit subject hold no secret. Dropping either `clean()` call fails it.

The other gates' fixes each have a test that would fail without them:
- Security commondir / config.worktree / worktreeConfig / textconv / driver: knowledge-repo.test.ts:895.
- A filter that would run through config.worktree: line 926, checked with a marker file.
- A `.git` that is a gitfile or a symlink, with the outside repository's HEAD, status and count unchanged: line 947.
- Risk, hand edits after an interruption kept: lines 736 and 771. The interrupted adopt: line 820. Both check that the person is told.
- Architecture, a too-new schema in rebuild, refresh, listing and openRepo: knowledge-index.test.ts:356. In every CLI command: knowledge-cli.test.ts:431.
- Code-quality, the doctor catch: doctor-knowledge.test.ts:206 renames a column and expects a warning, not ok.
- Data, rebuildRepo order: knowledge-index.test.ts:309 (see F-2). For the write path, see F-1.

The round-one fixture names that used real people (Q8) are gone.

## Outside the change
- none

## Not answerable
- Question 7 (mutation) · no mutation report was named for this item.
- Code-quality fixes that only remove code (knowledge.ts:177, repo.ts:477) and the doctor version compare's move to the shared rule · these are refactors with no new behaviour to test; the version boundary is still covered at doctor-knowledge.test.ts:77-80.
- Data's personal-data retention defect · a documentation ruling, not a test question.
