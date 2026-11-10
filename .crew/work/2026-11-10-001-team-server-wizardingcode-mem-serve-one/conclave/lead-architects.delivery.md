# architects lead's validation of 2026-11-10-001-team-server-wizardingcode-mem-serve-one: delivery
verdict: validated
## Returns
none
## Notes
- **The store boundary holds.**
  - `src/team/store.ts:1-4` says it holds every SQL statement. `transaction` wraps the core `withWrite` (`store.ts:17-19`).
  - Its own imports are only `../store/db.ts` and `../store/meta.ts` (`store.ts:5-12`). It imports nothing from `./`, so it also meets the test's `./db.ts`/`./errors.ts` allowance.
  - `src/team/db.ts:1-6` names the statements it runs before the store can be asked. Its code matches that list and nothing more: `PRAGMA user_version` (`:51`), the `sqlite_master` and `team.schema` checks (`:61-70`), `secure_delete` (`:75`) and the identity insert of migration 1 (`:28`).
  - `tests/unit/team-store-boundary.test.ts:31-46` exempts exactly `store.ts` and `db.ts`. For every other file it fails on `store/`, `bun:sqlite`, `.query(`, `.run(`, `.prepare(` and `withWrite(`.
  - ADR 0026 states that exemption by name and says a second engine replaces `db.ts` as well (`docs/adr/0026-team-server.md:48`).
  - `src/cli/commands/serve.ts` holds no `.query(`/`.run(`/`.prepare(` either. It reaches the database only through `team/store.ts` (`serve.ts:34`) and `team/db.ts`.
- **`types.ts` is a leaf.** It has only `import type` lines (`src/team/types.ts:5-8`).
- **The server never opens a client's store.** `src/team/` has no `openDb`, `resolvePaths` or `storeDir`. `db.ts` opens only `team.db` through `openFile`/`openExistingFile` (`db.ts:80-99`), with its own `backups/` and the `team` prefix (`db.ts:38-40`).
- **No hook imports `src/team/`.** Only `src/cli/commands/serve.ts` and `src/cli/main.ts` refer to it. `main.ts:29` loads `serve` lazily through `COMMANDS`, and `main.ts:34` makes it skip the legacy migration.
- **The core runner split is in place.** `openFile` (`src/store/db.ts:351`) and `openExistingFile` (`:400`) are the shared runner. `openDb` (`:376`) and `openExisting` (`:427`) now sit on top of it, and `openDb` keeps its `backups/` folder and `wizardingcode-mem` prefix (`:378`).
- **The `GitHost` seam is in place.**
  - `GitHost` is declared at `src/modules/knowledge/types.ts:29`, and `KnowledgeStore extends GitHost` (`:45`), so part 1's store satisfies it as it is.
  - `gitEnv`, `runGit` and `commitPaths` take a `GitHost` (`repo.ts:379`, `:454`, `:936`). `commitPaths` takes an optional `committer` and a plain `{ path }`.
  - `GIT_CEILING_DIRECTORIES` is `host.root` and falls back to the knowledge root (`repo.ts:387`).
  - The mirror builds its own host and imports only the runner's exported helpers (`src/team/mirror.ts:8-17`, `:425`).
- **The HTTP helpers moved.** `src/http/respond.ts` is a leaf with `json`, `problem` and `jsonObject` (`:5`, `:17`, `:22`). The viewer imports all three (`src/ui/server.ts:21`) and the team routes import two (`src/team/routes.ts:4`).
- **The one-process assumption is written beside the boundary.** ADR 0026's section "One process, one store boundary" (`docs/adr/0026-team-server.md:46-48`) names the four things that tie the design to one process: the change signal, the `meta` leases, the in-memory rate buckets and the high-water file. It also says the lease refuses a second process. `CLAUDE.md`'s team-server bullet repeats this.
- **Contract base.** `src/team/contract.ts:5` uses part 4's `OUTGOING_ENTRY_KEYS`/`OUTGOING_MEMORY_KEYS` from `src/sharing/types.ts` as they are, and `mirror.ts:19` uses `entryUid` from there. That agrees with ADR 0025.
- **Judgement.** `review/ruling.json` records the architecture gate as proven. Its one finding is advisory: `mirror.ts:25` imports `deviceAlias`, `memoryFeedUid` and `parseFeedUid` from `push.ts`. I agree it is a convention point and crosses no stated boundary. `parseFeedUid` reads through the store, so it cannot live in the leaf `ids.ts`. A small `feed-uid.ts` module would remove the import of a handler from the mirror; that is a preference, not a return.
- **Note, not a return.** The boundary test reads only the top level of `src/team/` (`team-store-boundary.test.ts:7-8`, `readdirSync` without recursion). A future `.ts` file in a subfolder would not be checked. Today the only subfolder is `migrations/`, which holds only SQL, so nothing escapes the check now.
- My spec-stage notes in `conclave/lead-architects-reply.md` (R-1 on `GitHost`'s shape, R-2 on the backups folders) hold on the delivered tree, as checked above.
