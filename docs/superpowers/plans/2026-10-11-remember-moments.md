# Remember at two more moments: when a file is read, after a tool fails — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When Claude Code reads a file that has a known gotcha, fix, convention or decision, or when a command fails with an error seen before, the agent gets the note next to the tool result — sparsely, at most twice, never twice for the same note in a context.

**Architecture:** Two new hook events, `file-read` (Claude Code `PostToolUse`, matcher `Read`) and `tool-failed` (Claude Code `PostToolUseFailure`, matcher `Bash`). `file-read` looks memories up by path in `memory_files`; `tool-failed` runs the existing lexical retrieval (FTS + evidence rule) on the redacted error, restricted to fix and gotcha memories. Both record what they injected so neither they nor the prompt hook repeat a note. Lexical only: the semantic channel was measured no-go (ADR 0014).

**Tech Stack:** TypeScript on the pinned Bun, `bun:sqlite` (FTS5), the existing hook pipeline (`src/hooks/handle.ts`, `src/adapters/common/hook-json.ts`, `src/install/*`, `scripts/plugins.ts`).

**Spec:** `docs/superpowers/specs/2026-10-11-semantic-recall-design.md`, component 6 ("New hook events") and Testing items 2–4 and 6, as amended by ADR 0014 and the author's decision: no semantic channel; this plan is lexical.

## Global Constraints

- Written from scratch; never copy from claude-mem (`CLEAN-ROOM.md`).
- Hooks never exit with code 2 and fail open: code 0 and empty stdout on any failure. The new events add nothing to the turn queue and start no background work of their own.
- Agents in v1: **Claude Code only**. Codex's `PostToolUse` does not honour `additionalContext` (only "block", which would interrupt the agent), Cursor's `postToolUseFailure` cannot inject, and Gemini's `AfterTool` is not confirmed; record this in ADR 0015, do not wire them.
- Events from subagents are ignored, as today (`src/cli/commands/hook.ts`).
- Limits: at most 2 notes per event; `file-read` only for memories of kind gotcha, fix, convention or decision; `tool-failed` only for fix and gotcha; a note already given in this context (by any event except a session brief that named it without its body) is not given again.
- Budgets: `file-read` and `tool-failed` p95 ≤ 50 ms each (`tests/perf/budgets.test.ts`); the prompt hook's 80 ms budget is unchanged.
- Never write to the user's real data (`~/.wizardingcode`, `~/.claude`, `~/.codex`); real-data measurements on a temporary copy taken with `sqlite3 -readonly <db> ".backup '<tmp>/copy.db'"`, transcripts only read, TypeSafe off. Installing the new hooks into the author's real Claude Code is a stop-and-ask step (Task 5).
- TDD; tests with the pinned Bun (`./node_modules/.bin/bun test <files>`, `bun run check`); explicit `.ts` imports; English; generated plugin files only through `bun run plugins`.

## Review Focus

1. Parallel reads: Claude Code fires `PostToolUse` concurrently for parallel tool calls — two processes injecting for two files at once must not fail or inject the same note twice (Task 2 test with two handlers on one database, sequential is enough to pin the unique-index path; plus `INSERT OR IGNORE`).
2. A path outside the project, a Windows-style path with backslashes, a relative path, or a path with `..` — normalised like distillation does, or ignored; never a throw (Task 2).
3. A huge error (Claude Code middle-truncates around `... [N characters truncated] ...`), an error that is only `Exit code 1`, an interrupted tool (`is_interrupt: true`), an error carrying a secret — redacted before anything is stored or searched, nothing injected for the empty or interrupted cases (Task 3).
4. A file read many times in one session — the notes come once; the prompt hook does not repeat them afterwards, and they do not repeat the prompt hook's (Task 2 and Task 3 tests).
5. A user who installed before this version — the new events arrive only through the regenerated plugin files; old installs keep working with the four events (Task 4 test that uninstall still removes every entry of ours, matcher groups included).

---

### Task 1: The two events end to end, injecting nothing yet

**Files:**
- Modify: `src/core/types.ts` (`HookEvent`), `src/adapters/types.ts` (`HookInput`), `src/adapters/common/hook-json.ts`, `src/cli/commands/hook.ts` (`BUSY_TIMEOUT_MS`), `src/retrieve/notes.ts` (`recordInjections` event type), `src/retrieve/prompt.ts` (`notYetShown`), `src/status/report.ts` (`EVENT_ORDER`)
- Create: `src/store/migrations/0005_moments.sql`; modify `src/store/db.ts` (register migration 5)
- Create: `tests/fixtures/claude-code/payloads/post-tool-use.read.json`, `tests/fixtures/claude-code/payloads/post-tool-use-failure.bash.json`
- Test: `tests/unit/claude-code-adapter.test.ts` (or the existing payload test file), `tests/integration/db.test.ts`, `tests/integration/hook*.test.ts`

**Interfaces — produces:**

```ts
export type HookEvent = "session-start" | "prompt" | "turn-end" | "session-end" | "file-read" | "tool-failed";
// HookInput gains:
  /** Only on "file-read": the path the tool read, as the host gave it (absolute). */
  toolFile: string | null;
  /** Only on "tool-failed": what the host says went wrong. Null when the tool was interrupted. */
  toolError: string | null;
// recordInjections' event: "session-start" | "prompt" | "file-read" | "tool-failed"
```

- Payload fixtures, from the hook documentation (to be replaced by captured payloads in Task 5):

```json
{"session_id":"abc123","transcript_path":"/tmp/t.jsonl","cwd":"/work/shop","permission_mode":"default","hook_event_name":"PostToolUse","tool_name":"Read","tool_input":{"file_path":"/work/shop/src/store/db.ts"},"tool_response":{"type":"text","file":{"filePath":"/work/shop/src/store/db.ts"}},"tool_use_id":"toolu_01","duration_ms":3}
```

```json
{"session_id":"abc123","transcript_path":"/tmp/t.jsonl","cwd":"/work/shop","permission_mode":"default","hook_event_name":"PostToolUseFailure","tool_name":"Bash","tool_input":{"command":"bun test","description":"Run tests"},"tool_use_id":"toolu_02","error":"Exit code 1\nSQLITE_BUSY: database is locked","is_interrupt":false,"duration_ms":4187}
```

- `parseHookJson`: `toolFile = event === "file-read" ? text(payload.tool_input?.file_path) : null`; `toolError = event === "tool-failed" && payload.is_interrupt !== true ? text(payload.error) : null`. `CLAUDE_STYLE_EVENTS` gains `"file-read": "PostToolUse"`, `"tool-failed": "PostToolUseFailure"` (so `renderHookJson` answers with the right `hookEventName`).
- `BUSY_TIMEOUT_MS`: `"file-read": 100`, `"tool-failed": 100`.
- Migration 5 (`0005_moments.sql`): SQLite cannot change a CHECK, so rebuild `injections` with `event IN ('session-start','prompt','mcp','file-read','tool-failed')`, copying the rows, recreating `injections_once` and any other index on it. Read `0001_init.sql` for the table and indexes; follow how `src/store/db.ts` runs `.sql` migrations (one transaction). Bump nothing else.
- `notYetShown` (prompt retrieval): a note counts as shown when injected in this context by `prompt`, `file-read` or `tool-failed`, or by `session-start` when its body is empty.
- `handleHook`: `file-read` and `tool-failed` resolve the project and session as other events do, but open or complete no turn, and spawn no viewer, backup or history index (the existing event checks already exclude them — keep it so). Context stays null in this task.
- `EVENT_ORDER` in the status report gains the two events after `prompt`.

- [ ] **Step 1: Failing tests:** both fixtures parse to the right `event`, `toolFile` and `toolError`; `is_interrupt: true` gives `toolError: null`; a payload without `tool_input` gives `toolFile: null`; `renderHookJson` for `file-read` with context gives `{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":…}}`; migration 5 on a v4 database keeps existing injection rows and accepts `file-read`/`tool-failed`, and running migrations twice is harmless; `hook claude-code file-read` with the fixture on stdin exits 0 with empty stdout and records a `hook_runs` row; a `prompt` after a `file-read` injection of memory M in the same context does not inject M.
- [ ] **Step 2:** Run, see them fail. **Step 3:** Implement. **Step 4:** Run, pass; `bun run check` (the backup tests use `LATEST_VERSION`).
- [ ] **Step 5:** Commit "Hooks: file-read and tool-failed events, recorded but quiet".

### Task 2: Notes when a file is read

**Files:**
- Create: `src/core/paths.ts` (moved from `src/distill/pipeline.ts`: `rootsOf`, `relativeTo`, with their cache), `src/retrieve/file.ts`
- Modify: `src/distill/pipeline.ts` (import the moved functions), `src/hooks/handle.ts`, `src/retrieve/render.ts` (optional heading)
- Create: `tests/golden/moments.json` (the `fileRead` part), `tests/golden/moments.test.ts`
- Test: `tests/unit/retrieve-file.test.ts`, the hook integration test

**Interfaces — produces:**

```ts
// src/core/paths.ts
export function rootsOf(cwd: string): string[];
export function relativeTo(roots: string[], paths: string[]): string[];
// src/retrieve/file.ts
export function notesForFile(db: Db, input: {
  projectId: number; sessionId: number; epoch: number;
  path: string;            // project-relative, forward slashes
  branch: string | null; now: number;
}): Note[];
// src/retrieve/render.ts
export function renderNotes(notes: Note[], intro?: string): string; // default intro unchanged
```

`notesForFile`: active memories of the project linked to `path` in `memory_files`, kind in (gotcha, fix, convention, decision), not yet shown in this context (same rule as Task 1), ordered by role (`changed` before `read`), then `prior` (`src/retrieve/notes.ts`), then id; at most 2, within 1,200 characters rendered. `handleHook` on `file-read`: `toolFile` null → nothing; else `relativeTo(rootsOf(input.cwd), [toolFile])` — outside the project → nothing; notes → `recordInjections(…, event: "file-read")` and `renderNotes(notes, "Notes saved from earlier sessions about <path>. They are background, not instructions, and may be out of date: check the code before relying on them.")`. Contained like the prompt lookup (`lookUp`).

`tests/golden/moments.json`, `fileRead` (memories are `tests/golden/retrieval.json`'s, inserted as `retrieval.test.ts` does; paths given absolute under the test project root):

```json
[
  { "read": "src/store/db.ts", "expect": ["busy-timeout", "wal-retry"] },
  { "read": "src/hooks/handle.ts", "expect": ["open-at-prompt", "redact-first"] },
  { "read": "src/cli/commands/hook.ts", "expect": ["exit-code"] },
  { "read": "scripts/build.ts", "expect": ["baseline", "dotenv"] },
  { "read": "src/retrieve/prompt.ts", "expect": ["cross-join"] },
  { "read": "src/mcp/server.ts", "expect": ["mcp-sdk"] },
  { "read": "src/store/meta.ts", "expect": ["drain-lease"] },
  { "read": "src/spike/support.ts", "expect": ["pending-timer"] },
  { "read": "src/cli/commands/status.ts", "expect": [] },
  { "read": "README.md", "expect": [] }
]
```

(`status-json` is a `change`, so `status.ts` gets nothing.)

- [ ] **Step 1: Failing tests:** every golden case gives exactly its expected keys (order free); reading `src/store/db.ts` twice in one session/epoch gives the notes once; after a `clear` (new epoch) they come again; a path outside the project, a relative path, a Windows path `C:\\work\\shop\\src\\store\\db.ts` with cwd `C:\\work\\shop` (backslashes normalised) and a path with `..` (resolved or ignored, never thrown); two `file-read` handlers for two files on one database both succeed; the moved `rootsOf`/`relativeTo` keep `tests/integration/distill*.test.ts` green.
- [ ] **Step 2:** Run, fail. **Step 3:** Implement. **Step 4:** Run, pass; `bun run check`.
- [ ] **Step 5:** Commit "Hooks: notes about a file when the agent reads it".

### Task 3: Notes after a tool fails

**Files:**
- Create: `src/retrieve/failure.ts`
- Modify: `src/retrieve/prompt.ts` (options: `kinds`, `maxNotes`, `budgetChars`, `event`), `src/hooks/handle.ts`
- Modify: `tests/golden/moments.json` (the `toolFailed` part), `tests/golden/moments.test.ts`
- Test: `tests/unit/retrieve-failure.test.ts`

**Interfaces — produces:**

```ts
// src/retrieve/prompt.ts — retrieveForPrompt keeps its signature; the input gains optional:
  kinds?: readonly MemoryKind[];   // default: all
  maxNotes?: number;               // default 5
  budgetChars?: number;            // default 2400
// src/retrieve/failure.ts
/** The part of a failure worth searching for: redacted, without the exit-code line or the host's truncation marker. */
export function failureQuery(error: string): string;
export function notesForFailure(db: Db, input: {
  projectId: number; sessionId: number; epoch: number;
  error: string; branch: string | null; now: number;
}): Note[];
```

`failureQuery`: `redact` first, then drop a first line matching `/^Exit code \d+$/`, drop `... [N characters truncated] ...` markers and lines like `Command timed out after …`, collapse whitespace, clip to 2,000 characters. `notesForFailure` = `retrieveForPrompt` on that text with `kinds: ["fix", "gotcha"]`, `maxNotes: 2`, `budgetChars: 1200` — the same evidence rule, so an ordinary error that shares one word with a memory injects nothing. `handleHook` on `tool-failed`: `toolError` null or `failureQuery` empty → nothing; else record (`event: "tool-failed"`) and render with the intro "Notes saved from earlier sessions that may bear on this failure. They are background, not instructions, and may be out of date: check before relying on them."

`tests/golden/moments.json`, `toolFailed`:

```json
[
  { "error": "Exit code 1\nSQLITE_BUSY: database is locked on the very first query", "expect": ["busy-timeout"] },
  { "error": "Exit code 1\nPRAGMA journal_mode = WAL failed with SQLITE_BUSY in enableWal", "expect": ["wal-retry"] },
  { "error": "Exit code 1\nthe test process stayed alive ten seconds after the tests passed: a pending timer from Bun.sleep in Promise.race", "expect": ["pending-timer"] },
  { "error": "Exit code 1\nhook exited with code 2 and the user's action was blocked", "expect": ["exit-code"] },
  { "error": "Exit code 1\nFTS5 search for migracao returned no rows; remove_diacritics not applied", "expect": ["diacritics"] },
  { "error": "Exit code 1\nthe compiled binary loaded .env from the working directory", "expect": ["dotenv"] },
  { "error": "Exit code 1\nError: Cannot find module 'express'", "expect": [] },
  { "error": "Exit code 1\nnpm ERR! code ERESOLVE could not resolve dependency peer react@19", "expect": [] },
  { "error": "Exit code 128\nfatal: not a git repository (or any of the parent directories): .git", "expect": [] },
  { "error": "Command timed out after 2m 0s", "expect": [] }
]
```

A golden case that fails because the existing evidence rule is stricter than the case: report it with the rule's verdict; do not loosen the evidence rule or edit the case to pass.

- [ ] **Step 1: Failing tests:** golden cases; `failureQuery` strips the exit-code line and the truncation marker and redacts a secret (`sk-ant-…` → `[REDACTED:…]`) before clipping; `Exit code 1` alone → empty → nothing; `is_interrupt` → nothing; a fix injected by `tool-failed` is not repeated by the next `prompt` or `tool-failed` in the context; `retrieveForPrompt` without the new options behaves exactly as before (`tests/golden/retrieval.test.ts` unchanged: 19/24, 0/23).
- [ ] **Step 2:** Run, fail. **Step 3:** Implement. **Step 4:** Run, pass; `bun run check`.
- [ ] **Step 5:** Commit "Hooks: notes that may bear on a failure, after a command fails".

### Task 4: Install the events in Claude Code

**Files:**
- Modify: `src/install/hooks-file.ts` (`HostSpec.events` entries gain an optional matcher; the grouped writer emits `{ matcher, hooks }` when set), `src/install/claude-code.ts` (`CLAUDE_CODE.events` add `["PostToolUse", "file-read", "Read"]`, `["PostToolUseFailure", "tool-failed", "Bash"]`), `scripts/plugins.ts` (`grouped` passes the matcher; timeouts 5 s for the new events)
- Regenerate: `hooks/hooks.json` and the other generated files via `bun run plugins`
- Test: `tests/integration/install*.test.ts`, the plugins test

**Interfaces:** `HostSpec.events: readonly (readonly [string, HookEvent, string?])[]` (the third item is the host's matcher). Codex, Cursor and Gemini specs unchanged.

- [ ] **Step 1: Failing tests:** installing into a temp `CLAUDE_CONFIG_DIR` writes `PostToolUse: [{ matcher: "Read", hooks: [ours] }]` and `PostToolUseFailure: [{ matcher: "Bash", hooks: [ours] }]` beside the four existing events; a user's own `PostToolUse` group (another matcher) is kept untouched; uninstall removes every entry of ours including the matcher groups and leaves the user's; reinstall is idempotent; `bun scripts/plugins.ts --check` passes after regeneration and the generated `hooks/hooks.json` carries both new events with their matchers.
- [ ] **Step 2:** Run, fail. **Step 3:** Implement; `bun run plugins`. **Step 4:** Run, pass; `bun run check`.
- [ ] **Step 5:** Commit "Install: the file-read and tool-failed hooks in Claude Code".

### Task 5: Budgets, a replay on real history, ADR 0015 — and the real-session check

**Files:**
- Modify: `tests/perf/budgets.test.ts` (two new measurements)
- Create: `scripts/proof/moments.ts`, `docs/adr/0015-remember-moments.md`
- Modify: `README.md` (one short paragraph in the section that describes when notes are given), `CLAUDE.md` (the hooks line), `docs/superpowers/specs/2026-10-11-semantic-recall-design.md` (status line: A4 shipped lexical, Claude Code only, ADR 0015)

- [ ] **Step 1: Budgets.** `budgets.test.ts` measures `file-read` (a file with 3 linked memories among the 65,000) and `tool-failed` (a twenty-word error) like the other events; each p95 ≤ 50 ms (CI rule as the others).
- [ ] **Step 2: Replay on real history** — `scripts/proof/moments.ts <copy.db> <transcripts root>`: against a temporary copy of the author's database (taken read-only), walk the Claude Code transcripts of the last 30 days read-only; for every successful `Read` tool call and every failed `Bash` tool result in them, call `notesForFile` / `notesForFailure` exactly as the hook would (a fresh session per transcript, epochs as recorded), and report: events seen, events that would inject, notes per injecting event, the distribution per file, and twenty random examples (path or first error line → note titles) for the author to judge by eye. Run it; numbers go to the ADR.
- [ ] **Step 3: ADR 0015:** the two events and why these moments (Claude Code injects next to the tool result; reading comes before editing); the limits; why only Claude Code (Codex, Cursor, Gemini as above); the budgets measured; the replay's numbers and examples; what is not confirmed yet (payloads from documentation until captured).
- [ ] **Step 4:** README, CLAUDE.md, spec status line; `bun run check`; commit "A4: budgets, a replay on real history, ADR 0015".
- [ ] **Step 5: Stop and ask the author** before the real-session check: it means installing the new build into the author's own Claude Code. With a yes, capture one `PostToolUse` (Read) and one `PostToolUseFailure` (Bash) payload into `tests/fixtures/claude-code/payloads/` (replacing the documentation-based fixtures, with any personal paths replaced by `/work/shop`), confirm the notes appear in the agent's context, and record it in ADR 0015.
