# History import, part 2: the raw history index — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** All of an agent's history (no time limit) is searchable on demand — `wizardingcode-mem history search`, the MCP tool `history_search` — from a separate, rebuildable `history.db`, kept current at each session's end, and deletable with `history forget`.

**Architecture:** `src/history/` owns `history.db` (its own SQLite file beside the main database: manifest + turns + FTS5, redacted text only). An index pass streams transcripts through part 1's readers, skipping files whose size and mtime are unchanged and dropping entries of files that disappeared. Search is FTS5 bm25 over prompt and answer, filtered by project. Nothing is injected automatically.

**Tech Stack:** TypeScript on the pinned Bun, `bun:sqlite` (FTS5, `unicode61 remove_diacritics 2`), `bun:test`, Biome.

**Spec:** `docs/superpowers/specs/2026-10-11-history-import-design.md` (sections "Indexing the raw history", "History search", "Errors and guarantees"). Part 1 (branch `design/history-import`, ADR 0013) is the base: readers `readClaudeCodeHistory` / `readCodexHistory`, listers, roots, `isFromTheHost`, `resolveProject`.

## Global Constraints

- Written from scratch; never copy from claude-mem (`CLEAN-ROOM.md`).
- TDD: every test is written and seen failing before the code.
- Imports carry an explicit `.ts` extension; repository text in English.
- Tests: `./node_modules/.bin/bun test <files>`; `bun run format && bun run check` green before each commit.
- Redact first, then clip: prompts 8 KiB, answers 16 KiB (`stored`, `PROMPT_MAX_CHARS`, `FINAL_TEXT_MAX_CHARS` from `src/hooks/handle.ts`).
- `history.db` lives in the store directory (`resolvePaths().storeDir`), mode 0600; it is never part of backups; deleting it loses nothing that cannot be rebuilt.
- Hooks never exit 2 and fail open; the session-end hook only spawns a detached process, and only when `history.db` already exists (the user opted in by importing).
- `WIZARDINGCODE_MEM_DISTILL=off` also turns off the background index spawn (it is the "no background work" switch tests use).
- Raw history is never injected into a prompt or session start.

## Review Focus

1. A transcript that grew since the last pass (a live session) — its entries are replaced, not duplicated.
2. A transcript deleted by the user — its entries leave the index on the next pass.
3. A secret in an old prompt — never stored in `history.db`.
4. `history_search` when `history.db` does not exist — a plain answer telling how to create it, not an error.
5. Two index passes at once (a session-end spawn during `history import`) — no corruption, no duplicates (one write transaction per file; busy timeout).

Each is pinned by a test in the owning task (Tasks 1, 1, 1, 3, 1).

---

### Task 1: `history.db` and the index pass

**Files:**
- Create: `src/history/db.ts`, `src/history/index-pass.ts`
- Test: `tests/integration/history-index.test.ts`

**Interfaces:**
- Produces:

```ts
// src/history/db.ts
export const HISTORY_DB_FILE = "history.db";
export function historyDbPath(storeDir: string): string;
/** Opens (creating when asked) the history index. Null when it does not exist and create is false. */
export function openHistoryDb(storeDir: string, options: { create: boolean; busyTimeoutMs?: number }): Database | null;

// src/history/index-pass.ts
export interface IndexReport { files: number; indexed: number; unchanged: number; removed: number; turns: number }
export function indexTranscript(hdb: Database, main: Db, agent: "claude-code" | "codex", path: string, options: { now: number; projects: Map<string, ProjectRef> }): number; // turns stored
export function indexAll(hdb: Database, main: Db, roots: { claudeCode: string; codex: string }, options: { now: number; maxMs: number; agents: ("claude-code" | "codex")[] }): IndexReport;
```

Schema (in `openHistoryDb`, `CREATE TABLE IF NOT EXISTS`, `PRAGMA user_version = 1`, WAL):

```sql
CREATE TABLE IF NOT EXISTS files (
  path TEXT PRIMARY KEY, agent TEXT NOT NULL, size INTEGER NOT NULL, mtime INTEGER NOT NULL, indexed_at INTEGER NOT NULL
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS turns (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL REFERENCES files(path) ON DELETE CASCADE,
  agent TEXT NOT NULL, session_id TEXT NOT NULL, turn_id TEXT NOT NULL,
  project_id INTEGER, project_name TEXT NOT NULL, cwd TEXT NOT NULL,
  started_at INTEGER NOT NULL, ended_at INTEGER NOT NULL,
  prompt TEXT NOT NULL, final_text TEXT
);
CREATE INDEX IF NOT EXISTS turns_path ON turns(path);
CREATE INDEX IF NOT EXISTS turns_project_time ON turns(project_id, ended_at DESC);
CREATE VIRTUAL TABLE IF NOT EXISTS turns_fts USING fts5(
  prompt, final_text, content='turns', content_rowid='id', tokenize = "unicode61 remove_diacritics 2"
);
-- triggers keeping turns_fts in step with turns on insert and delete (same pattern as memories_fts)
```

`project_id` is the main database's project id (resolved once per cwd through the shared `projects` map, `resolveProject`); `project_name` its name, kept so the index reads alone. A disabled project's turns are not stored.

- [ ] **Step 1: Write the failing tests** (`tests/integration/history-index.test.ts`)

Build transcripts with the same line helpers as `tests/unit/claude-code-history.test.ts` (copy the small helpers into this file). Cases:

```ts
test("a pass stores every turn of every transcript, redacted, and finds them by words")
// two Claude Code transcripts in <tmp>/claude/projects/-shop/, one with a key `sk-ant-api03-` + 90×"a" in a prompt
// indexAll → report { files: 2, indexed: 2, unchanged: 0, removed: 0, turns: N }
// SELECT prompt FROM turns → none contains the key
// SELECT rowid FROM turns_fts WHERE turns_fts MATCH '"pragma"' → the turn that said it

test("an unchanged transcript is skipped; one that grew is re-indexed without duplicates")
// pass 1; pass 2 → unchanged: 2; append a turn to one file (and bump its mtime) → pass 3: indexed 1, unchanged 1, total turns = before + 1

test("a transcript that disappeared leaves the index")
// pass 1; rm one file; pass 2 → removed: 1; no turns with that path

test("host notifications and turns of disabled projects are not stored")

test("two passes at once leave one copy of each turn")
// run indexAll twice concurrently in two Bun workers or two child processes against the same files
// (follow tests/helpers/open-db-worker.ts for the worker pattern) → turns count equals a single pass

test("history.db is created with owner-only permissions")  // skipIf win32, like db.test.ts
```

- [ ] **Step 2: Run them and see them fail** — `./node_modules/.bin/bun test tests/integration/history-index.test.ts` → module not found.

- [ ] **Step 3: Implement `src/history/db.ts`** — `new Database(path, { create })` after an `existsSync` check when `create` is false; `busy_timeout` (default 5000), `journal_mode = WAL`, `foreign_keys = ON`, the schema above, and `chmod 0600` on the file (reuse the `restrict` approach in `src/store/db.ts`; export it from there if it is private).

- [ ] **Step 4: Implement `src/history/index-pass.ts`**

```ts
// One write transaction per transcript: its old rows go and its new rows come in together,
// so a concurrent pass sees either the old file or the new one, never half of each.
export function indexTranscript(hdb, main, agent, path, options): number {
  const stat = statSync(path);
  const turns = (agent === "claude-code" ? readClaudeCodeHistory(path) : readCodexHistory(path))
    .filter((turn) => !isFromTheHost(turn.prompt));
  // resolve projects outside the transaction (resolveProject writes to the main db)
  const rows = turns.flatMap((turn) => { /* project via options.projects cache + resolveProject; skip disabled;
    prompt: stored(turn.prompt, PROMPT_MAX_CHARS); final: turn.finalText === null ? null : stored(turn.finalText, FINAL_TEXT_MAX_CHARS) */ });
  hdb.transaction(() => {
    hdb.run("DELETE FROM files WHERE path = ?", [path]); // cascades to turns, triggers clean turns_fts
    hdb.run("INSERT INTO files (path, agent, size, mtime, indexed_at) VALUES (?, ?, ?, ?, ?)", [path, agent, stat.size, Math.trunc(stat.mtimeMs), options.now]);
    for (const row of rows) hdb.run("INSERT INTO turns (...) VALUES (...)", [...]);
  }).immediate();
  return rows.length;
}
```

`indexAll`: for each agent, list ALL transcripts (`list…Transcripts(root, 0)`); for each, compare `files.size`/`files.mtime` with `statSync` → `unchanged++` or `indexTranscript` (`indexed++`); stop starting new files once `maxMs` is spent (the report's counts say how far it got; the next run continues). Then remove manifest rows of this agent whose path no longer exists (`removed`), in one transaction. Write the whole loop body in a try/catch per file: a file that fails is logged with `logError("history-index", error)` and skipped.

- [ ] **Step 5: Run the tests** — PASS.

- [ ] **Step 6: Commit** — `git commit -m "History: a separate, rebuildable index of every past turn, redacted"`

### Task 2: `history index`, `history search`, `history forget`; `history import` also indexes

**Files:**
- Create: `src/history/search.ts`
- Modify: `src/cli/commands/history.ts`
- Test: `tests/integration/history-cli.test.ts`, `tests/integration/history-search.test.ts`

**Interfaces:**
- Consumes: `openHistoryDb`, `indexAll` (Task 1); `explicitMatch` (`src/retrieve/query.ts`).
- Produces:

```ts
export interface HistoryHit { project: string; agent: string; sessionId: string; endedAt: number; prompt: string; answer: string | null }
/** Best matches first. `projectId` limits to one project. */
export function searchHistory(hdb: Database, args: { query: string; projectId?: number; projectName?: string; limit?: number }): HistoryHit[];
/** Hits as plain text for a person or a model: one block per turn, newest dates shown, text clipped to 600 chars per side. */
export function renderHits(hits: HistoryHit[]): string;
```

CLI:
- `wizardingcode-mem history index [--agent claude-code|codex] [--max-seconds n]` — creates `history.db` if missing, runs `indexAll`, prints `history index: F files, I indexed, U unchanged, R removed, T turns`.
- `wizardingcode-mem history search <words…> [--project <name>] [--limit n]` — needs `history.db`; prints `renderHits`. Without it: `history search: no history index yet — run wizardingcode-mem history import` and exit 0.
- `wizardingcode-mem history forget` — deletes `history.db` (and `-wal`, `-shm`) and prints `history forget: index deleted`. Memories and the main database are untouched.
- `history import` runs the backfill (part 1) and then an index pass with the remaining time budget, and prints both summary lines.

- [ ] **Step 1: Write the failing tests**

`tests/integration/history-search.test.ts` (direct, no CLI): search by a word in the answer; `projectId` filter excludes another project; accents folded (`pragmá` finds `pragma`); limit honoured (default 10, max 25); `renderHits` output contains the project name, the date (`YYYY-MM-DD`), the prompt and the answer, and clips long text with `…`.

`tests/integration/history-cli.test.ts` additions (use the file's existing env and transcript fixtures): `history index` then `history search <word>` prints the turn; `history search` before any index prints the "no history index yet" line with exit 0; `history forget` removes the file (assert it no longer exists) and leaves `wizardingcode-mem.db` and its memories untouched; `history import` prints both the backfill line and the index line.

- [ ] **Step 2: See them fail.**

- [ ] **Step 3: Implement `searchHistory`** — `explicitMatch(query)`; null → `[]`. SQL:

```sql
SELECT t.project_name AS project, t.agent, t.session_id AS sessionId, t.ended_at AS endedAt,
       t.prompt, t.final_text AS answer
  FROM turns_fts JOIN turns t ON t.id = turns_fts.rowid
 WHERE turns_fts MATCH ? AND (? IS NULL OR t.project_id = ?) AND (? IS NULL OR t.project_name = ?)
 ORDER BY bm25(turns_fts), t.ended_at DESC
 LIMIT ?
```

and `renderHits` as specified. Then the CLI subcommands in `src/cli/commands/history.ts` (extend `USAGE`, keep the existing usage-error behaviour).

- [ ] **Step 4: Run the tests and the check; commit** — `git commit -m "history index, search and forget; import also indexes"`

### Task 3: the `history_search` MCP tool

**Files:**
- Modify: `src/mcp/run.ts` (names, schema, descriptions, meta, both runners), `src/mcp/server.ts` only if it enumerates names, `src/cli/commands/tool.ts` if it lists them, `GLOBAL_INSTRUCTIONS`
- Test: `tests/integration/tool-cli.test.ts`, `tests/integration/mcp-global.test.ts`, `tests/integration/mcp.test.ts`

**Interfaces:**
- Consumes: `openHistoryDb`, `searchHistory`, `renderHits` (Tasks 1–2).
- Produces: tool `history_search` with args `{ query: string (1..500), limit?: 1..25 }` in a project, plus `project?: string` in the global scope. Read-only annotations (`readOnlyHint: true`, `idempotentHint: true`), title "Search past conversations".

Descriptions:
- project: `"Search what was said in this project's past agent sessions, word for word, including before wizardingcode-mem was installed. Use it when memory_search finds nothing and the user refers to an earlier conversation."`
- global: same, "in any of the user's projects; each result names its project".

Behaviour: opens `history.db` read-only (`create: false`); absent → returns `"No past conversations are indexed yet. The user can run: wizardingcode-mem history import"`. In a project, filter by the resolved project id; globally, by `project` name when given. Never writes.

- [ ] **Step 1: Failing tests** — tool listing includes `history_search` (project and global); calling it with an index returns the hit; without `history.db` returns the plain sentence; global with `project` filters. Follow the existing tests' patterns for `memory_search`.
- [ ] **Step 2: See them fail.**
- [ ] **Step 3: Implement** — add `"history_search"` to `TOOL_NAMES` (and so to `GLOBAL_TOOL_NAMES`), its schema in `toolSchemas`, its description in both description maps, its `TOOL_META`, and a case in `runTool` and `runGlobalTool`. Add one sentence to `GLOBAL_INSTRUCTIONS`: `"For something said in an earlier conversation that no note covers, history_search searches the past sessions themselves."` Then run `bun run plugins` if the plugin skill or manifests list tool names (check `scripts/plugins.ts` and `skills/`), and include its output in the commit.
- [ ] **Step 4: Run tests and the check; commit** — `git commit -m "MCP: history_search, past conversations on demand"`

### Task 4: index each session as it ends

**Files:**
- Modify: `src/hooks/handle.ts` (`HookDeps.spawnHistoryIndex?: (transcriptPath: string, agent: string) => void`; call it on `session-end` when the input has a transcript path and the agent is `claude-code` or `codex`), `src/cli/commands/hook.ts` (implement it: when `WIZARDINGCODE_MEM_DISTILL !== "off"` and `existsSync(historyDbPath(storeDir))`, `spawnDetached("history", "index", "--transcript", path, "--agent", agent)`), `src/cli/commands/history.ts` (`history index --transcript <path> --agent <a>` indexes that one file only)
- Test: `tests/integration/hooks.test.ts`, `tests/integration/history-cli.test.ts`

- [ ] **Step 1: Failing tests** — `handleHook` on `session-end` with a transcript path calls `spawnHistoryIndex` once with that path and agent; not on other events; not when `transcriptPath` is null; a throwing `spawnHistoryIndex` is contained (hook output unchanged, `onError` called). CLI: `history index --transcript <file> --agent claude-code` indexes exactly that file (report `files: 1`).
- [ ] **Step 2: See them fail.**
- [ ] **Step 3: Implement** — inside the existing "starting background work must never cost the agent…" try/catch style; the hook path must not import `src/history/*` beyond `historyDbPath` (keep the import cheap: put `historyDbPath` and `HISTORY_DB_FILE` in a tiny module `src/history/path.ts` with no SQLite import, and have `db.ts` re-export them).
- [ ] **Step 4: Measure** — run the existing hook latency test/budget (`tests/integration/hook-cli.test.ts` or the e2e harness) and confirm session-end stays within its budget; record the p95 in the report.
- [ ] **Step 5: Run tests and the check; commit** — `git commit -m "Session end: index the finished session when the history index exists"`

### Task 5: ADR and real-data measurement

**Files:**
- Modify: `docs/adr/0013-history-import.md` (a "Part 2: the raw index" section), `CLAUDE.md` (extend the `history` command line with `index`, `search`, `forget`)

- [ ] **Step 1:** On a temp copy of the main database and a temp `history.db` (store dir pointed at a temp folder; transcripts read in place, read-only), run `history index --max-seconds 600` and record: files, turns, wall time, `history.db` size, and the latency of three `history search` queries (time each with `time`). Delete the temp folder.
- [ ] **Step 2:** Write the ADR section: why a separate file, what is stored (redacted prompt and answer only), what is skipped (host notifications, sidechains, isMeta, claude-mem observer sessions, disabled projects), how it stays current (session end, manifest by size and mtime), how it is removed (`history forget`), never injected, and the measured numbers.
- [ ] **Step 3:** `bun run format && bun run check`; commit — `git commit -m "docs: ADR 0013 part 2 (raw history index) and the history commands"`
