# risk findings for 2026-10-15-001-memory-quality-knowledge-not-records-of
reviewer: review-risk
read: spec, plan, 8 files

## Findings
- F-1 · advisory · src/distill/pipeline.ts:319 · Once v2 ships, the drain has three reasons to mark a turn `skipped`: the agent saved a memory itself, the filter emptied the turn, or the judge refused it. All three write the same `skipped` state, with no log line, no count and no `last_error`. If the v2 TypeSafe judge started rejecting knowledge in daily use (calibration on A already showed one wording losing 66 turns), nobody would see it in the first hour or the first week. The spec says so (docs/superpowers/specs/2026-10-14-memory-quality-design.md:299, "Known; the proof reports the filter's share"), but the proof only runs offline. A drain-side counter of filter-emptied and judge-refused turns would make the first hour visible.
- F-2 · advisory · docs/superpowers/specs/2026-10-14-memory-quality-design.md:292 · Rolling back the code is a release, but a release does not bring back what v2 skipped while it was live. Those turns stay `skipped`, and the only way to distil them again is the cleanup item D-1, which is not designed yet. Their text also lasts only until someone runs `compact` (RETENTION_DAYS 90, src/store/compact.ts:12; compact is manual, from the CLI or the viewer). The spec and ADR 0023:22 state this dependency and its window, so it is advisory. It is still a recovery path that does not exist at merge time, and it rests on 11 knowledge turns of B already accepted as lost (D-12).
- F-3 · advisory · src/distill/noise.ts:52 · In production, `stripHost` can silently cut the rest of a final answer. It does so whenever an unclosed `<agent-message>`, `<task-notification>` or `<system-reminder>` tag opens a line outside a fence. Nothing records that text was removed: the proof counts it (1 turn on B), the live drain does not. An assistant answer that quotes such a block at a line start loses everything after it, with no trace.
- F-4 · advisory · scripts/proof/quality.sh:24 · The proof leaves a full copy of the author's store in the work directory, and nothing ever deletes it: the mem's `forget` and `compact` never reach it, and the only cleanup is a manual `rm -rf` named in a comment and in docs/adr/0023-memory-quality.md:21. Two things limit this: `umask 077` (scripts/proof/quality.sh:30), and the refusal to use a work directory inside the repository or the live data. The deletion step has no owner and no reminder at the end of a `measure` run.

## Outside the change
- src/distill/pipeline.ts:307 · The `turns` table has never recorded why a turn was skipped (`finish` clears `last_error`). This item adds a third skip reason to a state that already could not tell them apart.
- src/store/compact.ts:12 · Skipped turns lose their text after 90 days whenever compact is run, and nothing ever distils them again. This window existed before this item; v2 adds more skipped turns to it.

## Not answerable
- none
