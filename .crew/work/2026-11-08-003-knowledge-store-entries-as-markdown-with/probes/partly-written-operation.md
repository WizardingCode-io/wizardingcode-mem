# Probe: the revert of an operation killed before it wrote one of its paths

Asked by the risk reviewer in round two, under "Not answerable": for a created path the operation never wrote (absent from both the disk and the index), the revert runs `git reset -q -- <path>`; if git exits non-zero for a path that matches nothing, `openRepo` throws on every knowledge command and the intent record is never cleared.

Run on 2026-11-09 in the item's worktree, against the code under review, with git 2.54.0. The script builds a workspace repository through the module's own functions, writes an intent record by hand, and opens the repository.

```
case 1: a created path the operation never wrote (not on disk, not in the index)
  openRepo returned: a repository
  intent record left: false
  said: []
case 2: git reset -q -- <path matching nothing>, run directly
  exit code: 0
case 3: two paths, one written and staged, the other never written
  openRepo returned
  intent record left: false
  status: []
  said: ["an interrupted write in knowledge/workspace was undone: entries/one.md","an interrupted write in knowledge/workspace left entries/two.md as they are now, since they changed after it; run wizardingcode-mem knowledge adopt to commit them"]
```

What it shows:

- `git reset -q -- <path>` exits 0 for a path that is on neither the disk nor the index (case 2), with `GIT_LITERAL_PATHSPECS=1` as the runner sets it. `openRepo` does not throw, and the record is cleared (cases 1 and 3).
- With only the never-written path (case 1), the paths are clean against HEAD, so the operation is taken as landed: nothing is done and nothing is said.
- With one written path and one never written (case 3), the written one is undone and the tree is clean. The never-written path is reported as "left as they are now, since they changed after it; run wizardingcode-mem knowledge adopt", though the person never touched it and there is nothing to adopt. That sentence is wrong for this case; the tree is right.

What it does not show: git versions other than 2.54.0.
