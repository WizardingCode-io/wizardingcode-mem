# Probe: the 0.6.0 binary against a store at knowledge module version 7

Asked by the risk reviewer in round one (Not answerable, rubric Q2): the spec (line 379) and ADR 0024 (part 2, Known limits) assert that a rollback to 0.6.0 "ignores the tables and logs an unknown module id once per hook process", and nothing in the diff or the logs showed a 0.6.0 run against such a store.

Run on 2026-11-09. The store: a data directory seeded by the current code (commit cc85251) with three projects, eleven knowledge entries over three repositories, four memories, `user_version` 7 and `module_migrations` rows `knowledge 6`, `knowledge 7`, `sharing 1`. The 0.6.0 code: the release tag `v0.6.0` (97c6c4b) checked out in a scratch git worktree and run from source with the current worktree's `node_modules` linked in (Bun 1.4.2), with `WIZARDINGCODE_MEM_DATA_DIR` and `WIZARDINGCODE_HOME` pointing at the seeded store, distillation and the viewer's auto-open off.

```
$ bun src/cli/main.ts status          (0.6.0)
wizardingcode-mem 0.6.0
project   wizardingcode-mem (remote:github.com/wizardingcode-io/wizardingcode-mem)
memories  3 active · 0 superseded
…
exit 0

$ bun src/cli/main.ts doctor          (0.6.0)
ok    data directory: …/rollback/mem
ok    database: schema version 7
ok    full-text search: FTS5 available (SQLite 3.54.0)
… (2 warnings, both about agents not installed on this machine)
exit 0

$ … | bun src/cli/main.ts hook session-start   (0.6.0; a SessionStart payload for the project)
(no output)
$ … | bun src/cli/main.ts hook prompt           (0.6.0; a prompt naming two entries' words)
(no output)
exit 0

after the four runs:
PRAGMA user_version            7
module_migrations              knowledge 6, knowledge 7, sharing 1
knowledge_entries              11
knowledge_fts                  11
files in the data directory    env (none), knowledge/, wizardingcode-mem.db (+ wal, shm); no logs/ folder, no backups/ folder
```

What it shows:

- 0.6.0 opens the store at `user_version` 7, reads its memories and runs its commands with exit 0. The two hook lines above ran `hook <event>` without the agent argument, which the command answers with exit 0 and nothing: they prove the exit code only. The hooks with their agent, and what they print, are in `rollback-to-0-6-0-hooks.md`: memory's brief and notes reach the agent.
- 0.6.0 leaves the module tables and `module_migrations` as they were: no row changed, no table dropped, no backup taken, and the search table keeps its rows.
- 0.6.0 writes no log line about the module rows: no `logs/` folder was made by the four runs. The sentence "logs an unknown module id once per hook process" in the spec and ADR 0024 is not what 0.6.0 does; 0.6.0 does not read `module_migrations` at all. The record should say "ignores the tables and the module rows, silently".

What it does not show: a 0.6.0 run with distillation on (the drain), the viewer, or a release binary rather than the source at the tag; the dependency versions were the current worktree's, not 0.6.0's lockfile.
