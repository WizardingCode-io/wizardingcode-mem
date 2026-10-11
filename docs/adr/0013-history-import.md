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
- History search for the memory tools beyond `history_search` (part 3 of the design).

## Part 2: the raw history index

Distilled memories lose detail, so part 2 keeps the conversation itself, searchable and separate.

- **A separate file.** `history.db` lives in the store directory (mode 0600), next to the main database but not in it. It is rebuildable from the transcripts, so it is never part of backups, never migrates with the main schema, and deleting it loses nothing that cannot be rebuilt. It is also the opt-in: the session-end hook indexes the finished session only when the file already exists.
- **What is stored.** Per finished turn, the redacted prompt (clipped to 8 KiB) and the redacted final answer (16 KiB), plus agent, project, session and time, in an FTS index. Redaction runs first, then the clip. Nothing else (tool calls, thinking, tool output) is kept.
- **What is skipped.** The same content rules as the import: host notifications, sidechain (subagent) lines, `isMeta` lines and compact summaries, claude-mem observer sessions, and projects with memory disabled.
- **How it stays current.** A manifest records each transcript's size and mtime; `history index` re-reads only files that changed and drops rows of files that disappeared. `history import` also indexes. The session-end hook spawns a detached `history index --transcript <file> --agent <agent>`; `WIZARDINGCODE_MEM_DISTILL=off` turns that off. `--max-seconds` bounds a run.
- **How it is read.** `history search <words> [--project] [--limit]` and the MCP tool `history_search` (read-only open, no write lock; a busy database answers with a sentence instead of failing). Raw history is never injected into a prompt or a session start.
- **How it is removed.** `history forget` deletes `history.db` and its sidecars; the next `history index` rebuilds it.

### Measured

On the author's machine, the main database copied read-only to a temporary store directory (the real one untouched), TypeSafe and distilling off, all 5,186 transcripts found on disk (the index has no day window; `historyDays` applies only to `history import`):

| | |
|---|---|
| First `history index` | 5,186 files indexed, 3,716 turns, 12.7 s wall time |
| Second `history index` | 5,186 unchanged, 0 turns, 0.07 s |
| `history.db` size | 15.6 MB (the main database copy: 220 MB) |
| `history search` (three generic words) | 0.02 s each, process start included |

After the index process exited, `history.db-wal` (0 bytes) and `history.db-shm` (32 KiB) were still on disk, as they were after the later searches. A `history search` with no other process open returned results, not the busy sentence. The leftover sidecars are harmless (empty WAL) but are not cleaned up on close.

### After review

- **Sidecars and the read-only open.** macOS's system SQLite (which Bun uses there) keeps `history.db-wal` and `-shm` after the last connection closes; Bun's bundled SQLite on Linux and Windows deletes them, and a copy, a move or another client's checkpoint loses them on any system. A read-only connection cannot create them, so its open fails with `SQLITE_CANTOPEN`. The reader catches that code and opens read-write instead, still running no schema, no writing pragma and no chmod; with the sidecars present it stays read-only and takes no write lock. Only `SQLITE_BUSY` answers "busy"; any other failure says to run `history forget` then `history index` (the CLI exits 1).
- **The hook never creates the index.** `history index --transcript` opens an existing index for writing and exits 0 silently when there is none, so `history forget` is not undone by the next session end.
- **Restore removes the index.** `backup --restore` (and the viewer's restore) deletes `history.db` and its sidecars: the copy may give the stored project ids to other projects. Both say to run `history index`.
- **Failures are retried.** A file whose turns cannot be resolved to a project stays out of the manifest and is counted as `failed`; the next pass reads it again.
- **Disabled projects.** Each pass first deletes the turns of projects disabled in the main database. Their files stay in the manifest, so turning a project back on brings its turns back only when the transcript changes or the index is rebuilt.
- **Sessions with no session-end hook** (a crash, a killed terminal, Codex without `transcript_path`) are indexed by the next `history index` or `history import`.
- **Whole-file re-reads.** A changed transcript is read again whole; there is no bytes-read offset, a departure from the plan. The measured full pass (12.7 s for 5,186 files) and the unchanged pass (0.07 s) did not justify the extra state.
- **Coverage.** Prompts whose content is an array (an image plus text; about 94 in six months on the author's machine) are not indexed. A renamed project keeps its old name on turns already indexed, so `--project` matches it by that name until those transcripts are indexed again.
