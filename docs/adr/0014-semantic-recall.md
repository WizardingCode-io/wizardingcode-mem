# ADR 0014 — Semantic recall: the spike and the gate

Date: 2026-10-11 · Status: accepted (no-go).

## Context

Retrieval is lexical (FTS5/BM25, files touched, a prior, fused by RRF). On the golden set it finds 19/24 with 0/23 false injections; the five misses are paraphrases that share no word with the memory. The design (`docs/superpowers/specs/2026-10-11-semantic-recall-design.md`) proposes a semantic channel: a static embedding model (`minishlab/potion-multilingual-128M`, 256 dimensions), run by our own engine (`src/embed/`), whose candidates enter the RRF only above a similarity threshold. Before any product code, a spike decides: go when recall@5 ≥ 22/24, false injections 0/23 and the prompt-path p95 ≤ 80 ms.

## Spike

### Method

- **Machine.** Apple M4 Max (16 cores, 128 GB), macOS 26.6.2, the pinned Bun 1.4.2.
- **Pack.** `potion-multilingual-128M.wcpack`, 146,383,528 bytes, sha256 `7d8362253e568e7bb24ff8be3f006f412973aa445a96c4c17b6f13a957825c6a`.
- **Engine agreement (Task 4).** Minimum cosine against the original model 0.999924 over 167 reference items; int8 round trip (quantise, dequantise) minimum cosine 0.999885. Quantised storage changes nothing measurable.
- **Latency.** `scripts/embed/spike-probe.ts`, compiled with `bun build --compile` (the product binary's runtime), does what the prompt hook would: open the pack (mmap), embed the prompt (clipped to buildQuery's 4,000 characters), read `vectors.bin` (N × (float32 scale + 256 int8)), cosine against each, keep the best 20. `scripts/embed/spike.ts` runs it 61 times as fresh processes (the first unmeasured) with a twenty-word prompt, against 5,000 and 65,000 random unit vectors, and the same number of times with `--noop` (the process alone). The prompt-path estimate is the current prompt hook p95 from `tests/perf/budgets.test.ts` (34.1 ms in the run made for this ADR; p50 32.6 ms) plus (probe p95 − `--noop` p95) at 65,000 vectors.
- **Recall and noise.** Each memory of `tests/golden/retrieval.json` is embedded as `title + "\n" + body`. Lexical retrieval runs exactly as in `tests/golden/retrieval.test.ts`. A relevant prompt counts as found when lexical finds it, or when its expected memory is in the cosine top 5 with score ≥ t. An unrelated prompt counts as a false injection when lexical injects for it, or when any memory scores ≥ t. t is swept from 0.30 to 0.90 by 0.01; the best t is the highest recall with 0 false injections, ties to the highest t. `tests/golden/semantic.json` (20 paraphrases, 20 unrelated, keyed to the same 24 memories) is then read at that t, not re-tuned.

### Latency (ms, p50 / p95)

| Vectors | Process wall | open | embed | scan | `--noop` wall | probe p95 − noop p95 |
|---|---|---|---|---|---|---|
| 5,000 | 14.3 / 15.0 | 0.2 / 0.3 | 3.3 / 3.6 | 3.7 / 4.0 | 6.3 / 10.0 | 4.9 |
| 65,000 | 27.1 / 28.5 | 0.3 / 0.3 | 3.3 / 3.6 | 16.2 / 17.0 | 5.9 / 6.4 | 22.1 |

Opening the 146 MB pack costs nothing (mmap); embedding twenty words costs about 3.5 ms; the scan is linear, about 0.25 µs per vector. A first run of the script gave 20.9 ms for the 65,000 difference; the 5,000 `--noop` p95 of 10.0 ms in this run is one slow process (its p50 is 6.3 ms), which is why that row's difference (4.9 ms) is below the 8.5 ms of the first run. **Estimated prompt-path p95 at 65,000 vectors: 34.1 + 22.1 = 56.2 ms.** The same perf test run inside the full `bun run check` (other tests running alongside) gave a prompt p95 of 42.4 ms; with it the estimate is 64.5 ms, still within the gate.

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

Recall 3/20 (all three lexical; semantic recovers 0), false injections 0/20. Not re-tuned. For reference only, its own sweep: 0 false injections from t = 0.40, where recall is 8/20 (5 recovered); its highest unrelated score is 0.399 ("set up a GitHub Actions workflow for a Python package" → baseline). Of its 17 lexical misses, 8 have the expected memory first by cosine, and the expected scores run from 0.108 to 0.511. The Portuguese paraphrases of English memories score 0.108–0.393, and the three expected memories outside the top 5 are all among them.

## Decision

**No-go.** Against the gate, at the chosen t = 0.90:

| Criterion | Gate | Measured | |
|---|---|---|---|
| recall@5 on retrieval.json | ≥ 22/24 | 19/24 | fails by 3 |
| False injections on retrieval.json | 0/23 | 0/23 | passes |
| Prompt-path p95 at 65,000 vectors | ≤ 80 ms | 56.2 ms (34.1 + 22.1) | passes |

Latency is not the obstacle: the engine fits in the budget with 24 ms to spare. Recall is: with a single absolute cosine threshold there is no t that recovers any of the five lexical misses without injecting into an unrelated prompt (the best miss 0.506, the worst unrelated 0.519), and 22/24 would need a threshold 0.053 below where noise begins. The threshold is recorded as 0.90 because the rule gives it; it has no effect.

Parts 2 to 4 of the semantic recall plan (vectors in the database, the semantic channel, the opt-in) are not started. The engine (`src/embed/`) and the two spike scripts stay, so a different rule (for example a relative one, such as the gap between the first and second memory) or a different model can be measured against the same gate. The gate itself is unchanged.
