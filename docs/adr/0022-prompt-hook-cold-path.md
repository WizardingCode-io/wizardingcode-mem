# ADR 0022 — The prompt hook's remaining cost in large projects

Date: 2026-10-13 · Status: accepted; measured on a copy of the author's store.

## Context

After ADR 0021 the prompt hook met its budget in process, but real sessions on the author's largest project (92,000 memories in the store; the project holds 37,500, 29,800 of them active) still showed a p95 of about 96 ms against a budget of 80. A probe of real runs found no single slow statement: the time came from CPU-bound retrieval meeting CPU contention from the agent and its other hooks. The candidate search was the largest part. It scored every FTS match, and read every match's full `memories` row (body included) before `ORDER BY bm25 LIMIT 20` kept twenty. That was 3,600 rows at p50 and 6,700 at p90 on that project's prompts. Three smaller costs ran on every prompt: a version check in the plugin script, a count of all memories, and a count of the project's active memories.

## Decisions

- **A1. The text search ranks first, then reads.** `projectMatches` (`src/retrieve/prompt.ts`) asks the index alone for its best 100 matches (`rowid` and bm25; the project filter stays inside the `MATCH`). It then reads only those rows from `memories` and applies the status, already-shown and kind filters. The result is exact when the index returned fewer than 100 matches, since that is every match, or when at least 20 of the 100 pass the filters, since every match past them ranks no better. Otherwise it runs the single query it replaced. On the 46 real prompts that reach the search, 45 have more than 100 matches. Of the best 100, 46 to 100 are eligible (median 89), so the fallback never ran.
- **A2. The queue check uses its index.** `hasQueuedTurns` repeats the partial index's own condition (`state IN ('open','pending','processing') AND …`). SQLite then searches `turns_queue` instead of scanning every turn. The answer is the same.
- **A3. The plugin script asks the version at session start only.** Only the session start ever fetched a binary, so running `"$bin" --version` before every prompt, stop and file hook changed nothing and cost a process start. The never-downgrade rule is unchanged. No stamp file was needed.
- **A4. A prompt counts less.** The index's size is now `max(id)`. Memories are never deleted (no code path deletes one; they are archived or superseded), and ids are given in order, so the highest id is the count. On the store, both are 92,224. The first lookup in a fresh process takes 0.01 ms instead of 0.33 ms. The project's active count (0.9 ms on a fresh process) is now taken only when a word's rarity decides a candidate's evidence, and at most once per prompt.

## The proof

- Golden set: unchanged, recall@5 19/24, false injections 0/23. Every hook snapshot is byte-identical.
- `tests/unit/prompt-matches.test.ts` compares `projectMatches` with the old single query in three cases: enough eligible rows in the best 100, the fallback, and fewer than 100 matches.
- On a fresh copy of the author's store, project 2, the 60 real prompts of the earlier probes:
  - In process: the top 20 candidates were identical (ids and bm25) for all 46 prompts that searched, and the injected text was identical for all 60.
  - Compiled hooks, main and this branch run alternately on separate copies of the store: stdout was byte-identical in every run (300 direct, 180 through the plugin script, 120 under load). 70% of the runs injected notes.

| Prompt hook, project 2, 60 real prompts | main p50 / p95 (ms) | after p50 / p95 (ms) |
|---|---|---|
| In process (`hook_runs.ms`), binary called directly, 300 runs | 19 / 37 | 16 / 30 |
| Whole compiled hook, called directly, 300 runs | 30.9 / 50.6 | 28.6 / 43.4 |
| Whole hook through the plugin script, 180 runs | 43.3 / 66.1 | 32.6 / 48.7 |
| Through the plugin script, 16 busy cores, 120 runs | 70.0 / 104.5 | 52.9 / 77.7 |
| In process under the same load | 27 / 51 | 25 / 42 |

## Also in this change

- `doctor` on a database from before a migration no longer fails with "no such table". It reports the schema version and that the database will be migrated on next use, and it skips the checks that need the newer tables. It still changes nothing.
- `history import` no longer stops when another process holds the drain lease. It used to treat that like an empty queue, and on the author's machine it distilled none of 3,299 queued turns. It now waits and retries within its time budget. When turns remain because the drain stayed held, its report line says so.
