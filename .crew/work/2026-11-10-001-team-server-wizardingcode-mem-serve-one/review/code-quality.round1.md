# code-quality findings for 2026-11-10-001-team-server-wizardingcode-mem-serve-one
reviewer: review-code-quality
read: 44 files, 49 hunks

## Findings
- F-1 · defect · src/team/mirror.ts:626 · `spawnMirror` runs `serve mirror --data <dir>`, but the `mirror` subcommand (src/cli/commands/serve.ts:479) only knows `--rebuild`, and every subcommand takes its directory from `resolveTeamDir(process.env)` (serve.ts:574). So in production the hourly and after-push child exits with "unknown flag --data" (exit 2) and the export never runs. Every test injects `mirrorChild` instead of using this path. This fails Q4 and Q6: a parameter that no handler accepts, which disagrees in behaviour with the USAGE line at serve.ts:64 ("The data directory is --data, …").
- F-2 · defect · src/cli/commands/serve.ts:567 · The `sub === "--help"` half of this branch can never run: line 566 already sends any argument starting with `--` to `runServer`, which rejects `--help` as an unknown flag with EXIT_USAGE. So `wizardingcode-mem serve --help`, which the top-level USAGE in src/cli/main.ts advertises, prints an error and exits 2 (Q4, dead path).
- F-3 · defect · src/team/server.ts:46 · `ServerOptions.env` and `ServerOptions.gitPath` (line 49) are declared, and `env` is passed by serve.ts `runServer`, but `startTeamServer` never reads either one (Q4, a parameter nobody uses; `gitPath` only works in `MirrorContext`).
- F-4 · defect · src/team/push.ts:423 · `splitMemoryKey` is the same key-grammar split as `splitKey` in src/team/feed.ts:85 and src/team/mirror.ts:530. The `<device id>:<uid>` rule is now written three times, where one export from push.ts or store.ts would do (Q2, logic duplicated).
- F-5 · defect · src/team/log.ts:51 · The error-message cleaning (collapse whitespace, `redact`, clip to `MESSAGE_MAX_CHARS` 300 with "…") repeats src/util/log.ts:39 line for line. A change to how errors are redacted or clipped now has to be made in two places (Q2, logic duplicated).
- F-6 · defect · src/team/routes.ts:332 · The invitation mint repeats src/cli/commands/serve.ts:270: the `forMember` vs role/name branching and the audit detail format (`${role} ${name}` / `device for …`). The disable audit detail at routes.ts:440 likewise repeats serve.ts:387. API and CLI should share one function that returns the act and its audit row (Q2, logic duplicated).
- F-7 · advisory · src/team/mirror.ts:573 · `purgeItem` writes `memberId: "operator", deviceId: "cli"` as literals (twice) instead of using push.ts's `OPERATOR` (push.ts:58). feed.ts:55 also defines its own `OPERATOR` with the same id (Q2, boilerplate).
- F-8 · advisory · src/team/db.ts:17 · `hex16()` and `renewInstance`'s `randomBytes(8).toString("hex")` (src/team/instance.ts:53) duplicate `newHexId` in src/team/ids.ts:24. That function's doc comment says it makes "the server's id, its instance", but neither caller uses it (Q2/Q3).
- F-9 · advisory · src/team/routes.ts:183 · `readBody` wraps the bytes in a synthetic `Request` to reuse `jsonObject`, then parses the returned problem `Response` to rethrow it as `HttpError`. Parsing the bytes directly would be simpler (Q5, a layer that only adapts).
- F-10 · advisory · src/team/signal.ts:56 · `ChangeSignal.waiting()` has no caller in src or tests (Q8, unused export).
- F-11 · advisory · src/team/members.ts:198 · The exported type `JoinRefusal` is imported nowhere (Q8, unused export).
- F-12 · advisory · src/store/db.ts:172 · `migrateFile` and `migrateModules` (line 275) are now exported, but only db.ts calls them (Q8, unused export).
- F-13 · advisory · src/team/feed.ts:19 · The re-export of `explainChangesSince`/`explainHasChanges` from store.ts exists only for tests/integration/team-pull.test.ts, which could import store.ts directly (Q5, a forward with no job).
- F-14 · advisory · src/team/db.ts:54 · `teamPaths().backups` is read by nobody and repeats `teamBackups(dir).folder` (line 40) (Q2/Q4, an unused field duplicating a value).
- F-15 · advisory · src/team/audit.ts:16 · `audit()` only forwards its argument to `insertAudit` (Q5, a layer that only forwards; the value it adds is the narrower `AuditSource` type).
- F-16 · advisory · src/store/db.ts:352 · These lines are over the formatter's width and were not run through `bun run format`: db.ts:352, db.ts:77 and src/modules/knowledge/repo.ts:478. Biome lint checks no files inside crew worktrees, so the lint gate does not catch them (Q6, style).

## Outside the change
- CLAUDE.md:19 · The sharing-policy bullet still says "what may leave for a team server, which does not exist yet". The diff did not touch that line, but after this change it is stale.

## Not answerable
- Q2/Q8 across the test files · The 20 test and helper files (tests/helpers/team.ts, tests/integration/team-*.test.ts, tests/unit/team-*.test.ts and the rest) were not read hunk by hunk. Duplication or leftovers inside them are not assessed.
- Q11 (prose against references/writing.md) · I did not have writing.md. ADR 0026 and the CLAUDE.md bullet were checked only for dropped facts against the old text (the CLAUDE.md change only adds a bullet), not against the writing standard's list of generated-text tells.
