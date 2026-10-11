import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeCode } from "../../src/adapters/claude-code/adapter.ts";
import type { HistoryTurn } from "../../src/adapters/history.ts";
import { enqueueHistory } from "../../src/backfill/enqueue.ts";
import type { ProjectRef } from "../../src/core/project.ts";
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
const history = (
  turnId: string,
  daysAgo: number,
  extra: Partial<HistoryTurn> = {},
): HistoryTurn => ({
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
const run = (turns: HistoryTurn[]) =>
  enqueueHistory(db, turns, { sinceMs: NOW - 180 * DAY, now: NOW });

describe("enqueueHistory", () => {
  test("turns inside the window are queued as finished history, oldest first", () => {
    const report = run([history("p2", 10), history("p1", 20), history("p0", 400)]);
    expect(report).toEqual({ queued: 2, known: 0, skipped: 1 });
    expect(rows()).toEqual([
      { agent_turn_id: "p1", origin: "history", state: "pending", ended_at: NOW - 20 * DAY + 5000 },
      { agent_turn_id: "p2", origin: "history", state: "pending", ended_at: NOW - 10 * DAY + 5000 },
    ]);
  });

  test("a turn in which the agent saved a memory itself is not queued", () => {
    expect(run([history("p1", 5, { detail: { ...EMPTY, savedMemory: true } })]).known).toBe(1);
    expect(rows()).toEqual([]);
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
      history("p1", 5, {
        prompt: "<task-notification>\n<task-id>b1</task-id>\n</task-notification>",
      }),
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

  test("one working directory is resolved once, however many turns it has", () => {
    const projects = new Map<string, ProjectRef>();
    const report = enqueueHistory(db, [history("p1", 5), history("p2", 4), history("p3", 3)], {
      sinceMs: NOW - 180 * DAY,
      now: NOW,
      projects,
    });
    expect(report.queued).toBe(3);
    expect([...projects.keys()]).toEqual([project]);
    expect(db.query("SELECT id FROM projects").all()).toHaveLength(1);
  });
});
