# Semantic recall, part 1: the embedding engine and the go/no-go spike — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a text into the same 256-dimension vector `potion-multilingual-128M` gives it, inside our binary, fast enough for a hook, and measure whether semantic recall earns its place (the spec's go/no-go gate).

**Architecture:** A pack file of our own format (`wcmem-embed-v1`) holds the tokenizer's normaliser map, the vocabulary in a binary hash table, the Unigram scores and the int8 embedding matrix with one scale per row. It is opened with `Bun.mmap`, so a hook touches only the pages it reads. A from-scratch normaliser and Unigram (Viterbi) tokenizer turn text into ids; the vector is the mean of their rows, L2-normalised. Reference ids and vectors from the original Python implementation (generated once, offline, committed as a fixture) prove equality. A subset pack holding only the pieces that occur in the fixture sentences lets CI run the real checks without the 138 MB file.

**Tech Stack:** TypeScript on the pinned Bun (`Bun.mmap`, `Intl.Segmenter`), `bun:sqlite`; dev-only Python 3 venv (`model2vec`, `tokenizers`) for the reference fixture, never shipped.

**Spec:** `docs/superpowers/specs/2026-10-11-semantic-recall-design.md` (components 1–3, Testing items 0 and 1). Parts 2–4 (vectors and the prompt channel, the A4 hooks, proofs and the viewer) are planned only after the gate passes.

## Global Constraints

- Written from scratch; never copy from claude-mem (`CLEAN-ROOM.md`). The model is `minishlab/potion-multilingual-128M`, MIT; its notice travels with any pack we build (`LICENSE-potion.txt` beside the pack, and a line in `THIRD-PARTY.md`).
- Model revision pinned: `73908c3438cf03b6a01bcb9611d62b23d0726f08` (the Hugging Face `sha` read on 2026-10-11).
- No resident process, no generative model, no network at run time in this part. Nothing here is on the hook path yet.
- Never write to the user's real data (`~/.wizardingcode`, `~/.claude`, `~/.codex`). The full pack, the venv and downloads live in the session scratchpad; real-data measurements run on a temporary copy taken with `sqlite3 -readonly <db> ".backup '<tmp>/copy.db'"`, TypeSafe off.
- TDD: each test is seen failing before the code. Tests run with the pinned Bun (`bun run test` or `./node_modules/.bin/bun test <files>`).
- Imports carry an explicit `.ts` extension. Repository text in English.
- Gate (spec, Testing 0): go when recall@5 ≥ 22/24, false injections 0/23, and prompt-path p95 ≤ 80 ms. Otherwise stop and report the numbers to the author.

## Review Focus

1. Text the fixture does not cover — emoji, CJK, combining accents, a 50 KB paste, an empty string, only punctuation — must give a finite vector or `null`, never throw or hang (Task 3 and 4 tests pin each).
2. A pack that is truncated, of another version, or not a pack at all — refused with a reason, no exception escapes (Task 2).
3. Normalisation differences that only show on real text (NFKC-like compatibility forms such as full-width letters, ligatures, non-breaking spaces) — covered by the reference fixture's edge sentences (Task 1) and compared id for id (Task 3).
4. Quantisation error compounding on long texts (many rows averaged) — cosine against the float reference on the longest fixture sentences ≥ 0.99 (Task 4).
5. A threshold that only separates the hand-written set by luck — the spike reports the margin between the lowest recovered paraphrase and the highest unrelated score, on the original and the extended set separately (Task 5).

---

### Task 1: Reference fixture and the extended semantic cases

**Files:**
- Create: `scripts/embed/reference.py` (dev-only), `scripts/embed/README.md`
- Create: `tests/golden/semantic.json`
- Create: `tests/fixtures/embed/sentences.json`, `tests/fixtures/embed/reference.json` (generated)

**Interfaces — produces:**
- `tests/fixtures/embed/reference.json`: `{ "model": "minishlab/potion-multilingual-128M", "revision": "73908c3438cf03b6a01bcb9611d62b23d0726f08", "items": [{ "text": string, "normalized": string, "ids": number[], "vector": number[] /* 256, rounded to 6 decimals */ }] }`.
- `tests/golden/semantic.json`: `{ "paraphrases": [{ "prompt": string, "expect": [string] }], "unrelated": [string] }`, keys referring to `tests/golden/retrieval.json` memories.

- [ ] **Step 1: Write the extended cases** — `tests/golden/semantic.json`, exactly:

```json
{
  "paraphrases": [
    { "prompt": "the very first statement after connecting gets a locked database error", "expect": ["busy-timeout"] },
    { "prompt": "porque é que a primeira consulta falha logo com a base bloqueada?", "expect": ["busy-timeout"] },
    { "prompt": "switching the journal to write-ahead logging ignores the wait setting", "expect": ["wal-retry"] },
    { "prompt": "can I fake the storage layer in unit tests instead of a real file?", "expect": ["no-mocks"] },
    { "prompt": "posso simular a base de dados nos testes?", "expect": ["no-mocks"] },
    { "prompt": "interrupted requests vanish from the log because we create them too late", "expect": ["open-at-prompt"] },
    { "prompt": "o agente bloqueia a ação do utilizador quando o nosso script termina mal", "expect": ["exit-code"] },
    { "prompt": "the release crashes on an old processor without AVX2", "expect": ["baseline"] },
    { "prompt": "o binário está a ler as variáveis secretas da pasta do projeto", "expect": ["dotenv"] },
    { "prompt": "accented words are not found when typed without accents", "expect": ["diacritics"] },
    { "prompt": "a pesquisa por palavras sem acentos não encontra nada", "expect": ["diacritics"] },
    { "prompt": "the query planner walks every row and the search is a hundred times slower", "expect": ["cross-join"] },
    { "prompt": "devíamos usar vetores semânticos na pesquisa?", "expect": ["no-embeddings"] },
    { "prompt": "importing the protocol library at startup made every hook slower", "expect": ["mcp-sdk"] },
    { "prompt": "cutting the text before hiding secrets may leave half a key visible", "expect": ["redact-first"] },
    { "prompt": "dois processos a esvaziar a fila ao mesmo tempo criaram duplicados", "expect": ["drain-lease"] },
    { "prompt": "which language should the replies to the user be in?", "expect": ["pt-lingua"] },
    { "prompt": "can Cursor get notes injected on every message?", "expect": ["pt-cursor"] },
    { "prompt": "o processo de testes fica pendurado dez segundos depois de passar", "expect": ["pending-timer"] },
    { "prompt": "where do we keep how long each hook took?", "expect": ["hook-runs"] }
  ],
  "unrelated": [
    "plan a three-day trip to Porto",
    "convert this recipe from cups to grams",
    "write a cover letter for a marketing job",
    "explain the difference between a virus and a bacterium",
    "qual é a melhor altura para visitar os Açores?",
    "faz um resumo deste livro em cinco frases",
    "what rhymes with orange?",
    "draw an ASCII cat",
    "how many calories are in a banana?",
    "escreve um poema sobre o mar",
    "set up a GitHub Actions workflow for a Python package",
    "add pagination to the products API",
    "style the login button with a gradient",
    "migrate the Express app to Fastify",
    "create a Dockerfile for the Next.js frontend",
    "adiciona validação de email ao formulário de registo",
    "muda a cor do cabeçalho para azul",
    "write unit tests for the date formatter",
    "optimise the images on the homepage",
    "o carrinho de compras não atualiza o total"
  ]
}
```

- [ ] **Step 2: Write the sentence list** — `tests/fixtures/embed/sentences.json`, a JSON array built by a small inline script (not committed) from: every golden memory's `title` and `title + "\n" + body`; every prompt in `retrieval.json` (relevant and unrelated) and `semantic.json`; and these 30 edge sentences, verbatim:

```json
[
  "", "   ", "!!!???...", "Ｆｕｌｌ－ｗｉｄｔｈ ＴＥＸＴ ｌｅｔｔｅｒｓ", "ﬁle ﬂow ligatures", "non\u00a0breaking\u00a0spaces",
  "e\u0301 combining accent versus é", "naïve café façade coöperate", "Ação, coração, pão, mãe, avó, cães",
  "日本語のテキストも混ざる", "emoji 🚀🔥 in a commit message ✅", "tab\tseparated\tvalues\nnew line",
  "src/store/migrations/0001_init.sql", "retrieveForPrompt(db, { projectId, sessionId })",
  "SQLITE_BUSY: database is locked", "PRAGMA journal_mode = WAL;", "https://example.com/a?b=c&d=e#f",
  "<task-notification> wrapped xml </task-notification>", "user@example.com wrote: \"quoted\"",
  "C:\\Users\\name\\AppData\\Local", "snake_case_identifier and camelCaseIdentifier and kebab-case-id",
  "0x7fffffff 1e-9 3.14159 -42", "TypeError: Cannot read properties of undefined (reading 'map')",
  "error[E0382]: borrow of moved value: `v`", "    at Object.<anonymous> (/app/index.js:10:5)",
  "Ünïcödé ÀÉÎÕÜ ß ø å æ", "çãõâêô in Portuguese words like 'informação'", "a",
  "the the the the the the the the the the", "Москва и Санкт-Петербург"
]
```

plus one long text: the first 6,000 characters of `docs/adr/0013-history-import.md`. Expect about 210 items.

- [ ] **Step 3: Write `scripts/embed/reference.py`** (dev-only; run from a venv in the scratchpad, never from the repo directory):

```python
"""Reference ids and vectors for the TypeScript embedding engine. Dev-only, run once.
Usage: python -I scripts/embed/reference.py <sentences.json> <out.json>"""
import json, sys
from model2vec import StaticModel
from tokenizers import Tokenizer

REPO = "minishlab/potion-multilingual-128M"
REV = "73908c3438cf03b6a01bcb9611d62b23d0726f08"

sentences = json.load(open(sys.argv[1], encoding="utf-8"))
model = StaticModel.from_pretrained(REPO, revision=REV)
tok: Tokenizer = model.tokenizer
items = []
for text in sentences:
    normalized = tok.normalizer.normalize_str(text)
    ids = tok.encode(text, add_special_tokens=False).ids
    vector = model.encode([text])[0]
    items.append({"text": text, "normalized": normalized, "ids": ids,
                  "vector": [round(float(x), 6) for x in vector]})
json.dump({"model": REPO, "revision": REV, "items": items}, open(sys.argv[2], "w", encoding="utf-8"),
          ensure_ascii=False)
```

`scripts/embed/README.md`: what the two scripts are, that they are dev-only, the venv commands (`python3 -m venv <scratch>/venv && <scratch>/venv/bin/pip install model2vec==0.6.0 tokenizers`), that `model2vec` may download the model into the Hugging Face cache (in the scratchpad: set `HF_HOME=<scratch>/hf`).

- [ ] **Step 4: Generate** — `HF_HOME=<scratch>/hf <scratch>/venv/bin/python -I scripts/embed/reference.py tests/fixtures/embed/sentences.json tests/fixtures/embed/reference.json`. Check: every vector has 256 numbers; the empty and whitespace-only sentences have `ids: []` (record what their vector is — model2vec returns zeros; our engine returns `null` for them, Task 4).
- [ ] **Step 5: Commit** — "Embed: reference ids and vectors from the original model, and 40 more semantic cases".

### Task 2: The pack format (`wcmem-embed-v1`): writer, reader, the full and subset packs

**Files:**
- Create: `src/embed/pack.ts`, `scripts/embed/pack.ts`
- Create: `tests/unit/embed-pack.test.ts`, `tests/fixtures/embed/subset.wcpack` (generated), `tests/fixtures/embed/LICENSE-potion.txt`
- Modify: `THIRD-PARTY.md` (create if absent): one line for the model, MIT, with its URL.

**Interfaces — produces:**

```ts
export interface PackHeader {
  format: "wcmem-embed-v1";
  model: string; revision: string;
  dims: number;           // 256
  count: number;          // pieces in this pack
  vocabSize: number;      // pieces in the original vocabulary (500353)
  unkId: number;          // 1
  minScore: number;       // lowest Unigram score of the FULL vocabulary
  maxPieceChars: number;  // longest piece, in code points
  tableSize: number;      // hash slots, a power of two ≥ 2 × count
}
export interface Pack {
  header: PackHeader;
  charsmap: Uint8Array;                 // SentencePiece precompiled_charsmap bytes, as published
  /** Index of a piece (by its exact text, "▁" included), or -1. */
  find(piece: string): number;
  idOf(index: number): number;          // the original vocabulary id
  score(index: number): number;
  /** Adds row × scale × weight into `into` (length dims). */
  addRow(index: number, into: Float32Array, weight?: number): void;
  close(): void;
}
export type PackResult = { ok: true; pack: Pack } | { ok: false; reason: string };
export function openPack(path: string): PackResult;
export function writePack(path: string, input: {
  header: Omit<PackHeader, "format" | "count" | "tableSize">;
  charsmap: Uint8Array;
  pieces: { text: string; id: number; score: number; row: Float32Array }[];
}): void;
```

Layout (little-endian, every section 8-byte aligned): magic `WCMEMEMB` (8 bytes) · `u32` header JSON length · header JSON (UTF-8) · `u32` charsmap length · charsmap bytes · `u32[count + 1]` piece offsets into the strings blob · strings blob (UTF-8) · `u32[count]` original ids · `f32[count]` scores · `u32[tableSize]` hash slots (index + 1, 0 = empty; FNV-1a 32-bit over the piece's UTF-8 bytes, linear probing) · `f32[count]` row scales · `i8[count × dims]` rows. Quantisation per row: `scale = max(|x|) / 127` (`scale = 0` for a zero row), `q = round(x / scale)` clamped to ±127.

`openPack` uses `Bun.mmap(path)`, checks the magic, parses the header, checks `format`, `dims > 0`, and that the file length equals the length the header implies; any mismatch → `{ ok: false, reason }`. It never throws (a `try` around everything). Reading through `DataView`/typed-array views over the mapped bytes; no copy of the matrix.

`scripts/embed/pack.ts <tokenizer.json> <model.safetensors> <out.wcpack> [--subset <reference.json>]` reads the published files (safetensors: `u64` header length, JSON header naming the `embeddings` tensor `F32 [500353, 256]` and its byte range, then raw data) and writes the pack. With `--subset`, it keeps only pieces whose text is a substring of `"▁" + normalized.replaceAll(" ", "▁")` for some fixture item, plus `[UNK]`; `minScore` and `vocabSize` still describe the full vocabulary.

- [ ] **Step 1: Failing tests** (`tests/unit/embed-pack.test.ts`), on tiny packs written by `writePack` in a temp dir: round trip (find each piece, `idOf`, `score`, `addRow` reproduces the float row within `scale / 2` per component); `find` of a missing piece is -1; a zero row has scale 0 and adds nothing; a file cut by one byte, a wrong magic, a header with `format: "other"` and a directory path each return `{ ok: false }` with a reason, and none throws; 10,000 pieces with colliding prefixes all found.
- [ ] **Step 2:** Run, see them fail. **Step 3:** Implement `src/embed/pack.ts`. **Step 4:** Run, pass.
- [ ] **Step 5: Build the packs** (files in the scratchpad: download `tokenizer.json` and `model.safetensors` at the pinned revision with `curl -L https://huggingface.co/minishlab/potion-multilingual-128M/resolve/<rev>/<file>`): the full pack to `<scratch>/potion-multilingual-128M.wcpack` (expect ≈ 138 MB; record size and sha256), and the subset pack to `tests/fixtures/embed/subset.wcpack` (expect well under 1 MB; if over 2 MB, report it instead of committing).
- [ ] **Step 6:** `bun run check`; commit "Embed: our own pack format, opened with mmap; the subset pack for tests".

### Task 3: Normaliser and Unigram tokenizer

**Files:**
- Create: `src/embed/normalize.ts`, `src/embed/tokenize.ts`
- Create: `tests/unit/embed-tokenize.test.ts`

**Interfaces:**
- Consumes: `Pack` (Task 2).
- Produces: `export function normalize(text: string, charsmap: Uint8Array): string;` and `export function tokenize(pack: Pack, text: string, maxTokens?: number): number[]` (original vocabulary ids, `[UNK]` included, at most `maxTokens`, default 512).

Behaviour to reproduce (the published `tokenizer.json`):
1. **Precompiled charsmap** (SentencePiece): the blob is `u32` trie size in bytes, then the trie (darts-clone double array of `u32` units), then a blob of NUL-terminated replacement strings. Per grapheme (`Intl.Segmenter` with `granularity: "grapheme"`): if the grapheme's UTF-8 is shorter than 6 bytes and a common-prefix search over its bytes finds a match covering the whole grapheme, replace it; otherwise, for each code point, replace it when its bytes match fully, else keep it. Darts unit helpers: `hasLeaf(u) = (u >>> 8) & 1`, `value(u) = u & 0x7fffffff`, `label(u) = u & 0x800000ff`, `offset(u) = (u >>> 10) << ((u & 0x200) >>> 6)`. Search: `pos = offset(units[0])`; for each byte `b`: `pos ^= b`; `u = units[pos]`; if `label(u) !== b` stop; `pos ^= offset(u)`; if `hasLeaf(u)` record `(length so far, value(units[pos]))`. The longest full match wins; the replacement is the NUL-terminated string at that value's byte offset.
2. Then, in order: collapse ` {2,}` to one space; surround each of `` !"#$%&'()*+,-./:;<=>?@[\]^_`{|}~ `` with spaces; collapse `\s+` to one space; strip both ends.
3. **Metaspace:** replace every space with `▁` and prepend `▁` (prepend scheme "always", no split). An empty normalised string gives no tokens.
4. **Unigram Viterbi** over the code points of that string: `best[0] = 0`; for each start `i` reachable, for each length `1..maxPieceChars` with `pack.find(substring) ≥ 0`, relax `best[i + len]` with `best[i] + score`; when no piece starts at `i` covering one code point, a single-character unknown with score `minScore - 10` is allowed. Backtrack; consecutive unknowns fuse into one `[UNK]` (id `unkId`). Ties: keep the first path found (strictly greater replaces).

- [ ] **Step 1: Failing tests:** for every item of `reference.json`, `normalize(item.text, pack.charsmap) === item.normalized` and `tokenize(pack, item.text)` equals `item.ids` — using `tests/fixtures/embed/subset.wcpack`. Plus: a 50,000-character paste tokenizes in under 200 ms and returns at most 512 ids; a string of only emoji gives ids without throwing; the empty string gives `[]`.
- [ ] **Step 2:** Run, see them fail. **Step 3:** Implement. **Step 4:** Run, pass. If some items still differ, print a table of them (text, ours, theirs) in the task report; fix until all match. Do not loosen the test.
- [ ] **Step 5:** `bun run check`; commit "Embed: the model's normaliser and Unigram tokenizer, written from scratch, id for id with the reference".

### Task 4: Embed, and the int8 agreement

**Files:**
- Create: `src/embed/embed.ts`
- Create: `tests/unit/embed.test.ts`

**Interfaces:**
- Consumes: `openPack`, `tokenize`.
- Produces:

```ts
/** The text's unit vector, or null when it has no known token. Never throws. */
export function embed(pack: Pack, text: string): Float32Array | null;
export function cosine(a: Float32Array, b: Float32Array): number;
/** int8 storage for vectors kept in the database (part 2): one scale per vector. */
export function quantize(v: Float32Array): { scale: number; q: Int8Array };
export function dequantize(scale: number, q: Int8Array): Float32Array;
```

`embed` = ids from `tokenize` without `[UNK]`; none left → `null`; otherwise the mean of their rows (`addRow` with weight `1 / n`), then divided by its L2 norm (a zero norm → `null`).

- [ ] **Step 1: Failing tests:** for every fixture item with a non-zero reference vector, `cosine(embed(subset, text), reference) ≥ 0.99`; report the minimum and the five lowest in the task report. Items whose reference is all zeros (empty, whitespace) give `null`. `quantize` then `dequantize` keeps cosine ≥ 0.999 on every fixture vector. `embed` never throws on the Review Focus inputs (emoji only, CJK, 50 KB, punctuation only).
- [ ] **Step 2:** Run, fail. **Step 3:** Implement. **Step 4:** Run, pass.
- [ ] **Step 5:** `bun run check`; commit "Embed: text to vector, matching the original within int8 rounding".

### Task 5: The spike — latency in a real process, recall and noise on the golden sets; the gate

**Files:**
- Create: `scripts/embed/spike-probe.ts`, `scripts/embed/spike.ts`
- Create: `docs/adr/0014-semantic-recall.md` (sections "Spike" and "Decision")

**`scripts/embed/spike-probe.ts`** — compiled with `bun build --compile --outfile <scratch>/spike-probe scripts/embed/spike-probe.ts` (the same runtime as the product binary). Arguments: `<pack> <vectors.bin> <prompt>`, or `--noop` alone (exit 0 at once). It does what the prompt hook will do in part 2: `openPack`, `embed` the prompt, read `vectors.bin` (N × (4-byte scale + 256 int8)) with `Bun.file().arrayBuffer()`, cosine against each, keep the best 20, print one line `ms_open ms_embed ms_scan best_score`. Exit 0.

**`scripts/embed/spike.ts`** — run with the pinned Bun:
1. **Latency.** Writes `vectors.bin` with 5,000 random unit vectors (quantised) and runs the probe binary 61 times as fresh processes (first unmeasured) with a twenty-word prompt; reports p50/p95 of wall time per process, and the same for the probe run with `--noop` (it exits as soon as it starts: the process cost alone). Repeat with 65,000 vectors.
2. **Recall and noise.** Opens the full pack. For `retrieval.json`: embeds each memory as `title + "\n" + body`; for each relevant prompt, the cosine rank of each expected memory; for each unrelated prompt, its best cosine to any memory. Runs the existing lexical retrieval (`retrieveForPrompt`, set up exactly as `tests/golden/retrieval.test.ts` does) to know which relevant prompts lexical already finds. Then, for every threshold `t` from 0.30 to 0.90 in steps of 0.01: recall = lexical finds ∪ prompts whose expected memory is in the cosine top 5 with score ≥ t; false injections = unrelated prompts that lexical injects for ∪ unrelated prompts with any memory ≥ t. Reports the table, the best `t` (highest recall with 0 false; ties → the highest `t`), and the margin (lowest recovered score minus highest unrelated score). Does the same for `semantic.json` on its own (its paraphrases against the same 24 memories, its unrelated prompts), with the `t` chosen on the original set, not re-tuned.
3. Writes everything to `<scratch>/spike-report.md` and prints it.

- [ ] **Step 1:** Write both scripts; run on the author's machine with the full pack from Task 2 Step 5. No real database is needed: the golden sets are self-contained.
- [ ] **Step 2: ADR 0014** "Spike": machine, pack size and sha256, the latency table (5,000 and 65,000 vectors; open, embed, scan), the recall/noise table at the chosen `t`, the margin, the extended-set result at that `t`, int8 vs float agreement from Task 4. "Decision": go / no-go against the gate (recall@5 ≥ 22/24, false injections 0/23, prompt-path p95 ≤ 80 ms, estimated as the current prompt hook p95 from `tests/perf/budgets.test.ts` plus (probe p95 − `--noop` p95), at 65,000 vectors), and the chosen threshold.
- [ ] **Step 3:** `bun run check`; commit "Spike: semantic recall measured against the gate (ADR 0014)".
- [ ] **Step 4: Stop.** Report the numbers to the author in Portuguese with the go/no-go. Parts 2–4 are planned only after a go.

### Task 6: A relative rule, measured against the same gate (added after the no-go, by the author's decision)

The absolute threshold failed (ADR 0014): the best lexical miss scores 0.506, a generic unrelated prompt 0.519. Three of the five misses rank first with a wide lead over the second memory. This task measures one relative rule, fixed before looking at its numbers, against the unchanged gate, with the extended set as a held-out check.

**Files:**
- Modify: `scripts/embed/spike.ts` (a `--relative` mode, or a sibling function; no change to the absolute sweep's output)
- Modify: `docs/adr/0014-semantic-recall.md` (a section "A relative rule" and an updated "Decision")

**The rule.** For a prompt with vector `p`, let `s1 ≥ s2` be the two highest cosine scores over the project's memories (`s2 = 0` with one memory). Only the top memory can be added by the semantic channel, and only when `s1 ≥ f` **and** `s1 − s2 ≥ g`. A relevant prompt counts as found when lexical finds it, or when its expected memory is that top memory and the rule fires. An unrelated prompt counts as a false injection when lexical injects for it, or when the rule fires for it.

**Choosing `f` and `g`, on `retrieval.json` only:** sweep `f` from 0.30 to 0.60 and `g` from 0.05 to 0.30, both by 0.01. Keep the pairs with 0/23 false injections; among them, the highest recall; ties go to the largest `g`, then the largest `f` (the most conservative rule). Report the chosen pair, the recall, and the region of the grid that achieves it (how wide it is says how much luck is involved).

**Held-out check, `semantic.json`, at the chosen pair, not re-tuned:** recall x/20 and false injections x/20.

**Gate (unchanged, plus one held-out condition):** go when recall@5 on `retrieval.json` ≥ 22/24, false injections 0/23, prompt-path p95 ≤ 80 ms (already measured: 56.2 ms; the rule adds one subtraction), **and** 0/20 false injections on the held-out `semantic.json`. Otherwise no-go for the prompt channel; the on-demand search uses (part 2) go ahead either way.

- [ ] **Step 1:** Implement the relative mode in `scripts/embed/spike.ts` exactly as defined; run it with the full pack.
- [ ] **Step 2:** ADR 0014: section "A relative rule" (the rule, the grid result, the chosen pair, the width of the winning region, the held-out result, each relevant miss with `s1`, `s2`, gap and whether it fired, the five unrelated prompts with the largest gap) and the updated "Decision" for the prompt channel.
- [ ] **Step 3:** `bun run check`; commit "Spike: a relative rule against the same gate (ADR 0014)".
- [ ] **Step 4: Stop.** Report the numbers to the author in Portuguese with the go/no-go for the prompt channel.
