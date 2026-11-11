# architects lead's validation of 2026-11-10-002-part-6-of-the-knowledge-and-team-journey: delivery
verdict: validated
## Returns
none
## Notes
- **The architecture gate passed and the tree is green.** The gate reads proven (report.md:159). The build, test, typecheck and lint gates pass on the merged tree (report.md:144-147). Both architecture findings are advisories (report.md:178-179; review/architecture.findings.md:6-7). The only point the report has as not proven is AC-85. That belongs to the test-quality gate (report.md:163) and is outside this team's scope.
- **The boundaries hold as the ADR states them.** `tests/unit/sync-boundary.test.ts` encodes every boundary rule:
  - hook.ts reaches only `spawn.ts`; `handle.ts` reaches nothing of the sync (lines 86-94).
  - The sync imports nothing of `src/team` except `contract.ts`, and the server imports nothing of the sync (98-107).
  - The knowledge module and retrieval import nothing of the sync or sharing (109-113).
  - The sync and backup never import each other (115-118).
  - Each sharing table is named only in its allowed files (121-172), and the quiet files name none (174-188).
  - These match docs/adr/0027-sync-client.md:80 word for word.
  - I checked independently: `src/sync/spawn.ts:5-17` imports only settings, store and util types. `src/modules/knowledge/` has no import of `team/`, `sync/` or `sharing/`.
  - The sync writes the received table only through the module. The two hits for `knowledge_received` in `src/sync/received.ts` (lines 3 and 137) are comments.
- **The data model is as validated.**
  - Knowledge is at v8: `src/modules/knowledge/migrations.ts:18`; the table in `0008_knowledge_received.sql:4-18` is the one from spec.md:240, with the reserved repo id 0 instead of a `knowledge_repos` row.
  - Sharing is at v2: `src/sharing/migrations.ts:82`.
  - No core-schema bump is in the diff.
  - The two indexes added to core and module tables are recorded in the ADR: `sharing_memories_updated` (ADR 0027:34, :87) and `knowledge_entries_id` (0008:18; ADR 0027:94).
- **Advisory F-1 (the sync's own SQL over the knowledge tables) breaks no base rule.** It is four read-only statements: `src/sync/outbound.ts:322` and `:379`, `src/sync/conflicts.ts:69` and `:172`.
  - The base already reads the module's tables from outside the module, in `src/sharing/report.ts`, `src/status/report.ts`, `src/doctor/checks.ts` and `src/store/compact.ts`.
  - Every write still goes through the module (`applyRevision`, `proposeConflict`, `openRepo` and `statusOf` in conflicts.ts:100-145).
  - Moving these reads into `index-store.ts` is debt for a later item, not a return.
- **Advisory F-2 (the refusal shape) is a gap that predates this part.** It stays a note because this part's plan forbids the fix.
  - `RESULT_SHAPES.refusal` (`src/team/contract.ts:104`) is part 5's: the diff adds no `refusal: [` line (review/diff.patch).
  - `plan.md:88` required "the contract fingerprint is unchanged" for this part. Pinning `accepted` here would mean repinning and, by contract.ts:139, bumping `CONTRACT`.
  - The real exposure is `accepted`. The server sends it (`src/team/auth.ts:48`) and the client reads it (`src/sync/client.ts:116-118`) to say which contract to speak. Yet it is unpinned, so D-18's "a change to a shape without a bump fails the build" (ADR 0026:34) does not cover it. If it drifted, the only cost would be a 409 message with an empty list (`src/sync/join.ts:86`); no data would be wrong.
  - `retryAfterSec` never reaches the body: `src/team/routes.ts:527-529` moves it to `Retry-After`, which the client reads first (`client.ts:95-96`). So `RefusalShape.retryAfterSec` (contract.ts:275) is a dead fallback.
  - The heading at contract.ts:200 ("the shapes `RESULT_SHAPES` pins, as types") is therefore not true of `RefusalShape`.
  - **For the next contract bump** (part 7 or later): pin `accepted` in `refusal`, and drop `retryAfterSec` from the type or name the header in the contract. I recommend recording this in ADR 0027's Known limits (line 102), which does not mention it today. The report.md:179 judgement record is the only place it is written down now.
- **The contract with the server is respected.**
  - The sync imports only `contract.ts`, and `parseEntryUid` is the one uid parser both sides use (contract.ts:36).
  - `validate.ts` re-exports it, so the server's tests keep the base's import (review/architecture.findings.md:13).
  - ADR 0026:110 records that the shared shapes moved into `contract.ts` and names the sync as the first client.
- **The ADRs and CLAUDE.md are in step with the code.**
  - ADR 0027 records D-1 to D-10 and six review rounds (lines 82-98), and its boundary section matches the test.
  - CLAUDE.md's sync and sharing bullets name the same tables, leases and boundary test.
  - Naming caution: the item's decision D-10 (retire AC-85 in favour of AC-92) and ADR 0027's ruling D-10 (the withdrawal hold, line 26) share an id from different registers. Whoever cites "D-10" should say which one.
- **My spec-time notes held in the build.**
  - The pinned block's held-pin rule lives in `index-store.ts` (`PIN_NOT_HELD`, ADR 0027:96).
  - `openStoreFile` with `upgradeBackup: false` is the restore's way in (ADR 0027:68, :89).
  - The ownership matrix is the one validated in conclave/lead-architects-reply.md:17.

Files: /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/team/contract.ts, /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/sync/client.ts, /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/team/routes.ts, /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/sync/outbound.ts, /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/sync/conflicts.ts, /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/unit/sync-boundary.test.ts, /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/docs/adr/0027-sync-client.md
