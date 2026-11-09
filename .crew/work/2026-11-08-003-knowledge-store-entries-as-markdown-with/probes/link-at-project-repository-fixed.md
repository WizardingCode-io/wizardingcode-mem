# Probe: a link, or a file, where a project's repository folder was, run against the fixed code

The same case as `link-at-project-repository.md`, run on 2026-11-09 after round seven's risk defect was fixed, on macOS, as a user who is not root. The project has only a `path:` alias, so its row is its only tie to its folder.

```
== a link where the project's repository folder was ==
before: {"repos":[{"scope":"project","path":"knowledge/projects/3131ba4bc674f915"},{"scope":"workspace","path":"knowledge/workspace"}],"entries":2} folders: ["3131ba4bc674f915"]
rebuild: returned, results 1, refused 1
  refused knowledge/projects/3131ba4bc674f915: <tmp>/wcm-probe-bBpdCe/knowledge/projects/3131ba4bc674f915 is a link; the knowledge store never follows one out of its own repository
  after rebuild: {"repos":[{"scope":"project","path":"knowledge/projects/3131ba4bc674f915"},{"scope":"workspace","path":"knowledge/workspace"}],"entries":2}
  folder put back, rebuild again: results 2, refused 0
  rows: {"repos":[{"scope":"project","path":"knowledge/projects/3131ba4bc674f915"},{"scope":"workspace","path":"knowledge/workspace"}],"entries":2}
  openRepo for the project: knowledge/projects/3131ba4bc674f915, entries listed 2
write, with the link in place: refused: <tmp>/wcm-probe-qaadoJ/knowledge/projects/3131ba4bc674f915 is a link; the knowledge store never follows one out of its own repository
  folders: ["3131ba4bc674f915"] rows: {"repos":[{"scope":"project","path":"knowledge/projects/3131ba4bc674f915"},{"scope":"workspace","path":"knowledge/workspace"}],"entries":2}
  openRepo (no create): refused: <tmp>/wcm-probe-qaadoJ/knowledge/projects/3131ba4bc674f915 is a link; the knowledge store never follows one out of its own repository

== a file where the project's repository folder was ==
before: {"repos":[{"scope":"project","path":"knowledge/projects/3131ba4bc674f915"},{"scope":"workspace","path":"knowledge/workspace"}],"entries":2} folders: ["3131ba4bc674f915"]
rebuild: returned, results 1, refused 1
  refused knowledge/projects/3131ba4bc674f915: <tmp>/wcm-probe-uxIYVs/knowledge/projects/3131ba4bc674f915 is not a folder, which is what the knowledge store keeps there
  after rebuild: {"repos":[{"scope":"project","path":"knowledge/projects/3131ba4bc674f915"},{"scope":"workspace","path":"knowledge/workspace"}],"entries":2}
  folder put back, rebuild again: results 2, refused 0
  rows: {"repos":[{"scope":"project","path":"knowledge/projects/3131ba4bc674f915"},{"scope":"workspace","path":"knowledge/workspace"}],"entries":2}
  openRepo for the project: knowledge/projects/3131ba4bc674f915, entries listed 2
write, with the file in place: refused: <tmp>/wcm-probe-h4L6Xb/knowledge/projects/3131ba4bc674f915 is not a folder, which is what the knowledge store keeps there
  folders: ["3131ba4bc674f915"] rows: {"repos":[{"scope":"project","path":"knowledge/projects/3131ba4bc674f915"},{"scope":"workspace","path":"knowledge/workspace"}],"entries":2}
  openRepo (no create): refused: <tmp>/wcm-probe-h4L6Xb/knowledge/projects/3131ba4bc674f915 is not a folder, which is what the knowledge store keeps there
```

What it shows, for a link and for a file alike:

- `rebuild` sets the project's repository aside by name and rebuilds the other one. The project's row and its two entry rows are as they were.
- With the real folder put back, `rebuild` refuses nothing, and the project opens the same folder with its two entries.
- A `write` with the link or the file in place is refused by name. No second folder is made, and no row changes.

What it does not show: a project with a `remote:` or `gitdir:` alias; Linux; Windows.

The same case is held by the test "a link or a file where a project's folder was is refused by name: its rows stay and no second folder is made" in `tests/unit/knowledge-index.test.ts`, and for the workspace by the test after it.
