# Findings from real use and reviews

One row per finding left open: where it was found, what it is, and its outcome. A finding that a later item takes is marked with that item.

| Found | Source | Finding | Outcome |
|---|---|---|---|
| 2026-11-08 | memory quality, test-quality (rounds 3-5) | `withoutSentences` (`src/distill/noise.ts`) removes only the first match of a dropped sentence: a noise sentence written twice keeps its second copy in the text the judge reads. No test repeats one. | deferred |
| 2026-11-08 | memory quality, test-quality (rounds 4-5) | The heuristic's 60% report share (`REPORT_SHARE`) is tested only on answers that are all report; a case of 3 report sentences in 5 would pin the boundary. | deferred |
| 2026-11-08 | memory quality, test-quality (rounds 2-5) | The golden TypeSafe replay answers by turn id and ignores the request, so a wording change does not force a re-recording; nothing ties the recording to the questions it was made with. | deferred |
| 2026-11-08 | memory quality, test-quality (rounds 3-5) | The proof's "Sentences dropped per pattern" line and `prepareTexts().dropped` are not asserted end to end. | deferred |
| 2026-11-08 | memory quality, risk (rounds 1-5) | The live drain records no reason for a skipped turn: a filter-emptied turn, a judge rejection and an agent-saved turn all end `skipped` with no count, so a loss of knowledge after release is not visible. | taken: the drain stores the reason (`skip:<reason>` in `last_error`); `distill` and `status` count by reason (item 2026-11-08-001) |
| 2026-11-08 | memory quality, risk (rounds 1-5) | Turns version 2 skips are recoverable only until `compact` removes their text (90 days); only the cleanup item (D-1) would distil them again, so D-1 belongs inside that window. | deferred, to D-1 |
| 2026-11-08 | memory quality, risk (round 3) | `history replace-imports` will archive more claude-mem imports after version 2, since fewer history memories confirm them; `history restore-imports` undoes it. Not measured. | deferred |
| 2026-11-08 | memory quality, code-quality and architecture (rounds 3-5) | `hasDurable` in `src/judge/heuristic.ts` still uses 0.5 while `KNOWLEDGE_THRESHOLD` is 0.45; D-6 and D-8 were measured on this code. | deferred, to D-1 |
| 2026-11-08 | memory quality, architecture (rounds 4-5) | The doc comments of `DistillVerdict.durable` and `titleIdx` (`src/judge/types.ts`) give the version 1 meanings; the title rule lives in `buildDraft` (pipeline.ts), while the spec places decision rules in policy.ts. | deferred |
| 2026-11-08 | memory quality, data and security (rounds 1-5) | The proof's work dir keeps a full copy of the store; deleting it is a manual step with no reminder at the end of a run. A work-dir path with `'` breaks the `.backup` dot-command. | deferred |
| 2026-11-08 | memory quality, data (rounds 1-5) | `toldInSession` scans `injections`: its only index is partial (`event <> 'mcp'`). An index on `injections(session_id, at)` would serve it. | deferred |
| 2026-11-08 | memory quality, risk (rounds 3-5) | The cost of the first `history import` under version 2 is not estimated: about 6,000 input tokens per real turn (ADR 0023), and version 1 was not measured on real turns. | deferred |
