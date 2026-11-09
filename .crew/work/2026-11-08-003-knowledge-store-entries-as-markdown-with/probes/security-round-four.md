# Probe: round three's two security findings, run against the fixed code

The same cases as `security-round-three-findings.md`, run on 2026-11-09 after round three's defects were fixed, with git 2.54.0 (Apple Git-157), in temporary directories, through the module's own entry points. "program ran" means the marker file the program writes exists.

```
F-1 (a): a hook dropped into knowledge/.no-hooks before the first write
  writeEntry: returned "written"
  program ran: false
F-1 (b): a knowledge/.gitconfig-empty that holds a filter and an attributes file
  writeEntry: returned "written"
  program ran: false
F-1 (c): a knowledge/.template that holds a config and info/attributes
  writeEntry: returned "written"
  program ran: false
F-2: a link under entries/, an index entry beyond it, and an intent record
  update-index (the dropper's index): returned
  statusOf for the path: returned ["AD entries/sub/victim.txt"]
  openRepo: returned "repo"
  the person's file outside the repository still exists: true
F-2 (i): the index entry is marked intent-to-add
  statusOf for the path: returned [" D entries/sub/victim.txt"]
  openRepo: returned "repo"
  the person's file outside the repository still exists: true
F-2 (ii): the index entry is a regular one whose blob is the file's content
  statusOf for the path: returned ["AD entries/sub/victim.txt"]
  openRepo: returned "repo"
  the person's file outside the repository still exists: true
```

What it shows:

- F-1. The store no longer uses a folder or a file of its own under `knowledge/`: the three dropped things are never read, the write completes, and no program runs.
- F-2. In all three variants the person's file outside the repository stays, and `openRepo` returns: the path beyond the link is taken out of the index and left, the record is removed, and the repository is usable. Variant (ii), which before left every command failing, now opens.

What it does not show: git versions other than 2.54.0; Windows.

The same cases are held by tests in `tests/unit/knowledge-repo.test.ts`: the four under "nothing of the store's own sits beside the repositories", "a file reached through a link inside the repository is never removed", "a regular index entry beyond a link does not leave the repository refusing every command" and "undoing refuses a path whose folder is a link".
