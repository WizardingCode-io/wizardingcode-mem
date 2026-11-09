# etl lead's validation of 2026-11-08-003-knowledge-store-entries-as-markdown-with: spec
verdict: validated
## Returns
none
## Notes
- R-1 holds. `spec.md:191` reads the columns of `module_migrations` with `PRAGMA table_info` and adds `name` and `applied_at` when they are missing, before recording anything. AC-16 (`spec.md:253`) names the case of a store with the withdrawn module's two-column table. `plan.md:19` prepares that archived fixture with the two-column table.
- R-2 holds. `spec.md:204` and AC-16 (`spec.md:253`) say an orphan project folder is reported and indexes nothing. It gets no `knowledge_repos` row, so `UNIQUE (scope, project_id)` cannot collide. `plan.md:34` tests two orphan folders.
- R-3 holds. `spec.md:204` gives an entry or a proposal with a missing, malformed or duplicate id a `dup:<slug>`, `dup:<file name>` or `file:` key with a `problem`. Because of that, one bad file cannot fail the single `withWrite` rebuild. AC-16 and `plan.md:34` cover it.
- I only grepped these lines (`spec.md:191`, `:204`, `:253`; `plan.md:19`, `:34`). I did not re-read the whole revised spec and plan, and I did not open `work.json` to check AC-17. The conclusion rests on those lines.
- The parts I validated in round 1 are unchanged as far as I looked. These are the core `user_version` staying at 7, the version-6 rule with its drops, the rebuildable index and the planned queries.
