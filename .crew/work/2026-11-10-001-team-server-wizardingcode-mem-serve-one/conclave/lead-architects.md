# architects lead's validation of 2026-11-10-001-team-server-wizardingcode-mem-serve-one: spec
verdict: returned
## Returns
- R-1 · .crew/work/2026-11-10-001-team-server-wizardingcode-mem-serve-one/plan.md:46 · The `GitHost` in the plan, `{ dataDir, root, renew(): void, gitTimeoutMs?, extraConfig? }`, is not enough for part 1's runner, and `KnowledgeStore` does not satisfy it as written. Three changes are needed.
  - Add `env: Record<string, string | undefined>` to `GitHost`. `src/modules/knowledge/repo.ts:464` finds git with `Bun.which("git", { PATH: store.env.PATH })`. `gitEnv` (lines 375-393) reads `store.env.PATH`, `HOME` and `XDG_CONFIG_HOME`. The spec's `git` server option and the `stubGit` isolation checks in Phase E (plan.md:174) work through that PATH, so a host without `env` cannot be built or tested.
  - `KnowledgeStore.renew` is `(() => void) | null` (`src/modules/knowledge/types.ts:35`), and `runGit` calls it as `store.renew?.()` (line 455). The host's `renew` must be typed `(() => void) | null`, or the store cannot satisfy the interface and "part 1's tests pass unchanged" (AC-16, AC-27) fails at typecheck.
  - `commitPaths`, `stagePaths` and `removePaths` take a `Repo` (`ref`, `relative` and `id` from `knowledge_repos`; repo.ts:905-937). The mirror's repositories have none of that. The plan must narrow these parameters to `{ path: string }` and say so in "Modify", or `ensureMirrorRepo` and `runMirror` have nothing to pass.
  Proof: the lines cited above in `repo.ts` and `types.ts`.
- R-2 · .crew/work/2026-11-10-001-team-server-wizardingcode-mem-serve-one/plan.md:45 · The runner's split contradicts today's behaviour and the spec. The plan says `backup(db, folder, version, prefix)` writes `<folder>/<prefix>-…db` directly, and that `openDb` passes `backupFolder: dir`, "the data directory, as today". Today's `backup` writes into `join(dir, BACKUPS_DIR)`, which is `<dir>/backups` (`src/store/db.ts:71-74`). With `backupFolder: dir`, a client store's upgrade copies would move out of `backups/` into the data directory. That changes `doctor`'s backups check and the pinned tests, against AC-16 ("no behaviour change") and AC-27. The team side passes `join(dir, "backups")` (plan.md:50; spec.md:109), so the two callers use different conventions for the same parameter. Fix: `openDb` passes `join(dir, "backups")` (the constant stays in `db.ts`), and the plan says the folder is the backups folder itself. Also state that `BACKUPS_KEPT` pruning (`db.ts:77-81`) acts per folder, and that all `.db` files in the folder count, as today.
## Notes
- The store boundary follows CLAUDE.md. The core runner's `upgrade`, `enableWal` and `withWrite` (`src/store/db.ts:129,90,333`) are reusable by `migrateFile` and `openFile` as the plan describes. `team.db` has its own `Migration` list and `user_version`, so it never touches the client store or `module_migrations`. The `NotATeamDatabaseError` check before migrating is sound: `migrate` throws `SchemaTooNewError` on `current > latest` (db.ts:175), which a client store copied to `team.db` would otherwise trigger.
- The plan keeps the one-engine rules. Nothing under `src/team/` is imported by a hook. `serve` is a lazy `COMMANDS` entry. `SKIPS_LEGACY` sits before the `applyLegacyEnv` and `migrateLegacyData` calls at `src/cli/main.ts:56-61`, so the legacy migration is skipped for `serve` only. Imports are with `.ts`.
- The part 4 contract is consumed as written, and the names exist.
  - `OUTGOING_ENTRY_KEYS` and `OUTGOING_MEMORY_KEYS` are at `src/sharing/types.ts:209,221`.
  - `MEMORY_HASH_FIELDS` is at types.ts:237.
  - `entryUid` and `memoryUid` are at types.ts:320,336.
  - `hashOf` is at repo.ts:341, `findSecrets` at `src/core/redact.ts:212` and `authorNameProblem` at `src/settings/settings.ts:143`.
  - `parseFrontmatter`, `checkSlug`, `UUID`, `AREA_ID` and `ENTRY_MAX_BYTES` are in `src/modules/knowledge/entry.ts`.
  - One destination per server and a ledger keyed by `serverId` match ADR 0025 D-9 and the ADR's note on a second server (lines 25 and 192). The spec assigns the `sharing_ledger` migration to part 6 and does not change part 4 here.
- The seams that keep behaviour hold on reading.
  - Viewer helpers: `json` and `problem` are at `src/ui/server.ts:162-167`, `jsonObject` at 179-190, with the inline copy at 528-531. Moving them to `src/http/respond.ts` with an optional `headers` parameter and `problem(status, detail, extra?)` is additive.
  - Log sink: `logError` (`src/util/log.ts:21`) is a single function, so a sink hook is a local change.
  - GitHost: `gitEnv` already uses a ceiling and the identity, so the `committer` and `extraConfig` additions are additive. `extraConfig` appended after `configArgs` keeps the `subcommand` lookup at repo.ts:456 working.
  - ADR number: 0026 is free (the highest is 0025).
- The design is sound on the points I checked. Only R-1 and R-2 are wrong.
  - The UUID is the entry key and revisions are kept.
  - The feed's `current` flag and `AUTOINCREMENT`, the `sqlite_sequence` high-water file and the 410 are consistent with each other.
  - The lease replaces the pid lock.
  - The mirror is an export from the database, not a source of truth.
  - The one-process assumption is stated beside the store boundary.
  - `RESULT_SHAPES` (plan.md:48) is a hand-kept list, unlike part 4's `keysOf`, which the compiler checks. Only the fingerprint test pins it. This is a note, not a return.
