# Probe: the security reviewer's three round-two findings, run

The security reviewer filed F-1, F-2 and F-3 in round two. It reasoned F-2 from git's submodule behaviour and did not run it, and F-3 rests on `git reset -q -- .git/config …` not failing, which it did not run either. This probe runs all three.

Run on 2026-11-09 in the item's worktree, against the code under review, with git 2.54.0. Each case builds its own data directory and its workspace repository through the module's own functions (`ensureRepo`), then adds what a person who can drop a folder under `knowledge/` could add. The "program" is a shell script inside the temporary directory that appends a line to a marker file and copies its input; "program ran" means the marker file exists afterwards.

```
case 1 (F-1): two section headers on one line, [core][filter "x"]
  git reads the filter: [ "filter.x.clean=<tmp>/program.sh" ]
  checkRepoConfig: returned
  openRepo: returned "repo"
  statusOf: returned ["?? .gitattributes"]
  program ran on status: true
  stagePaths: returned
  program ran on add: true
case 2 (F-2): a gitlink in the index and a nested repository with its own filter
  update-index (the dropper's index): returned
  refuseForeign: returned
  checkRepoConfig: returned
  openRepo: returned "repo"
  statusOf: returned ["AM entries/sub"]
  program ran on status: true
case 3 (F-3): an intent record that names .git/config, with kept bytes for it
  checkRepoConfig before: returned
  openRepo: returned "repo"
  .git/config now has the filter: true
  stagePaths after openRepo: returned
  program ran on add: true
```

What it shows:

- Case 1. git reads `[core][filter "x"]` on one line as a `filter` section (`git config --local --list` prints `filter.x.clean`). `checkRepoConfig` and `openRepo` do not refuse it. With a `.gitattributes` line `* filter=x`, the program runs on `git status` (a tracked file whose time changed) and on `git add`.
- Case 2. With a gitlink at `entries/sub` in the index and a repository in that folder whose own configuration has a filter, `refuseForeign`, `checkRepoConfig` and `openRepo` do not refuse, and `statusOf` runs the nested repository's program.
- Case 3. An intent record of operation `adopt` that names `.git/config`, with kept bytes for it, makes `openRepo` write those bytes over `.git/config` after the configuration was checked. `git reset -q -- .git/config entries/x.md` does not fail. The `git add` that follows runs the program.

What it does not show: git versions other than 2.54.0.

The script is the session's, outside the repository; its three cases are described above in full.
