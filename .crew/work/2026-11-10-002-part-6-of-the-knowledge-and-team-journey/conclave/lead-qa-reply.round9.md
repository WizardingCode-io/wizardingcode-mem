# qa lead's validation of 2026-11-10-002-part-6-of-the-knowledge-and-team-journey: spec
verdict: validated
## Returns
none
## Notes
- AC-58 (supersedes AC-49) is testable as written. Task 14 (plan.md:100) and its case line (plan.md:125) cover the deletion of the server's restore-hold key, with the unbound rows. The case sits beside the unchanged cases: withdraw with the server down, `stale` withdraw retried once, removal during a held pull, and `resume` without the yes.
- AC-59 (supersedes AC-51) is testable as written. A memory `stale` stores the local `memoryHash` in `local_hash` and the second sweep sends nothing. Plan tasks 9 and 10 (plan.md:90, 92) and the case "a memory `stale` and the quiet second sweep" (plan.md:128) cover it. It is deterministic against the in-process server.
- AC-60 (supersedes AC-54) is testable as written.
  - A snapshot completes per cursor, and `snapshot_due` clears only after the scopes cursor and every group reached `more: false`.
  - A crash restarts from the first uncompleted cursor.
  - An instance change deletes the pending rows.
  - Task 12 (plan.md:95, 98) and the case line (plan.md:131) carry "a snapshot over two groups with a crash between them" and "the pending rows gone after an instance change". Both can be injected in-process.
- AC-61 (supersedes AC-55) is testable as written. The copy's hold keys are cleared in the raw copy before the rename, and a re-added server starts with no hold. Task 17 (plan.md:107, 109) and the case line (plan.md:132) cover it.
- AC-62 (observed; supersedes AC-33, spec.md:242) names the `applied` direction in ADR 0025's amendment. It is proven by `crew tdd observed` (plan.md:116, 118). AC-57 (spec.md:244) now cites AC-62 for the contract-test change, so the supersede chain is consistent.
- AC-56 (observed, spec.md:243) and AC-57 (preserve, spec.md:244) are unchanged and provable as validated in round 9.
- The remaining criteria (AC-15, AC-35, AC-50, AC-52, AC-53, AC-23, AC-24) keep their case lines (plan.md:124, 126-127, 129-130, 133-134).
- The boundary test's file-list pin and the `pragma_table_info` read for `deleteReceivedMemory` are test-design changes inside plan tasks 15 and 12. They are provable by those tests.
