# etl lead's validation of 2026-11-09-001-knowledge-for-the-agent-mcp-tools-search: delivery
verdict: validated
## Returns
none
## Notes
- No task briefs exist, because nothing was handed out. I validated on the report, the data findings, the judge's ruling and the migration itself.
- The data judgement gate is proven. `review/ruling.json` has the `data` gate as `proven`, with five findings, all advisory. `review/data.findings.md` has three advisory findings and two outside-the-change notes, and none is a defect.
- The gates pass on the merged tree (`report.md:62-70`). Build, test (166 s), typecheck, secrets, prose, design-lint and the opencode plugin test all pass. Lint passes, with one untouched file that has problems, none of them the item's. e2e is skipped by a recorded user decision (`report.md:70`, `report.md:289`).
- Migration `src/modules/knowledge/migrations/0007_knowledge_agent.sql` only adds. It uses `ALTER TABLE ADD COLUMN` with defaults (lines 5-15), one FTS5 table (lines 20-29) and `knowledge_shown` with its key and two indexes (lines 33-46). Nothing is backfilled, so there are no destructive statements and no long locks. It is forward-only, the same as migration 6.
- `data.findings.md:19` says the module runner backs up before a pending step. The rollback to 0.6.0 is stated in the spec and measured by two probes (`ruling.json`, risk finding on `spec.md:379`).
- FTS rows are keyed by rowid. `fts_rowid` is stored on the entry (migration lines 6-8), so writes and rebuilds delete search rows by rowid, never by a scan (`data.findings.md:20`). `repo_id` and `entry_id` are `UNINDEXED`, so a query term cannot match an id.
- The queries are planned. `data.findings.md:20` records that reads of `knowledge_shown` use the primary key's `session_id` prefix. `openProposalTexts` uses the `knowledge_proposals_entry` index. Compact's orphan delete correlates on primary keys.
- The data returns of the spec (AC-27) are covered by tests that went red and then green three times (`report.md:53`). Rebuilding 2,000 entries runs under 2 s. The write transaction runs under 50 ms. The perf corpus has 30 non-visible repositories of 200 entries. Compact prunes `knowledge_shown` in the same transaction as the session delete and counts it under `--dry-run`.
- The preservation check (AC-31) is observed as passing. The hook snapshots and the memory-alone tool-list snapshots are byte for byte the same as at the base, and the perf budgets hold with knowledge on.
- The TypeSafe call runs outside any transaction (`data.findings.md:21`). `judge_version` is `TEXT` in the schema and in the code. `pinned` and `contradicts` are read defensively.
- The one personal-data column, `on_behalf_of`, is rebuilt from the files, and its retention and erasure are part 1's, stated in ADR 0024 (`data.findings.md:23`). `knowledge_shown` holds only ids, an event, a rule and a time. The judge receives redacted text.
- The advisories I accept as debt:
  - `contribute.ts:176`: the FTS `repo_id` filter on an UNINDEXED column makes the time the write lock is held grow with the whole corpus. It is measured inside the prompt budget at 3×2,000 visible and 30×200 non-visible entries.
  - `index-store.ts:963`: `pinnedEntries` reads all entry rows of the visible repositories at every session start, where a partial index on pinned entries would read only the pins.
  - `propose.ts:47`: the `knowledge.rate:<id>` meta rows have no cleanup and no fixed bound.
  - `0001_init.sql:20`: session ids can be reused. This is core-schema debt, and the guards in `contribute.ts` and `compact.ts` hold against it.
- Files read (all under the worktree root):
  - `.crew/work/2026-11-09-001-knowledge-for-the-agent-mcp-tools-search/report.md`
  - `.crew/work/2026-11-09-001-knowledge-for-the-agent-mcp-tools-search/review/data.findings.md`
  - `.crew/work/2026-11-09-001-knowledge-for-the-agent-mcp-tools-search/review/ruling.json`
  - `src/modules/knowledge/migrations/0007_knowledge_agent.sql`
