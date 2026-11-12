# Probe: recursive removal of a git repository on the macOS runner

Run on 2026-11-12 on GitHub's `macos-latest` runner (macOS 26.7.2, arm64, git 2.56.0 from Homebrew at `/opt/homebrew/bin/git`, Bun 1.4.2), from a throwaway branch `probe/macos-rm` (three workflow runs: 43295316572, 43296827248, 43299412544). The same three scripts on the author's machine (macOS 27.2, Apple Git 2.54.0, Bun 1.4.2) failed 0 times in every case, at 5 and 20 repetitions.

Every repository below is made with `git init`, then three commits of one file each, with `GIT_CONFIG_GLOBAL=/dev/null` and `GIT_CONFIG_NOSYSTEM=1`. "Failed" means `rmSync(root, { recursive: true })` threw, or the folder was still there.

## Run 1 (300 repetitions each)

| Case | Failed |
| :- | :- |
| A plain tree, no git | 0 of 300 |
| B git repository, `rmSync` recursive | 275 of 300, `ENOENT … lstat '<root>'`, the tree left half removed |
| C the knowledge store's project repository (two writes, then the removal the failing test makes) | 0 of 300 |
| D `rmSync(root, { recursive: true, force: true })` under a parent of mode 0500, which must throw | 283 of 300 did not throw, and left `shared/.git` in place |

## Run 2 (150 repetitions each)

| Case | Failed |
| :- | :- |
| B git repository, `rmSync` | 108 |
| E plain tree, files of mode 0444 | 0 |
| F plain tree, 20 files a folder | 0 |
| I git repository made with `--template=` | 111 |
| J a copy of a git repository (`cpSync`), `rmSync` | 0 |
| J2 a copy of a git repository (`cp -R`), `rmSync` | 0 |
| G git repository, a removal written by hand (list, then unlink) | 115, the first: `ENOENT … lstat '<root>/.git/objects/maintenance.lock'` |
| H git repository, `fs.promises.rm` | 108 |
| H2 git repository, `rmSync` with `maxRetries: 3` | 123 |
| H3 git repository, `rmSync` twice | 0 |
| K git repository, `rm -rf .git/hooks` run first (a process between the commit and the removal) | 0 |

The copies never fail and the hand-written removal names the file: `.git/objects/maintenance.lock` is listed, and gone before it is looked at. Something creates and removes it while the removal runs.

## Run 3 (150 repetitions each)

`GIT_TRACE=1 git commit` on the runner, and on the author's machine alike:

```
trace: built-in: git commit -q -m t
trace: run_command: git maintenance run --auto --quiet --detach
trace: built-in: git maintenance run --auto --quiet --detach
```

`maintenance.auto`, `maintenance.autoDetach`, `gc.auto`, `gc.autoDetach` and `maintenance.strategy` are all unset in the repository.

| Case (settings given with `-c` on every git call) | Failed | `maintenance.lock` present right after the last commit |
| :- | :- | :- |
| P none | 96 of 150 | 136 times |
| Q `maintenance.autoDetach=false` and `gc.autoDetach=false` | 0 | 0 |
| Q1 `maintenance.autoDetach=false` alone | 0 | 0 |
| Q2 `gc.autoDetach=false` alone | 0 | 0 |
| R `maintenance.auto=false` | 0 | 0 |
| S `gc.auto=0` | 0 | 0 |
| T the two `autoDetach` settings through `GIT_CONFIG_COUNT` in the environment | 0 | 0 |

## What it shows

After a commit returns, git's own `git maintenance run --auto --detach` is still running in the repository: it holds `.git/objects/maintenance.lock` and removes it when it ends. A recursive removal that runs meanwhile lists the lock and finds it gone. Bun's `rmSync` then stops with `ENOENT`, named by the root's path, leaving the tree half removed; with `force: true` it stops the same way and reports nothing.

## What it does not show

- Why the author's machine never fails: the same detached command is started there. Not measured; the likely reading is that the process ends sooner than the removal starts.
- Why case C never failed in 300 repetitions while the suite's same removal fails once in several runs. Not measured; the store's last call before the removal is not a commit.
- Which of Bun's steps turns one missing child into an `ENOENT` for the root. Bun's source was not read.

## After the change (pull request 41)

| Run | Commit | `check (macos-latest)` | `check (ubuntu-latest)` |
| :- | :- | :- | :- |
| 43303693995 | `f7955dc` | failed on the item's own new test alone (an exact count of loose objects); the three tests that used to fail passed | failed on the same new test |
| 43305613360 | `2f7edd8` | not read (the run was replaced) | failed on the same new test: git 2.56.0 found nothing due with `gc.auto=1` alone |
| 43306754559 | `421df55` | passed | passed |

git 2.56.0 runs on both runners. Its release notes say that from 2.54.0 `git maintenance` uses the geometric strategy by default, whose loose-object threshold is `maintenance.geometric-repack.auto`; Apple's git 2.54.0 on the author's machine repacked with `gc.auto=1` alone. The compaction test lowers both.

One green run does not show that an intermittent failure is gone: one of the three tests failed in 4 of the 6 failed runs read before the change (43291158026, 43274479753, 43266344890, 43203363318). The later runs on the runner are the evidence.
