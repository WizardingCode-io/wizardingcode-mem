# ADR 0014 — Semantic recall: the spike and the gate

Date: 2026-10-11 · Status: accepted (no-go for the prompt channel, with an absolute and with a relative rule; semantic ranking for on-demand search goes ahead).

## Context

Retrieval is lexical (FTS5/BM25, files touched, a prior, fused by RRF). On the golden set it finds 19/24 with 0/23 false injections; the five misses are paraphrases that share no word with the memory. The design (`docs/superpowers/specs/2026-10-11-semantic-recall-design.md`) proposes a semantic channel: a static embedding model (`minishlab/potion-multilingual-128M`, 256 dimensions), run by our own engine (`src/embed/`), whose candidates enter the RRF only above a similarity threshold. Before any product code, a spike decides: go when recall@5 ≥ 22/24, false injections 0/23 and the prompt-path p95 ≤ 80 ms.

## Spike

### Method

- **Machine.** Apple M4 Max (16 cores, 128 GB), macOS 26.6.2, the pinned Bun 1.4.2.
- **Pack.** `potion-multilingual-128M.wcpack`, 146,383,528 bytes, sha256 `7d8362253e568e7bb24ff8be3f006f412973aa445a96c4c17b6f13a957825c6a`.
- **Engine agreement (Task 4).** Minimum cosine against the original model 0.999924 over 167 reference items; int8 round trip (quantise, dequantise) minimum cosine 0.999885. Quantised storage changes nothing measurable.
- **Latency.** `scripts/embed/spike-probe.ts`, compiled with `bun build --compile` (the product binary's runtime), does what the prompt hook would: open the pack (mmap), embed the prompt (clipped to buildQuery's 4,000 characters), read `vectors.bin` (N × (float32 scale + 256 int8)), cosine against each, keep the best 20. `scripts/embed/spike.ts` runs it 61 times as fresh processes (the first unmeasured) with a twenty-word prompt, against 5,000 and 65,000 random unit vectors, and the same number of times with `--noop` (the process alone: it exits before the engine's modules are imported, so the difference includes loading them). The prompt-path estimate is the current prompt hook p95 from `tests/perf/budgets.test.ts` (34.1 ms in the run made for this ADR; p50 32.6 ms) plus (probe p95 − `--noop` p95) at 65,000 vectors.
- **What the latency estimate covers.** The scan only: open, embed, read the vectors file, cosine against every vector, keep the best 20. It does not cover what the hook would also do in part 2: mapping vector rows to memory ids, filtering by project and by what was already shown, reading the matched rows from the database, or the database read of the vectors themselves (here a flat file read with `Bun.file().arrayBuffer()`).
- **Recall and noise.** Each memory of `tests/golden/retrieval.json` is embedded as `title + "\n" + body`. Lexical retrieval runs exactly as in `tests/golden/retrieval.test.ts`. A relevant prompt counts as found when lexical finds it, or when its expected memory is in the cosine top 5 with score ≥ t. An unrelated prompt counts as a false injection when lexical injects for it, or when any memory scores ≥ t. t is swept from 0.30 to 0.90 by 0.01; the best t is the highest recall with 0 false injections, ties to the highest t. `tests/golden/semantic.json` (20 paraphrases, 20 unrelated, keyed to the same 24 memories) is then read at that t, not re-tuned.

### Latency (ms, p50 / p95)

| Vectors | Process wall | open | embed | scan | `--noop` wall | probe p95 − noop p95 |
|---|---|---|---|---|---|---|
| 5,000 | 16.1 / 21.4 | 0.3 / 0.5 | 3.7 / 5.2 | 4.1 / 5.3 | 7.0 / 8.6 | 12.8 |
| 65,000 | 28.5 / 30.3 | 0.2 / 0.3 | 3.6 / 4.1 | 16.7 / 18.3 | 6.7 / 9.6 | 20.7 |

Opening the 146 MB pack costs nothing (mmap); embedding twenty words costs about 3.5 ms; the scan is linear, about 0.25 µs per vector. **Estimated prompt-path p95 at 65,000 vectors: 34.1 + 20.7 = 54.8 ms.**

This table is the run made with the late-loading `--noop`. The first runs (Task 5) used a `--noop` that evaluated the engine's static imports before exiting, which hid their load time from the difference; they gave 20.9 and 22.1 ms at 65,000 (estimate 56.2 ms). The hidden cost is small: 120 interleaved runs of each `--noop` gave p50 / p95 6.76 / 7.73 ms with the imports and 6.68 / 7.53 ms without, about 0.1–0.2 ms. Runs vary by a few ms at p95 (the 5,000 row here: 12.8 ms, against 8.5 and 4.9 ms in the two earlier runs), and so does the hook figure: `tests/perf/budgets.test.ts` gave a prompt p95 of 38.6 ms in a later run alone and 42.4 ms inside the full `bun run check`. With the worst of these the estimate is 42.4 + 22.1 = 64.5 ms, still within the gate.

### Recall and noise on retrieval.json (24 relevant, 23 unrelated)

The sweep, condensed (the full table is in the spike report):

| t | Recall | Recovered by semantic | False injections |
|---|---|---|---|
| 0.30–0.34 | 24/24 | 5 | 16 → 10/23 |
| 0.35–0.39 | 23/24 | 4 | 10 → 6/23 |
| 0.40–0.46 | 22/24 | 3 | 5 → 2/23 |
| 0.47 | 21/24 | 2 | 1/23 |
| 0.48–0.50 | 20/24 | 1 | 1/23 |
| 0.51 | 19/24 | 0 | 1/23 |
| 0.52–0.90 | 19/24 | 0 | 0/23 |

At every t with 0 false injections (0.52 and above), semantic recovers nothing: recall stays at lexical's 19/24. The rule picks **t = 0.90** (the highest of the tied thresholds); any t in 0.52–0.90 gives the same result.

**Margin.** Nothing is recovered at the chosen t, so the brief's margin (lowest recovered score − highest unrelated score) is undefined. What a threshold would have to separate: the best semantic-only candidate scores 0.506 and the highest unrelated 0.519 (−0.013), so not even one miss can be recovered without a false injection. Reaching 22/24 needs three recovered; the third-best candidate scores 0.466 (−0.053).

The relevant prompts lexical misses, with the expected memory's cosine score and rank:

| Prompt | Expected | Rank | Score | Cosine top 3 |
|---|---|---|---|---|
| I truncate the prompt to 8k and then call redact, is that right? | redact-first | 2 | 0.397 | prompt-id 0.436, redact-first 0.397, hook-runs 0.286 |
| em que língua devo responder ao utilizador? | pt-lingua | 1 | 0.466 | pt-lingua 0.466, pt-cursor 0.220, pt-importador 0.219 |
| o Cursor consegue receber memórias em cada prompt? | pt-cursor | 1 | 0.473 | pt-cursor 0.473, pt-lingua 0.232, cross-join 0.214 |
| should imports end in .js or .ts? | ts-extension | 1 | 0.506 | ts-extension 0.506, diacritics 0.340, pt-lingua 0.306 |
| where are hook timings stored? | hook-runs | 3 | 0.350 | pending-timer 0.365, no-mocks 0.358, hook-runs 0.350 |

The five highest unrelated scores (lexical injects for none of them):

| Unrelated prompt | Best memory | Score |
|---|---|---|
| update the README with the install steps | settings-backup | 0.519 |
| can you check the error in the build output? | baseline | 0.463 |
| add a new function to the utils file | settings-backup | 0.454 |
| add a dark mode toggle to the settings page | settings-backup | 0.438 |
| refactor this function to use async await | wal-retry | 0.404 |

Three of the five misses do rank first by cosine, and by a clear gap over the second memory (0.466 vs 0.220, 0.473 vs 0.232, 0.506 vs 0.340). Their absolute scores, though, are no higher than what generic coding requests reach against generic memories: "update the README with the install steps" scores 0.519 against the settings and backups memory. An absolute threshold on cosine cannot tell them apart on this set.

### The extended set at t = 0.90 (semantic.json, 20 paraphrases, 20 unrelated)

Recall 3/20 (all three lexical; semantic recovers 0), false injections 0/20. Not re-tuned.

**Its margin is positive where the original set's is negative.** Its best semantic-only candidate scores 0.511 ("can I fake the storage layer…" → no-mocks) and its highest unrelated prompt 0.399: +0.112, against −0.013 (0.506 vs 0.519) on the original set. The candidates are alike (0.511 and 0.506); what differs is the noise ceiling, 0.399 against 0.519, 0.12 apart. Both sets' unrelated prompts mix off-topic requests with generic coding ones, but the original set's coding requests use this project's own vocabulary ("update the README with the install steps", "check the error in the build output", "the settings page") and land on its memories about settings, builds and tests, while the extended set's are about other stacks (a Dockerfile, Express, a products API). So the ceiling is a property of which twenty-odd unrelated prompts were written, and moves by 0.12 between two reasonable sets: an absolute threshold calibrated on one of them says little about real prompts, most of which are coding requests in the project's own vocabulary, where the original set's ceiling is the more realistic one. For reference only, its own sweep: 0 false injections from t = 0.40, where recall is 8/20 (5 recovered); its highest unrelated score is 0.399 ("set up a GitHub Actions workflow for a Python package" → baseline). Of its 17 lexical misses, 8 have the expected memory first by cosine, and the expected scores run from 0.108 to 0.511. The Portuguese paraphrases of English memories score 0.108–0.393, and the three expected memories outside the top 5 are all among them.

## A relative rule

Added after the no-go above, by the author's decision. The rule was fixed before its numbers were seen: for a prompt, let s1 ≥ s2 be the two highest cosine scores over the project's memories (s2 = 0 with one memory). Only the top memory can be added by the semantic channel, and only when **s1 ≥ f and s1 − s2 ≥ g**. A relevant prompt counts as found when lexical finds it, or when its expected memory is the top memory and the rule fires; an unrelated prompt is a false injection when lexical injects for it or the rule fires. f is swept from 0.30 to 0.60 and g from 0.05 to 0.30, both by 0.01 (806 pairs), on `retrieval.json` only. Among pairs with 0/23 false injections: the highest recall; ties to the largest g, then the largest f. `semantic.json` is the held-out check at that pair.

### The grid

| g | Pairs with 0 false | Best recall at 0 false | f reaching it |
|---|---|---|---|
| 0.05–0.16 | 9 each | 19/24 | 0.52–0.60 |
| 0.17–0.24 | 31 each (every f) | 21/24 | 0.30–0.46 |
| 0.25–0.30 | 31 each (every f) | 19/24 | 0.30–0.60 |

**Chosen: f = 0.46, g = 0.24**: recall 21/24, false injections 0/23. The winning region (0 false, 21/24) is 136 of the 806 pairs: g 0.17–0.24 by f 0.30–0.46, a solid rectangle. Its edges are set by single prompts: below g = 0.17 the README prompt (gap 0.164, s1 0.519) fires unless f ≥ 0.52, which removes every recovery; above g = 0.24 pt-cursor (gap 0.241) stops firing, and above f = 0.46 pt-lingua (s1 0.466) does.

No pair reaches 22/24. The third recoverable miss, ts-extension, has a gap of 0.165; the README prompt's is 0.164, and its s1 (0.519) is above ts-extension's (0.506), so neither g nor f can admit one without the other: the two are 0.001 apart in gap.

The relevant prompts lexical misses:

| Prompt | Expected | Top memory | s1 | s2 | Gap | At (0.46, 0.24) |
|---|---|---|---|---|---|---|
| I truncate the prompt to 8k and then call redact, is that right? | redact-first | prompt-id | 0.436 | 0.397 | 0.039 | no (wrong top memory) |
| em que língua devo responder ao utilizador? | pt-lingua | pt-lingua | 0.466 | 0.220 | 0.246 | fires, recovered |
| o Cursor consegue receber memórias em cada prompt? | pt-cursor | pt-cursor | 0.473 | 0.232 | 0.241 | fires, recovered |
| should imports end in .js or .ts? | ts-extension | ts-extension | 0.506 | 0.340 | 0.165 | no (gap below g) |
| where are hook timings stored? | hook-runs | pending-timer | 0.365 | 0.358 | 0.008 | no (wrong top memory) |

The five unrelated prompts with the largest gap (none fires at the chosen pair):

| Unrelated prompt | Top memory | s1 | s2 | Gap |
|---|---|---|---|---|
| update the README with the install steps | settings-backup | 0.519 | 0.355 | 0.164 |
| traduz este parágrafo para francês | pt-lingua | 0.380 | 0.218 | 0.162 |
| add a dark mode toggle to the settings page | settings-backup | 0.438 | 0.319 | 0.119 |
| bump the React version to 19 | no-embeddings | 0.374 | 0.271 | 0.103 |
| sort this list of numbers in descending order | cross-join | 0.316 | 0.234 | 0.082 |

### Held out: semantic.json at (0.46, 0.24), not re-tuned

Recall 3/20 (the three lexical finds; the rule recovers none), false injections 0/20. Of the 17 lexical misses, 8 have the expected memory on top, but the largest of their gaps is 0.136 ("can I fake the storage layer…"), far below g = 0.24; the other 9 have a different memory on top. Its largest unrelated gap is 0.108 ("escreve um poema sobre o mar"). The two recoveries on the original set are both short Portuguese questions about Portuguese memories (pt-lingua, pt-cursor), where shared language alone separates the top memory from the rest; nothing in the held-out set behaves that way.

## Decision

**No-go for the prompt channel**, with either rule. Against the gate:

| Criterion | Gate | Absolute (t = 0.90) | Relative (f = 0.46, g = 0.24) |
|---|---|---|---|
| recall@5 on retrieval.json | ≥ 22/24 | 19/24 — fails by 3 | 21/24 — fails by 1 |
| False injections on retrieval.json | 0/23 | 0/23 | 0/23 |
| False injections on semantic.json (held out; relative rule only) | 0/20 | 0/20 | 0/20 |
| Prompt-path p95 at 65,000 vectors | ≤ 80 ms | 54.8 ms (34.1 + 20.7) | 54.8 ms (the rule adds one subtraction) |

Held-out recall at the relative pair: 3/20 (lexical only).

Latency is not the obstacle: the scan fits in the budget with about 25 ms to spare (15 ms with the noisiest hook figure). Recall is. With an absolute threshold no t recovers any miss without injecting into an unrelated prompt (the best miss 0.506, the worst unrelated 0.519). The relative rule recovers two misses, both Portuguese questions about Portuguese memories, and the third is separated from a generic coding request by 0.001 in gap; on the held-out paraphrases it recovers nothing. Neither rule is evidence that the semantic channel would add the right memory to real prompts without adding wrong ones.

The thresholds are recorded as t = 0.90 and (f, g) = (0.46, 0.24) because the fixed rules give them; neither is used.

The semantic channel in `retrieveForPrompt` (the prompt-time injection) is not built. By the author's decision, semantic ranking goes ahead for on-demand search (part 2, in another plan), where a person or the agent asks and reads the results, so a wrong neighbour costs a line in a list rather than an injected note. The engine (`src/embed/`) and the two spike scripts stay; a different model or rule can be measured against the same gate. The gate itself is unchanged.
