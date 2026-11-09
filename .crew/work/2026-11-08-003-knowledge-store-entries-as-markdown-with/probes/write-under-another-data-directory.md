# Probe: a write, and `doctor`, under a data directory with no `knowledge/` folder, against a database that holds knowledge rows

Asked in round nine by the data reviewer (F-1, an advisory, and its "Not answerable"), by the architecture reviewer (F-1, an advisory, the same path) and by the risk reviewer (F-1, an advisory; and its "Not answerable": what `doctor` says in this state). Each reasoned from `src/modules/knowledge/resolve.ts:236-254` that the refusal round nine added to `rebuild` does not cover a write. None ran it.

Run on 2026-11-09 against the code under review (round nine), on macOS, in a temporary folder. Two data directories share one database. The workspace and a project (only a `path:` alias) get an entry each under the first; the second is empty.

## A write for the project under the second data directory

```
written under the first: {"repos":["knowledge/projects/3131ba4bc674f915","knowledge/workspace"],"entries":2}
the second data directory holds: []
rebuild under the second, before any write there: refused: <tmp>/wcm-probe-8xnV46/data-two/knowledge is not there, and the index holds 2 repositories under it; nothing was forgotten. If the knowledge is under another data directory (WIZARDINGCODE_MEM_DATA_DIR, WIZARDINGCODE_HOME), run rebuild under that one. If the folder was removed on purpose, make it aga
  rows: {"repos":["knowledge/projects/3131ba4bc674f915","knowledge/workspace"],"entries":2}
a write for the project under the second: accepted
  rows: {"repos":["knowledge/projects/3131ba4bc674f915-2","knowledge/workspace"],"entries":1}
  project folders under the first: ["3131ba4bc674f915"] under the second: ["3131ba4bc674f915-2"]
rebuild under the second, after that write: returned, results 2, refused 0
  rows: {"repos":["knowledge/projects/3131ba4bc674f915-2","knowledge/workspace"],"entries":1}
rebuild under the first again: results 1, orphans ["knowledge/projects/3131ba4bc674f915"]
  rows: {"repos":["knowledge/workspace"],"entries":1}
  the project's repository under the first: none
```

(The refusal's text is cut at 300 characters by the probe.)

## `doctor` under the second data directory

```
the index holds 1 knowledge repository row(s), written under the first data directory
doctor under the first data directory:  ok: 1 repository, 1 entry, 0 drafts, 0 open proposals
doctor under the second (no knowledge/), same database: skip: no knowledge repository yet
```

What it shows:

- The reviewers' reading holds. `rebuild` under the second data directory is refused while it has no `knowledge/` folder. A write for the project there is accepted: it makes `knowledge/` under the second, gives the project a folder `<name>-2` there, and points the project's row at it. After that write `rebuild` under the second is not refused. Back under the first, the project's folder is an orphan and the project has no repository.
- The first data directory's files are not touched at any step.
- `doctor` under the second says "skip: no knowledge repository yet": it does not say that the index holds rows.

What it does not show: two real processes with `WIZARDINGCODE_MEM_STORE_DIR` set (the probe uses one process, one database handle and two stores that differ only in their data directory); a project with a `remote:` or `gitdir:` alias; Linux; Windows.
