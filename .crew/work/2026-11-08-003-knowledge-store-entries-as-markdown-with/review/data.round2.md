# data findings for 2026-11-08-003-knowledge-store-entries-as-markdown-with
reviewer: review-data
read: 16 files, the schema and migrations read (src/modules/knowledge/migrations/0006_knowledge_store.sql; src/store/db.ts `upgrade`, `migrateModules`, `prepareModuleMigrations`, `moduleSchemaState`; tests/unit/module-migrations.test.ts fixture; the probe on the withdrawn module's objects; ADR 0024 "The index and the migration namespace", "Personal data", "Known limits"), risk areas: data-migration, personal-data

## Findings
- F-1 · advisory · src/modules/knowledge/store.ts:360 · Round 1's F-1 is partly closed. `rebuildRepo` now takes the head and fingerprint before it reads the files (src/modules/knowledge/index-store.ts:491-494), so that path is closed. `settle` now records a fingerprint only when `commit` found the folders undisturbed (store.ts:299-300, 360). It takes that fingerprint after the files are written, staged and committed, though. So a file a person adds between the comparison at store.ts:300 and line 360 is counted in the recorded fingerprint and never read. `ensureFresh` (index-store.ts:591) and every later write's `undisturbed` check then match, and the file stays out of `listEntries`/`countOpen` until an `adopt` or a `rebuild`. This is now a stated known limit with a remedy (docs/adr/0024-knowledge-module.md:162), so it is advisory and not a defect. Rubric Q1/Q3.
- F-2 · advisory · docs/adr/0024-knowledge-module.md:162 · The known limit says the window is "the few milliseconds between a write's commit and its indexing". In the code the window opens at store.ts:300, before `writeFileAtomic`, `git add` and `git commit` (store.ts:315-330), so it lasts as long as those git subprocesses. That can be hundreds of milliseconds, up to the git timeout. The sentence should name the real span. Rubric Q3 (a long step between the check and the record).
- F-3 · advisory · src/modules/knowledge/migrations/0006_knowledge_store.sql:7 · This is carried from round 1 and unchanged in substance. The drop of the withdrawn module's tables cannot be undone. It has a stated reason (lines 4-6, ADR 0024:123), and `backupVersion` (src/store/db.ts:299-302) takes a backup first. That copy still shares `BACKUPS_KEPT = 2` (db.ts:33), which the ADR now states (0024:164). Round 1's open question is settled: the probe shows no view, and the three triggers are only on `knowledge_entries`. The test fixture now creates the three triggers and the two `injections` indexes (tests/unit/module-migrations.test.ts:137-157), so the drop is shown by a run and not only argued from SQLite's rule. Rubric Q1.
- F-4 · advisory · src/store/db.ts:143 · Carried from round 1, unchanged and stated. On a store that ran the withdrawn module, the first open runs a one-time `VACUUM INTO` while the second connection holds `BEGIN IMMEDIATE`. Rubric Q6.
- F-5 · advisory · src/modules/knowledge/resolve.ts:101 · Carried from round 1, unchanged. `project_aliases` is filtered by `project_id`, which has no index. `scanRepos` runs this once per project (resolve.ts:319). The table is small and the read is off the hook path. Rubric Q2.

These round 1 data findings are closed by the change:
- The personal-data defect is closed. ADR 0024:135-147 now states which columns hold the name, its retention (as long as the repository's history) and its erasure (rewrite the history, then `knowledge rebuild`, or delete the folder and `rebuild`). `rebuildAll` does remove the rows of a folder that is gone (index-store.ts:560-579). The ADR also states that backups carry the names.
- The `injections` index drop now has its comment (0006_knowledge_store.sql:13-14).
- Proposal `file:`/`dup:` ids now carry the folder (index-store.ts:44, 109, 465). Entry ids cannot collide, because `parseEntry` clears a non-UUID id (entry.ts:329-331).
- A decided proposal with no decision now carries a problem (index-store.ts:471-476).
- The meta lease scan is now a primary-key range (src/store/meta.ts:142-144).
- `requireSchema` now guards `rebuildAll`, `ensureFresh`, `rebuildRepo`, `resolveRepo` and `listRepos`. `doctor` reads only, and warns on `too-new` (src/doctor/checks.ts:704).

## Outside the change
- src/store/migrations/0001_init.sql:14 · `project_aliases` has no index on `project_id`, and existing core readers already filter on it. This is debt and advisory.

## Not answerable
- Q1 Migrations · The probe greps only the withdrawn module's DDL. Whether that module also wrote rows into core tables (for example `meta` keys or `injections` rows) that migration 6 leaves behind is not in the review inputs. If it did, they would be orphan rows, not a broken write.
- Q6 Availability · There is still no measurement of how long the first open (the backup plus the drops under the write lock) takes on a real store that ran the withdrawn module.
