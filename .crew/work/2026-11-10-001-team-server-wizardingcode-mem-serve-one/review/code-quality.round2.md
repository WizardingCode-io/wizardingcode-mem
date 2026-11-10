# code-quality findings for 2026-11-10-001-team-server-wizardingcode-mem-serve-one
reviewer: review-code-quality
read: 36 files, 52 hunks

## Round 1 upheld defects, checked against the current code
- F-1 (src/team/mirror.ts:626, the `serve mirror --data` child) · fixed. `run` in src/cli/commands/serve.ts:567 now strips `--data <dir>` from any position with `takeData` (serve.ts:145). The subcommands use it as `shell.dir` (serve.ts:575), so the `selfCommand("serve", "mirror", "--data", dir)` call at src/team/server.ts:125 parses. tests/integration/team-mirror.test.ts:607 runs the real child.
- F-2 (serve.ts:567, `--help` unreachable) · fixed. `--help` and `-h` are checked first, at serve.ts:563, before any routing to `runServer`.
- F-3 (src/team/server.ts:46, the unused `env` and `gitPath`) · fixed. `ServerOptions` (server.ts:43-57) has neither field any more, and serve.ts:206 passes no `env`. `gitPath` lives only on `MirrorContext`, and tests/integration/team-mirror.test.ts:78 uses it.
- F-4 (src/team/push.ts:423, the key split written three times) · fixed. `splitMemoryKey` is now in src/team/ids.ts:64. push.ts, feed.ts:123 and mirror.ts:587 all import it, and no local `splitKey` is left.
- Round 1 advisories: F-7, F-8, F-10, F-11, F-12, F-13 and F-14 are resolved. `OPERATOR` and `newHexId` now come from ids.ts, `waiting()`, `JoinRefusal` and `teamPaths().backups` are gone, `migrateFile` and `migrateModules` are no longer exported, and the feed.ts re-export was removed. F-5 and F-6 are also resolved: `describeError` and `inviteFrom`/`disableWithItems` each have one home. F-15 (`audit()` only forwards) is still present and is still advisory. The CLAUDE.md debt item is fixed by the rewrite of the sharing-policy line, and that rewrite keeps "nothing is sent".

## Findings
- F-1 · defect · src/team/mirror.ts:381 · `underMirrorLease` passes `result` to its `record` callback, and the `result` variable (line 391) exists only for that. Both callers ignore it as `_result` (lines 462 and 624). This fails Q4: a parameter nobody uses, the same kind as round 1's F-3.
- F-2 · defect · src/team/mirror.ts:613 · `purgeItem` picks `source: "api"` and the caller's `deviceId` when the actor is not `OPERATOR`. Its only caller passes `OPERATOR` (serve.ts:507, and every test does too), and the spec has no API purge route. So the `"api"` half of lines 613-614 and the `actor` parameter are a branch no caller reaches and a value that is always the same (Q4).
- F-3 · advisory · src/team/store.ts:599 · `allRevisions` has no caller in src or tests now that `forEachRevision` (line 606) replaced it. It also repeats that function's SQL (Q8, an unused export left behind by the fix).
- F-4 · advisory · src/team/db.ts:79 · `openTeamDb` is now called only by tests, because the server and the CLI open through `openTeamForWrite`. Its `openFile` call repeats lines 117-124 of `openTeamForWrite`, without the lease check (Q2/Q8).
- F-5 · advisory · src/team/server.ts:24 · `LIMITS.itemBytes` (262_144) is published in `/v1/me` but read nowhere. The check that applies is `ENTRY_MAX_BYTES` (262144) at src/team/validate.ts:148 and :188, so the same cap is written twice and the two could drift (Q2).
- F-6 · advisory · src/team/mirror.ts:592 · The purge rebuilds the memory feed uid by hand (`deviceById(...)?.alias ?? ""` and `remote:${alias}:${memoryUid}`). push.ts already has `memoryFeedUid`, a private function, and repeats the same alias lookup at lines 484 and 614 (Q2, boilerplate).
- F-7 · advisory · src/team/mirror.ts:635 · `result as unknown as { revisions; feedRows }` uses a double cast to get around closure narrowing. Returning the transaction's value from the `underMirrorLease` callback would make the cast unnecessary (Q5).
- F-8 · advisory · src/team/members.ts:402 · `BOOTSTRAP_VALID_HOURS` only re-exports `BOOTSTRAP_HOURS` under a second name, and its one reader is server.ts:117 (Q5, a forward).
- F-9 · advisory · Dockerfile:179 · `WIZARDINGCODE_MEM_MIGRATE=off` repeats what `SKIPS_LEGACY` in src/cli/main.ts:992 already guarantees for `serve`, so the image carries a second guard for the same case (Q9).
- F-10 · advisory · src/cli/commands/serve.ts:41 · The USAGE says every subcommand takes `--data <dir>`, but `health` (serve.ts:541) reads only `--url` and the port, so `--data` is accepted and silently ignored there (Q3/Q6).
- F-11 · advisory · src/team/audit.ts:9 · `audit()` still only forwards to `insertAudit`. Round 1's F-15 was not changed (Q5).

## Outside the change
none

## Not answerable
- Q2/Q8 across the test files · The 20 test and helper files (tests/helpers/team.ts, tests/integration/team-*.test.ts, tests/unit/team-*.test.ts and the others) were not read hunk by hunk. Their test seams were looked up only where a source name depended on them. A search of the added lines found no `console.log`, `debugger`, `.only(` or `.skip(`.
- Q11 (prose against references/writing.md) · writing.md was not given. ADR 0026 and the CLAUDE.md bullets were checked only for dropped facts against the old text, not against the list of tells of generated text.
- Q6 (formatter width, round 1's F-16) · Lint checks no files inside crew worktrees. Line widths across the new files were not measured line by line. The three lines named in round 1 are now wrapped.
