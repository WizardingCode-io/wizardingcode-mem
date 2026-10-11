# ADR 0013 — History import, part 1: distilling the agents' own transcripts

Date: 2026-10-11 · Status: accepted.

## Context

Until now the memory knew only what happened after it was installed, plus what the claude-mem importer brought in (ADR 0003). The agents already keep months of history on disk: Claude Code transcripts under `~/.claude/projects`, Codex rollouts under `~/.codex/sessions`. Part 1 of the history import (design: `docs/superpowers/specs/2026-10-11-history-import-design.md`) distils the recent part of that history into memories through the same pipeline as live turns. The raw index and history search are later parts.

## Decisions

- **Migration 4.** `turns.origin` (`'live'` by default, or `'history'`) records where a turn came from; every existing turn becomes `'live'` and no row is changed or lost. A `history_replacements` table lists the imports that replacement archived, so the undo touches only them. Migration 4 adds no index: the queue keeps using `turns_queue`.
- **Live first.** The queue claims live turns before history turns (`ORDER BY origin = 'history', id`), so a new session never waits behind a backfill. History drains in bounded batches; `--max-seconds` (default 600) caps a run, and running again continues.
- **Dated at their turn.** A history memory is created and updated as of when its turn ended, so recency and supersession treat it as if it had been captured then. A history memory never supersedes a newer memory: when the memory it would replace is newer, the history memory is the one that steps aside.
- **History does not move the present.** A session first seen in history is created as it was then (started, last seen and ended with its turn); a session already known is left unchanged, so history never rewinds a live one. "Where things stood" in the session brief, and the files a session touched recently, are the latest turns by time, not by insertion. A turn that a hook completes is live, even if history queued it first.
- **Readers.** `src/adapters/claude-code/history.ts` and `src/adapters/codex/history.ts` stream each file and hold only the turns still open, so files of hundreds of megabytes stay cheap. Only finished turns are queued. Skipped: sidechain (subagent) lines, `isMeta` lines and compact summaries in Claude Code; claude-mem's own observer sessions (any working directory under `.claude-mem`); host notifications (`isFromTheHost`); turns where the agent saved a memory itself (counted as known); aborted Codex turns. For Codex, the prompt is what the user typed: wrapper texts that start with `<` or `# ` (injected context, automation) contribute nothing, a `<realtime_delegation>` keeps only its `<input>`, and the last typed text wins. Secrets are redacted before anything reaches the queue.
- **Bounded by a window.** `history import` reads the last `historyDays` days (setting `WIZARDINGCODE_MEM_HISTORY_DAYS`, default 180, `--days` overrides). `compact` keeps history turns inside that window even past the retention period: they are what tells a later import that a turn is already known.
- **Replacement is an opt-in command.** `history import` never archives; it reports how many projects are ready. `history replace-imports` acts on every project whose history turns are all finished with at least one distilled (a project whose history only failed is not ready). For each, it computes afresh the span its history covers (earliest start to latest end of its history turns) and archives the active claude-mem imports created inside it, status only (`updated_at` is not touched). Imports outside the span stay, because their periods were never read. An import that history confirmed stays: one that a history turn reinforced, or one that a history memory stepped aside for. There are no per-project markers; running it again is idempotent because what is archived is no longer active, and a span that widened is applied in full. `history restore-imports` reactivates the listed rows that are still archived and clears the list; a later import does not archive them again.

## Measured

On a copy of the author's database (never the real one), with TypeSafe off (heuristic judge), reading 5,186 transcripts from the last 180 days:

| | Task 7 (archived inside import) | Fix round 1 (span) | This decision (opt-in, spares confirmed) |
|---|---|---|---|
| Queued / known / skipped | 3,393 / 307 / 4,415 | 3,393 / 307 / 4,415 | 3,393 / 309 / 4,415 |
| Distilled memories, active | 1,657 | 1,659 | 1,652 |
| Imports archived by replacement | 59,901 | 38,274 | 38,245 (0 spared as confirmed) |
| Imports active / archived after | 7,529 / 81,969 | 29,156 / 60,342 | 29,185 / 60,313 |
| Wall time | 69 s | 65 s | import 65 s, replace-imports 0.9 s |

Before the run the copy held 67,430 active and 22,068 archived imports, and 283 active distilled memories. All 4,415 skips were host notifications (the readers already drop files and turns older than the window). History turns ended 1,388 done and 2,005 skipped. A second `history import` queued nothing (3,702 known), also after `compact`. `history restore-imports` restored 38,245 and brought the imports back to exactly 67,430 active / 22,068 archived.

No import was spared as confirmed in this run: with the heuristic judge no history turn was judged a duplicate of an import. With TypeSafe the count may differ.

## Not yet decided

- The span is per project, from its first to its last history turn, so sparse history still covers a wide period: replacement archived 57% of the active imports. A per-session overlap rule would be narrower, but imports do not record their source session.
- The raw history index and history search (parts 2 and 3 of the design).
