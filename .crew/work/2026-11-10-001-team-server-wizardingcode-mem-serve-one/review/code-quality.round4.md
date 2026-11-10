# code-quality findings for 2026-11-10-001-team-server-wizardingcode-mem-serve-one
reviewer: review-code-quality
read: 7 files, 12 hunks

## Round 3 advisories, checked against the current code
- Round 3 F-1 (the stacked doc comments over `memoryFeedUid`) · answered. src/team/push.ts:156 now has one comment over `memoryFeedUid`, and the new `deviceAlias` at :152-154 has its own.
- Round 3 F-2 (`runMirror` and `purgeItem` async for nothing) · answered in src/team/mirror.ts. Both are synchronous now, at :455 and :668. A leftover in their CLI wrappers is F-1 below.
- Round 3 F-3 (the 404 `unknown` built three times) · answered. `unknownItem` lives in src/team/errors.ts:55. It is used at push.ts:607, 610, 619, 633, 635 and 640, at mirror.ts:599, 630 and 676, and at routes.ts:200. No inline `HttpError(404, { error: "unknown" })` is left. The other 404s (`member unknown`, `invitation unknown`, `device unknown`) are separate bodies.
- Round 3 F-4 (the device-alias lookup written three times) · answered. `deviceAlias` is defined at push.ts:153 and used at push.ts:489 and 621 and mirror.ts:635.
- Round 3 F-5 (`revisions: 1` for a memory) · answered. The field is now `rows`, with the doc comment "an entry's revisions, or the memory's one" (mirror.ts:591-592). The audit detail at mirror.ts:693 reads "`<kind>`: n rows".

## Findings
- F-1 · advisory · src/cli/commands/serve.ts:475 · `mirror` (and `purge` at :491) are still `async ... Promise<number>` with no `await` in them, and the dispatcher at :597/:599 awaits them for nothing. Their sync neighbours, such as `instanceRenew` (:516), return `number`; this is what is left of round 3's F-2 (Q5/Q6).
- F-2 · advisory · src/team/mirror.ts:369 · `if (revision !== null)` silently skips a pending key whose row is gone. That cannot happen: the keys and the rows are read under the mirror lease, and only `purgeItem`, which takes the same lease, deletes revisions. If it ever did happen, the skip would hide the cause; throwing, or recording a failure, would not (Q9, a guard for a case the code cannot reach).
- F-3 · advisory · src/team/mirror.ts:361 · The generator `pendingRevisions` writes the same seq-keyed batch loop as `forEachRevision` (src/team/store.ts:617-631): read `seq > after LIMIT REVISION_BATCH`, stop on empty, advance `after`. The two differ only in being a generator or a callback, and in where `after` moves. Also, `pendingRevisionsAfter` takes a `limit` that its one caller always passes as `REVISION_BATCH`, while `forEachRevision` uses the constant inside (Q2 boilerplate, Q4 a parameter that is always one value).
- F-4 · advisory · src/team/mirror.ts:677 · `touched` and `let owed` (:678) are declared outside the lease callback only so the transaction's closure can fill them. `owed` is reassigned inside `transaction(...)` and read after it, so the data flows through outer mutable state. The transaction could return `owed` beside the counts (Q5, simplest thing).

## Outside the change
none

## Not answerable
- Q2/Q8 across the 21 test and helper files · Not read hunk by hunk this round. They were searched only for the names the round's fixes touched (`explainPendingMirror`, `deviceAlias`, `unknownItem`, `REVISION_BATCH`), and each has a caller.
- Q8 (unused exports across src/team/store.ts) · Each of the about 80 exports was not traced to a caller. The new ones (`PendingKey`, `pendingRevisionsAfter`, `checkpointWal`, `explainPendingMirror`) are all referenced.
- Q11 (prose against references/writing.md) · writing.md was not given. Only the ADR's purge paragraph (docs/adr/0026-team-server.md:78) was read, against the code: the note merge, the two cuts, `truncated`/`busy` and the hourly checkpoint all match mirror.ts:396-407 and :698-717 and server.ts:216-217.
