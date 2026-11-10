# Probe: dropped object files, the store's commit and git's automatic gc

Asked by the security reviewer in round six (F-1, an advisory, and its "Not answerable"): it reasoned from git's source that about 28 files dropped into `objects/17` trip git's auto-gc estimate, that the store's own `git commit` then starts a detached `git maintenance run --auto`, and that this gc removes `commit-graph-chain` and `*.graph` files in a folder reached through a linked `objects/info/commit-graphs`. It did not run it. The risk reviewer's round-six F-3 names the same detached gc.

Run on 2026-11-09 against the code under review, with git 2.54.0 (Apple Git-157) on macOS, in a temporary data directory. The workspace repository is made by `ensureRepo`; 28 empty files with 38-character hex names are put in `objects/17`; `objects/info/commit-graphs` is made a link to a folder that holds `commit-graph-chain`, `graph-0000.graph` and `notes.txt`; then a person's `writeEntry` commits. The probe waits six seconds after the write returns.

```
writeEntry: written
gc left a log or a pid file: false false
packs now: 0
the person's folder now holds: ["commit-graph-chain","graph-0000.graph","notes.txt"]
```

What it shows: on this git and in this setup, the write completes, no gc log, pid file or pack appears within six seconds, and the three files in the linked folder are still there. The removal the reviewer reasoned was not reproduced.

What it does not show: why no gc ran (the estimate, the empty files, or a gc that started and ended at once without packing were not told apart); git 2.32, or any other version; a wait longer than six seconds; a repository that reaches git's threshold on its own, with real loose objects. The reviewer's reading of git's source is not contradicted by one run that did not trigger it.
