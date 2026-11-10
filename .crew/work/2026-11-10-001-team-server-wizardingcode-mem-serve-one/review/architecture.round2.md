# architecture findings for 2026-11-10-001-team-server-wizardingcode-mem-serve-one
reviewer: review-architecture
read: the rubric; review/architecture.round1.md and review/ruling.round1.json; docs/adr/0026-team-server.md in full; the CLAUDE.md diff (the new team-server bullet and the reworded sharing bullet); review/files.txt (62 files); the diff of src/store/db.ts, src/modules/knowledge/repo.ts and types.ts, src/http/respond.ts, src/ui/server.ts, src/util/log.ts, src/core/redact.ts and src/cli/main.ts; the current src/cli/commands/serve.ts, src/team/db.ts, types.ts, server.ts and migrations/0001_team_init.sql; the mirror host in src/team/mirror.ts; the import graph of every src/team/*.ts file; a search for SQL outside src/team/store.ts; a search for importers of src/team/ and src/http/ outside the folder; tests/unit/team-store-boundary.test.ts; the tests that run the child's real command line (team-mirror.test.ts:607, team-serve-cli.test.ts:380)

Round 1, upheld defect:
- F-1 (src/team/mirror.ts:626, the child launched with `serve mirror --data <dir>`, which the subcommand rejected) is fixed. `run()` takes `--data` out of a subcommand's arguments wherever it appears, through `takeData` (src/cli/commands/serve.ts:145-162, 567-568). It then resolves `shell.dir` from that value first and from `resolveTeamDir(process.env)` only after (serve.ts:575). So `mirror` never sees the flag in `parseFlags`. The server builds the child's command as `selfCommand("serve", "mirror", "--data", dir)` (src/team/server.ts:125). The child and the server now read the directory the same way, and the USAGE line (serve.ts:41, 60) matches. Two tests run the real command line: tests/integration/team-mirror.test.ts:607 through `mirrorCommand`, and tests/integration/team-serve-cli.test.ts:380 with `mirror --data`. `serve` is in `SKIPS_LEGACY` (src/cli/main.ts), so the child also skips the legacy migration.

Round 1 advisories, for the record:
- F-2: largely addressed. `teamSchemaVersion` moved to store.ts:88. db.ts and CLAUDE.md now name the two reads an open needs. The rest of this point is in F-1 below.
- F-3: fixed. types.ts is a type-only leaf. push.ts:34, feed.ts:19 and routes.ts:34 all import from it, and no domain file imports routes.ts.
- F-4: fixed. `GitHost.logScope` exists (repo.ts:467) and `mirrorHost` sets `logScope: "team"` (mirror.ts:113).
- F-5: fixed. `migrateFile` and `migrateModules` are module-private again (src/store/db.ts:181, 284).

## Findings
- F-1 · advisory · src/team/db.ts:27 · The boundary statement still does not match the code. ADR 0026 D-1 (line 17) says "Every SQL statement lives in `src/team/store.ts`", and its "One process" section (line 48) says db.ts holds "the schema, the migration list and the three ways to open the file". But db.ts also runs SQL: the `INSERT INTO meta` in `mintIdentity` (db.ts:27), the `PRAGMA user_version` read and the `requireTeamSchema` queries (db.ts:50, 62, 67), and `PRAGMA secure_delete` (db.ts:74). The boundary test allows this by exempting db.ts. The CLAUDE.md bullet names the two reads; the ADR names neither the reads nor the identity write. Fix: add one clause to ADR line 48 (and D-1) naming what db.ts keeps, the migration's identity write and the two reads an open needs, so a second engine knows to replace db.ts as well.
- F-2 · advisory · src/team/instance.ts:4 · The server imports the generic helper `writeFileAtomic` from the knowledge module's internals (`src/modules/knowledge/repo.ts`), and status.ts:6 imports `headOf` from the same file. ADR 0026 declares that the mirror uses part 1's runner, so the mirror depending on repo.ts is stated. A high-water file written through a knowledge-module helper is not stated, and the base is silent about it. Consider giving the server these helpers from `src/util/`, or naming the dependency in the ADR.
- F-3 · advisory · src/store/db.ts:86 · Pruning of the client store's upgrade copies is narrower than before. It used to remove any `*.db` past the newest two in `<store>/backups`; now it removes only files that match the `wizardingcode-mem-<ms>-v<n>-<pid>.db` grammar. Any other `.db` in that folder, such as a copy under an older name, is no longer pruned. The change keeps more data and touches no contract. It is still a change of behaviour in the core store that neither the ADR nor the spec states. Name it in ADR 0026's split paragraph, or confirm it is intended.

## Outside the change
none

## Not answerable
none
