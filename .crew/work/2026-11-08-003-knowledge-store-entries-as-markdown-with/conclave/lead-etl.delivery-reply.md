# etl lead's validation of 2026-11-08-003-knowledge-store-entries-as-markdown-with: delivery
verdict: validated
## Returns
none
## Notes
- R-1 is fixed the way the answer chose (option b), and the ADR now matches what the code does.
  - `docs/adr/0024-knowledge-module.md:88` lists only three things that are never read as nothing (:89-91). The bullet on a data directory with no `knowledge/` folder is gone from that list. So "In each case the index rows stay as they were" (:95) now covers only the cases every path keeps.
  - `docs/adr/0024-knowledge-module.md:97` states the remaining case on its own: "`rebuild`, and only `rebuild`, has one more refusal". It says the empty `knowledge/` folder made by hand cannot be undone for a project that is not a git repository. It also says that a write is not refused in that state, nor is any command once the folder exists.
  - `docs/adr/0024-knowledge-module.md:184` now says what a write does under a data directory with no `knowledge/` folder. It makes `knowledge/`, gives the project `<name>-2`, points the row at it and drops the project's rows. After that `rebuild` is no longer refused there, and `doctor` says only "no knowledge repository yet".
  - This matches the code at `src/modules/knowledge/resolve.ts:236-247` and `:63-79` (`saveRow`), and the session's run at `.crew/work/2026-11-08-003-knowledge-store-entries-as-markdown-with/probes/write-under-another-data-directory.md:14-21` and `:28-31`.
- The requirement is carried forward in the design of record. `docs/adr/0024-knowledge-module.md:184` ends with: "The part that lets an agent's tool write must refuse a write in the state `rebuild` refuses, before it does anything else." That is enough for 2026-11-09-001 and -003 to read it as a limit and a requirement, not as a guarantee. When I validate 2026-11-09-001's spec, I will expect that guard and a test for it.
- Choosing (b) over the guard is acceptable for this part. The setup is declared unsupported (:184), the shell command is the only writer, and no file is touched (probe :37).
- I could not find the row the coordinator says was added to `docs/real-use/findings.md`. I searched for "data directory", "knowledge/", "2026-11-09-001", "rebuild refuses" and "resolveRepo" in `docs/real-use/`, with no match. This is not a return, because the ADR text above carries the requirement. If that row is meant to exist, check that it was committed.
- What I validated last time still holds, since the commit touches only the ADR:
  - Migration 6: the widened `module_migrations`, the drops and the `meta` delete come after a backup (`src/store/db.ts:238-262` and `:298-302`; `tests/unit/module-migrations.test.ts:125-235`).
  - `user_version` stays 7.
  - My spec returns R-1 to R-3 are closed (AC-16).
  - The queries are planned.
  - Round eight's `rebuild` defect is closed (`src/modules/knowledge/index-store.ts:597-604`).
  - Data was proven in round nine.
