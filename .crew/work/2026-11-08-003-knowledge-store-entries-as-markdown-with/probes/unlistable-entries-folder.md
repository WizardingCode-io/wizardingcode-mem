# Probe: `rebuild` against a repository whose `entries/` folder cannot be listed

Asked by the data reviewer in round seven (F-1, an advisory, and its "Not answerable"): it reasoned from the code that `listFolder` and `fingerprintOf` read an `entries/` folder that cannot be listed as empty, so a rebuild deletes that repository's entry rows, and that the rows come back at the first refresh once the folder is readable. It did not run it.

Run on 2026-11-09 against the code under review, on macOS, in a temporary data directory, as a user who is not root. The workspace repository holds two entries. The mode of its `entries/` folder is changed, `rebuildAll` is called, the mode is put back, and the repository is opened and refreshed (`ensureFresh`).

```
before: {"repos":1,"entries":2}
entries/ at mode 000: rebuild returned, results 1, refused 0
  rows while unreadable: {"repos":1,"entries":0}
  rows once readable again, after the next refresh: {"repos":1,"entries":2} listed: 2
entries/ at mode 300 (searched, not listed): rebuild returned, results 1, refused 0
  rows while unreadable: {"repos":1,"entries":0}
  rows once readable again, after the next refresh: {"repos":1,"entries":2} listed: 2
```

What it shows:

- The reviewer's reading holds. With `entries/` at mode 000 or 300, `rebuild` is not refused, and the repository's two entry rows are deleted. Its `knowledge_repos` row stays.
- Once the folder is readable again, the next refresh puts both rows back, from the files, which were never touched.
- This is the state ADR 0024's new sentence says is refused ("a folder under `knowledge/` that cannot be looked at or listed … refuses the command"): for the folders inside a repository, it is not.

What it does not show: Linux; a disk fault; `proposals/open/` or `proposals/decided/`, which the same code reads the same way.
