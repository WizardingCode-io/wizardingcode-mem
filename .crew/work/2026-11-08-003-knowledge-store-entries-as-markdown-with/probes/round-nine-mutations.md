# Probe: round eight's two mutants and round nine's rules, each undone against the tests

Run by the session on 2026-11-09, on macOS, against the code of round nine, before its commit. Each mutant changes one line, the test files that should hold it are run with the pinned Bun, and the file is written back. `git status` showed only the round's own changes after the run.

The first two are the mutants round eight's test-quality review named and the judge upheld as defects (`round-eight-two-mutants.md` shows them surviving against round eight's tests). The other four are the lines round nine's commit adds.

```
1 (round eight's F-1) a manifest is written back into a repository that has commits: killed by 2 test(s)
    rebuildAll > a repository folder or a manifest that cannot be read never costs a project its folder
    resolveRepo > the folder a project's row names stays its repository while anything is there, whatever it holds
2 (round eight's F-2) doctor's own listing of the fixed scopes skips a link or a file: killed by 1 test(s)
    doctor: knowledge > a link or a file where the workspace's repository was is a warning that names it, with a database and with none
3 rebuild no longer refuses a data directory with no knowledge folder: killed by 1 test(s)
    rebuildAll > a data directory with no knowledge folder, and rows in the index, refuses the rebuild and forgets nothing
4 rebuild refuses a scope the index holds nothing of: killed by 1 test(s)
    rebuildAll > a data directory with no knowledge folder, and rows in the index, refuses the rebuild and forgets nothing
5 rebuild refuses whenever the knowledge folder is absent, rows or not: killed by 1 test(s)
    rebuildAll > a data directory with no knowledge folder, and rows in the index, refuses the rebuild and forgets nothing
6 the taxonomy is read through a link at the root's name again: killed by 2 test(s)
    doctor: knowledge > a link or a file where the workspace's repository was is a warning that names it, with a database and with none
    rebuildAll > a project's rebuild never reads the taxonomy through a link at the workspace's name
```

What it shows: each of the six, undone alone, fails at least one test.

What it does not show: mutations of lines neither round touched; the permission cases, which return early as root or on Windows.

The mutants, as applied:

1. `src/modules/knowledge/resolve.ts`: `&& headOf(path) === null` dropped from the condition that writes a project's manifest.
2. `src/doctor/checks.ts`, `foldersByHand`: `kindAt(path) !== "absent"` put back to `kindAt(path) === "folder"`.
3. `src/modules/knowledge/index-store.ts`, `rebuildAll`: the refusal's condition made false.
4. The same function: the rows counted for the refusal no longer filtered by the scope asked for.
5. The same function: `known > 0 &&` dropped from the refusal's condition.
6. `src/modules/knowledge/repo.ts`, `taxonomyFor`: the `kindAt(folder) !== "folder"` return removed.
