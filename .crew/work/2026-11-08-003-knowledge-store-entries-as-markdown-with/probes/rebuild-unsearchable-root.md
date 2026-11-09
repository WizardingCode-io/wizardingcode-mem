# Probe: `rebuild` against a `knowledge/projects` whose permission bits are off

Asked by the data reviewer in round six (F-1, and "Not answerable"): it reasoned from the code that `rebuildAll` takes any failed `lstat` as "the folder is gone" and deletes the rows of repositories that are still on the disk, and it did not run it.

Run on 2026-11-09 against the code under review, on macOS, in a temporary data directory, as a user who is not root. The store holds the workspace repository and the repository of one project that is not a git repository (its only alias is a path, so only its row ties it to its knowledge folder). Then the mode of `knowledge/projects` is changed, `rebuildAll` is called, and the mode is put back.

```
before: repositories [{"scope":"project","path":"knowledge/projects/3131ba4bc674f915"},{"scope":"workspace","path":"knowledge/workspace"}] entries 2
folders under knowledge/projects: 1
knowledge/projects at mode 000: rebuild returned, refused 0
  after: repositories [{"scope":"workspace","path":"knowledge/workspace"}] entries 1
  folders still under knowledge/projects: 1
knowledge/projects at mode 600 (listed, not searched): rebuild returned, refused 0
  after: repositories [{"scope":"workspace","path":"knowledge/workspace"}] entries 1
  folders still under knowledge/projects: 1
```

What it shows:

- With `knowledge/projects` at mode 000, `rebuild` returns without a refusal and deletes the project repository's row and its entry row. The folder and its files are still there once the mode is put back.
- The second run starts from the state the first left, so it shows only that nothing comes back: the row that tied the project to its folder is gone, and a manifest is never matched by a path (ADR 0024, known limits).

What it does not show: a `knowledge/` folder itself with its bits off; Linux; the rows coming back, which they do not for this project.
