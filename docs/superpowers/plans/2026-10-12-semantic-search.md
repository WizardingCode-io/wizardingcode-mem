# Semantic recall, part 2: search by meaning, on demand — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When someone searches — `memory_search` (MCP), the viewer's search, `history_search` and the History view — results also come by meaning (Portuguese ↔ English paraphrases included), using the engine from part 1, after the user opts in to a one-time model download. Nothing is injected automatically by meaning (ADR 0014).

**Architecture:** The model pack lives in the data directory, downloaded once with a pinned sha256. A per-process loader opens it (and reopens it when the file is replaced). Memories get an int8 vector in `memory_vectors` (migration 6) when written and through a resumable backfill; `history.db` gets `turn_vectors` from the index pass. Each search adds a semantic ranking, above a calibrated floor, to its existing results by reciprocal rank fusion. Without the model, everything behaves exactly as today.

**Tech Stack:** TypeScript on the pinned Bun; `src/embed/` (part 1: `openPack`, `embed`, `cosine`, `quantize`/`dequantize`); `bun:sqlite`; the viewer (Vue 3 + Tailwind 4 + Nuxt UI).

**Spec:** `docs/superpowers/specs/2026-10-11-semantic-recall-design.md` (components 1, 4, 7, 8; status line: prompt channel no-go, on-demand search only) and ADR 0014.

## Global Constraints

- Written from scratch (`CLEAN-ROOM.md`). No resident process, no generative model.
- **No automatic injection by meaning.** `retrieveForPrompt`, `sessionBrief`, `notesForFile` and `notesForFailure` stay lexical; the golden retrieval test stays 19/24 recall, 0/23 false injections.
- The download is the only network access, only after the user opts in: a fixed URL in the code, sha256 and byte size pinned in the code, written to a temporary file and renamed. No text of the user's leaves the machine for this feature.
- Fail open: no model, a corrupt or wrong-version model, `WIZARDINGCODE_MEM_SEMANTIC=off`, or any embed error → today's lexical behaviour, logged once; hooks always exit 0.
- Pack files are never modified in place (ADR 0014 engine notes): replaced by temp + rename, removed by unlink; long-lived processes (viewer, MCP server) reopen when the file's device, inode, size or mtime changes.
- Hook budgets unchanged (prompt p95 ≤ 80 ms; session-start ≤ 150 ms): the hooks never load the model.
- Never write to the author's real data (`~/.wizardingcode`, agent dirs); tests use temp dirs; real-data measurements on a temporary copy (`sqlite3 -readonly … ".backup '<tmp>/…'"`), TypeSafe off.
- Viewer changes follow the WizardingCode Sales OS mockups and are compared side by side in light and dark (CLAUDE.md).
- TDD; English; explicit `.ts` imports; `bun run check` green at every commit.

## Review Focus

1. The model file replaced while the viewer or MCP server has it open (a re-download, "delete the model") — no crash; the next search uses the new file or falls back to lexical (Task 1).
2. A memory edited in the viewer, superseded, archived or deleted — its vector follows (rewritten, ignored when not active, removed with the row) (Task 3).
3. A search that matches nothing lexically but means something (a paraphrase) — returns the right memory; a gibberish query returns no semantic results (floor) (Task 4).
4. A download interrupted, a full disk, a wrong checksum, or a proxy returning HTML — no partial file left under the final name, a clear message, retry works (Task 2).
5. A backfill running while distillation writes new memories and while a backup or `move` starts — one run at a time, lease respected, resumable, no duplicate vectors (Task 3).

---

### Task 1: The model in the data directory, loaded once per process

**Files:** Create `src/embed/model.ts`, `tests/unit/embed-model.test.ts`; modify `src/settings/settings.ts` (key `WIZARDINGCODE_MEM_SEMANTIC`, `on` by default), `src/embed/pack.ts` (carried minors below).

**Interfaces — produces:**

```ts
export const MODEL_FILE = "potion-multilingual-128M.wcpack";
export function modelPath(dataDir: string): string;            // <dataDir>/models/<MODEL_FILE>
export interface Model { pack: Pack; embed(text: string): Float32Array | null; id: string /* "potion-multilingual-128M@<sha256-prefix>" */ }
/** The model when present, valid and switched on; null otherwise. Cached per process; reopened when the file changes. */
export function loadModel(options: { dataDir: string; env?: Record<string, string | undefined> }): Model | null;
export function modelState(dataDir: string): { present: boolean; bytes: number; enabled: boolean; reason: string | null };
```

`loadModel` stats the file on each call (cheap) and reopens when `dev`, `ino`, `size` or `mtimeMs` differ from the cached open; returns null when `WIZARDINGCODE_MEM_SEMANTIC` is `off`, the file is absent, or `openPack` refuses (reason kept for `modelState`/doctor). Carried minors from part 1's final review: in `openPack`, check `header === null || typeof header !== "object"` before reading `header.format`; give `writePack`'s temp file a unique name (`${path}.${pid}.${random}.tmp`) and remove it if `rename` fails; make `embed.ts`'s "logged once" flag resettable for tests (an exported test hook) instead of module-level only; strengthen the private-mapping test to write through a byte of the mapping and assert the file on disk is unchanged.

- [ ] **Step 1: Failing tests:** absent file → null and `present:false`; `off` → null; a valid subset pack (`tests/fixtures/embed/subset.wcpack`, copied to a temp data dir) → a model whose `embed` matches `embed(pack, …)`; the file replaced by rename with a different pack → the next `loadModel` returns a model answering from the new file, and the old one still works; a truncated file → null with a reason; the carried minors' tests.
- [ ] **Step 2:** Fail. **Step 3:** Implement. **Step 4:** Pass; `bun run check`. **Step 5:** Commit "Embed: the model in the data directory, loaded once and reopened when replaced".

### Task 2: Download, opt-in

**Files:** Create `src/embed/download.ts`, `src/cli/commands/embed.ts` (`embed download | status | delete`), tests `tests/integration/embed-download.test.ts`; modify the CLI command table and usage.

**Interfaces — produces:**

```ts
export const MODEL_URL = "https://github.com/WizardingCode-io/wizardingcode-mem/releases/download/model-potion-multilingual-128M-v1/potion-multilingual-128M.wcpack";
export const MODEL_SHA256: string; // pinned in Task 7 from the published asset
export const MODEL_BYTES: number;  // pinned in Task 7
export async function downloadModel(options: { dataDir: string; url?: string; sha256?: string; bytes?: number; fetch?: typeof fetch; onProgress?: (done: number, total: number) => void }): Promise<{ ok: true } | { ok: false; reason: string }>;
export function deleteModel(dataDir: string): void; // unlink the pack; drop memory_vectors rows and history turn_vectors rows (Tasks 3, 5 add those tables; until then a no-op beyond unlink)
```

Download streams to `<models>/.<name>.<pid>.part`, checks `Content-Length`/byte count and sha256 while streaming, refuses a `text/html` response or a size mismatch, then renames over the final name; any failure removes the part file. Progress goes to meta (`embed.download.done`, `embed.download.total`) so the viewer can poll it. `MODEL_SHA256`/`MODEL_BYTES` are placeholders only in the sense that Task 7 fills the published values; until then tests inject `sha256`/`bytes`/`url`, and the constants hold the values of the pack built in part 1 (`7d8362253e568e7bb24ff8be3f006f412973aa445a96c4c17b6f13a957825c6a`, `146383528`), to be confirmed in Task 7.

- [ ] **Step 1: Failing tests** against a local `Bun.serve` in the test: success writes the final file with the right hash; a wrong hash, a short body, an HTML body, a server error and an aborted stream each leave no final file and no part file and return a reason; a second download over an existing valid file is a no-op ("already present"); `embed status` prints present/bytes/enabled; `embed delete` removes it.
- [ ] **Step 2:** Fail. **Step 3:** Implement. **Step 4:** Pass; check. **Step 5:** Commit "Embed: an opt-in download, checked as it streams".

### Task 3: Vectors for memories

**Files:** Create `src/store/migrations/0006_vectors.sql`, `src/embed/vectors.ts`, `src/embed/backfill.ts`; modify `src/store/db.ts` (migration 6), `src/store/memories.ts` and every place a memory's title/body is written (`insertMemory`, the viewer's `updateMemory` in `src/ui/api.ts`, supersede/merge paths in `src/distill/`), `src/store/meta.ts` (`embed.lease` in `anyLeaseActive`), `src/cli/commands/embed.ts` (`embed backfill [--limit n]`), `src/store/compact.ts` if it deletes memories; tests.

**Schema:** `memory_vectors(memory_id INTEGER PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE, model TEXT NOT NULL, scale REAL NOT NULL, vec BLOB NOT NULL)`.

**Interfaces — produces:**

```ts
export function writeMemoryVector(db: Db, model: Model | null, memoryId: number, title: string, body: string): void; // no-op without a model; replaces the row
export function memoryVectors(db: Db, model: Model, filter: { projectId: number | null; kinds?: readonly string[] }): { id: number; vec: Float32Array }[]; // active memories only, this model only
export function runEmbedBackfill(db: Db, model: Model, options: { limit?: number; now: () => number }): Promise<{ written: number; remaining: number } | null>; // null when another run holds the lease
```

The text embedded is the memory's redacted `title + "\n" + body` (as part 1's spike). Writes happen in the memory's own transaction where one exists. Ruling for this plan: vectors live in the main database and therefore travel in backups (256 bytes + overhead per memory); the spec's "backups do not carry vectors" is dropped because a restore would otherwise leave every memory without a vector until a backfill — record this in ADR 0017. A vector whose `model` differs from the loaded model's `id` is ignored and rewritten by the backfill.

- [ ] **Step 1: Failing tests:** migration 6 on a v5 database; insert with a model writes a vector, without a model writes none; viewer edit rewrites it; delete cascades; archived/superseded memories are excluded by `memoryVectors`; backfill fills only missing or other-model rows, resumes after a limit, respects `embed.lease` and returns null while held; `anyLeaseActive` sees `embed.lease` (so move/restore/compact refuse during a backfill); `deleteModel` drops the rows.
- [ ] **Step 2:** Fail. **Step 3:** Implement. **Step 4:** Pass; check (backup tests use `LATEST_VERSION`). **Step 5:** Commit "Memories: a vector each when the model is present, and a resumable backfill".

### Task 4: Search memories by meaning (MCP and viewer)

**Files:** Create `src/retrieve/semantic.ts`, `tests/golden/search.test.ts`; modify `src/mcp/tools.ts` (`searchMemories`), `src/mcp/global.ts` (`globalSearch` if separate), `src/ui/api.ts` (`searchAll` and the memory list's text search, if it has one), the MCP server/viewer wiring that passes a `Model | null` in.

**Interfaces — produces:**

```ts
/** The best memories by meaning above the floor, best first. Empty without a model or for a query with no known token. */
export function semanticCandidates(db: Db, model: Model | null, query: string, filter: { projectId: number | null; kind?: string | null; limit: number }): { id: number; score: number }[];
export const SEMANTIC_FLOOR: number; // calibrated in Step 1
```

Each search fuses its existing lexical ranking with the semantic ranking by RRF (k = 60, as today), including memories found only by meaning. **Calibrate `SEMANTIC_FLOOR` first (Step 1)** on `tests/golden/retrieval.json` + `tests/golden/semantic.json` with the full pack (`<scratchpad>/potion-multilingual-128M.wcpack` from part 1): for each paraphrase, the expected memory's rank in the fused `memory_search` results; for each unrelated query, how many semantic-only results appear. Choose the floor that maximises paraphrases found in the top 5 while semantic-only results for unrelated queries stay ≤ 1 per query on average; write the table into ADR 0017. The golden test uses the subset pack where possible; when a case needs the full pack, skip it unless `WIZARDINGCODE_MEM_EMBED_PACK` points to it (and run it locally in this task).

- [ ] **Step 1:** Calibration script `scripts/embed/search-floor.ts`; run; record. **Step 2: Failing tests:** without a model, outputs are byte-identical to today's (snapshot of `searchMemories`/`searchAll` on the golden set); with the model, the Portuguese paraphrases of English memories from `semantic.json` reach the top 5 at the calibrated rate; a gibberish query returns nothing semantic; `kind` and project filters apply to semantic candidates; archived memories never appear. **Step 3:** Fail. **Step 4:** Implement. **Step 5:** Pass; check; commit "Search: memories by meaning as well as by words, when asked".

### Task 5: Search past conversations by meaning

**Files:** Modify `src/history/db.ts` (table `turn_vectors(turn_id INTEGER PRIMARY KEY REFERENCES turns(id) ON DELETE CASCADE, model TEXT, scale REAL, vec BLOB)`, created with the rest of history.db's schema — history.db is rebuildable, so no migration path is needed beyond `CREATE TABLE IF NOT EXISTS`), `src/history/index-pass.ts` (embed `prompt + "\n" + final_text`, redacted as stored, when a model is present; vectors for already-indexed turns filled by the same pass when missing), `src/history/search.ts` (`searchHistory` fuses a semantic ranking with the same floor), the MCP `history_search` and the viewer's `/api/history/search` (pass the model); tests.

- [ ] **Step 1: Failing tests:** an index pass with the model writes vectors; without, none (and search is identical to today); a paraphrase query finds the turn; project filter applies; `history forget` removes vectors with the file; a transcript removed from disk takes its vectors with its turns.
- [ ] **Step 2:** Fail. **Step 3:** Implement. **Step 4:** Pass; check. **Step 5:** Commit "History: past conversations found by meaning too".

### Task 6: Turning it on — install, Settings card, doctor

**Files:** Modify `src/cli/commands/install.ts` (offer once, like the history offer: TTY asks "Download the 140 MB search model so searches also find notes by meaning? Nothing you write is sent anywhere."; no TTY → one hint line; flags `--semantic` / `--no-semantic`), `src/ui/server.ts` (`GET /api/semantic` state + download progress, `POST /api/semantic/download` spawns `embed download` then `embed backfill` detached, `POST /api/semantic/off|on`, `POST /api/semantic/delete`), `ui/src/components/settings/Semantic.vue` (new card in the Memory group), `src/doctor/` (model state line), tests (`tests/integration/ui*.test.ts`, install tests).

The card: state (not downloaded / downloading x% / ready, size), backfill progress (memories with vectors / total), buttons Download (or Turn off / Turn on), Delete model (confirm). Built from the rendered Sales OS mockups (settings card pattern of the existing History card), screenshots light and dark compared side by side, paths listed in the report.

- [ ] **Step 1: Failing tests** for the routes (auth like the others; download refused while running; delete refused while a backfill runs), the install offer branches, and doctor's line. **Step 2:** Fail. **Step 3:** Implement + UI. **Step 4:** Pass; check; screenshots. **Step 5:** Commit "Semantic search: offered at install, a Settings card, and doctor".

### Task 7: Publish the model, prove it, ADR 0017 — and stop

**Files:** Create `docs/adr/0017-semantic-search.md`, `scripts/proof/semantic.sh`; modify `src/embed/download.ts` (final `MODEL_SHA256`/`MODEL_BYTES`), README, CLAUDE.md, the spec status line.

- [ ] **Step 1: Rebuild the pack** reproducibly with `scripts/embed/pack.ts` from the pinned model revision (scratchpad), record its sha256 and size, and put `LICENSE-potion.txt` beside it.
- [ ] **Step 2: Stop and ask the author** before publishing: creating the GitHub release `model-potion-multilingual-128M-v1` with the pack and licence as assets is an outward, public action. With a yes, publish (`gh release create … --notes …`), then pin `MODEL_SHA256`/`MODEL_BYTES` to the published file and verify `embed download` against the real URL into a temp data dir.
- [ ] **Step 3: Proof on real data:** `scripts/proof/semantic.sh` on a temporary copy of the author's database (read-only `.backup`, TypeSafe off, temp data dir with the model): backfill time and size; `memory_search` latency p95 with and without the model; ten real Portuguese queries chosen from the author's recent prompts in the copy (anonymised in any committed output) with the top 5 before and after, judged by eye in the task report (not committed); history search the same.
- [ ] **Step 4:** ADR 0017 (floor table, the backups ruling, latency, the proof's anonymised numbers, what is not done); README section "Search by meaning (optional)"; CLAUDE.md commands; spec status; `bun run check`; commit "Semantic search: published model, proof, ADR 0017".
