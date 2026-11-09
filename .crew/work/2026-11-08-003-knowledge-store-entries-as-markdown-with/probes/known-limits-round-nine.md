# Probe: two statements ADR 0024's known limits now make, run before they were written down

Run by the session on 2026-11-09, on macOS, in temporary folders, against the code of round nine. Round nine's commit adds four lines to "Known limits" in `docs/adr/0024-knowledge-module.md`. Two of them say what the store does in a state no earlier probe ran; this is those two.

```
== (a) the second data directory has an empty knowledge folder of its own ==
written under the first: {"repos":["knowledge/projects/3131ba4bc674f915","knowledge/workspace"],"entries":2}
a write for the project under the second: accepted
  rows: {"repos":["knowledge/projects/3131ba4bc674f915-2","knowledge/workspace"],"entries":1}
  project folders under the first: ["3131ba4bc674f915"] under the second: ["3131ba4bc674f915-2"]
rebuild under the second: returned, results 2, refused 0
  rows: {"repos":["knowledge/projects/3131ba4bc674f915-2","knowledge/workspace"],"entries":1}

== (b) the workspace's manifest deleted from a repository that has commits ==
after the deletion: " D knowledge.json"
after the next write: " M knowledge.json"
commits: 3
```

What it shows:

- (a) One database, two data directories, the second with a `knowledge/` folder of its own. A write for the project under the second is accepted: the project gets a folder under the second, its row points at it, and the index then holds the second's repositories. `rebuild` there is not refused. The first data directory's files are not touched. This is the limit as the ADR states it: the index belongs to one data directory, and `rebuild` refuses only where there is no `knowledge/` folder at all (`rebuild-under-another-data-directory.md` and the test "a data directory with no knowledge folder, and rows in the index, refuses the rebuild and forgets nothing").
- (b) The workspace's manifest, deleted from a repository that has commits, is written back by the next write and left uncommitted (` M knowledge.json`): the write's own commit does not take it. A project's manifest in the same state is not written back (the test "a repository folder or a manifest that cannot be read never costs a project its folder" holds `D knowledge.json` there).

What it does not show: two real processes with `WIZARDINGCODE_MEM_STORE_DIR` set (the probe uses one process, one database handle and two stores that differ only in their data directory); Linux; Windows.
