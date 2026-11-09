# Probe: the security reviewer's round-four findings, run

The security reviewer filed F-1 and F-2 in round four (links inside a dropped repository's `.git/`) and said it reasoned them from git's source and did not run them. Its "Not answerable" list asks about git's behaviour for both, and about `clearIntent` on a link to a folder. This probe runs all of it against the code under review, through the module's own entry points (`writeEntry`, `adopt`, `clearIntent`).

Run on 2026-11-09 with git 2.54.0 (Apple Git-157) and the repository's pinned Bun, in temporary directories. In each case the workspace repository is made by `ensureRepo`, and then one thing inside its `.git/` is replaced by a link, as a dropped folder could carry it.

```
F-1 (a): .git/COMMIT_EDITMSG is a link to a file of the person's
  writeEntry: returned "written"
  the person's file now holds: "knowledge: create an-entry (v1)\n"
F-1 (b): the same link, and an adopt of a file whose name holds a new line
  adopt: returned 1
  the person's file now holds: "knowledge: adopt 1 change made outside the engine\n\nentries/a\necho a-line-of-its-own\n"
F-2 (a): .git/logs/HEAD is a link to a file of the person's
  writeEntry: returned "written"
  the person's file grew: true
  it now holds the writer's name: true
F-2 (b): .git/refs and .git/objects are links into another repository
  writeEntry: returned "written"
  the other repository's main moved: true
  its newest commit says: "Zoë Writer|knowledge: create an-entry (v1)"
clearIntent: the record's path is a link to a folder of the person's
  clearIntent: returned
  the link is gone: true
  the folder still holds: ["kept.txt"]
```

What it shows:

- F-1 (a). `git commit -q --only -m` writes the commit message through a `.git/COMMIT_EDITMSG` that is a link: the person's file is emptied and holds the message. The write completes.
- F-1 (b). With the same link, an adopt of a file whose name holds a new line puts the rest of that name on a line of its own in the person's file.
- F-2 (a). With `.git/logs/HEAD` a link, a line that holds the writer's name is appended to the person's file.
- F-2 (b). With `.git/refs` and `.git/objects` links into another repository, the store's commit lands on that repository's `main`.
- `clearIntent`. `rmSync` with `recursive` and `force` removes a link to a folder and leaves the folder and what it holds. It does not go into the target.

What it does not show: git versions other than 2.54.0; Windows.

## The test-quality reviewer's open question, run

The test-quality reviewer asked in round four whether the test "git never runs in a repository nested in the store's" goes red with only the `--ignore-submodules=all` flag dropped from `statusOf`. Run after every reviewer had answered and before the judge was launched: the one line was commented out, the test file was run, and the line was put back (`git status` then showed no tracked file changed).

```
(fail) a folder that is not the store's own repository > git never runs in a repository nested in the store's
  at tests/unit/knowledge-repo.test.ts:1525   expect(statusOf(store, repo, [])).toEqual([])
 70 pass
 1 fail
```

It goes red, and already in its first half: without the flag, `git status` lists the gitlink in the index, which the flag hides.
