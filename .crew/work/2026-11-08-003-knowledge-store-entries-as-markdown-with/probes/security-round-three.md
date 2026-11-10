# Probe: the three round-two security cases, run against the fixed code

The same three cases as `security-round-two.md`, run on 2026-11-09 after the round-two defects were fixed, with git 2.54.0. This time each case goes through the module's own entry points (`openRepo`, `writeEntry`, `adopt`, `rebuildAll`), which is what a command does; a git call made around the checks proves nothing about them. "program ran" means the marker file the program writes exists.

```
case 1 (F-1): two section headers on one line, [core][filter "x"]
  openRepo: refused: the repository's own git configuration sets filter.x.clean, and a knowledge repository carries only the settings git init writes; remove it from <tmp>/…/knowledge/workspace/.git/config
  writeEntry: refused: (the same message)
  adopt: refused: (the same message)
  rebuildAll: refused: (the same message)
  program ran: false
case 2 (F-2): a gitlink in the index and a nested repository with its own filter
  openRepo: returned "repo"
  statusOf: returned []
  writeEntry: returned "written"
  adopt: returned 0
  rebuildAll: returned
  program ran: false
  program ran with a plain git status, to show the trap is live: true
case 3 (F-3): an intent record that names .git/config, with kept bytes for it
  the record is read: false
  openRepo: returned "repo"
  .git/config is unchanged: true
  the record is still there: false
  adopt: returned 1
  program ran: false
```

What it shows:

- Case 1. The second header on the line is read as git reads it, and every entry point refuses the repository by the setting's name. The program does not run.
- Case 2. `statusOf` no longer looks into the nested repository, and a write, an adopt and a rebuild complete without the program running. A plain `git status` in the same folder, without the store's flag, does run it: the trap was live.
- Case 3. The record that names `.git/config` is not read, `openRepo` removes it, the configuration is byte for byte as it was, and the adopt that follows does not run the program.

What it does not show: git versions other than 2.54.0. In case 2 the gitlink stays in the dropped index: the store neither sees it nor commits it (`git commit --only` takes the named paths alone). In case 3 the kept-bytes file the dropper wrote stays under `.git/`; nothing reads it again.

The same cases are held by tests in `tests/unit/knowledge-repo.test.ts`: "a second section on a header's line is read as git reads it, and its program never runs", "git never runs in a repository nested in the store's", "a record that names a path outside the knowledge folders is not acted on".
