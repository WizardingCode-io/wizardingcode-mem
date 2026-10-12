# ADR 0017 — Search by meaning: the published model, the floor, and the proof

Date: 2026-10-12 · Status: accepted; built and measured on a copy of real data; the model's GitHub release is to be published at `MODEL_URL` before the first download can succeed. Part 2 of roadmap item A3. Design: `docs/superpowers/specs/2026-10-11-semantic-recall-design.md`; the gate and the engine: ADR 0014.

## Context

ADR 0014 measured the semantic channel for prompt-time injection and found it a no-go: no threshold recovers the lexical misses without injecting into unrelated prompts. By the author's decision the engine goes ahead for **on-demand search only**: `memory_search` (MCP and `wizardingcode-mem tool`), `history_search`, the viewer's palette (⌘K) and its History view. There a person or the agent asks and reads the list, so a wrong neighbour costs a line, not an injected note. The hooks never load the model; `retrieveForPrompt`, `sessionBrief`, `notesForFile` and `notesForFailure` stay lexical, and the golden retrieval test still reads 19/24 recall, 0/23 false injections.

## Decisions

| Topic | Decision |
|---|---|
| Delivery | Opt-in download of one file, `potion-multilingual-128M.wcpack` (146,383,528 bytes), from a fixed URL in the code (`MODEL_URL`, a release asset of the WizardingCode repository), sha256 and size pinned (`MODEL_SHA256`, `MODEL_BYTES` in `src/embed/download.ts`). Streamed to a private part file, renamed over the final name only when both match. The only network access of the feature; no text of the user's leaves the machine. |
| Where the model lives | `<data dir>/models/`. Opened lazily, once per process, by the viewer, the MCP server and the CLI; reopened when the file's device, inode, size or mtime change. |
| Memory vectors | `memory_vectors` in the main database: int8 with a scale, one row per memory, scoped to the model's id. Written with the memory (distillation, `memory_save`, the viewer's edit) when the model is there; the rest by `embed backfill`. |
| Turn vectors | `turn_vectors` in `history.db`, filled by `history index` (at most 2,000 per pass) and the session-end update. |
| Ranking | Lexical (FTS5/BM25), meaning (cosine over the vectors) and the prior, fused by reciprocal rank (k = 60). A result found only by meaning must reach `SEMANTIC_FLOOR` = 0.32. Without the model, or when nothing passes the floor, the ranking is exactly the lexical one. |
| Switch | `WIZARDINGCODE_MEM_SEMANTIC` (`on` by default when the model is present), from the environment or the settings file. |
| Surfaces | `wizardingcode-mem embed download [--backfill] | status | delete | backfill [--limit n]`; `install --semantic / --no-semantic` (asks once in a terminal, a hint otherwise); the viewer's Settings → **Search** card ("Search by meaning": download with progress, backfill, on/off, delete); a `semantic search` line in `doctor`. |

## The floor

`scripts/embed/search-floor.ts` runs `rankMemories` over the golden memories, each with a vector, for every paraphrase (24 in `retrieval.json`, 20 in `semantic.json`: is the expected memory in the top 5?) and every unrelated query (23 and 20: how many of the first 10 results were found only by meaning?). The rule fixed before the numbers: the most paraphrases in the top 5 while results found only by meaning stay at most 1 per unrelated query; ties go to the higher floor.

| Floor | retrieval.json top 5 | semantic.json top 5 | All top 5 | Meaning-only per unrelated: retrieval.json | semantic.json | Both together |
|---|---|---|---|---|---|---|
| no model | 24/24 | 11/20 | 35/44 | 0.00 | 0.00 | 0.00 |
| 0.25 | 24/24 | 16/20 | 40/44 | 3.65 | 1.35 | 2.58 |
| 0.28 | 24/24 | 16/20 | 40/44 | 2.48 | 0.70 | 1.65 |
| 0.30 | 24/24 | 16/20 | 40/44 | 1.78 | 0.50 | 1.19 |
| 0.31 | 24/24 | 16/20 | 40/44 | 1.43 | 0.40 | **0.95** |
| **0.32** | 24/24 | 15/20 | **39/44** | **1.00** | 0.30 | 0.67 |
| 0.33 | 24/24 | 15/20 | 39/44 | 0.78 | 0.30 | 0.56 |
| 0.35 | 24/24 | 12/20 | 36/44 | 0.52 | 0.15 | 0.35 |
| 0.38 | 24/24 | 11/20 | 35/44 | 0.26 | 0.05 | 0.16 |
| 0.45 | 24/24 | 11/20 | 35/44 | 0.00 | 0.00 | 0.00 |

Two readings of the rule:

- **Both sets together (per query over all 43 unrelated):** 0.31 passes (0.95) with 40/44 and is the answer.
- **Each set on its own:** 0.31 fails on `retrieval.json` (1.43); 0.32 is the lowest floor that keeps each set at or under 1 (1.00 and 0.30), with 39/44.

**Chosen: 0.32**, the per-set reading. 0.31 also sits on a knife edge: the paraphrase it gains over 0.32 scores 0.310–0.311. The per-set reading is the safer one, and the rule's tie-break prefers the higher floor; the cost is one paraphrase fewer in the golden top 5. Portuguese paraphrases in the top 5 go from 1/8 to 4/8. The golden search test (`tests/golden/search.test.ts`) checks the floor per set.

The same floor serves `history_search` (see the proof: there it lets in more noise than in memories).

## Backups carry the vectors (contradicting the spec)

The spec said backups would not carry vectors, as they do not carry `history.db`, and a restore would be followed by a backfill. The vectors live in the main database instead, so `backup` copies them. The reason: a restore would otherwise leave every memory without a vector, and search by meaning silently weaker, until someone runs a backfill, which nothing prompts. The cost is about 256 bytes of vector per memory (on the author's copy: 22 MB of vectors, 31 MB of database growth with the index, for 89,916 memories, against a 222 MB database). `turn_vectors` stay in `history.db`, which is rebuildable and not backed up, as before.

## Deleting the model

`embed delete` and the viewer's Delete remove the file and drop `memory_vectors` and, when `history.db` exists, its `turn_vectors`: the rows are harmless (scoped to the model's id) but deleting the model should give their space back. A re-download re-embeds (memories: about 0.15 ms each on the author's copy; turns: about 0.3 ms). The viewer refuses while a download, a backfill or a history run holds its lease; the command refuses during a history run.

## Latency

The spec's target for a global search with the model (≤ 60 ms p95 at 65,000 memories) is replaced by **"meaning adds at most about 10 ms over the lexical search"**. The time left over is the existing FTS query on common words, which this work does not change: at 65,000 synthetic memories the lexical global search alone reads 72–73 ms p95, and 74 ms with the model after the int8 scoring fix (scoring the int8 rows in place, with a per-connection cache of the packed vectors, took semantic global scoring from 150 to 11 ms p95). Making the lexical global search faster is a separate optimisation.

**MCP pays the cache miss on every call.** The MCP server (and `wizardingcode-mem tool`) opens a database connection per call, and the vector cache belongs to the connection, so it never hits there: every search rebuilds the packed vectors. Measured in part 2's review at 65,000 memories: 46 ms p50, 83 ms p95 per MCP search; on the author's copy (89,916 memories), see below. Acceptable for a tool the agent calls a few times per session; a persistent connection in the server is a later improvement.

## The proof

`scripts/proof/semantic.sh <pack> <queries.tsv> <work dir> [--history-seconds n] [--runs n]` runs the compiled binary on a copy of the live database taken with `sqlite3 -readonly … ".backup"` into a fresh data directory, with TypeSafe's variables unset and distillation, the viewer, the migration and the browser off. Without a `history.db`, it indexes the agents' transcripts (only read) into the copy's store. It measures without the model, copies the pack in (no download), times the backfill, fills the history vectors, measures again, and writes an anonymous comparison; the queries and titles go to a separate file that is never committed. The measuring half is `scripts/proof/semantic.ts`.

Run on 2026-10-12, Apple M4 Max, macOS 26.6.2, the pinned Bun 1.4.2, the darwin-arm64 binary. The database: 67,848 active, 22,068 archived and 38 superseded memories. The history index: 5,089 transcript files, 3,626 turns. Ten real Portuguese queries, taken from the author's recent prompts (seven about one project, two about a second, one about a third), each run against every project and against its own.

**Cost**

| | |
|---|---|
| `embed backfill` | 89,916 vectors in 13.0 s (0.14 ms each) |
| Main database | 222.0 MB → 254.2 MB (+31.4 MB; 23.0 MB of it vector bytes) |
| History vectors | 3,626 in 1.1 s; `history.db` 15.5 MB → 17.1 MB |

**Latency, ms, p50 / p95** (warm: one connection, 20 rounds of the ten queries after a first round; per call: a connection per search, as MCP does; process: the binary's `tool memory_search --global`, one process per call)

| | Words only | With the model | Added at p95 |
|---|---|---|---|
| memory_search, every project, warm | 9.8 / 26.8 | 16.4 / 37.7 | +10.9 |
| memory_search, one project, warm | 4.3 / 14.8 | 7.9 / 18.5 | +3.7 |
| history_search, warm | 1.8 / 3.6 | 3.2 / 5.7 | +2.1 |
| memory_search, every project, per call | 8.4 / 25.5 | 78.3 / 98.8 | +73.3 |
| memory_search, every project, per process | 21.7 / 36.7 | 103.3 / 126.5 | +89.8 |

Warm, meaning adds about 11 ms at p95 to the global search over 89,916 memories, and under 4 ms to a project's: the target holds within a millisecond. Per call, the rebuild of the packed vectors dominates (about 70 ms at this size), which is the MCP note above at a larger scale.

**Results** (top 5 of each of the ten queries, before and after; counts only)

| Search | Top-5 results kept from before | Found only by meaning | Empty before / after |
|---|---|---|---|
| memory_search, every project | 20/50 | 4 | 0 / 0 |
| memory_search, the query's project | 20/50 | 3 | 0 / 0 |
| history_search | 15/50 | 13 | 0 / 0 |

Judged by eye on the queries and titles (in the task report, not committed): in memory search, meaning helps in about six of the ten (memories about the asked subject rise into the top 5, mostly from the lexical pool rather than as new finds), changes nothing that matters in two or three, and hurts in one or two, where on-topic lexical results gave way to weaker neighbours. In history search the turns found only by meaning are mostly noise: short turns ("yes", "the command?") and unrelated conversations clear the 0.32 floor more easily than memories do, and the queries, being near-copies of indexed prompts, already find their source turn lexically.

## Reproducible pack and licence

`scripts/embed/pack.ts` rebuilds the pack from the model's pinned revision (`73908c3438cf03b6a01bcb9611d62b23d0726f08` of `minishlab/potion-multilingual-128M`); rebuilt on 2026-10-12, it is byte-identical to part 1's: sha256 `7d8362253e568e7bb24ff8be3f006f412973aa445a96c4c17b6f13a957825c6a`, 146,383,528 bytes. The model is MIT-licensed (Minish Lab); its notice, `LICENSE-potion.txt`, is published as a second asset of the same release.

## What is not done

- **The prompt channel stays off** (ADR 0014): nothing is injected by meaning.
- **The release is not yet published.** Until the asset exists at `MODEL_URL`, `embed download` fails cleanly ("Nothing was installed"). After publishing, the pinned sha256 and size must be checked against the asset.
- **`embed download --backfill` end to end needs the network**: the download is tested against a local server (checksum, interruption, retry), the hand-over of its lease to the backfill and the backfill on their own; the whole command against the real URL is not run in the test suite.
- **History noise.** The floor was calibrated on memories; turns, often short, pass it more easily. A floor of its own for `history_search`, or a minimum length, is a later measurement.
- **A persistent connection in the MCP server**, so its searches hit the vector cache.
