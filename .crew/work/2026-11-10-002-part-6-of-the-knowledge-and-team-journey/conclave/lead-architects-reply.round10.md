# architects lead's validation of 2026-11-10-002-part-6-of-the-knowledge-and-team-journey: spec
verdict: returned
## Returns
- R-1 · .crew/work/2026-11-10-002-part-6-of-the-knowledge-and-team-journey/plan.md:104 (and spec.md:83) · The ownership list, and the boundary test that pins it, say the sharing tables are named in SQL only in `src/sync/ledger.ts`. The spec's own file plan puts sharing-table statements in other `src/sync/` files, so a test written from this list would fail on the planned tree.
  - spec.md:83 says "The sync client's statements over the sharing tables live in `ledger.ts`". plan.md:104 says "the sharing tables are named in SQL only in `src/sync/ledger.ts`, `src/sharing/`, the five read-only readers' files … ".
  - But `servers.ts` holds "the server list and the token file" and the rows of `sharing_servers`: `insertPending`, `replaceDevice`, `setStopped`, `deleteServerRows` (spec.md:82; plan.md:77). `state.ts` holds "the per-server state rows, their writes and reads" (spec.md:82; plan.md:77). Both write and read `sharing_servers`, not through `ledger.ts`.
  - `spawn.ts` runs its one statement over `sharing_servers` and `meta` (spec.md:130, plan.md:105). It also "imports nothing else of `src/sync/`" (spec.md:89), so it cannot call `ledger.ts`.
  - plan.md:104 says "the five read-only readers' files" and lists four: `index-store.ts`, `contribute.ts`, `brief.ts`, `notes.ts`. Spec.md:84-85 names two readers.
  - What must change:
    - Restate the rule in spec.md:83 and plan.md:104 as the files that do hold the statements. For example: `src/sync/ledger.ts` for the ledger tables, `servers.ts`, `state.ts` and `spawn.ts` for `sharing_servers`, `src/sharing/`, the four reading files, `carry.ts`, `resetSharingInCopy` in `backup.ts` and `deleteReceivedMemory`.
    - Or narrow the rule to "the ledger's tables (the ledger, sent hashes, refusals, conflicts, pending rows, unbound rows, received memories) are named only in `ledger.ts`".
    - Say whether `src/status/report.ts`, `src/doctor/checks.ts` and `src/ui/api.ts` read `sharing_servers` themselves or through `src/sync/state.ts`. The current text (plan.md:110) leaves it open, and a boundary test listing exact files forces the answer.
    - Fix "five" to the real count.
## Notes
- My round-9 returns are answered.
  - **The ownership list.** spec.md:83-88 now reads: the sync client's statements live in `ledger.ts`, the policy module's writes stay in `src/sharing/` (`confirmServer`, `setLevel`'s unbound row, `setServerLists`, `resetLevels`), and the other places are named. They are the knowledge reads, the retrieval reads, `completeOwedCarry`, `resetSharingInCopy` in `backup.ts` and `deleteReceivedMemory` in `src/store/memories.ts`.
  - **The hook-path clause.** It now reads "nothing under `src/sync/` but `spawn.ts`, and not `src/backup/carry.ts`, runs on a hook path" (spec.md:89). plan.md:104 states reachability from `hook.ts` the same way.
  - **The file count.** `ledger.ts` is listed first, in a list of 14 files (spec.md:82). The Sizing line says "31 source files (14 new under `src/sync/`" (spec.md:64).
  - **The `loadPolicy` wording.** It takes no project, and the callers pass the bound server (spec.md:113).
- A check of the current code supports the part of the rule that holds. Outside `src/sharing/`, the four main sharing tables (`sharing_levels`, `sharing_ledger`, `sharing_changes`, `sharing_servers`) are named in SQL nowhere today. My grep over `src/` excluding `src/sharing/` returned nothing. So the pinned list is a real constraint, and it can be written truthfully.
- `LedgerRecord`'s `direction` is `"sent" | "received"` today (`src/sharing/types.ts:244`). The spec and plan add `applied` to the union (spec.md:113, plan.md:75), selected only for its own destination, never read by `decide`, and cleared with the `sent` row. That change is a type-level one. `DECISION_KEYS` and `LEDGER_RECORD_KEYS` are not affected by it, so `tests/unit/sharing-contract.test.ts` changes only in the ledger-keys and REASONS blocks, as stated.
- The criteria agree with the spec and the plan: AC-58 to AC-62 supersede AC-49, AC-51, AC-54, AC-55 and AC-33 (spec.md:232-242), and the plan's phase headers and test lines use them (plan.md:73, :80, :90-100, :107-109, :116-118, :125-132).
- The module boundaries stand against the code.
  - `compact` is made async with its two callers, and `restoreBackup` and `moveStore` are async already (checked last round).
  - `src/modules/knowledge/` and `src/retrieve/` still import nothing of `src/sharing/` or `src/sync/`.
  - The schema versions (sharing v2, knowledge v8, `user_version` 7) are unchanged across spec.md:64, :91 and the plan's schema section.
