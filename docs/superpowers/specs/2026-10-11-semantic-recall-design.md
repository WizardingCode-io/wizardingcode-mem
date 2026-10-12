# Semantic recall and two more moments to remember — design

Date: 2026-10-11. Status: approved; the prompt channel was measured no-go twice (ADR 0014); by the author's decision the engine is used for on-demand search only, built in part 2 and proven on real data (ADR 0017; vectors do travel in backups, contrary to the Errors section below); the engine reads the pack with mmap (fallback: read into memory). A4 shipped file-read only, lexical, Claude Code only; tool-failed is held (ADR 0015). Roadmap items A3 (semantic recall, local, no daemon) and A4 (remember at more moments).

## Why

Retrieval today is lexical: FTS5/BM25, the files the session touched, and a prior, fused by reciprocal rank fusion (`src/retrieve/prompt.ts`). On the golden set it finds 19/24 with 0/23 false injections; the five misses are paraphrases that share no word with the memory, two of them in Portuguese (`tests/golden/retrieval.test.ts`). The original design said "no vectors in v1; recall@5 on the golden set decides whether they come back" (`docs/design/2026-10-05-shibaox-mem-design.md`). The competitors (claude-mem, deja-vu) recall by meaning. The author writes prompts in Portuguese and memories mix Portuguese and English.

Memory is also offered at only two moments: session start and prompt. The agent most needs a note when it opens a file that has a known gotcha, and when a command fails with an error that was fixed before.

## Decisions

| Topic | Decision |
|---|---|
| Engine | **Static embeddings** (model2vec family): a per-token vector table, no neural network at run time. A text's vector is the mean of its tokens' vectors. Read per hook, no daemon. A transformer (ONNX) was rejected: loading it costs 100–300 ms per hook. A synonym-expansion table without vectors was rejected: it misses whole-sentence paraphrases. |
| Model | `minishlab/potion-multilingual-128M` (MIT, 101 languages, 256 dimensions), **quantised to int8** with one scale per row (≈ 130 MB), so Portuguese ↔ English paraphrases meet. |
| Delivery | **Opt-in download.** The binary does not grow. Turning semantic recall on (install prompt or the viewer's Settings) downloads the model once into the data directory. Without it everything works as today (lexical). |
| Where it is used | A fourth ranking in the prompt's RRF; the "after a failure" moment; `memory_search` (MCP); `history_search` and the viewer's History view. |
| A4 moments | **When a file is read** (not before an edit: in Claude Code a `PreToolUse` context arrives next to the tool result, after the edit ran) and **after a tool fails**. |
| Gate | Measure first: a spike decides before any product code (see Testing). |

## Components

1. **Model pack** — `src/embed/pack.ts`. Our own file format, `wcmem-embed-v1`: a header (magic, version, dimensions, vocabulary size, tokenizer kind and parameters), the vocabulary, the int8 matrix and the per-row scales. A script (`scripts/embed-pack.ts`, run once by us, not by users) builds it from the published model; it is published as a GitHub release asset of the WizardingCode repository with its sha256 pinned in the binary. The model's MIT notice travels with it. A hook reads only the rows of the tokens it needs (positioned reads on the open file), never the whole matrix.
2. **Tokenizer** — `src/embed/tokenize.ts`. Written from scratch, for the tokenizer the model ships with. Verified against reference token ids produced offline from the original tokenizer (a fixture of 200 Portuguese and English sentences).
3. **Embed** — `src/embed/embed.ts`. Text → normalised 256-dimension vector. Pure; testable without the network.
4. **Memory vectors** — table `memory_vectors(memory_id PRIMARY KEY, model TEXT, vec BLOB)` (migration 5), int8 with a scale. A separate table, so that a model change is a rebuild. Written by distillation, `memory_save` and the viewer's edit, in the same transaction as the memory, when the model is present. Existing memories (and any written without the model) are filled by `wizardingcode-mem embed backfill [--limit n]`: resumable, one run at a time (meta lease `embed.lease`, joined to `anyLeaseActive`), started after the download.
5. **Semantic channel** — in `retrieveForPrompt`. Loads the project's active, not-yet-shown vectors, scores them by cosine against the prompt's vector, and passes the best 20 as a fourth ranking to the existing RRF. Evidence rule: a candidate found only by the semantic channel must reach a similarity threshold calibrated on the golden set; a candidate with lexical evidence follows today's rules. The budget (5 notes, ≈ 700 tokens) is unchanged.
6. **New hook events.**
   - `file-read`: Claude Code `PostToolUse` with matcher `Read`; the equivalents in Codex (`PostToolUse`) and Gemini (`AfterTool`) once confirmed in real sessions. Memories linked to that file in `memory_files` (path made project-relative, as today), of kind gotcha, fix, convention or decision; at most 2; at most once per file per context; nothing when there is none.
   - `tool-failed`: Claude Code `PostToolUseFailure`; Codex `PostToolUse` with a non-zero exit code; Gemini `AfterTool` with an error. The error text (redacted, first 2,000 characters, paths and numbers stripped the way `buildQuery` does) is searched by FTS and the semantic channel among fix and gotcha memories, with the same evidence rule; at most 2.
   - Both record in `injections` with their event name, so a note is not given twice in a context. Cursor's `postToolUseFailure` cannot inject context today; Cursor and OpenCode stay out of v1.
   - The events are added to the generated plugin files through `scripts/plugins.ts`.
7. **Switch and settings.** `WIZARDINGCODE_MEM_SEMANTIC` (`on` by default when the model is present). `install` asks once (TTY) or prints a hint (no TTY), like the history offer; `--semantic` / `--no-semantic`. The viewer's Settings gains a "Semantic recall" card: download with progress, model size, backfill progress, turn off, delete the model.
8. **History.** `history.db` gains `turn_vectors`, filled by `history index` when the model is present; `history_search` and the History view add the semantic channel. Search runs on demand, so its cost does not touch the hooks.

## Data flow

### Prompt (budget: p95 ≤ 80 ms)

1. `buildQuery` as today; host notifications and empty queries inject nothing.
2. With the model present: tokenise the prompt (clipped as today), read those rows, average, normalise.
3. Load the project's active vectors not yet shown in this context in one query; cosine by brute force (5,000 memories × 256 int8 ≈ 1.3 M multiply-adds).
4. Four rankings into RRF, the evidence rule, the existing budget.

### Writing a memory

The vector is computed from the redacted title and body in the memory's transaction. If the model is absent, broken or of another version, the memory is saved without a vector and the backfill picks it up later.

### File read and tool failure (budget: p95 ≤ 50 ms each)

They run on every matching tool call, so they do the least: an indexed lookup by path for `file-read`; one FTS query and one cosine pass over fix and gotcha vectors for `tool-failed`.

### Errors and guarantees

- Fail open everywhere: a missing, corrupt (sha256 mismatch) or wrong-version model leaves the semantic channel out, logs once and shows in `doctor`; hooks exit 0 with empty output on any failure.
- The download is the only network access, only for those who turn it on: a fixed URL in the code, the sha256 checked, written to a temporary file and renamed. No text of the user's ever leaves the machine for this feature; TypeSafe is unchanged.
- Backups do not carry vectors (like `history.db`); after a restore the backfill rebuilds them.
- Turning semantic recall off stops its use at once; deleting the model also drops `memory_vectors` and `turn_vectors` rows.

## Testing

TDD: every test is seen failing before the code. Proofs are part of the delivery and live in the repository.

0. **Spike (go/no-go, before product code).** With the real model, measured on the author's machine on a copy of the database: hook start-up with the model (p95 over 60 runs); recall@5 and false injections on the golden set with and without the semantic channel; int8 against float16. Go when recall@5 ≥ 22/24, false injections 0/23 and prompt p95 ≤ 80 ms. Otherwise stop and report the numbers.
1. **Unit:** tokenizer ids equal the reference fixture; embed cosine ≥ 0.99 against reference vectors; a pack with a wrong sha256 or truncated is refused without throwing; the evidence rule (semantic-only below the threshold injects nothing).
2. **Golden set, extended:** +20 paraphrases (half Portuguese, with Portuguese prompt ↔ English memory pairs); +20 unrelated controls; 10 `file-read` cases (a file with a note injects 1–2, without a note nothing); 10 `tool-failed` cases (a known error gets its fix, a new error nothing). The test fails if recall drops or any false injection appears.
3. **Integration:** `file-read` and `tool-failed` hooks with captured Claude Code and Codex payloads; no note twice per context; without the model the output equals today's (snapshot); download against a local server (checksum, interrupted and resumed); backfill resumable and one at a time.
4. **Performance:** `tests/perf/budgets.test.ts` gains the prompt with the model at 65,000 memories, and `file-read` and `tool-failed` under 50 ms.
5. **End-to-end proofs in the repository:** `scripts/proof/history.sh` (the A1 proof, cleaned up) and `scripts/proof/semantic.sh`. They run the compiled binary on a temporary copy of the user's database, TypeSafe off, the real store only read, and write a report: recall before and after, latencies, and ten real "what was injected and why" examples to judge by eye.
6. **Real sessions:** Claude Code and Codex with the new hooks; what was and was not confirmed goes in ADR 0014.
7. **Viewer:** the "Semantic recall" card built from the rendered Sales OS mockups and compared side by side in light and dark.

## Out of scope

- A resident process or any generative model.
- Cursor and OpenCode tool events (no context injection there today).
- Injecting raw history automatically.
- The public benchmark (A2), still at the end of the roadmap.
