# Probe: round four's security findings, run against the fixed code

The same cases as `security-round-four-findings.md`, run on 2026-11-09 after round four's defects were fixed, with git 2.54.0 (Apple Git-157), in temporary directories, through `writeEntry`, `adopt` and `clearIntent`.

```
F-1 (a): .git/COMMIT_EDITMSG is a link to a file of the person's
  writeEntry: refused: <tmp>/…/knowledge/workspace/.git/COMMIT_EDITMSG is a link, and the knowledge store never lets git write through one; remove it
  the person's file now holds: "the person's own lines\n"
F-1 (b): the same link, and an adopt of a file whose name holds a new line
  adopt: refused: (the same message)
  the person's file now holds: "the person's own lines\n"
F-2 (a): .git/logs/HEAD is a link to a file of the person's
  writeEntry: refused: <tmp>/…/knowledge/workspace/.git/logs/HEAD is a link, and the knowledge store never lets git write through one; remove it
  the person's file grew: false
  it now holds the writer's name: false
F-2 (b): .git/refs and .git/objects are links into another repository
  writeEntry: refused: <tmp>/…/knowledge/workspace/.git/objects is a link, and the knowledge store never lets git write through one; remove it
  the other repository's main moved: false
  its newest commit says: "probe|the project's commit"
clearIntent: the record's path is a link to a folder of the person's
  clearIntent: returned
  the link is gone: true
  the folder still holds: ["kept.txt"]
```

What it shows: in each case the repository is refused before git runs, by the path of the link; the person's file is as it was, and the other repository's branch did not move.

What it does not show: git versions other than 2.54.0; Windows.

The same cases are held by the test "a link anywhere inside .git is refused before git runs, and nothing is written through it" in `tests/unit/knowledge-repo.test.ts`, which puts a link at ten places inside `.git/`.

## Write latency, measured again

Each open now reads every entry of `.git/` with its kind. Measured on the same machine as ADR 0024's table (an Apple silicon Mac, git 2.54.0), 30 runs of each operation, load average 13 at the time:

```
first write, creating the repository: 92 ms
create: n=30 p50 44 ms, p95 52 ms, max 53 ms
update: n=30 p50 44 ms, p95 53 ms, max 54 ms
propose: n=30 p50 44 ms, p95 50 ms, max 59 ms
accept: n=30 p50 71 ms, p95 77 ms, max 80 ms
read: n=30 p50 1 ms, p95 1 ms, max 2 ms
rebuild of 31 entries and 30 proposals: 15 ms
```

The figures before round three's change were 51, 49, 48 and 79 ms at p50 for the four writes. They did not rise: the walk reads about ten folders, and creating a repository no longer copies a template.
