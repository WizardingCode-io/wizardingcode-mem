# Probe: round five's security findings, run against the fixed code

The same cases as `security-round-five-findings.md`, run on 2026-11-09 after round five's defects were fixed, with git 2.54.0 (Apple Git-157) on macOS, in temporary directories.

```
F-1 (a): .git with mode 0300, and COMMIT_EDITMSG a link to a file of the person's
  writeEntry: refused: <tmp>/…/knowledge/workspace/.git cannot be listed, so the knowledge store cannot check what git would write through; make it readable
  the person's file now holds: "the person's own lines\n"
F-1 (b): .git/logs with mode 0100, and logs/HEAD a link to a file of the person's
  writeEntry: refused: <tmp>/…/knowledge/workspace/.git/logs cannot be listed, so the knowledge store cannot check what git would write through; make it readable
  the person's file grew: false
  it now holds the writer's name: false
F-2: knowledge/projects is a link to a folder outside the data directory
  writeEntry for a project: refused: <tmp>/…/knowledge/projects is not a folder of its own (a link, or a file); the knowledge store keeps its repositories under it and never follows a link out of the data directory. Remove it
  folders made in the outside folder: 0
F-4: HEAD names a ref that climbs out of .git, to a file that holds a hash
  headOf: returned null
```

What it shows: a folder of `.git` that cannot be listed refuses the repository, and nothing is written through the link inside it; a link at `knowledge/projects` is refused before anything is created; a HEAD that names a path out of the git directory is read as no commit.

What it does not show: git versions other than 2.54.0; Windows.

## What the check costs, and why the object folders are not listed

The security reviewer's round-five F-3 (an advisory) asked for the files inside `objects/pack`, `objects/info` and the fan-out folders to be listed too, and called it cheap. Measured, 200 runs of `refuseForeign` each, on this machine:

```
listing every folder of objects/:          as the code stands (objects' folders not entered):
a new repository:   0.256 ms per check     a new repository:   0.150 ms per check
500 loose objects:  4.344 ms per check     500 loose objects:  0.288 ms per check
2000 loose objects: 5.305 ms per check     2000 loose objects: 0.284 ms per check
6700 loose objects: 8.233 ms per check     6700 loose objects: 0.262 ms per check
```

Every open pays the check, a read included, and a read took about 1 ms before. Listing the object folders was written, measured, and taken out again. ADR 0024 states the limit under "Known limits": a linked object or pack there has git read another repository's objects, nothing is written through it, and the sync part closes it before it sends objects anywhere.

## Write latency with the code as it stands

```
first write, creating the repository: 100 ms
create: n=30 p50 39 ms, p95 43 ms, max 43 ms
update: n=30 p50 39 ms, p95 44 ms, max 44 ms
propose: n=30 p50 40 ms, p95 45 ms, max 52 ms
accept: n=30 p50 57 ms, p95 68 ms, max 69 ms
read: n=30 p50 0 ms, p95 1 ms, max 1 ms
rebuild of 31 entries and 30 proposals: 13 ms
```

Load average 6.6 at the time. These are the figures in ADR 0024's table.
