# Probe: a link, or a file, where a project's repository folder was

Asked by the risk reviewer in round seven (F-1, a defect, and its "Not answerable"): it reasoned from `resolve.ts` and `index-store.ts` that `rebuild` forgets the rows of a project repository whose folder was replaced by a link or a file, and that a `write` then lands in a new, empty repository. It did not run either. The code-quality reviewer's F-5 names the same line (`index-store.ts:594`) as an advisory.

Run on 2026-11-09 against the code under review, on macOS, in a temporary data directory, as a user who is not root. The project has only a `path:` alias (it is not a git repository), so its `knowledge_repos` row is its only tie to its folder. Its repository holds two entries. The folder is moved aside and a link to it, or a regular file, is put at its name.

```
== a link where the project's repository folder was ==
before: {"repos":[{"scope":"project","path":"knowledge/projects/3131ba4bc674f915"},{"scope":"workspace","path":"knowledge/workspace"}],"entries":2} folders: ["3131ba4bc674f915"]
rebuild: returned, results 1, refused 0
  after rebuild: {"repos":[{"scope":"workspace","path":"knowledge/workspace"}],"entries":0}
  folder put back, rebuild again: results 1, refused 0
  rows: {"repos":[{"scope":"workspace","path":"knowledge/workspace"}],"entries":0}
  openRepo for the project: null (no repository)
write, with the link in place: accepted
  folders: ["3131ba4bc674f915","3131ba4bc674f915-2"] rows: {"repos":[{"scope":"project","path":"knowledge/projects/3131ba4bc674f915-2"},{"scope":"workspace","path":"knowledge/workspace"}],"entries":1}
  openRepo (no create): knowledge/projects/3131ba4bc674f915-2

== a file where the project's repository folder was ==
before: {"repos":[{"scope":"project","path":"knowledge/projects/3131ba4bc674f915"},{"scope":"workspace","path":"knowledge/workspace"}],"entries":2} folders: ["3131ba4bc674f915"]
rebuild: returned, results 1, refused 0
  after rebuild: {"repos":[{"scope":"workspace","path":"knowledge/workspace"}],"entries":0}
  folder put back, rebuild again: results 1, refused 0
  rows: {"repos":[{"scope":"workspace","path":"knowledge/workspace"}],"entries":0}
  openRepo for the project: null (no repository)
write, with the file in place: accepted
  folders: ["3131ba4bc674f915","3131ba4bc674f915-2"] rows: {"repos":[{"scope":"project","path":"knowledge/projects/3131ba4bc674f915-2"},{"scope":"workspace","path":"knowledge/workspace"}],"entries":1}
  openRepo (no create): knowledge/projects/3131ba4bc674f915-2
```

What it shows, for a link and for a file alike:

- `rebuild` returns with nothing refused and nothing set aside, and the project's `knowledge_repos` row and its two entry rows are gone.
- Putting the real folder back and rebuilding again does not bring the row back: the project then has no repository (`openRepo` gives null). The files in the folder were never touched.
- A `write` for the project, with the link or the file in place, is accepted: a second folder `<name>-2` is created, the project's row points at it, and the index holds the one new entry. Nothing is said about the folder left behind.
- So the reviewer's reading holds on both paths, including the one it marked "reasoned, not run".

What it does not show: a project with a `remote:` or `gitdir:` alias, which the manifest can rematch; Linux; Windows.
