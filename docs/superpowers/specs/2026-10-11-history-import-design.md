# History import — design

Date: 2026-10-11. Status: design approved in conversation; awaiting review of this spec.

## Why

Today wizardingcode-mem only knows what happens after it is installed (the claude-mem importer aside). Coding agents already keep months of history on disk: on the author's machine, 15 GB of Claude Code transcripts across 71 projects (≈ 41,500 turns in the last six months) and 972 MB of Codex sessions. A competitor (deja-vu) indexes that history and is useful from the first minute. This feature makes ours useful from the first minute too, without giving up what sets it apart: what is injected is what matters, in the original words, with no generative model and no resident process.

## Decisions

| Topic | Decision |
|---|---|
| What is kept | **Hybrid.** Recent history is distilled into memories (the ones injected automatically); all history is indexed raw and searched only on demand. |
| Time window | Distil the **last 6 months** (setting `WIZARDINGCODE_MEM_HISTORY_DAYS`, default 180); index **everything** raw. |
| Agents, v1 | Claude Code and Codex (readers exist in `src/adapters/*/transcript.ts`). Then Gemini; Cursor and OpenCode need their own investigation. |
| When it runs | **At install, after confirmation**, then in the background in bounded, resumable batches. Users who installed earlier are asked once in the viewer. |
| Overlap with claude-mem imports | **Distil everything and replace.** Imported memories do not record their source session, so replacement is by project and time window: once a project's history is distilled, its imported memories inside the window become `archived` (never deleted), with the reason recorded, reversible in one command. |
| Raw index storage | **A separate SQLite file, `history.db`**, beside the main database, so the main database and its backups stay small and the index can be deleted and rebuilt at will. |

## Components

1. **History readers** — `src/adapters/<agent>/history.ts`. List an agent's sessions and yield their turns: prompt, final answer, `cwd`, time, session id, turn id, transcript path. Built on the existing transcript parsing. Host notifications are skipped (`isFromTheHost`, `src/core/host-prompt.ts`); unknown shapes and broken lines are skipped.
2. **Backfill** — `src/backfill/`. Feeds the turns inside the window to the existing distillation queue, oldest first.
3. **Replacement** — archives the claude-mem imports of a project and window once that project's backfill is distilled, recording each archived id so the undo touches only those.
4. **Raw history index** — `src/history/` and `history.db`. FTS5 over redacted turn text, with an incremental manifest.
5. **History search** — MCP tool `history_search`, CLI `wizardingcode-mem history search`, and a History tab in the viewer. Never injected on its own.
6. **Trigger and progress** — `install` asks (as it already does before retiring claude-mem) and starts the backfill detached; the viewer asks once for existing installs; `status` and the viewer show progress.

## Data flow

### Distilling the recent history

1. Each reader lists the sessions whose turns fall inside the window.
2. The project is resolved from `cwd` with the identity the hooks use (`src/core/project.ts`).
3. Each turn becomes a finished session and turn in the queue, with its **original time**, marked `origin = 'history'` (new column on `turns`, default `'live'`; migration 4, which assumes migration 3 from PR #12 is merged first).
4. **Live turns first.** The queue claims live turns before history turns (`ORDER BY origin = 'history', id` in `src/distill/queue.ts`), so a new session never waits behind the backfill. History drains in bounded batches, like `rejudge`.
5. A turn already captured by the hooks is not queued again (same session and agent turn id; the existing `turns_agent_turn` unique index).
6. Distillation is unchanged: redaction, judge (TypeSafe if a key is set, with the heuristic fallback), consolidation. The memory's `created_at` is the **turn's original time**, so recency ranking and supersession behave as if it had been captured then. Turn detail (files, commands, errors) is read from the transcript as today.
7. When a project's backfill is fully distilled, its `imported` memories created inside the window become `archived`; their ids go to a `history_replacements` table (migration 4) with the run that archived them.

### Indexing the raw history

1. `history.db` holds a manifest per transcript: path, size, mtime, bytes read. A pass reads only what changed.
2. Each turn is stored redacted (prompt and final answer), with project, session, agent and time, in an FTS5 table.
3. A transcript that disappears takes its entries with it: if the user deleted a conversation, we forget it too.
4. After the initial import, the session-end hook indexes the session that just ended (a short detached run, no resident process).

### Errors and guarantees

- Fail open: an unreadable file or line is skipped and logged; one bad session does not stop the rest. Hooks keep exiting 0.
- Resumable: the manifest records what was indexed and the queue what was distilled; an interrupted import continues where it stopped, without duplicates.
- Nothing leaves the machine except TypeSafe requests when a key is set, as today. The cost with TypeSafe is about $0.00006 per turn (≈ $2.50 for six months of the author's history).
- Undo: `wizardingcode-mem history forget` deletes `history.db`; `wizardingcode-mem history restore-imports` reactivates the memories listed in `history_replacements`.

## Testing

TDD: every test is seen failing before the code.

- **Readers (unit):** sample Claude Code and Codex transcripts yield the expected turns; host notifications, broken lines and unknown shapes are skipped.
- **Redaction:** a secret in an old prompt never reaches `history.db` or a memory.
- **Backfill (integration):** only the window is queued, oldest first; turns already captured are not repeated; running twice changes nothing; live turns drain before history turns; memories carry the original date.
- **Replacement:** imports of the project and window become `archived` and are listed; imports outside stay active; `restore-imports` reverts exactly those.
- **Index:** incremental passes read only what changed; a deleted transcript leaves the index; `history_search` finds by words and returns project, session and time; `history forget` removes everything.
- **Trigger:** `install` asks and does nothing without a yes; the viewer asks once; `status` shows progress.
- **Resume:** an import killed midway finishes on the next run with no duplicates.
- **Performance:** hook budgets unchanged (prompt p95 < 80 ms while a backfill runs); `history_search` < 100 ms on a multi-GB index; time and index size measured on a copy of real history and recorded in an ADR.

## Out of scope

- Gemini, Cursor and OpenCode readers (next, one by one).
- Injecting raw history automatically.
- The public benchmark (A2), deferred to the end of the roadmap.
