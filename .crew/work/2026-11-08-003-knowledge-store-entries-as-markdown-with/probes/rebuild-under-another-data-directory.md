# Probe: `rebuild` under a data directory with no `knowledge/` folder, against a database that holds knowledge rows

Asked by the data reviewer in round eight (F-1, an advisory, and its "Not answerable"): it reasoned from `index-store.ts:595` that when `knowledge/` is absent as a whole and `knowledge_repos` holds rows, `rebuild` deletes every one of them, and that one store directory shared by two data directories (`WIZARDINGCODE_MEM_STORE_DIR` from the environment) is how the disk gets there. It did not run it.

Run on 2026-11-09 against the code under review (round eight), on macOS, in a temporary folder. Two data directories share one database. The workspace repository and a project's repository, an entry each, are written under the first; the project has only a `path:` alias. `rebuildAll` is then called with the second data directory, which is empty, and again with the first.

```
under the first data directory: {"repos":[{"scope":"project","path":"knowledge/projects/3131ba4bc674f915"},{"scope":"workspace","path":"knowledge/workspace"}],"entries":2}
second data directory holds: []
rebuild under the second: returned, results 0, refused 0
  rows: {"repos":[],"entries":0}
rebuild under the first again: results 1, refused 0, orphans ["knowledge/projects/3131ba4bc674f915"]
  rows: {"repos":[{"scope":"workspace","path":"knowledge/workspace"}],"entries":1}
  the project's repository: none
```

What it shows:

- The reviewer's reading holds. Under the data directory that has no `knowledge/` folder, `rebuild` returns with nothing refused and every knowledge row is gone.
- Back under the first data directory, the workspace's rows are rebuilt from its files. The project's folder is reported as an orphan, and the project has no repository: with only a `path:` alias, the row was its only tie to its folder. The files were never touched.

What it does not show: the two processes of a real install (the probe uses one process and one database handle, with two stores that differ only in their data directory); a project with a `remote:` or `gitdir:` alias, which its manifest rematches; Linux; Windows.
