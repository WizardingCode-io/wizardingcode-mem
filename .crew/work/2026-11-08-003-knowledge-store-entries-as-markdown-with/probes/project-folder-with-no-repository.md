# Probe: `rebuild` and `doctor` against a project's folder that is still there and holds no repository

Asked by the risk reviewer in round eight (F-1, an advisory): it read from the code that a project's folder emptied by hand, or whose `.git` was deleted, keeps its old index rows through `rebuild`, "and `rebuild` prints nothing about it". It did not run it.

Run on 2026-11-09 against the code under review (round eight), on macOS, in a temporary data directory, through the command line (`wizardingcode-mem knowledge rebuild`, then `wizardingcode-mem doctor`). The workspace and a project hold one entry each; the project has only a `path:` alias.

```
== the project's folder, emptied by hand ==
before: {"repos":["knowledge/projects/3131ba4bc674f915","knowledge/workspace"],"entries":["in-the-project","in-the-workspace"]}
knowledge rebuild: exit 0
  stdout:
    knowledge/workspace: 1 entry, 0 proposals (0 open)
    knowledge/projects/3131ba4bc674f915: not a repository
after: {"repos":["knowledge/projects/3131ba4bc674f915","knowledge/workspace"],"entries":["in-the-project","in-the-workspace"]}
doctor's knowledge line: warn  knowledge: knowledge/projects/3131ba4bc674f915 is not a git repository (1 repository, 1 entry, 0 drafts, 0 open proposals)

== the project's folder, its .git deleted ==
before: {"repos":["knowledge/projects/3131ba4bc674f915","knowledge/workspace"],"entries":["in-the-project","in-the-workspace"]}
knowledge rebuild: exit 0
  stdout:
    knowledge/workspace: 1 entry, 0 proposals (0 open)
    knowledge/projects/3131ba4bc674f915: not a repository
after: {"repos":["knowledge/projects/3131ba4bc674f915","knowledge/workspace"],"entries":["in-the-project","in-the-workspace"]}
doctor's knowledge line: warn  knowledge: knowledge/projects/3131ba4bc674f915 is not a git repository (1 repository, 1 entry, 0 drafts, 0 open proposals)
```

What it shows:

- The first half of the reviewer's reading holds: the project's entry row stays in the index after `rebuild`, in both cases, and `rebuild` exits 0. In the first case the file the row describes is gone.
- The second half does not: `rebuild` prints `<folder>: not a repository` for it, and `doctor` warns `<folder> is not a git repository`.

What it does not show: what a reader of the index is given for that row (no hook, tool or view reads the index in this part; a read through `openRepo` gives no repository); Linux; Windows.
