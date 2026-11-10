# Probe: a project's repository folder, its manifest, or its entries folder, with the permission bits off

Run by the session on 2026-11-09, before fixing round seven's two defects, to see whether the same fault (what cannot be looked at is read as not there) existed one level below the folders the reviewers named. No reviewer asked for it. On macOS, in a temporary data directory, as a user who is not root. The project has only a `path:` alias, so its row is its only tie to its folder; its repository holds two entries. Each case changes one mode, runs `rebuild` or a `write` of a third entry, and puts the mode back.

## Against the code round seven reviewed

```
== the repository folder at mode 000 ==
rebuild: returned, results 1, refused 0
  rows as before
  folders: ["3131ba4bc674f915"]
write: accepted
  rows changed: {"repos":[{"scope":"project","path":"knowledge/projects/3131ba4bc674f915-2"},{"scope":"workspace","path":"knowledge/workspace"}],"entries":1}
  folders: ["3131ba4bc674f915","3131ba4bc674f915-2"]

== the repository folder at mode 600 ==
rebuild: returned, results 1, refused 0
  rows as before
  folders: ["3131ba4bc674f915"]
write: accepted
  rows changed: {"repos":[{"scope":"project","path":"knowledge/projects/3131ba4bc674f915-2"},{"scope":"workspace","path":"knowledge/workspace"}],"entries":1}
  folders: ["3131ba4bc674f915","3131ba4bc674f915-2"]

== knowledge.json at mode 000 ==
rebuild: returned, results 1, refused 0
  rows as before
  folders: ["3131ba4bc674f915"]
write: accepted
  rows changed: {"repos":[{"scope":"project","path":"knowledge/projects/3131ba4bc674f915-2"},{"scope":"workspace","path":"knowledge/workspace"}],"entries":1}
  folders: ["3131ba4bc674f915","3131ba4bc674f915-2"]

== entries/ at mode 600 (listed, not searched) ==
rebuild: returned, results 2, refused 0
  rows changed: {"repos":[{"scope":"project","path":"knowledge/projects/3131ba4bc674f915"},{"scope":"workspace","path":"knowledge/workspace"}],"entries":0}
  folders: ["3131ba4bc674f915"]
write: refused: EACCES: permission denied, rm '<tmp>/wcm-probe-GO7WMA/knowledge/projects/3131ba4bc674f915/entries/.three.md.tmp'
  rows as before
  folders: ["3131ba4bc674f915"]

== entries/ at mode 000 ==
rebuild: returned, results 2, refused 0
  rows changed: {"repos":[{"scope":"project","path":"knowledge/projects/3131ba4bc674f915"},{"scope":"workspace","path":"knowledge/workspace"}],"entries":0}
  folders: ["3131ba4bc674f915"]
write: refused: EACCES: permission denied, rm '<tmp>/wcm-probe-zfrQxv/knowledge/projects/3131ba4bc674f915/entries/.three.md.tmp'
  rows changed: {"repos":[{"scope":"project","path":"knowledge/projects/3131ba4bc674f915"},{"scope":"workspace","path":"knowledge/workspace"}],"entries":0}
  folders: ["3131ba4bc674f915"]
```

What it showed: the same fault, one level down. With the repository folder or its manifest unreadable, a `write` was accepted into a second folder `<name>-2`, the project's row was pointed at it, and the index held only the new entry; `rebuild` skipped the repository and said nothing. With `entries/` unreadable, `rebuild` replaced the repository's entry rows with none.

## Against the fixed code

```
== the repository folder at mode 000 ==
rebuild: returned, results 1, refused 1
    refused: <tmp>/wcm-probe-rKNll3/knowledge/projects/3131ba4bc674f915/.git cannot be listed (EACCES), so the knowledge store cannot check what git would write through
  rows as before
  folders: ["3131ba4bc674f915"]
write: refused: <tmp>/wcm-probe-CmNZ6L/knowledge/projects/3131ba4bc674f915/.git cannot be listed (EACCES), so the knowledge store cannot check what git would write through
  rows as before
  folders: ["3131ba4bc674f915"]

== the repository folder at mode 600 ==
rebuild: returned, results 1, refused 1
    refused: <tmp>/wcm-probe-J2Kpb1/knowledge/projects/3131ba4bc674f915/.git cannot be listed (EACCES), so the knowledge store cannot check what git would write through
  rows as before
  folders: ["3131ba4bc674f915"]
write: refused: <tmp>/wcm-probe-EzHOwY/knowledge/projects/3131ba4bc674f915/.git cannot be listed (EACCES), so the knowledge store cannot check what git would write through
  rows as before
  folders: ["3131ba4bc674f915"]

== knowledge.json at mode 000 ==
rebuild: returned, results 2, refused 0
  rows as before
  folders: ["3131ba4bc674f915"]
write: accepted
  rows changed: {"repos":[{"scope":"project","path":"knowledge/projects/3131ba4bc674f915"},{"scope":"workspace","path":"knowledge/workspace"}],"entries":3}
  folders: ["3131ba4bc674f915"]

== entries/ at mode 600 (listed, not searched) ==
rebuild: returned, results 1, refused 1
    refused: <tmp>/wcm-probe-wrnbdw/knowledge/projects/3131ba4bc674f915/entries/one.md cannot be looked at (EACCES); check the permissions of that path and of the folders above it. The knowledge store never takes what it cannot see for gone
  rows as before
  folders: ["3131ba4bc674f915"]
write: refused: EACCES: permission denied, rm '<tmp>/wcm-probe-ZUQLjV/knowledge/projects/3131ba4bc674f915/entries/.three.md.tmp'
  rows as before
  folders: ["3131ba4bc674f915"]

== entries/ at mode 000 ==
rebuild: returned, results 1, refused 1
    refused: <tmp>/wcm-probe-qe3i6y/knowledge/projects/3131ba4bc674f915/entries cannot be looked at (EACCES); check the permissions of that path and of the folders above it. The knowledge store never takes what it cannot see for gone
  rows as before
  folders: ["3131ba4bc674f915"]
write: refused: <tmp>/wcm-probe-5RYvCb/knowledge/projects/3131ba4bc674f915/entries cannot be looked at (EACCES); check the permissions of that path and of the folders above it. The knowledge store never takes what it cannot see for gone
  rows as before
  folders: ["3131ba4bc674f915"]
```

What it shows:

- No case makes a second folder, and no case changes a row it should not. With the manifest unreadable, the write lands in the project's own repository (three entries), since the row names the folder.
- A repository whose folder or whose `entries/` cannot be read is set aside by `rebuild` with the path and the error's code, and the other repository is rebuilt.
- One message is not the store's own: with `entries/` listed and not searched, a `write` fails on the temporary file it writes beside the entry, with the file system's error text. Nothing is written and no row changes. That text was the same before this change.

What it does not show: Linux; a disk fault; `proposals/open/` and `proposals/decided/`, which the same code reads; Windows.

The cases are held by the tests "a repository folder or a manifest that cannot be read never costs a project its folder" and "an entries folder that cannot be read refuses the rebuild, and its rows stay" in `tests/unit/knowledge-index.test.ts`.
