# architects lead's validation of 2026-11-10-001-team-server-wizardingcode-mem-serve-one: spec
verdict: validated
## Returns
none
## Notes
- R-1 holds. I checked `plan.md:46`.
  - `GitHost` is now `{ dataDir, root, env, renew: (() => void) | null, gitTimeoutMs?, extraConfig? }`. This matches `KnowledgeStore` in `src/modules/knowledge/types.ts:27-41` (`env`, nullable `renew`, `dataDir`). `root` is set by `openStore`.
  - `runGit` reads `Bun.which("git", { PATH: store.env.PATH })` at `repo.ts:464`. The host's `env` covers that and `gitEnv`.
  - `stagePaths`, `removePaths` and `commitPaths` take `{ path: string }`, and a `Repo` has `path` (`repo.ts:905-937`). Part 1's callers need no change, so the mirror can pass a plain path.
- R-2 holds. I checked `plan.md:45`. `openDb` passes `join(dir, BACKUPS_DIR)`, and `backup` takes the backups folder itself. The client's upgrade copies stay in `<dir>/backups`, as at `src/store/db.ts:71`. The team side passes `join(dir, "backups")` with the `team` prefix, so both callers now use the same convention. Pruning to `BACKUPS_KEPT` per folder is stated.
- The other revisions raise no architecture problem.
  - The store boundary is unchanged. The `UNION ALL` pull, the partial index and the rowid tables all sit behind `store.ts`.
  - `openTeamExisting` runs `requireTeamSchema` before the version check. That is the right order and matches the earlier concern about reporting a client store as a newer schema.
  - `feed.seq` now holds two high-waters (the `changes` and `audit` sequences) behind one `ctx.onWrite({ feed })`. That is consistent with the one-process, high-water-file design.
- Standing notes from the first round:
  - No hook imports `src/team/`.
  - `serve` is a lazy `COMMANDS` entry that skips the legacy migration.
  - Part 4's key lists, uids and hash are consumed as they are.
  - One destination per server matches ADR 0025 D-9.
  - ADR number 0026 is free.
  - `RESULT_SHAPES` is hand-kept and pinned only by the fingerprint test. That is a note, not a return.
