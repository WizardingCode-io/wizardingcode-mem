# code-quality findings for 2026-11-10-002-part-6-of-the-knowledge-and-team-journey
reviewer: review-code-quality
read: 34 files, 130 hunks

## Findings
- F-1 · defect · src/sync/outbound.ts:775 · `projectOf(row.itemUid) ?? (row.itemUid.includes(":") && row.itemKind === "memory" ? null : null)` has a ternary whose two branches are both `null`, so the right-hand side is dead code (Q4).
- F-2 · defect · src/sync/outbound.ts:842 · `withdrawSweep`'s parameter `_texts` is passed by `sweep` but never read: a dead parameter (Q4).
- F-3 · defect · src/sync/inbound.ts:286 · `slugOfText`'s parameter `_frontmatter` is passed by `applyRow` but never read: a dead parameter (Q4).
- F-4 · defect · src/sync/spawn.ts:68 · `startSync`'s parameter `_paths` is ignored, yet share.ts, ui/server.ts and the hook command all build and pass `{ dataDir, storeDir }`: a dead parameter (Q4).
- F-5 · defect · src/sync/state.ts:363 · `retryAt: row.retryAt !== null && row.retryAt > now ? row.retryAt : row.retryAt` gives the same value on both branches, so the condition does nothing (Q4).
- F-6 · defect · src/sync/inbound.ts:286 · the `try/catch` around `slugify` (entry.ts:48) guards against a throw that cannot happen, because `slugify` never throws; meanwhile a reserved slug such as `con`, which `checkComponent` later refuses, is not handled here (Q9).
- F-7 · defect · src/sync/run.ts:75 · `NO_HOOKS` is the set of real hooks the process runs (startSteps, the outbound sweep, the inbound pull), so the name says the opposite of what it holds; its interface comment at run.ts:49 ("each a no-op until its task") is false for the same reason (Q3).
- F-8 · defect · src/sync/outbound.ts:744 · the private `projectByAlias` has the same SQL as the exported `projectByAlias` in src/sync/conflicts.ts:51 and as `projectIdOf` in src/sync/received.ts:61: the same lookup written three times in the diff (Q2).
- F-9 · defect · src/sync/outbound.ts:200 · `PIN_LINE` and the split at the end of the frontmatter that drops the `pinned:` line in `entryPayloadOf` repeat `PIN_LINE` and `withLocalPin` in src/modules/knowledge/store.ts:638-654, also added by this diff (Q2).
- F-10 · defect · src/sync/outbound.ts:974 · `withdrawAll` handles each answer line (withdrawn → markWithdrawn, stale → moveSent, refused unknown/purged/withdrawn-by-admin → markWithdrawn) with the same logic as `withdrawSweep` at outbound.ts:895-919 (Q2).
- F-11 · defect · src/sync/inbound.ts:604 · `saveCursor` re-implements the keep-the-larger cursor rule of `setCursor` in src/sync/state.ts:70, which only tests call (Q2).
- F-12 · defect · src/cli/commands/share.ts:461 · `server rejoin` accepts `--yes` and never reads it; the usage text does not list it either: a dead flag (Q4).
- F-13 · advisory · src/sync/state.ts:289 · "The counts `ledger.ts` gives once it exists; until then every count is zero" narrates how the change was built rather than why (Q10).
- F-14 · advisory · src/store/meta.ts:41 · a doc comment is left orphaned: the "held withdrawal" comment now sits above `dirtyKey`'s comment, so `restoreHoldKey` has no doc; likewise `stopSync`'s comment (around meta.ts:189) sits above `SYNC_STOP_WAIT_MS` instead of the function (Q10).
- F-15 · advisory · src/sync/join.ts:39 · `STOP_WAIT_MS` and `STOP_POLL_MS` (and again in src/cli/commands/sync.ts:24-25) redefine `SYNC_STOP_WAIT_MS` and `SYNC_STOP_POLL_MS`, which meta.ts exports and backup, move and compact already use (Q2, boilerplate).
- F-16 · advisory · src/cli/commands/share.ts:597 · the `SyncContext` is built three times, almost the same each time: `syncContextOf` here, `context()` in src/cli/commands/sync.ts:27 and `syncContext` in src/ui/server.ts:223 (Q2, boilerplate).
- F-17 · advisory · src/sync/ledger.ts:253 · `sentHashes` has no caller anywhere. The sent-hash history that `writeSent` fills is never read, although ADR 0027 D-8 says that history is what tells a rollback from a conflict, and `applyAnswer` decides rollback without it (Q8 / Q4).
- F-18 · advisory · src/store/meta.ts:104 · unused exports: `liveLease` has no caller, and neither does `logCount` (src/sync/log.ts:39) or `textHash` (src/sync/inbound.ts:652); `hitOfReceived` (src/modules/knowledge/index-store.ts:964) is used only inside its own file; `serverRows` (state.ts:241), `serversConfigured` (servers.ts:287) and `setCursor` (state.ts:70) are called only by tests (Q8).
- F-19 · advisory · src/sync/inbound.ts:63 · layers that only forward: `boundAliases` only calls `boundAliasesOf`, as do `serverRows` (state.ts:241), `backlogOf` (run.ts), the re-export `export { closeConflict }` (conflicts.ts:17) and the re-export of `dirtyKey` (outbound.ts:71) (Q5).
- F-20 · advisory · src/ui/servers-api.ts:147 · `const { report } = { report: joined.wouldLeave };` builds an object only to destructure it again (Q5).
- F-21 · advisory · src/ui/servers-api.ts:213 · this line is longer than the formatter's width, and src/ui/server.ts:50 adds imports out of sorted order: the formatter and organizeImports were not run on these files (Q6).
- F-22 · advisory · src/backup/backup.ts:333 · `pendingDeletion` always equals `servers.dropped`: two report fields carry one value (Q5).
- F-23 · advisory · src/sync/outbound.ts:793 · `Withdrawal.title` is set to the item's uid (also at outbound.ts:807), so the name does not say what it holds (Q3).
- F-24 · advisory · src/sharing/migrations.ts:35 · a tests-only failure switch (`WIZARDINGCODE_MEM_TEST_FAIL_MIGRATION`) is read from `process.env` inside a shipped migration, where neighbouring code takes its test seams injected (Q9 / Q6).
- F-25 · advisory · src/store/compact.ts:64 · `hasReceivedTable` copies the exported `hasReceivedTable` in src/modules/knowledge/index-store.ts:1447. The same `sqlite_master` probe also appears in sharing/levels.ts (`hasServerList`), sync/servers.ts, sync/spawn.ts, sync/ledger.ts, retrieve/received.ts:13 and index-store.ts (`hasSharingTables`, and inline in `serverByName`); some copies are required by the import boundary, but this one is not (Q2).
- F-26 · advisory · src/sync/state.ts:325 · `statusReport` has the same name as the different `statusReport` in src/status/report.ts. Similarly, `formatServerLine` (share.ts) and `formatServer` (status/report.ts) print two formats for one server line (Q3).
- F-27 · advisory · src/sync/inbound.ts:98 · a local `statusOf` (normalises a memory's status) reuses the name of `repo.ts`'s `statusOf` (git status), which sibling files conflicts.ts and outbound.ts import (Q3).
- F-28 · advisory · src/sync/ledger.ts:553 · `entryLedgerUids` is the only reader in ledger.ts without the `hasLedgerTables` guard every other reader there has (Q6).
- F-29 · advisory · src/sync/outbound.ts:522 · the failed-push `recordAnswer` block (the error text, `retryAfterMs`, `requestId`) is repeated at outbound.ts:880 and 956 and in inbound.ts:399 (Q2, boilerplate).
- F-30 · advisory · src/sync/outbound.ts:583 · `if (stopped === null && !(await pushBatch(batch))) { // stopped is set by pushBatch }` is a branch with an empty body, kept only for the call's side effect (Q5).

## Outside the change
- none

## Not answerable
- Q11 (the prose a rewrite changes) · I did not compare the rewritten hunks of CLAUDE.md, README.md and docs/adr/0024, 0025 and 0026 with their old text, so whether a fact, hedge or scope limit was dropped is unchecked.
- Q1 to Q10 for the unread hunks · I did not read src/doctor/checks.ts, src/team/*.ts, src/modules/knowledge/{author,contribute,repo,visible,types}.ts, src/retrieve/{brief,prompt}.ts, src/sharing/{report,store,types,in-force}.ts, src/hooks/handle.ts, src/cli/commands/{hook,knowledge,compact,backup}.ts, ui/src/**, the tests or the helpers; about 218 of the 348 hunks are unreviewed.
- Q7 (a dependency nobody asked for) · I did not read review/inputs.json; files.txt lists no package.json, so the diff seems to add no dependency.
- ADR 0027's "an item over the per-item limit `me` publishes is refused locally" · src/sync/outbound.ts:60 uses the constant `ENTRY_MAX_BYTES`, while the limits `joinServer` reads (`Joined.limits`) are only returned and shown. Whether that is the intended behaviour is for the criteria to settle, not this rubric.
