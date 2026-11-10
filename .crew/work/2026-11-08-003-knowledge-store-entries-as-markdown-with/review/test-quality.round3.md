# test-quality findings for 2026-11-08-003-knowledge-store-entries-as-markdown-with
reviewer: review-test-quality
read: 5 test files (the round-three hunks of knowledge-repo, knowledge-index, knowledge-resolve, doctor-knowledge and knowledge-store, read against repo.ts, store.ts and checks.ts), 19 criteria

## Findings
- F-1 · advisory · tests/unit/knowledge-repo.test.ts:1323 · AC-15/AC-19 security fix (git never runs in a nested repository), rubric Q1. The test does hold the behaviour: undo the whole fix and the marker appears. It does not hold the `--ignore-submodules=all` flag on its own, though. `configArgs` also passes `-c diff.ignoreSubmodules=all` (repo.ts, configArgs), and `git status` honours that setting when no `.gitmodules` overrides it, which is the case in this fixture. So dropping only the flag would most likely leave the test green. I worked this out from git's diff/status config handling and did not run it. The flag is the layer that still wins against a `submodule.<name>.ignore=none`, and no test sets one up. One way to hold it: a `.gitmodules`-free fixture where the store's own `.git/config` is bypassed, or a test that drops `diff.ignoreSubmodules` through a stub-git wrapper and expects the marker to stay absent. `submodule.recurse=false` is held by no test either.
- F-2 · advisory · tests/unit/knowledge-repo.test.ts:430 · The `init.defaultObjectFormat=sha1` and `init.defaultRefFormat=files` settings added to `configArgs` are held by no test (rubric Q1). The test passes on git 2.54.0 whether or not they are passed, because that git already defaults to those formats. A red run was possible: put a PATH wrapper (tests/helpers/stub-git.ts style) in front of the real git that injects `-c init.defaultObjectFormat=sha256` ahead of the store's arguments. Without the fix, `ensureRepo` then writes `extensions.objectformat` and the next `openRepo` refuses its own repository. ADR 0024 records that no such git was run. No criterion names this, hence advisory.
- F-3 · advisory · tests/unit/knowledge-index.test.ts:335 · Round two's F-1, lowered by the ruling and unchanged since. No test adds a file during `commit`'s `git add` and `git commit`. The ADR now states this window as a known limit.
- F-4 · advisory · tests/unit/knowledge-index.test.ts:314 · Carried from round two (Q5): the rebuild-order test depends on the internal renewal count.
- F-5 · advisory · tests/unit/knowledge-store.test.ts:440 · Carried (AC-8): only the `git --version` probe times out; no git call inside the write does.
- F-6 · advisory · tests/unit/knowledge-repo.test.ts:467 · Carried (AC-8 "killed"): only the "timed out" message is checked, not that the process is gone.
- F-7 · advisory · tests/unit/knowledge-repo.test.ts:267 · Carried (AC-2): the parent's `.gitignore` holds `data/`, so the parent's empty status proves nothing. The ceiling guard is held by the environment test at line 520.
- F-8 · advisory · tests/unit/knowledge-repo.test.ts:506 · Carried (AC-13): clipping is checked on the thrown message, not on the log line.
- F-9 · advisory · tests/unit/knowledge-resolve.test.ts:85 · Carried (AC-2): the gained-remote test resolves through the `knowledge_repos` row. The manifest path is covered elsewhere, without a gained remote.

No defects. Reading each round-three test against the code before the fix, these fail when the fix is undone:
- The config tokenizer. If it read only the first header on a line, `[core][filter "x"]` (line 351) would be refused as `core.clean`, and `[core] [diff "x"] textconv` (line 373) as an unreadable line 1. Both tests assert the message names `filter.x.clean` / `diff.x.textconv`, so both fail. Going back to a deny list lets `remote.origin.url`, `alias.st`, `credential.helper`, `core.pager` and the rest through, so line 373 fails. Line 351 also shows with real git that git reads the line as a filter, and that `writeEntry` writes nothing and runs nothing. Line 436 fails without `readRegularFile` (link, 256 KiB).
- The intent record. Line 1042 fails on reversion: the old `readIntent` accepted `.git/config`, and the adopt revert wrote the kept filter into it. Line 1072 covers each path shape (`.GIT`, `..`, `entries/.git/…`, `//`, absolute, `.gitignore`) for `existed`, `created` and `written`. Line 1120 fails under the old `restoreKept`, which allowed `.git/config` and wrote through `entries/linked`. Line 1148 fails because the old `undoStaged` removed `.git/config`.
- The per-path revert. Line 985 fails because the old code unstaged `two.md` and reported it a second time. Line 1007 fails because the old code put back b's hand bytes over the landed commit. knowledge-index.test.ts:1045 fails because the old record held only the kept entry paths.
- refuseForeign additions. Line 1303 fails because the old `writeFileSync`/`existsSync` wrote through the links and created the dangling target. Line 1359 fails without the `.gitmodules` refusal. knowledge-index.test.ts:1026 fails because, without the nested-repository refusal, adopt would commit `entries/notes/`.
- doctor-knowledge.test.ts:991 fails because, without `refuseForeign` in doctor, the entry would be counted through the link (it asserts `0 entries` and `a link`).
- The resolve lease test (knowledge-resolve.test.ts:~138) was written after the code but was seen failing with the lease removed. Its "another process" is a live pid with a foreign owner, which is what `withRepoLeases` refuses.

Nothing is true by construction. Line 430 asserts the config real git writes, not a fixture. No fixture uses a real name.

## Outside the change
- none

## Not answerable
- Q7 (mutation) · no mutation report was named for this item.
- Whether git 2.54.0 honours `diff.ignoreSubmodules` in `git status` exactly as F-1 assumes · I read and did not run. One run settles it: drop `--ignore-submodules=all` from `statusOf` (repo.ts) and run the test at knowledge-repo.test.ts:1323.
