# History import, part 1: distilling recent history — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `wizardingcode-mem history import` reads the last N days of Claude Code and Codex transcripts, distils them through the existing queue (live turns first), dates each memory at its original time, and archives the claude-mem imports it replaces — reversibly.

**Architecture:** Per-agent history readers (`src/adapters/<agent>/history.ts`) turn transcript files into `HistoryTurn`s, reusing the per-turn detail parsing that already exists. `src/backfill/` queues them as finished turns marked `origin = 'history'` (migration 4), drains the existing queue in bounded batches, and archives replaced imports into a `history_replacements` table so the undo touches only those.

**Tech Stack:** TypeScript on the pinned Bun (`./node_modules/.bin/bun`), `bun:sqlite`, `bun:test`, Biome.

**Spec:** `docs/superpowers/specs/2026-10-11-history-import-design.md`. Parts 2 (raw index, `history_search`) and 3 (install prompt, viewer) get their own plans.

## Global Constraints

- Written from scratch; never copy from claude-mem (`CLEAN-ROOM.md`). claude-mem's data is only ever read.
- TDD: every test is written and seen failing before the code.
- Imports use an explicit `.ts` extension. Repository text is in English.
- Run tests with `./node_modules/.bin/bun test <files>` or `bun run test`; `bun run check` must be green before each commit (`bun run format` fixes lint).
- Hooks never exit 2 and fail open; nothing here runs on the hook path.
- Redact first, then clip (`redact` from `src/core/redact.ts`, then `clip`): the same limits as the hooks, 8 KiB for prompts and 16 KiB for answers.
- Window default: 180 days, setting `WIZARDINGCODE_MEM_HISTORY_DAYS` (1–3650).
- Migration 4 assumes migration 3 (PR #12, `host_context`) is merged; rebase this branch on `main` after #12 lands, before Task 1.
- Nothing is deleted: replaced imports become `archived`.

## Review Focus

1. A transcript still being written (last line cut mid-JSON) — the reader skips the broken line and keeps the rest.
2. A prompt captured live by the hooks and also present in the transcript — it is queued once (same session and agent turn id).
3. A session whose `cwd` no longer exists on disk — it is still imported under a project resolved from the path, never crashes the run.
4. A run interrupted mid-drain and run again — no duplicate turns or memories, and replacements happen only once per project.
5. A subagent's sidechain lines in a Claude Code transcript — never taken as the user's prompts.

Each is pinned by a test in the owning task (Tasks 3, 5, 5, 6 and 3).

---

### Task 1: Migration 4 — turn origin, replacements table, live turns first

**Files:**
- Create: `src/store/migrations/0004_history.sql`
- Modify: `src/store/db.ts` (register migration 4)
- Modify: `src/distill/queue.ts:42-75` (claim order and the two new fields)
- Modify: `src/distill/pipeline.ts:23-36` (`QueuedTurn` gains `origin`, `endedAt`)
- Test: `tests/integration/distill.test.ts`, `tests/integration/db.test.ts`

**Interfaces:**
- Produces: column `turns.origin TEXT NOT NULL DEFAULT 'live' CHECK (origin IN ('live','history'))`; table `history_replacements(memory_id INTEGER PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE, project_id INTEGER NOT NULL, run_at INTEGER NOT NULL)`; `QueuedTurn.origin: "live" | "history"`; `QueuedTurn.endedAt: number | null`.

- [ ] **Step 1: Write the failing tests**

In `tests/integration/db.test.ts`, inside `describe("store/db")`:

```ts
  test("turns record where they came from, live by default", () => {
    const db = open();
    const columns = db
      .query<{ name: string; dflt_value: string | null }, []>("PRAGMA table_info(turns)")
      .all();
    expect(columns.find((c) => c.name === "origin")?.dflt_value).toBe("'live'");
    expect(
      db.query("SELECT name FROM sqlite_master WHERE name = 'history_replacements'").all(),
    ).toHaveLength(1);
    db.close();
  });
```

In `tests/integration/distill.test.ts`, inside `describe("distill: the queue")`:

```ts
  test("a live turn is distilled before history queued ahead of it", async () => {
    turn("the tests fail with a timeout", FIX);
    db.run("UPDATE turns SET origin = 'history'");
    turn(
      "Never mock the database in these tests. Always use a real SQLite file.",
      "Understood.",
    );
    await drainQueue(deps(), { owner: "test", maxTurns: 1, maxMs: 10_000 });
    expect(memories().map((m) => m.kind)).toEqual(["convention"]);
  });
```

- [ ] **Step 2: Run them and see them fail**

Run: `./node_modules/.bin/bun test tests/integration/db.test.ts tests/integration/distill.test.ts`
Expected: FAIL — `no such column: origin` / `expected ["convention"]`.

- [ ] **Step 3: Write the migration and register it**

`src/store/migrations/0004_history.sql`:

```sql
-- Turns read back from an agent's own transcripts, after the fact, are queued beside
-- live ones. They wait behind them, and the memories they make carry their own date.
ALTER TABLE turns ADD COLUMN origin TEXT NOT NULL DEFAULT 'live' CHECK (origin IN ('live','history'));
CREATE INDEX turns_queue_origin ON turns(state, origin, id) WHERE state IN ('pending','processing');

-- claude-mem imports archived because distilled history replaced them; the undo
-- reactivates exactly these and nothing archived for another reason.
CREATE TABLE history_replacements (
  memory_id INTEGER PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  run_at INTEGER NOT NULL
);
```

In `src/store/db.ts` add the import and the entry:

```ts
import history from "./migrations/0004_history.sql" with { type: "text" };
// …
  { version: 3, name: "host_context", run: dropHostContext },
  { version: 4, name: "history", sql: history },
```

- [ ] **Step 4: Claim live turns first and carry the new fields**

In `src/distill/pipeline.ts`, extend `QueuedTurn`:

```ts
  /** Where the turn came from: a hook, or an agent's transcript read afterwards. */
  origin: "live" | "history";
  /** When the turn ended; history memories are dated by it. */
  endedAt: number | null;
```

In `src/distill/queue.ts`, add `origin: "live" | "history"; endedAt: number | null;` to `ClaimRow`, select `t.origin, t.ended_at AS endedAt`, and order live first:

```ts
            ORDER BY t.origin = 'history', t.id LIMIT 1`,
```

- [ ] **Step 5: Run the tests and the suite**

Run: `./node_modules/.bin/bun test tests/integration/db.test.ts tests/integration/distill.test.ts tests/integration/backup.test.ts`
Expected: PASS (backup tests use `LATEST_VERSION`, so the new version needs no edit).

- [ ] **Step 6: Commit**

```bash
bun run format && bun run check
git add src/store/migrations/0004_history.sql src/store/db.ts src/distill/queue.ts src/distill/pipeline.ts tests/integration/db.test.ts tests/integration/distill.test.ts
git commit -m "Queue: turns read from history wait behind live ones (migration 4)"
```

### Task 2: History memories carry the turn's own date

**Files:**
- Modify: `src/distill/pipeline.ts` (`distillTurn`, the line `const now = deps.now();`)
- Test: `tests/integration/distill.test.ts`

**Interfaces:**
- Consumes: `QueuedTurn.origin`, `QueuedTurn.endedAt` (Task 1).

- [ ] **Step 1: Write the failing test** (in `describe("distill: from a queued turn to a memory")`)

```ts
  test("a turn from history makes a memory dated when the turn ended", async () => {
    turn("the tests fail with a timeout", FIX);
    const then = clock - 30 * 86_400_000;
    db.run("UPDATE turns SET origin = 'history', ended_at = ?", [then]);
    await drain();
    expect(
      db.query<{ created_at: number }, []>("SELECT created_at FROM memories").get()?.created_at,
    ).toBe(then);
  });
```

- [ ] **Step 2: Run it and see it fail**

Run: `./node_modules/.bin/bun test tests/integration/distill.test.ts -t "dated when the turn ended"`
Expected: FAIL — received the current clock.

- [ ] **Step 3: Implement**

In `distillTurn`, replace `const now = deps.now();` with:

```ts
  // A turn read back from history is remembered as of when it happened, so that
  // recency and supersession treat it as if it had been captured then.
  const now = turn.origin === "history" && turn.endedAt !== null ? turn.endedAt : deps.now();
```

- [ ] **Step 4: Run the distill tests**

Run: `./node_modules/.bin/bun test tests/integration/distill.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
bun run format && bun run check
git add src/distill/pipeline.ts tests/integration/distill.test.ts
git commit -m "Distill: a history turn's memory is dated when the turn ended"
```

### Task 3: Claude Code history reader

**Files:**
- Create: `src/adapters/history.ts` (the shared `HistoryTurn` type)
- Create: `src/adapters/claude-code/history.ts`
- Modify: `src/adapters/claude-code/transcript.ts` (extract `turnDetailFromLines`)
- Test: `tests/unit/claude-code-history.test.ts`

**Interfaces:**
- Produces:

```ts
// src/adapters/history.ts
import type { AgentId } from "../core/types.ts";
import type { TurnDetail } from "./types.ts";

/** One finished turn read back from an agent's transcript. Nothing here is redacted. */
export interface HistoryTurn {
  agent: AgentId;
  sessionId: string;
  turnId: string;
  cwd: string;
  branch: string | null;
  prompt: string;
  finalText: string | null;
  /** Milliseconds since the epoch. */
  startedAt: number;
  endedAt: number;
  transcriptPath: string;
  detail: TurnDetail;
}
```

```ts
// src/adapters/claude-code/history.ts
export function claudeCodeRoot(env?: Record<string, string | undefined>): string; // $CLAUDE_CONFIG_DIR or ~/.claude, + "/projects"
export function listClaudeCodeTranscripts(root: string, sinceMs: number): string[]; // *.jsonl modified at or after sinceMs, oldest first
export function readClaudeCodeHistory(path: string): HistoryTurn[];
// src/adapters/claude-code/transcript.ts
export function turnDetailFromLines(lines: Json[], turnId: string | null): TurnDetail;
```

- [ ] **Step 1: Write the failing tests**

`tests/unit/claude-code-history.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  listClaudeCodeTranscripts,
  readClaudeCodeHistory,
} from "../../src/adapters/claude-code/history.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wizardingcode-mem-cc-history-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const base = { sessionId: "s1", cwd: "/work/shop", gitBranch: "main", isSidechain: false };
const prompt = (promptId: string, content: string, timestamp: string, extra = {}) => ({
  ...base,
  type: "user",
  promptId,
  timestamp,
  message: { role: "user", content },
  ...extra,
});
const assistant = (content: unknown[], timestamp: string, extra = {}) => ({
  ...base,
  type: "assistant",
  timestamp,
  message: { role: "assistant", content },
  ...extra,
});

function write(name: string, lines: unknown[], tail = ""): string {
  const path = join(dir, name);
  writeFileSync(path, `${lines.map((l) => JSON.stringify(l)).join("\n")}\n${tail}`);
  return path;
}

describe("readClaudeCodeHistory", () => {
  test("each prompt becomes a turn with the last thing the assistant said", () => {
    const path = write("a.jsonl", [
      prompt("p1", "why do the tests time out?", "2026-09-01T10:00:00.000Z"),
      assistant(
        [{ type: "tool_use", id: "t1", name: "Edit", input: { file_path: "/work/shop/db.ts" } }],
        "2026-09-01T10:00:05.000Z",
      ),
      assistant([{ type: "text", text: "Fixed: the pragma ran too late." }], "2026-09-01T10:00:09.000Z"),
      prompt("p2", "thanks", "2026-09-01T10:01:00.000Z"),
      assistant([{ type: "text", text: "You're welcome." }], "2026-09-01T10:01:02.000Z"),
    ]);
    const turns = readClaudeCodeHistory(path);
    expect(turns).toHaveLength(2);
    expect(turns[0]).toMatchObject({
      agent: "claude-code",
      sessionId: "s1",
      turnId: "p1",
      cwd: "/work/shop",
      branch: "main",
      prompt: "why do the tests time out?",
      finalText: "Fixed: the pragma ran too late.",
      startedAt: Date.parse("2026-09-01T10:00:00.000Z"),
      endedAt: Date.parse("2026-09-01T10:00:09.000Z"),
      transcriptPath: path,
    });
    expect(turns[0]?.detail.filesChanged).toEqual(["/work/shop/db.ts"]);
  });

  test("a subagent's sidechain is not the user speaking", () => {
    const path = write("b.jsonl", [
      prompt("p1", "review the branch", "2026-09-01T10:00:00.000Z"),
      prompt("p9", "Never touch the lockfile.", "2026-09-01T10:00:01.000Z", { isSidechain: true }),
      assistant([{ type: "text", text: "Reviewed." }], "2026-09-01T10:00:02.000Z"),
    ]);
    expect(readClaudeCodeHistory(path).map((t) => t.turnId)).toEqual(["p1"]);
  });

  test("a broken last line and unknown shapes are skipped, the rest is kept", () => {
    const path = write(
      "c.jsonl",
      [
        { type: "file-history-snapshot", snapshot: {} },
        prompt("p1", "why?", "2026-09-01T10:00:00.000Z"),
        assistant([{ type: "text", text: "Because." }], "2026-09-01T10:00:01.000Z"),
      ],
      '{"type":"user","promptId":"p2","mess',
    );
    expect(readClaudeCodeHistory(path).map((t) => t.turnId)).toEqual(["p1"]);
  });

  test("an unreadable file yields nothing", () => {
    expect(readClaudeCodeHistory(join(dir, "missing.jsonl"))).toEqual([]);
  });
});

describe("listClaudeCodeTranscripts", () => {
  test("lists transcripts touched since the cut-off, oldest first", () => {
    mkdirSync(join(dir, "-work-shop"));
    const old = write("-work-shop/old.jsonl", []);
    const recent = write("-work-shop/recent.jsonl", []);
    const newer = write("-work-shop/newer.jsonl", []);
    const day = 86_400_000;
    const now = Date.now();
    utimesSync(old, new Date(now - 400 * day), new Date(now - 400 * day));
    utimesSync(recent, new Date(now - 10 * day), new Date(now - 10 * day));
    utimesSync(newer, new Date(now - 1 * day), new Date(now - 1 * day));
    expect(listClaudeCodeTranscripts(dir, now - 180 * day)).toEqual([recent, newer]);
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `./node_modules/.bin/bun test tests/unit/claude-code-history.test.ts`
Expected: FAIL — `Cannot find module '../../src/adapters/claude-code/history.ts'`.

- [ ] **Step 3: Extract the per-turn detail from `readTurnDetail`**

In `src/adapters/claude-code/transcript.ts`, move everything after the `lines` are parsed into an exported function, and have `readTurnDetail` call it:

```ts
/** What one turn did, from transcript lines already parsed. */
export function turnDetailFromLines(lines: Json[], turnId: string | null): TurnDetail {
  // (the body of readTurnDetail from `const filesRead = new Set<string>();` to the
  // final `return detail();`, with the readTail/parseLines try-block removed)
}

export function readTurnDetail(
  transcriptPath: string,
  turnId: string | null,
  options: { maxBytes?: number } = {},
): TurnDetail {
  let lines: Json[];
  try {
    lines = parseLines(readTail(transcriptPath, options.maxBytes ?? DEFAULT_MAX_BYTES));
  } catch {
    return turnDetailFromLines([], null);
  }
  return turnDetailFromLines(lines, turnId);
}
```

Also export `isPrompt` (used by the reader). Run `./node_modules/.bin/bun test tests/unit/claude-code-adapter.test.ts` — it must stay green.

- [ ] **Step 4: Write `src/adapters/history.ts` (the `HistoryTurn` type above) and the reader**

`src/adapters/claude-code/history.ts`:

```ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { isObject, type Json, parseLines, text } from "../common/jsonl.ts";
import type { HistoryTurn } from "../history.ts";
import { isPrompt, turnDetailFromLines } from "./transcript.ts";

// Claude Code keeps one JSON-lines transcript per session under
// <config>/projects/<encoded cwd>/<session>.jsonl. Not a contract: best effort.

export function claudeCodeRoot(env: Record<string, string | undefined> = process.env): string {
  return join(env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), "projects");
}

/** Transcripts modified at or after `sinceMs`, oldest first. */
export function listClaudeCodeTranscripts(root: string, sinceMs: number): string[] {
  const found: { path: string; mtime: number }[] = [];
  let projects: string[];
  try {
    projects = readdirSync(root);
  } catch {
    return [];
  }
  for (const project of projects) {
    let names: string[];
    try {
      names = readdirSync(join(root, project));
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.endsWith(".jsonl")) continue;
      const path = join(root, project, name);
      try {
        const mtime = statSync(path).mtimeMs;
        if (mtime >= sinceMs) found.push({ path, mtime });
      } catch {
        // Gone between the listing and the stat.
      }
    }
  }
  return found.sort((a, b) => a.mtime - b.mtime).map((f) => f.path);
}

const time = (line: Json | undefined): number | null => {
  const value = Date.parse(text(line?.timestamp) ?? "");
  return Number.isNaN(value) ? null : value;
};

/** The text an assistant line says, if any. */
function said(line: Json): string | null {
  if (line.type !== "assistant" || !isObject(line.message)) return null;
  const content = line.message.content;
  if (!Array.isArray(content)) return null;
  const parts = content
    .filter((block) => isObject(block) && block.type === "text")
    .map((block) => text((block as Json).text) ?? "")
    .filter((part) => part !== "");
  return parts.length === 0 ? null : parts.join("\n");
}

/** Every finished turn in one transcript. Never throws. */
export function readClaudeCodeHistory(path: string): HistoryTurn[] {
  let lines: Json[];
  try {
    lines = parseLines(readFileSync(path, "utf8")).filter((line) => line.isSidechain !== true);
  } catch {
    return [];
  }
  const turns: HistoryTurn[] = [];
  const starts = lines.flatMap((line, at) => (isPrompt(line) ? [at] : []));
  starts.forEach((start, n) => {
    const open = lines[start] as Json;
    const end = starts[n + 1] ?? lines.length;
    const body = lines.slice(start, end);
    let finalText: string | null = null;
    let endedAt = time(open);
    for (const line of body) {
      const words = said(line);
      if (words !== null) finalText = words;
      endedAt = time(line) ?? endedAt;
    }
    const startedAt = time(open);
    const turnId = text(open.promptId);
    const sessionId = text(open.sessionId);
    const cwd = text(open.cwd);
    const message = open.message as Json;
    if (startedAt === null || endedAt === null || turnId === null || sessionId === null || cwd === null)
      return;
    turns.push({
      agent: "claude-code",
      sessionId,
      turnId,
      cwd,
      branch: text(open.gitBranch),
      prompt: message.content as string,
      finalText,
      startedAt,
      endedAt,
      transcriptPath: path,
      detail: turnDetailFromLines(body, turnId),
    });
  });
  return turns;
}
```

- [ ] **Step 5: Run the tests**

Run: `./node_modules/.bin/bun test tests/unit/claude-code-history.test.ts tests/unit/claude-code-adapter.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
bun run format && bun run check
git add src/adapters/history.ts src/adapters/claude-code/history.ts src/adapters/claude-code/transcript.ts tests/unit/claude-code-history.test.ts
git commit -m "Claude Code: read finished turns back from its transcripts"
```

### Task 4: Codex history reader

**Files:**
- Create: `src/adapters/codex/history.ts`
- Modify: `src/adapters/codex/transcript.ts` (extract `turnDetailFromEvents`, export `turnEvent`)
- Test: `tests/unit/codex-history.test.ts`

**Interfaces:**
- Consumes: `HistoryTurn` (Task 3).
- Produces:

```ts
export function codexRoot(env?: Record<string, string | undefined>): string; // $CODEX_HOME or ~/.codex, + "/sessions"
export function listCodexTranscripts(root: string, sinceMs: number): string[]; // recursive *.jsonl, oldest first
export function readCodexHistory(path: string): HistoryTurn[];
// src/adapters/codex/transcript.ts
export function turnDetailFromEvents(events: (Json & { turn_id: string })[], turnId: string | null): TurnDetail;
```

- [ ] **Step 1: Write the failing tests**

`tests/unit/codex-history.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listCodexTranscripts, readCodexHistory } from "../../src/adapters/codex/history.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wizardingcode-mem-codex-history-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const meta = {
  timestamp: "2026-09-25T13:58:39.000Z",
  type: "session_meta",
  payload: { session_id: "c1", cwd: "/work/shop" },
};
const event = (timestamp: string, payload: Record<string, unknown>) => ({
  timestamp,
  type: "event_msg",
  payload,
});
const userMessage = (turnId: string, words: string, timestamp: string) =>
  event(timestamp, {
    type: "item_completed",
    turn_id: turnId,
    item: { type: "UserMessage", content: [{ type: "text", text: words }] },
  });
const complete = (turnId: string, words: string | null, timestamp: string) =>
  event(timestamp, { type: "task_complete", turn_id: turnId, last_agent_message: words });

function write(lines: unknown[], tail = ""): string {
  const path = join(dir, "rollout.jsonl");
  writeFileSync(path, `${lines.map((l) => JSON.stringify(l)).join("\n")}\n${tail}`);
  return path;
}

describe("readCodexHistory", () => {
  test("each completed turn becomes a turn, with its prompt and last message", () => {
    const path = write([
      meta,
      event("2026-09-25T13:58:51.000Z", { type: "task_started", turn_id: "t1" }),
      userMessage("t1", "why do the tests time out?", "2026-09-25T13:58:51.500Z"),
      event("2026-09-25T13:59:00.000Z", {
        type: "item_completed",
        turn_id: "t1",
        item: { type: "FileChange", changes: { "/work/shop/db.ts": {} } },
      }),
      complete("t1", "Fixed: the pragma ran too late.", "2026-09-25T13:59:17.000Z"),
    ]);
    const [turn, ...rest] = readCodexHistory(path);
    expect(rest).toEqual([]);
    expect(turn).toMatchObject({
      agent: "codex",
      sessionId: "c1",
      turnId: "t1",
      cwd: "/work/shop",
      prompt: "why do the tests time out?",
      finalText: "Fixed: the pragma ran too late.",
      startedAt: Date.parse("2026-09-25T13:58:51.000Z"),
      endedAt: Date.parse("2026-09-25T13:59:17.000Z"),
    });
    expect(turn?.detail.filesChanged).toEqual(["/work/shop/db.ts"]);
  });

  test("a turn that never completed, or had no prompt, is left out", () => {
    const path = write(
      [
        meta,
        userMessage("t1", "start the deploy", "2026-09-25T14:00:00.000Z"),
        complete("t2", "Done.", "2026-09-25T14:01:00.000Z"),
      ],
      '{"timestamp":"2026-09-25T14:02',
    );
    expect(readCodexHistory(path)).toEqual([]);
  });

  test("a file without session metadata yields nothing", () => {
    expect(readCodexHistory(write([complete("t1", "Done.", "2026-09-25T14:01:00.000Z")]))).toEqual([]);
  });
});

describe("listCodexTranscripts", () => {
  test("walks the dated folders and keeps the recent files, oldest first", () => {
    const day = 86_400_000;
    const now = Date.now();
    const paths = ["2026/03/01/a.jsonl", "2026/09/20/b.jsonl", "2026/10/01/c.jsonl"].map((p) => {
      mkdirSync(join(dir, p, ".."), { recursive: true });
      writeFileSync(join(dir, p), "");
      return join(dir, p);
    });
    [400, 20, 5].forEach((ago, i) =>
      utimesSync(paths[i] as string, new Date(now - ago * day), new Date(now - ago * day)),
    );
    expect(listCodexTranscripts(dir, now - 180 * day)).toEqual([paths[1], paths[2]]);
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `./node_modules/.bin/bun test tests/unit/codex-history.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Extract `turnDetailFromEvents`**

In `src/adapters/codex/transcript.ts`, export `turnEvent`, and move the loop from `const id = turnId ?? events.at(-1)?.turn_id ?? null;` to the end into:

```ts
/** What one turn did, from the turn events of a rollout file. */
export function turnDetailFromEvents(
  events: (Json & { turn_id: string })[],
  turnId: string | null,
): TurnDetail {
  // (the sets, `detail()`, the `id` lookup and the switch over item types, unchanged)
}
```

`readTurnDetail` then parses and returns `turnDetailFromEvents(lines.map(turnEvent).filter((e) => e !== null), turnId)`, or `turnDetailFromEvents([], null)` when reading fails. `./node_modules/.bin/bun test tests/unit/codex-adapter.test.ts` must stay green.

- [ ] **Step 4: Write the reader**

`src/adapters/codex/history.ts`:

```ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { isObject, type Json, parseLines, text } from "../common/jsonl.ts";
import type { HistoryTurn } from "../history.ts";
import { turnDetailFromEvents, turnEvent } from "./transcript.ts";

// Codex writes one rollout file per session under <home>/sessions/YYYY/MM/DD/.
// Declared unstable by Codex: best effort, unknown shapes are skipped.

export function codexRoot(env: Record<string, string | undefined> = process.env): string {
  return join(env.CODEX_HOME ?? join(homedir(), ".codex"), "sessions");
}

/** Rollout files modified at or after `sinceMs`, oldest first. */
export function listCodexTranscripts(root: string, sinceMs: number): string[] {
  const found: { path: string; mtime: number }[] = [];
  const walk = (dir: string): void => {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      const path = join(dir, name);
      let stat: ReturnType<typeof statSync>;
      try {
        stat = statSync(path);
      } catch {
        continue;
      }
      if (stat.isDirectory()) walk(path);
      else if (name.endsWith(".jsonl") && stat.mtimeMs >= sinceMs) found.push({ path, mtime: stat.mtimeMs });
    }
  };
  walk(root);
  return found.sort((a, b) => a.mtime - b.mtime).map((f) => f.path);
}

const time = (line: Json): number | null => {
  const value = Date.parse(text(line.timestamp) ?? "");
  return Number.isNaN(value) ? null : value;
};

function userWords(item: Json): string | null {
  if (item.type !== "UserMessage" || !Array.isArray(item.content)) return null;
  const parts = item.content
    .filter((part) => isObject(part) && part.type === "text")
    .map((part) => text((part as Json).text) ?? "")
    .filter((part) => part !== "");
  return parts.length === 0 ? null : parts.join("\n");
}

/** Every completed turn in one rollout file. Never throws. */
export function readCodexHistory(path: string): HistoryTurn[] {
  let lines: Json[];
  try {
    lines = parseLines(readFileSync(path, "utf8"));
  } catch {
    return [];
  }
  const meta = lines.find((line) => line.type === "session_meta" && isObject(line.payload));
  const sessionId = text((meta?.payload as Json | undefined)?.session_id);
  const sessionCwd = text((meta?.payload as Json | undefined)?.cwd);
  if (sessionId === null || sessionCwd === null) return [];

  const events = lines.map(turnEvent).filter((e) => e !== null);
  const turns: HistoryTurn[] = [];
  const order: string[] = [];
  const byTurn = new Map<
    string,
    { prompt: string | null; finalText: string | null; startedAt: number | null; endedAt: number | null; cwd: string }
  >();
  lines.forEach((line) => {
    const payload = isObject(line.payload) ? line.payload : null;
    const turnId = text(payload?.turn_id);
    if (payload === null || turnId === null) return;
    if (!byTurn.has(turnId)) {
      order.push(turnId);
      byTurn.set(turnId, { prompt: null, finalText: null, startedAt: time(line), endedAt: null, cwd: sessionCwd });
    }
    const entry = byTurn.get(turnId) as NonNullable<ReturnType<typeof byTurn.get>>;
    if (line.type === "turn_context") entry.cwd = text(payload.cwd) ?? entry.cwd;
    if (payload.type === "item_completed" && isObject(payload.item)) {
      entry.prompt ??= userWords(payload.item);
    }
    if (payload.type === "task_complete") {
      entry.finalText = text(payload.last_agent_message);
      entry.endedAt = time(line);
    }
  });
  for (const turnId of order) {
    const entry = byTurn.get(turnId);
    if (entry === undefined || entry.prompt === null || entry.endedAt === null) continue;
    turns.push({
      agent: "codex",
      sessionId,
      turnId,
      cwd: entry.cwd,
      branch: null,
      prompt: entry.prompt,
      finalText: entry.finalText,
      startedAt: entry.startedAt ?? entry.endedAt,
      endedAt: entry.endedAt,
      transcriptPath: path,
      detail: turnDetailFromEvents(events, turnId),
    });
  }
  return turns;
}
```

- [ ] **Step 5: Run the tests**

Run: `./node_modules/.bin/bun test tests/unit/codex-history.test.ts tests/unit/codex-adapter.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
bun run format && bun run check
git add src/adapters/codex/history.ts src/adapters/codex/transcript.ts tests/unit/codex-history.test.ts
git commit -m "Codex: read completed turns back from its rollout files"
```

### Task 5: Queue history turns

**Files:**
- Create: `src/backfill/enqueue.ts`
- Modify: `src/hooks/handle.ts` (export `PROMPT_MAX_CHARS`, `FINAL_TEXT_MAX_CHARS`, `stored` so both paths store text the same way)
- Test: `tests/integration/backfill.test.ts`

**Interfaces:**
- Consumes: `HistoryTurn` (Task 3); `resolveProject(db, cwd, now)` (`src/core/project.ts:71`); `touchSession` (`src/store/sessions.ts`); `isFromTheHost` (`src/core/host-prompt.ts`); `stored(text, max)` from `src/hooks/handle.ts`.
- Produces:

```ts
export interface EnqueueReport { queued: number; known: number; skipped: number }
/** Queues finished history turns that started at or after `sinceMs`. Idempotent. */
export function enqueueHistory(db: Db, turns: HistoryTurn[], options: { sinceMs: number; now: number }): EnqueueReport;
```

Text is stored as the hooks store it; the turn detail goes into the existing `files_read`, `files_changed`, `commands`, `errors` columns (JSON arrays, redacted and clipped like `readDetail` does) — Task 7 has the pipeline read them for history turns, since the transcript tail no longer holds an old turn.

- [ ] **Step 1: Write the failing tests**

`tests/integration/backfill.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeCode } from "../../src/adapters/claude-code/adapter.ts";
import type { HistoryTurn } from "../../src/adapters/history.ts";
import { enqueueHistory } from "../../src/backfill/enqueue.ts";
import { handleHook } from "../../src/hooks/handle.ts";
import { type Db, openDb } from "../../src/store/db.ts";

let base: string;
let project: string;
let db: Db;
const NOW = Date.parse("2026-10-11T12:00:00.000Z");
const DAY = 86_400_000;

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "wizardingcode-mem-backfill-")));
  project = join(base, "shop");
  mkdirSync(project);
  db = openDb({ dataDir: join(base, "data"), busyTimeoutMs: 2000 });
});
afterEach(() => {
  db.close();
  rmSync(base, { recursive: true, force: true });
});

const EMPTY = { filesRead: [], filesChanged: [], commands: [], errors: [], savedMemory: false };
const history = (turnId: string, daysAgo: number, extra: Partial<HistoryTurn> = {}): HistoryTurn => ({
  agent: "claude-code",
  sessionId: "s1",
  turnId,
  cwd: project,
  branch: "main",
  prompt: `question ${turnId}`,
  finalText: `answer ${turnId}`,
  startedAt: NOW - daysAgo * DAY,
  endedAt: NOW - daysAgo * DAY + 5000,
  transcriptPath: join(base, "s1.jsonl"),
  detail: EMPTY,
  ...extra,
});
const rows = () =>
  db
    .query<{ agent_turn_id: string; origin: string; state: string; ended_at: number }, []>(
      "SELECT agent_turn_id, origin, state, ended_at FROM turns ORDER BY id",
    )
    .all();
const run = (turns: HistoryTurn[]) => enqueueHistory(db, turns, { sinceMs: NOW - 180 * DAY, now: NOW });

describe("enqueueHistory", () => {
  test("turns inside the window are queued as finished history, oldest first", () => {
    const report = run([history("p2", 10), history("p1", 20), history("p0", 400)]);
    expect(report).toEqual({ queued: 2, known: 0, skipped: 1 });
    expect(rows()).toEqual([
      { agent_turn_id: "p1", origin: "history", state: "pending", ended_at: NOW - 20 * DAY + 5000 },
      { agent_turn_id: "p2", origin: "history", state: "pending", ended_at: NOW - 10 * DAY + 5000 },
    ]);
  });

  test("running it twice queues nothing new", () => {
    run([history("p1", 20)]);
    expect(run([history("p1", 20)])).toEqual({ queued: 0, known: 1, skipped: 0 });
    expect(rows()).toHaveLength(1);
  });

  test("a turn the hooks already captured is not queued again", () => {
    handleHook({ db, now: () => NOW, spawnDistill: () => {} }, claudeCode, {
      agent: "claude-code",
      event: "prompt",
      sessionId: "s1",
      cwd: project,
      turnId: "p1",
      transcriptPath: null,
      prompt: "question p1",
      finalText: null,
      source: null,
      subagent: false,
    });
    expect(run([history("p1", 1)])).toEqual({ queued: 0, known: 1, skipped: 0 });
    expect(rows().map((r) => r.origin)).toEqual(["live"]);
  });

  test("host notifications are skipped, and secrets never reach the queue", () => {
    const key = ["sk-ant-api03-", "a".repeat(90)].join("");
    run([
      history("p1", 5, { prompt: "<task-notification>\n<task-id>b1</task-id>\n</task-notification>" }),
      history("p2", 4, { prompt: `use ${key} for staging` }),
    ]);
    const prompts = db.query<{ prompt: string }, []>("SELECT prompt FROM turns").all();
    expect(prompts).toHaveLength(1);
    expect(prompts[0]?.prompt).not.toContain(key);
  });

  test("a session whose folder is gone is still imported under its path", () => {
    const gone = join(base, "deleted-project");
    expect(run([history("p1", 5, { cwd: gone })]).queued).toBe(1);
    expect(db.query<{ name: string }, []>("SELECT name FROM projects").all()).toEqual([
      { name: "deleted-project" },
    ]);
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `./node_modules/.bin/bun test tests/integration/backfill.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

In `src/hooks/handle.ts` add `export` to `PROMPT_MAX_CHARS`, `FINAL_TEXT_MAX_CHARS` and `stored`.

`src/backfill/enqueue.ts`:

```ts
import type { HistoryTurn } from "../adapters/history.ts";
import { isFromTheHost } from "../core/host-prompt.ts";
import { resolveProject } from "../core/project.ts";
import { redact } from "../core/redact.ts";
import { FINAL_TEXT_MAX_CHARS, PROMPT_MAX_CHARS, stored } from "../hooks/handle.ts";
import { type Db, withWrite } from "../store/db.ts";
import { touchSession } from "../store/sessions.ts";
import { clip } from "../util/text.ts";

const DETAIL_MAX_CHARS = 500;

export interface EnqueueReport {
  queued: number;
  /** Already in the queue or already captured by the hooks. */
  known: number;
  /** Outside the window, from the host, or from a disabled project. */
  skipped: number;
}

const list = (values: string[], redacted: boolean) =>
  JSON.stringify(values.map((v) => (redacted ? clip(redact(v), DETAIL_MAX_CHARS, "…") : v)));

/** Queues finished history turns that started at or after `sinceMs`, oldest first. Idempotent. */
export function enqueueHistory(
  db: Db,
  turns: HistoryTurn[],
  options: { sinceMs: number; now: number },
): EnqueueReport {
  const report: EnqueueReport = { queued: 0, known: 0, skipped: 0 };
  const ordered = [...turns].sort((a, b) => a.startedAt - b.startedAt);
  for (const turn of ordered) {
    if (turn.startedAt < options.sinceMs || isFromTheHost(turn.prompt)) {
      report.skipped++;
      continue;
    }
    withWrite(db, () => {
      const project = resolveProject(db, turn.cwd, options.now);
      if (project.disabled) {
        report.skipped++;
        return;
      }
      const session = touchSession(db, {
        agent: turn.agent,
        agentSessionId: turn.sessionId,
        projectId: project.id,
        cwd: turn.cwd,
        branch: turn.branch,
        now: turn.endedAt,
      });
      const inserted = db.run(
        `INSERT INTO turns (session_id, project_id, seq, agent_turn_id, state, completeness, origin,
                            prompt, final_text, files_read, files_changed, commands, errors,
                            transcript_path, branch, started_at, ended_at)
         VALUES (?, ?, (SELECT COALESCE(MAX(seq), 0) + 1 FROM turns WHERE session_id = ?), ?,
                 'pending', 'full', 'history', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (session_id, agent_turn_id) WHERE agent_turn_id IS NOT NULL DO NOTHING`,
        [
          session.id,
          project.id,
          session.id,
          turn.turnId,
          stored(turn.prompt, PROMPT_MAX_CHARS),
          turn.finalText === null ? null : stored(turn.finalText, FINAL_TEXT_MAX_CHARS),
          list(turn.detail.filesRead, false),
          list(turn.detail.filesChanged, false),
          list(turn.detail.commands, true),
          list(turn.detail.errors, true),
          turn.transcriptPath,
          turn.branch,
          turn.startedAt,
          turn.endedAt,
        ],
      );
      if (inserted.changes === 1) report.queued++;
      else report.known++;
    });
  }
  return report;
}
```

Note: `touchSession` sets `last_seen_at` to the turn's own time; a live session that is still running is not disturbed beyond that, because the hooks touch it again on their next event.

- [ ] **Step 4: Run the tests**

Run: `./node_modules/.bin/bun test tests/integration/backfill.test.ts tests/integration/hooks.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
bun run format && bun run check
git add src/backfill/enqueue.ts src/hooks/handle.ts tests/integration/backfill.test.ts
git commit -m "Backfill: queue finished turns read from history, once each"
```

### Task 6: Replace claude-mem imports, and undo it

**Files:**
- Create: `src/backfill/replace.ts`
- Test: `tests/integration/backfill-replace.test.ts`

**Interfaces:**
- Produces:

```ts
/** Projects whose history turns are all distilled and that have not been replaced yet. */
export function projectsReadyForReplacement(db: Db): number[];
/** Archives the project's active claude-mem imports created at or after `sinceMs`; returns how many. */
export function replaceImports(db: Db, projectId: number, options: { sinceMs: number; now: number }): number;
/** Reactivates every memory archived by replaceImports; returns how many. */
export function restoreImports(db: Db): number;
```

A project counts as replaced once it has a `meta` row `history.replaced.<projectId>`; `replaceImports` writes it even when nothing was archived, so a second run does nothing.

- [ ] **Step 1: Write the failing tests**

`tests/integration/backfill-replace.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  projectsReadyForReplacement,
  replaceImports,
  restoreImports,
} from "../../src/backfill/replace.ts";
import { type Db, openDb } from "../../src/store/db.ts";

let dir: string;
let db: Db;
const NOW = Date.parse("2026-10-11T12:00:00.000Z");
const DAY = 86_400_000;
let projectId: number;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wizardingcode-mem-replace-"));
  db = openDb({ dataDir: dir, busyTimeoutMs: 2000 });
  projectId = db
    .query<{ id: number }, [number]>(
      "INSERT INTO projects (key, name, created_at) VALUES ('path:/shop', 'shop', ?) RETURNING id",
    )
    .get(NOW)?.id as number;
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function memory(origin: string, daysAgo: number, status = "active"): number {
  const at = NOW - daysAgo * DAY;
  return db
    .query<{ id: number }, [number, string, string, number, number]>(
      `INSERT INTO memories (project_id, kind, title, body, importance, status, origin, judge, judge_version, created_at, updated_at)
       VALUES (?, 'decision', 't', 'b', 3, ?, ?, 'x', '1', ?, ?) RETURNING id`,
    )
    .get(projectId, status, origin, at, at)?.id as number;
}
const status = (id: number) =>
  db.query<{ status: string }, [number]>("SELECT status FROM memories WHERE id = ?").get(id)?.status;

describe("replacing claude-mem imports", () => {
  test("imports inside the window are archived; older, distilled and already archived ones are not", () => {
    const inside = memory("imported", 30);
    const older = memory("imported", 400);
    const ours = memory("distilled", 30);
    const rejudged = memory("imported", 30, "archived");
    expect(replaceImports(db, projectId, { sinceMs: NOW - 180 * DAY, now: NOW })).toBe(1);
    expect([status(inside), status(older), status(ours), status(rejudged)]).toEqual([
      "archived",
      "active",
      "active",
      "archived",
    ]);
  });

  test("restoring reactivates exactly what replacement archived", () => {
    const inside = memory("imported", 30);
    const rejudged = memory("imported", 30, "archived");
    replaceImports(db, projectId, { sinceMs: NOW - 180 * DAY, now: NOW });
    expect(restoreImports(db)).toBe(1);
    expect([status(inside), status(rejudged)]).toEqual(["active", "archived"]);
  });

  test("a project is ready once its history is all distilled, and only once", () => {
    const session = db
      .query<{ id: number }, [number, number, number]>(
        `INSERT INTO sessions (agent, agent_session_id, project_id, cwd, started_at, last_seen_at)
         VALUES ('claude-code', 's1', ?, '/shop', ?, ?) RETURNING id`,
      )
      .get(projectId, NOW, NOW)?.id as number;
    db.run(
      `INSERT INTO turns (session_id, project_id, seq, state, origin, prompt, started_at)
       VALUES (?, ?, 1, 'pending', 'history', 'q', ?)`,
      [session, projectId, NOW],
    );
    expect(projectsReadyForReplacement(db)).toEqual([]);
    db.run("UPDATE turns SET state = 'done'");
    expect(projectsReadyForReplacement(db)).toEqual([projectId]);
    replaceImports(db, projectId, { sinceMs: NOW - 180 * DAY, now: NOW });
    expect(projectsReadyForReplacement(db)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `./node_modules/.bin/bun test tests/integration/backfill-replace.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/backfill/replace.ts`:

```ts
import { type Db, withWrite } from "../store/db.ts";
import { setMeta } from "../store/meta.ts";

// Distilled history and claude-mem's imports describe the same sessions. Once a
// project's history is distilled, its imports from the same window step aside:
// archived, never deleted, and listed so that the undo touches only them.

const replacedKey = (projectId: number) => `history.replaced.${projectId}`;

export function projectsReadyForReplacement(db: Db): number[] {
  return db
    .query<{ id: number }, []>(
      `SELECT t.project_id AS id FROM turns t
        WHERE t.origin = 'history'
          AND NOT EXISTS (SELECT 1 FROM meta WHERE key = 'history.replaced.' || t.project_id)
        GROUP BY t.project_id
       HAVING SUM(t.state IN ('open','pending','processing')) = 0
        ORDER BY t.project_id`,
    )
    .all()
    .map((row) => row.id);
}

export function replaceImports(
  db: Db,
  projectId: number,
  options: { sinceMs: number; now: number },
): number {
  return withWrite(db, () => {
    const ids = db
      .query<{ id: number }, [number, number]>(
        `SELECT id FROM memories
          WHERE project_id = ? AND origin = 'imported' AND status = 'active' AND created_at >= ?`,
      )
      .all(projectId, options.sinceMs)
      .map((row) => row.id);
    for (const id of ids) {
      db.run("UPDATE memories SET status = 'archived', updated_at = ? WHERE id = ?", [options.now, id]);
      db.run(
        "INSERT OR IGNORE INTO history_replacements (memory_id, project_id, run_at) VALUES (?, ?, ?)",
        [id, projectId, options.now],
      );
    }
    setMeta(db, replacedKey(projectId), String(options.now));
    return ids.length;
  });
}

export function restoreImports(db: Db): number {
  return withWrite(db, () => {
    const restored = db.run(
      `UPDATE memories SET status = 'active'
        WHERE status = 'archived' AND id IN (SELECT memory_id FROM history_replacements)`,
    ).changes;
    db.run("DELETE FROM history_replacements");
    db.run("DELETE FROM meta WHERE key LIKE 'history.replaced.%'");
    return restored;
  });
}
```

- [ ] **Step 4: Run the tests**

Run: `./node_modules/.bin/bun test tests/integration/backfill-replace.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
bun run format && bun run check
git add src/backfill/replace.ts tests/integration/backfill-replace.test.ts
git commit -m "Backfill: distilled history replaces claude-mem's imports of the same window, reversibly"
```

### Task 7: The `history` command, its setting, and history turn detail

**Files:**
- Create: `src/backfill/run.ts`, `src/cli/commands/history.ts`
- Modify: `src/cli/main.ts` (register `history`), `src/settings/settings.ts` (`WIZARDINGCODE_MEM_HISTORY_DAYS`, `historyDays`), `src/distill/pipeline.ts` (`readDetail` uses the stored detail for history turns)
- Test: `tests/integration/history-cli.test.ts`, `tests/unit/settings.test.ts`, `tests/integration/distill.test.ts`

**Interfaces:**
- Consumes: readers (Tasks 3–4), `enqueueHistory` (Task 5), `projectsReadyForReplacement`/`replaceImports`/`restoreImports` (Task 6), `drainQueue` (`src/distill/queue.ts`), `makeJudge` (`src/judge/index.ts`), `ADAPTERS`, `resolvePaths`, `loadSettings`.
- Produces:

```ts
export interface BackfillReport { transcripts: number; queued: number; known: number; skipped: number; distilled: number; replaced: number; remaining: number }
export async function runBackfill(deps: { db: Db; judge: Judge; now: () => number; roots: { claudeCode: string; codex: string } },
  options: { days: number; maxMs: number; agents: ("claude-code" | "codex")[] }): Promise<BackfillReport>;
```

CLI: `wizardingcode-mem history import [--days <n>] [--agent claude-code|codex] [--max-seconds <n>]` and `wizardingcode-mem history restore-imports`. `--days` defaults to the setting (default 180). Each run reads, queues, drains until done or `--max-seconds` (default 600), then replaces the projects that are ready; running it again continues.

- [ ] **Step 1: Write the failing tests**

`tests/unit/settings.test.ts`, add:

```ts
  test("history days default to 180 and accept 1 to 3650", () => {
    expect(loadSettings({}, dir).historyDays).toBe(180);
    expect(loadSettings({ WIZARDINGCODE_MEM_HISTORY_DAYS: "30" }, dir).historyDays).toBe(30);
    expect(loadSettings({ WIZARDINGCODE_MEM_HISTORY_DAYS: "0" }, dir).historyDays).toBe(180);
  });
```

(Use the file's existing temp-directory variable name in place of `dir` if it differs.)

`tests/integration/distill.test.ts`, in `describe("distill: from a queued turn to a memory")`:

```ts
  test("a history turn's files come from what was stored with it", async () => {
    turn("the tests fail with a timeout", FIX);
    db.run(
      "UPDATE turns SET origin = 'history', ended_at = ?, transcript_path = NULL, files_changed = ?",
      [clock, JSON.stringify([join(project, "src/store/db.ts")])],
    );
    await drain();
    expect(db.query("SELECT path, role FROM memory_files").all()).toEqual([
      { path: "src/store/db.ts", role: "changed" },
    ]);
  });
```

`tests/integration/history-cli.test.ts`:

```ts
import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DB_FILE } from "../../src/store/db.ts";
import { runCliWith } from "../helpers/cli.ts";

let base: string;
let env: Record<string, string>;
const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "wizardingcode-mem-history-cli-")));
  const shop = join(base, "shop");
  mkdirSync(shop);
  const projects = join(base, "claude", "projects", "-shop");
  mkdirSync(projects, { recursive: true });
  const line = (o: unknown) => JSON.stringify(o);
  const common = { sessionId: "s1", cwd: shop, gitBranch: "main", isSidechain: false };
  writeFileSync(
    join(projects, "s1.jsonl"),
    [
      line({ ...common, type: "user", promptId: "p1", timestamp: day(3), message: { role: "user", content: "Never mock the database in these tests. Always use a real SQLite file." } }),
      line({ ...common, type: "assistant", timestamp: day(3), message: { role: "assistant", content: [{ type: "text", text: "Understood." }] } }),
    ].join("\n"),
  );
  env = {
    WIZARDINGCODE_HOME: join(base, "home"),
    CLAUDE_CONFIG_DIR: join(base, "claude"),
    CODEX_HOME: join(base, "codex"),
    WIZARDINGCODE_MEM_DISTILL: "off",
    WIZARDINGCODE_MEM_UI_AUTO_OPEN: "off",
    WIZARDINGCODE_MEM_MIGRATE: "off",
  };
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

const dbPath = () => join(base, "home", "mem", DB_FILE);

describe("wizardingcode-mem history", () => {
  test("import distils recent history into memories dated when they happened", async () => {
    const out = await runCliWith(["history", "import"], env);
    expect(out.code).toBe(0);
    expect(out.stdout).toContain("1 queued");
    const db = new Database(dbPath(), { readonly: true });
    const rows = db.query<{ kind: string; created_at: number }, []>("SELECT kind, created_at FROM memories").all();
    db.close();
    expect(rows.map((r) => r.kind)).toEqual(["convention"]);
    expect(rows[0]?.created_at).toBeLessThan(Date.now() - 2 * 86_400_000);
  });

  test("running it again adds nothing", async () => {
    await runCliWith(["history", "import"], env);
    const again = await runCliWith(["history", "import"], env);
    expect(again.stdout).toContain("0 queued, 1 known");
  });

  test("a bad flag is a usage error", async () => {
    const out = await runCliWith(["history", "import", "--days", "zero"], env);
    expect(out.code).toBe(2);
  });

  test("restore-imports reports what it reactivated", async () => {
    const out = await runCliWith(["history", "restore-imports"], env);
    expect(out.code).toBe(0);
    expect(out.stdout).toContain("0 restored");
  });
});
```

Before writing it, open `tests/helpers/cli.ts` and match `runCliWith`'s real signature and return shape (`code`, `stdout`, `stderr`); confirm the data directory layout under `WIZARDINGCODE_HOME` with `src/util/paths.ts` (`defaultDataDir`) and adjust `dbPath()` if it differs. `EXIT_USAGE` is in `src/cli/exit.ts`; use its value in the usage-error assertion.

- [ ] **Step 2: Run them and see them fail**

Run: `./node_modules/.bin/bun test tests/unit/settings.test.ts tests/integration/distill.test.ts tests/integration/history-cli.test.ts`
Expected: FAIL — `historyDays` undefined, files empty, unknown command "history".

- [ ] **Step 3: The setting**

In `src/settings/settings.ts`: add `"WIZARDINGCODE_MEM_HISTORY_DAYS"` to `SETTING_KEYS`; add `historyDays: number` to `Settings` (doc: "How far back history is distilled. Older history is only indexed."); add `historyDays: 180` to `DEFAULTS`; `const HISTORY_DAYS = { min: 1, max: 3650 };`; in `loadSettings` add `historyDays: integer(value("WIZARDINGCODE_MEM_HISTORY_DAYS"), HISTORY_DAYS, DEFAULTS.historyDays),`; and a validator:

```ts
  WIZARDINGCODE_MEM_HISTORY_DAYS: (v) =>
    /^\d+$/.test(v) && Number(v) >= HISTORY_DAYS.min && Number(v) <= HISTORY_DAYS.max
      ? null
      : `a whole number of days from ${HISTORY_DAYS.min} to ${HISTORY_DAYS.max}`,
```

(Match the exact style of the neighbouring `WIZARDINGCODE_MEM_RETENTION_DAYS` validator.)

- [ ] **Step 4: Stored detail for history turns**

In `src/distill/pipeline.ts`, `readDetail`: when `turn.origin === "history"`, read the turn's stored columns instead of the transcript (its tail no longer holds an old turn):

```ts
function storedDetail(db: Db, turnId: number): TurnDetail {
  const row = db
    .query<{ filesRead: string; filesChanged: string; commands: string; errors: string }, [number]>(
      `SELECT files_read AS filesRead, files_changed AS filesChanged, commands, errors
         FROM turns WHERE id = ?`,
    )
    .get(turnId);
  const parse = (json: string | undefined): string[] => {
    try {
      const value: unknown = JSON.parse(json ?? "[]");
      return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
    } catch {
      return [];
    }
  };
  return {
    filesRead: parse(row?.filesRead),
    filesChanged: parse(row?.filesChanged),
    commands: parse(row?.commands),
    errors: parse(row?.errors),
    savedMemory: false,
  };
}
```

and at the top of `readDetail` take `raw` from it for history turns, keeping the rest (relative paths, redaction, clipping) unchanged:

```ts
  const raw =
    turn.origin === "history"
      ? storedDetail(deps.db, turn.id)
      : adapter !== undefined && turn.transcriptPath !== null
        ? adapter.readTurnDetail(turn.transcriptPath, turn.agentTurnId)
        : null;
  if (raw === null) return EMPTY;
```

`savedMemory` for history turns: carry it through Task 5 by skipping turns whose `detail.savedMemory` is true in `enqueueHistory` (count them as `known`: what the agent saved itself is already a memory). Add that check and a test case to `tests/integration/backfill.test.ts`:

```ts
  test("a turn in which the agent saved a memory itself is not queued", () => {
    expect(run([history("p1", 5, { detail: { ...EMPTY, savedMemory: true } })]).known).toBe(1);
    expect(rows()).toEqual([]);
  });
```

- [ ] **Step 5: The runner**

`src/backfill/run.ts`:

```ts
import { listClaudeCodeTranscripts, readClaudeCodeHistory } from "../adapters/claude-code/history.ts";
import { listCodexTranscripts, readCodexHistory } from "../adapters/codex/history.ts";
import type { HistoryTurn } from "../adapters/history.ts";
import { ADAPTERS } from "../adapters/index.ts";
import { drainQueue } from "../distill/queue.ts";
import type { Judge } from "../judge/types.ts";
import type { Db } from "../store/db.ts";
import { enqueueHistory } from "./enqueue.ts";
import { projectsReadyForReplacement, replaceImports } from "./replace.ts";

const DAY = 86_400_000;
const BATCH = 50;

export interface BackfillReport {
  transcripts: number;
  queued: number;
  known: number;
  skipped: number;
  distilled: number;
  replaced: number;
  /** History turns still waiting; a later run continues with them. */
  remaining: number;
}

const READERS = {
  "claude-code": { list: listClaudeCodeTranscripts, read: readClaudeCodeHistory, root: "claudeCode" },
  codex: { list: listCodexTranscripts, read: readCodexHistory, root: "codex" },
} as const;

export async function runBackfill(
  deps: { db: Db; judge: Judge; now: () => number; roots: { claudeCode: string; codex: string } },
  options: { days: number; maxMs: number; agents: (keyof typeof READERS)[] },
): Promise<BackfillReport> {
  const started = deps.now();
  const sinceMs = started - options.days * DAY;
  const report: BackfillReport = { transcripts: 0, queued: 0, known: 0, skipped: 0, distilled: 0, replaced: 0, remaining: 0 };

  for (const agent of options.agents) {
    const reader = READERS[agent];
    for (const path of reader.list(deps.roots[reader.root], sinceMs)) {
      report.transcripts++;
      const turns: HistoryTurn[] = reader.read(path);
      const queued = enqueueHistory(deps.db, turns, { sinceMs, now: deps.now() });
      report.queued += queued.queued;
      report.known += queued.known;
      report.skipped += queued.skipped;
    }
  }

  const owner = `history-${process.pid}-${crypto.randomUUID()}`;
  while (deps.now() - started < options.maxMs) {
    const drained = await drainQueue(
      { db: deps.db, judge: deps.judge, adapters: ADAPTERS, now: deps.now },
      { owner, maxTurns: BATCH, maxMs: Math.max(1000, options.maxMs - (deps.now() - started)) },
    );
    report.distilled += drained.done + drained.skipped;
    if (drained.claimed === 0) break;
  }

  for (const projectId of projectsReadyForReplacement(deps.db)) {
    report.replaced += replaceImports(deps.db, projectId, { sinceMs, now: deps.now() });
  }
  report.remaining =
    deps.db
      .query<{ n: number }, []>(
        "SELECT count(*) AS n FROM turns WHERE origin = 'history' AND state IN ('pending','processing')",
      )
      .get()?.n ?? 0;
  return report;
}
```

If `drainQueue` returns `claimed: 0` because another process holds the drain lease (a hook's `distill`), the loop stops and `remaining` says so; the next run continues. That is the intended behaviour, not an error.

- [ ] **Step 6: The command**

`src/cli/commands/history.ts`, following `src/cli/commands/rejudge.ts`:

```ts
import { claudeCodeRoot } from "../../adapters/claude-code/history.ts";
import { codexRoot } from "../../adapters/codex/history.ts";
import { restoreImports } from "../../backfill/replace.ts";
import { runBackfill } from "../../backfill/run.ts";
import { makeJudge } from "../../judge/index.ts";
import { loadSettings } from "../../settings/settings.ts";
import { type Db, openDb } from "../../store/db.ts";
import { logError } from "../../util/log.ts";
import { resolvePaths } from "../../util/paths.ts";
import { EXIT_USAGE } from "../exit.ts";

const USAGE = `Usage: wizardingcode-mem history import [--days <n>] [--agent claude-code|codex] [--max-seconds <n>]
       wizardingcode-mem history restore-imports
`;

function positiveInt(argv: string[], flag: string): number | undefined | null {
  const at = argv.indexOf(flag);
  if (at === -1) return undefined;
  const value = Number(argv[at + 1]);
  return Number.isInteger(value) && value > 0 ? value : null;
}

/**
 * `wizardingcode-mem history`: distils what the agents already have on disk from the
 * last days, oldest first, behind any live turn. Safe to interrupt and run again.
 */
export async function run(argv: string[]): Promise<number> {
  const [sub, ...rest] = argv;
  if (sub !== "import" && sub !== "restore-imports") {
    process.stderr.write(USAGE);
    return EXIT_USAGE;
  }
  const days = positiveInt(rest, "--days");
  const maxSeconds = positiveInt(rest, "--max-seconds");
  const agentAt = rest.indexOf("--agent");
  const agent = agentAt === -1 ? undefined : rest[agentAt + 1];
  if (days === null || maxSeconds === null || (agent !== undefined && agent !== "claude-code" && agent !== "codex")) {
    process.stderr.write(`wizardingcode-mem history: bad option\n${USAGE}`);
    return EXIT_USAGE;
  }
  let db: Db | undefined;
  try {
    const { dataDir, storeDir } = resolvePaths();
    db = openDb({ dataDir: storeDir, busyTimeoutMs: 2000 });
    if (sub === "restore-imports") {
      process.stdout.write(`history: ${restoreImports(db)} restored\n`);
      return 0;
    }
    const report = await runBackfill(
      {
        db,
        judge: makeJudge({ db, dataDir }),
        now: Date.now,
        roots: { claudeCode: claudeCodeRoot(), codex: codexRoot() },
      },
      {
        days: days ?? loadSettings(process.env, dataDir).historyDays,
        maxMs: (maxSeconds ?? 600) * 1000,
        agents: agent === undefined ? ["claude-code", "codex"] : [agent],
      },
    );
    process.stdout.write(
      `history: ${report.transcripts} transcripts, ${report.queued} queued, ${report.known} known, ${report.skipped} skipped, ${report.distilled} distilled, ${report.replaced} imports replaced, ${report.remaining} remaining\n`,
    );
    return 0;
  } catch (error) {
    logError("history", error);
    process.stderr.write(`wizardingcode-mem: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  } finally {
    db?.close();
  }
}
```

In `src/cli/main.ts` add `history: () => import("./commands/history.ts"),` to `COMMANDS`.

- [ ] **Step 7: Run the tests and the whole check**

Run: `./node_modules/.bin/bun test tests/unit/settings.test.ts tests/integration/distill.test.ts tests/integration/backfill.test.ts tests/integration/history-cli.test.ts`
Expected: PASS. Then `bun run format && bun run check` — green.

- [ ] **Step 8: Try it on a copy of real data**

```bash
S=$(mktemp -d)
sqlite3 -readonly ~/.wizardingcode/mem/wizardingcode-mem.db ".backup '$S/wizardingcode-mem.db'"
time WIZARDINGCODE_MEM_STORE_DIR=$S WIZARDINGCODE_MEM_TYPESAFE=off ./node_modules/.bin/bun src/cli/main.ts history import --max-seconds 120
sqlite3 -readonly $S/wizardingcode-mem.db "select origin, state, count(*) from turns group by 1,2; select origin, status, count(*) from memories group by 1,2;"
rm -rf $S
```

Record transcripts read, turns queued, turns distilled per second and memories made in the PR description; the full run's timing goes into an ADR in part 3. (Check how `WIZARDINGCODE_MEM_STORE_DIR` is honoured in `src/util/paths.ts` first; if it is file-only, point `WIZARDINGCODE_HOME` at a temp copy instead.)

- [ ] **Step 9: Commit**

```bash
git add src/backfill/run.ts src/cli/commands/history.ts src/cli/main.ts src/settings/settings.ts src/distill/pipeline.ts src/backfill/enqueue.ts tests/
git commit -m "history import: distil the agents' recent history, then replace the imports it covers"
```

---

## Self-review notes

- Spec coverage (part 1 only): readers ✔ (T3, T4), live first ✔ (T1), original date ✔ (T2), dedupe with hooks ✔ (T5), window + setting ✔ (T5, T7), replacement + undo ✔ (T6, T7), resumable ✔ (T5 idempotence, T6 marker, T7 loop), redaction ✔ (T5). Raw index, `history_search`, `history forget`, install prompt, viewer and status progress are parts 2 and 3.
- Hook latency while a backfill runs is measured in part 3 together with the detached start from `install`.
