# Probe: the security reviewer's round-five findings, run

The security reviewer filed F-1 and F-2 in round five, and F-4 as an advisory, and said it had not run them. The code-quality reviewer's F-1 is the same gap as the security F-1. This probe runs F-1, F-2 and F-4 against the code under review, through `writeEntry` and `headOf`.

Run on 2026-11-09 with git 2.54.0 (Apple Git-157) on macOS and the repository's pinned Bun, in temporary directories.

```
F-1 (a): .git with mode 0300, and COMMIT_EDITMSG a link to a file of the person's
  writeEntry: returned "written"
  the person's file now holds: "knowledge: create an-entry (v1)\n"
F-1 (b): .git/logs with mode 0100, and logs/HEAD a link to a file of the person's
  writeEntry: returned "written"
  the person's file grew: true
  it now holds the writer's name: true
F-2: knowledge/projects is a link to a folder outside the data directory
  writeEntry for a project: returned "written"
  folders made in the outside folder: 1
  it holds: [".git",".gitignore","entries","knowledge.json","proposals"]
  the entry there names the writer: true
F-4: HEAD names a ref that climbs out of .git, to a file that holds a hash
  headOf: returned "0123456789abcdef0123456789abcdef01234567"
```

What it shows:

- F-1 (a). With `.git` at mode 0300 (searched, not listed), the walk reads nothing, the write completes, and git writes its commit message through the link into the person's file.
- F-1 (b). With `.git/logs` at mode 0100, the same happens for the reflog: a line with the writer's name is appended to the person's file.
- F-2. With `knowledge/projects` a link, the store creates a project's whole repository in the folder the link names: its `.git`, its manifest and an entry that names the writer.
- F-4. `headOf` follows a `ref:` that climbs out of `.git` and returns what an outside file holds.

What it does not show: git versions other than 2.54.0; the security reviewer's F-3 (a detached gc, a pack linked into `objects/pack`), which was not run; F-4's read of a device such as `/dev/zero`, which was not run because it would not end.

The risk reviewer's round-five question about a socket in `.git/` is in `fsmonitor-socket.md`.
