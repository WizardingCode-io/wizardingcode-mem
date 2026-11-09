# Probe: the security reviewer's two round-three findings, run

The security reviewer filed F-1 and F-2 in round three and said it reasoned them and did not run them. Its "Not answerable" list asks four things about git's behaviour. This probe runs both findings against the code under review, through the module's own entry points.

Run on 2026-11-09 with git 2.54.0 (Apple Git-157), in temporary directories. The "program" is a shell script that appends a line to a marker file; "program ran" means the marker exists afterwards.

## F-1: the store's support folders under `knowledge/`

In each case the file is placed under `<data dir>/knowledge/` before the store runs, then a person's `writeEntry` creates the workspace repository and writes one entry.

```
F-1 (a): a hook dropped into knowledge/.no-hooks before the first write
  writeEntry: returned "written"
  program ran: true
F-1 (b): a knowledge/.gitconfig-empty that holds a filter and an attributes file
  writeEntry: returned "written"
  program ran: true
F-1 (c): a knowledge/.template that holds a config and info/attributes
  writeEntry: refused: the repository's own git configuration sets filter.x.clean, and a knowledge repository carries only the settings git init writes; remove it from <tmp>/…/knowledge/workspace/.git/config
  program ran: true
```

What it shows:

- (a) A `pre-commit` file in `knowledge/.no-hooks/` runs on the store's commit: `core.hooksPath` points there, and the store takes the folder as it finds it.
- (b) A `knowledge/.gitconfig-empty` with `core.attributesFile` and a filter is read as the global configuration of every git call, and the filter runs on the write. The write completes.
- (c) `git init --template` copies the template's `config` and `info/attributes` into the new repository, and the filter runs during the repository's creation. The configuration check then refuses the repository, after the program has run.

## F-2: a link one level under `entries/`

The dropper prepares the index while `entries/sub` is a real folder, then replaces the folder with a link to a folder outside the repository that holds `victim.txt`. The intent record names `entries/sub/victim.txt` as created by a write, with the hash of the outside file's content.

```
F-2 (i): the index entry is marked intent-to-add
  statusOf for the path: returned [" D entries/sub/victim.txt"]
  openRepo: returned "repo"
  the person's file outside the repository still exists: false
F-2 (ii): the index entry is a regular one whose blob is the file's content
  statusOf for the path: returned ["AD entries/sub/victim.txt"]
  openRepo: refused: git rm in <tmp>/…/knowledge/workspace failed: error: the following file has staged content different from both the …
  the person's file outside the repository still exists: true
```

What it shows:

- (i) As the reviewer wrote it. `git status --ignore-submodules=all` lists the intent-to-add entry beyond the link, `git rm --cached -q --ignore-unmatch` exits 0, and `openRepo` deletes the person's file outside the repository.
- (ii) With a regular index entry, `git rm --cached` refuses, so nothing is deleted. `openRepo` then fails with a git error and the record stays, so every command on that repository fails the same way.

What it does not show: git versions other than 2.54.0.
