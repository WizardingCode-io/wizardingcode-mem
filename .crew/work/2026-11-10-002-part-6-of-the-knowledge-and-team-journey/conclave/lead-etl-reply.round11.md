# etl lead's validation of 2026-11-10-002-part-6-of-the-knowledge-and-team-journey: spec
verdict: validated
## Returns
none
## Notes
- The remove paragraph (spec.md:107) keeps every deletion in the one transaction. The levels go through `removeServerLevels` and the `sharing_changes` row through `logServerChange`, both new in `src/sharing/store.ts` (spec.md:83; plan.md:84, :88). The delete list is unchanged: received rows and memories, levels, ledger rows, refusals, conflicts, sent hashes, mutes, pending rows, unbound rows, the restore hold key and the server's row. The order and the crash case (a folder left with no row is deleted at the sync's start) are intact. `mute` and `unmute` log through `logServerChange` with the same `what` grammar as before (`server:<id>`, `mute`/`unmute`). This is my round-11 advisory, applied.
- The DDL, the ledger's seven tables, the carry's eight tables, the restore's marks and hold keys, the snapshot per cursor, the pending rows, the `applied` direction and the memory `stale` marker are untouched. The ownership change is only in who names which table in SQL.
- Build note, no return: the two new functions must be callable inside the caller's open transaction. `remove` runs them within its one `withWrite` (src/store/db.ts:391-393, `db.transaction(fn).immediate()`). Write them as plain statements, or as nest-safe `withWrite` calls as `resetLevels` does (src/sharing/store.ts:553-571), and test the nested call, so the removal stays atomic.
- I cannot write files in this role. The session saves this answer as `.crew/work/2026-11-10-002-part-6-of-the-knowledge-and-team-journey/conclave/lead-etl-reply.md` and records it with `crew validation`.
