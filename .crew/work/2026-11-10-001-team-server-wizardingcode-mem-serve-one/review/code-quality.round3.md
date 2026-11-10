# code-quality findings for 2026-11-10-001-team-server-wizardingcode-mem-serve-one
reviewer: review-code-quality
read: 9 files, 14 hunks

## Round 2 upheld defects, checked against the current code
- Round 2 F-1 (src/team/mirror.ts:381, the unread `result` parameter of `underMirrorLease`) · fixed. `underMirrorLease` (mirror.ts:391-410) now gives `record` only `failures`. It returns `{ result, failures }` to its caller. `runMirror` (mirror.ts:424) reads only `failures`. `purgeItem` (mirror.ts:645) reads `result` and uses it at line 680.
- Round 2 F-2 (mirror.ts:613, the `"api"` branch and `actor` of `purgeItem`) · fixed. `purgeItem(ctx, kind, uid, now)` (mirror.ts:635-640) has no `actor` parameter. The audit row uses a fixed `source: "cli"` (line 656), the purge's change rows use `OPERATOR` (lines 584-585 and 610-611), and its one caller, src/cli/commands/serve.ts:502, matches.

## Round 2 advisories that were taken, checked
- `allRevisions` · fixed. Nothing in src or tests mentions it.
- `openTeamDb` / `openTeamForWrite` · fixed. Both go through the private `openWriter` (src/team/db.ts:79). `openTeamDb` (db.ts:91) is still exported for tests only, and its doc comment says so.
- `LIMITS.itemBytes` · fixed. It is `ENTRY_MAX_BYTES` (src/team/server.ts:25), the same constant validate.ts:148 and :188 check.
- `memoryFeedUid` · fixed. It is exported (src/team/push.ts:154) and the purge uses it (mirror.ts:602). The only place that builds `remote:${…}` by hand is push.ts:155.
- Double cast · fixed. `purgeItem` returns the transaction's counts from the callback, and no `as unknown as` is left in src/team.
- `BOOTSTRAP_VALID_HOURS` · fixed. server.ts:123 reads `BOOTSTRAP_HOURS` directly.
- `audit()` · fixed. src/team/audit.ts has only `readAudit`, and every writer calls the store's `insertAudit`.
- The usage line about `health` · fixed. serve.ts:41 reads "each takes --data <dir> as well; health takes --url alone".
- Dockerfile `WIZARDINGCODE_MEM_MIGRATE=off` · kept, and the reason is now written down. ADR 0026's image section (docs/adr/0026-team-server.md:86) says "the image's own guard for any command run in it, beside `serve`'s own skip of the legacy migration". No longer a finding.

## Findings
- F-1 · advisory · src/team/push.ts:152 · Two doc comments sit on top of each other over `memoryFeedUid`, lines 152 and 153. The first is left over from before the export and says the same thing as the second (Q10, a comment that only repeats the code).
- F-2 · advisory · src/team/mirror.ts:418 · `runMirror` is `async` and never awaits, and neither does `purgeItem` (mirror.ts:635). Every step is synchronous, so the `Promise` only wraps a value already computed, and serve.ts:480/502 await it for nothing (Q5).
- F-3 · advisory · src/team/mirror.ts:556 · `const unknown = () => new HttpError(404, { error: "unknown" })` is written again at push.ts:594, and routes.ts:200 builds the same error inline (Q2, boilerplate).
- F-4 · advisory · src/team/mirror.ts:602 · The lookup `deviceById(db, …)?.alias ?? ""` is still written three times: here and at push.ts:486 and push.ts:620. The purge now shares `memoryFeedUid`, but the alias lookup that goes with it is not shared (Q2, boilerplate). Round 2's F-6 pointed at the same pattern.
- F-5 · advisory · src/team/mirror.ts:616 · `eraseMemory` returns `revisions: 1` for a memory, which has no revision rows. The purge's audit detail therefore reads "memory: 1 revisions" (mirror.ts:659), so the field's name does not match its value for that kind (Q3, a name that could be sharper).

## Outside the change
none

## Not answerable
- Q2/Q8 across the test files · The 21 test and helper files were not read hunk by hunk this round. They were searched only where a source name depended on them (`openTeamDb`, `mirrorCommandFor`, `mirrorCommand`, `mirrorChild`), and each of those has a test caller.
- Q8 (unused exports across src/team/store.ts) · The about 80 exports of store.ts were not each traced to a caller. A sample of twelve were all referenced.
- Q11 (prose against references/writing.md) · writing.md was not given. Only the ADR's image section was read, for the MIGRATE rationale.
