# Probe: each rule of round seven's fix undone in turn, against the tests

Run by the session on 2026-11-09, on macOS, after the fix for round seven's two defects was committed. The test-quality reviewer wrote in round seven that no mutation report was named (its "Not answerable", Q7). This is one, by hand, for the lines this round's commit adds or changes: each is undone, the test files that should hold it are run with the pinned Bun, and the file is put back. `git status` showed no tracked change after the run.

```
1 rebuild's loop forgets a link's rows again: killed by 2 test(s)
    rebuildAll > a link or a file where a project's folder was is refused by name: its rows stay and no second folder is made
    rebuildAll > a link where the workspace's folder was is set aside by name, and its rows stay
2 the listing skips names that are not folders again: killed by 2 test(s)
    rebuildAll > a link or a file where a project's folder was is refused by name: its rows stay and no second folder is made
    resolveRepo > the folder a project's row names stays its repository while anything is there, whatever it holds
3 the row's folder wins only with a manifest again: killed by 3 test(s)
    rebuildAll > a link or a file where a project's folder was is refused by name: its rows stay and no second folder is made
    rebuildAll > a repository folder or a manifest that cannot be read never costs a project its folder
    resolveRepo > the folder a project's row names stays its repository while anything is there, whatever it holds
4 resolveRepo no longer refuses a link at the project's name: killed by 1 test(s)
    resolveRepo > the folder a project's row names stays its repository while anything is there, whatever it holds
5 the scan skips a link at a fixed scope's name again: killed by 1 test(s)
    rebuildAll > a link where the workspace's folder was is set aside by name, and its rows stay
6 an unlistable entries folder reads as empty again: killed by 1 test(s)
    rebuildAll > an entries folder that cannot be read refuses the rebuild, and its rows stay
7 a listed file that cannot be looked at is skipped again: killed by 2 test(s)
    doctor: knowledge > an entries folder it cannot read is a warning for that repository, and the others are still checked
    rebuildAll > an entries folder that cannot be read refuses the rebuild, and its rows stay
8 an emptied folder gets no manifest: killed by 1 test(s)
    resolveRepo > the folder a project's row names stays its repository while anything is there, whatever it holds
9 doctor's listing swallows the error again: killed by 2 test(s)
    doctor: knowledge > a projects folder it cannot read is a warning that names it, with a database and with none
    doctor: knowledge > a link or a file where a project's repository was is a warning that names it, and is never read through
10 doctor no longer refuses a name before looking under it: killed by 3 test(s)
    doctor: knowledge > a manifest that is a link is not followed
    doctor: knowledge > a linked knowledge folder is a warning, and nothing is read through it
    doctor: knowledge > a link or a file where a project's repository was is a warning that names it, and is never read through
11 doctor lets an unreadable entries folder fail the whole check: killed by 1 test(s)
    doctor: knowledge > an entries folder it cannot read is a warning for that repository, and the others are still checked
12 the refusal drops the error's code: killed by 4 test(s)
    doctor: knowledge > a projects folder it cannot read is a warning that names it, with a database and with none
    doctor: knowledge > an entries folder it cannot read is a warning for that repository, and the others are still checked
    rebuildAll > a folder it cannot look into is refused, and no row is forgotten for it
    rebuildAll > an entries folder that cannot be read refuses the rebuild, and its rows stay
13 the fixed scopes read a link as no repository: killed by 2 test(s)
    rebuildAll > a link where the workspace's folder was is set aside by name, and its rows stay
    a folder that is not the store's own repository > a repository folder that is a link is refused, and nothing is written through it
14 a new folder's name ignores what is on the disk: SURVIVED (tests green)
```

Mutation 14 survived: no test held that a name already on the disk is never taken for a new project's folder. The test "a name already on the disk is never taken for a new project's folder, a link included" was added to `tests/unit/knowledge-resolve.test.ts`, and the mutation run again:

```
14 a new folder's name ignores what is on the disk: killed by 1 test(s)
    resolveRepo > a name already on the disk is never taken for a new project's folder, a link included
```

What it shows: each of the fourteen changes, undone alone, fails at least one test.

What it does not show: mutations of lines this commit did not touch; the tests that return early as root or on Windows (the permission cases) hold nothing there; two rules are held only together with a neighbour and were not mutated alone: the `kindAt` in the doctor's own listing of names (a name that cannot be looked at is refused a few lines later all the same), and `resolveRepo`'s `kindAt` for a fixed scope's folder that cannot be looked at (`refuseLinkedRoots` refuses first).

The script is the session's own (`mutate-round-seven.ts` in its scratchpad); it changes one string in one file, runs `bun test` on the named files, and writes the file back.
