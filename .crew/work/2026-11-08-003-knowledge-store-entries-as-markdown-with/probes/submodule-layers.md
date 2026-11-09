# Probe: which layer keeps `git status` out of a nested repository

Asked by the test-quality reviewer in round three, under "Not answerable": whether git 2.54.0 honours `diff.ignoreSubmodules` in `git status`, so that the test "git never runs in a repository nested in the store's" would stay green with the `--ignore-submodules=all` flag dropped from `statusOf`.

Run on 2026-11-09 against the code under review, with git 2.54.0 (Apple Git-157), in a temporary directory. The fixture is the test's: a workspace repository made by `ensureRepo`, a repository nested at `entries/sub` whose own configuration holds a filter, and a gitlink to it in the outer index. Before each call the nested file's time is moved, so a status that enters the nested repository must run the filter. "program ran" means the marker file the filter writes exists. "The store's -c settings, without the flag" is `runGit` given the status arguments of `statusOf` minus `--ignore-submodules=all`; `runGit` adds `-c diff.ignoreSubmodules=all -c submodule.recurse=false` to every call. No watched file was changed to run this.

```
git version 2.54.0 (Apple Git-157)
no .gitmodules:
  plain git status, no setting and no flag: program ran: true
  the store's -c settings, without the flag: program ran: false
  statusOf (the settings and the flag): program ran: false
with a .gitmodules that sets ignore = none for the path:
  the store's -c settings, without the flag: program ran: true
  statusOf (the settings and the flag): program ran: false
```

What it shows:

- The reviewer's reading is right. With no `.gitmodules`, the `-c diff.ignoreSubmodules=all` setting alone keeps git out, so the test as written would stay green if only the flag were dropped. It fails only when both layers are dropped.
- With a `.gitmodules` that sets `ignore = none` for the path, the setting alone does not hold: the program runs. The flag does hold. No test sets up this case.
- `openRepo` refuses a repository that has a `.gitmodules` file (`refuseForeign`), which the test "a .gitmodules file is refused" holds. So the second case is reached only by a `.gitmodules` that appears between the open and the status call.

What it does not show: git versions other than 2.54.0; `submodule.recurse=false`, which no command the store runs is known to depend on, and which no test or probe exercises.
