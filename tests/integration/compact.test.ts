import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enqueueHistory } from "../../src/backfill/enqueue.ts";
import { resolveProject } from "../../src/core/project.ts";
import type { Redacted } from "../../src/core/redact.ts";
import {
  CompactBusyError,
  compact,
  KEEP_HOOK_RUNS,
  RETENTION_DAYS,
} from "../../src/store/compact.ts";
import { DB_FILE, type Db, openDb } from "../../src/store/db.ts";
import { insertMemory } from "../../src/store/memories.ts";
import { claimLease } from "../../src/store/meta.ts";
import { runCliWith } from "../helpers/cli.ts";

const NOW = Date.UTC(2026, 9, 5, 12);
const DAY = 86_400_000;

let base: string;
let dataDir: string;
let db: Db;
let projectId: number;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "wizardingcode-mem-compact-"));
  dataDir = join(base, "data");
  db = openDb({ dataDir, busyTimeoutMs: 2000 });
  projectId = resolveProject(db, join(base, "p"), NOW).id;
});
afterEach(() => {
  db.close();
  rmSync(base, { recursive: true, force: true });
});

function session(agentSessionId: string, lastSeen: number): number {
  return db
    .query<{ id: number }, [string, number, number, number]>(
      `INSERT INTO sessions (agent, agent_session_id, project_id, cwd, started_at, last_seen_at)
       VALUES ('claude-code', ?, ?, '/p', ?, ?) RETURNING id`,
    )
    .get(agentSessionId, projectId, lastSeen, lastSeen)?.id as number;
}
function turn(sessionId: number, seq: number, state: string, startedAt: number): number {
  return db
    .query<{ id: number }, [number, number, number, string, number, number]>(
      `INSERT INTO turns (session_id, project_id, seq, state, prompt, started_at, ended_at)
       VALUES (?, ?, ?, ?, 'p', ?, ?) RETURNING id`,
    )
    .get(sessionId, projectId, seq, state, startedAt, startedAt)?.id as number;
}
const count = (table: string) =>
  db.query<{ n: number }, []>(`SELECT count(*) AS n FROM ${table}`).get()?.n ?? 0;
/** A project repository's row; each has its own owner, as one project has one repository. */
function repo(path: string): number {
  const owner = 1000 + count("knowledge_repos");
  return db
    .query<{ id: number }, [number, string]>(
      "INSERT INTO knowledge_repos (scope, project_id, path, indexed_at) VALUES ('project', ?, ?, 1) RETURNING id",
    )
    .get(owner, path)?.id as number;
}
function shown(sessionId: number, repoId: number, entryId: string): void {
  db.run(
    `INSERT INTO knowledge_shown (session_id, context_epoch, repo_id, entry_id, event, rule, at)
     VALUES (?, 0, ?, ?, 'prompt', 'words', 1)`,
    [sessionId, repoId, entryId],
  );
}
const shownRows = () =>
  db
    .query<{ session_id: number; repo_id: number; entry_id: string }, []>(
      "SELECT session_id, repo_id, entry_id FROM knowledge_shown ORDER BY session_id, entry_id",
    )
    .all();

/**
 * A live session and repository, a session the run removes, a session already gone and a
 * repository already gone: rows of each, and one row whose session is removed by the run
 * and whose repository is gone, which counts once.
 */
function seedShown(): { live: number; kept: number; goes: number } {
  const live = session("live", NOW - DAY);
  turn(live, 1, "done", NOW - DAY);
  const goes = session("old", NOW - 200 * DAY);
  turn(goes, 1, "done", NOW - 200 * DAY);
  const kept = repo("knowledge/projects/kept");
  const dropped = repo("knowledge/projects/dropped");
  db.run("DELETE FROM knowledge_repos WHERE id = ?", [dropped]);
  shown(live, kept, "a");
  shown(live, dropped, "b");
  shown(goes, kept, "c");
  shown(goes, dropped, "d");
  shown(9999, kept, "e");
  return { live, kept, goes };
}

describe("compact", () => {
  test("finished turns older than the retention window go, unless a memory came from them", async () => {
    const old = session("old", NOW - 200 * DAY);
    const done = turn(old, 1, "done", NOW - 200 * DAY);
    turn(old, 2, "skipped", NOW - 150 * DAY);
    const kept = turn(old, 3, "done", NOW - 120 * DAY);
    insertMemory(db, {
      projectId,
      kind: "decision",
      title: "Kept because a memory points at it.",
      body: "" as Redacted,
      terms: "",
      importance: 3,
      branch: null,
      commit: null,
      origin: "distilled",
      judge: "heuristic",
      judgeVersion: "1",
      sourceTurnId: kept,
      files: [],
      now: NOW - 120 * DAY,
    });
    const recent = session("recent", NOW - DAY);
    turn(recent, 1, "done", NOW - DAY);
    turn(recent, 2, "pending", NOW - 100 * DAY);

    const report = await compact(db, { now: NOW, vacuum: false });
    expect(report.turns).toBe(2);
    expect(db.query("SELECT id FROM turns ORDER BY id").all()).toEqual([
      { id: kept },
      { id: 4 },
      { id: 5 },
    ]);
    expect(db.query("SELECT id FROM turns WHERE id = ?").get(done)).toBeNull();
  });

  test("history turns inside the history window stay, so a later import does not queue them again", async () => {
    const at = NOW - 120 * DAY;
    const historyTurn = {
      agent: "claude-code" as const,
      sessionId: "h1",
      turnId: "p1",
      cwd: join(base, "p"),
      branch: null,
      prompt: "question",
      finalText: "answer",
      startedAt: at,
      endedAt: at + 5000,
      transcriptPath: join(base, "h1.jsonl"),
      detail: { filesRead: [], filesChanged: [], commands: [], errors: [], savedMemory: false },
    };
    const options = { sinceMs: NOW - 180 * DAY, now: NOW };
    expect(enqueueHistory(db, [historyTurn], options).queued).toBe(1);
    db.run("UPDATE turns SET state = 'done'");
    const older = session("h0", NOW - 200 * DAY);
    db.run("UPDATE turns SET origin = 'history' WHERE id = ?", [
      turn(older, 1, "done", NOW - 200 * DAY),
    ]);

    expect((await compact(db, { now: NOW, vacuum: false })).turns).toBe(1);
    expect(enqueueHistory(db, [historyTurn], options).queued).toBe(0);

    // A shorter history window lets them go like any other turn.
    expect((await compact(db, { now: NOW, vacuum: false, historyDays: 100 })).turns).toBe(1);
  });

  test("sessions left with nothing, last seen long ago, go too; recent empty ones stay", async () => {
    session("stale-empty", NOW - (RETENTION_DAYS + 1) * DAY);
    session("fresh-empty", NOW - DAY);
    const report = await compact(db, { now: NOW, vacuum: false });
    expect(report.sessions).toBe(1);
    expect(db.query("SELECT agent_session_id AS id FROM sessions").all()).toEqual([
      { id: "fresh-empty" },
    ]);
  });

  test("hook runs beyond the most recent ones are dropped; injections of gone sessions with them", async () => {
    for (let i = 0; i < KEEP_HOOK_RUNS + 25; i++) {
      db.run(
        "INSERT INTO hook_runs (at, agent, event, ms, outcome) VALUES (?, 'claude-code', 'prompt', 1, 'ok')",
        [i],
      );
    }
    const gone = session("gone", NOW - 400 * DAY);
    const memoryId = insertMemory(db, {
      projectId,
      kind: "decision",
      title: "Shown once, long ago.",
      body: "" as Redacted,
      terms: "",
      importance: 3,
      branch: null,
      commit: null,
      origin: "manual",
      judge: "heuristic",
      judgeVersion: "1",
      sourceTurnId: null,
      files: [],
      now: NOW - 400 * DAY,
    });
    db.run(
      "INSERT INTO injections (session_id, context_epoch, memory_id, event, tokens, at) VALUES (?, 0, ?, 'prompt', 0, 1)",
      [gone, memoryId],
    );
    const report = await compact(db, { now: NOW, vacuum: false });
    expect(report.hookRuns).toBe(25);
    expect(count("hook_runs")).toBe(KEEP_HOOK_RUNS);
    expect(db.query("SELECT min(at) AS first FROM hook_runs").get()).toEqual({ first: 25 });
    expect(count("injections")).toBe(0);
  });

  test("a dry run reports what would go and changes nothing", async () => {
    const old = session("old", NOW - 200 * DAY);
    turn(old, 1, "done", NOW - 200 * DAY);
    const report = await compact(db, { now: NOW, vacuum: false, dryRun: true });
    expect(report).toMatchObject({ turns: 1, sessions: 1, dryRun: true });
    expect(count("turns")).toBe(1);
    expect(count("sessions")).toBe(1);
  });

  test("refuses while a history run holds its lease: the vacuum would stall it; a dry run still reports", async () => {
    const old = session("old", NOW - 200 * DAY);
    turn(old, 1, "done", NOW - 200 * DAY);
    expect(claimLease(db, "history.lease", "run-1", NOW, 120_000)).toBe(true);
    await expect(compact(db, { now: NOW })).rejects.toThrow(CompactBusyError);
    expect(count("turns")).toBe(1);
    expect(await compact(db, { now: NOW, dryRun: true })).toMatchObject({ turns: 1, dryRun: true });
  });

  test("knowledge shown rows whose session or repository is gone go; the others stay", async () => {
    const { live, kept } = seedShown();
    const report = await compact(db, { now: NOW, vacuum: false });
    expect(report.sessions).toBe(1);
    expect(report.knowledgeShown).toBe(4);
    expect(shownRows()).toEqual([{ session_id: live, repo_id: kept, entry_id: "a" }]);
  });

  test("a dry run counts the shown rows the real run deletes, each once, and deletes none", async () => {
    seedShown();
    const dry = await compact(db, { now: NOW, vacuum: false, dryRun: true });
    expect(dry.knowledgeShown).toBe(4);
    expect(count("knowledge_shown")).toBe(5);
    expect(count("sessions")).toBe(2);
    expect((await compact(db, { now: NOW, vacuum: false })).knowledgeShown).toBe(
      dry.knowledgeShown,
    );
  });

  test("runs on a store without the knowledge shown table, and reports 0", async () => {
    const old = session("old", NOW - 200 * DAY);
    turn(old, 1, "done", NOW - 200 * DAY);
    db.run("DROP TABLE knowledge_shown");
    expect((await compact(db, { now: NOW, vacuum: false, dryRun: true })).knowledgeShown).toBe(0);
    const report = await compact(db, { now: NOW, vacuum: false });
    expect(report).toMatchObject({ turns: 1, sessions: 1, knowledgeShown: 0 });
  });

  test("a knowledge module at a version this binary does not know keeps its shown rows, and reports 0", async () => {
    // The module's rule (ADR 0024): a too-new schema is left alone by every reader and
    // writer, compact included; the sessions still go.
    seedShown();
    db.run(
      "INSERT INTO module_migrations (module, version, name, applied_at) VALUES ('knowledge', 9, 'later', 1)",
    );
    expect((await compact(db, { now: NOW, vacuum: false, dryRun: true })).knowledgeShown).toBe(0);
    const report = await compact(db, { now: NOW, vacuum: false });
    expect(report).toMatchObject({ sessions: 1, knowledgeShown: 0 });
    expect(count("knowledge_shown")).toBe(5);
  });

  test("a row of a removed session goes with it, so a session that reuses its id starts unshown", async () => {
    const kept = repo("knowledge/projects/kept");
    const old = session("old", NOW - 200 * DAY);
    turn(old, 1, "done", NOW - 200 * DAY);
    shown(old, kept, "a");
    expect(await compact(db, { now: NOW, vacuum: false })).toMatchObject({
      sessions: 1,
      knowledgeShown: 1,
    });
    // SQLite gives the highest id back once its row is deleted.
    const reused = session("new", NOW);
    expect(reused).toBe(old);
    expect(count("knowledge_shown")).toBe(0);
  });

  test("the file shrinks after a vacuum", async () => {
    const s = session("bulk", NOW - 200 * DAY);
    for (let i = 1; i <= 300; i++) {
      db.run(
        "INSERT INTO turns (session_id, project_id, seq, state, prompt, started_at) VALUES (?, ?, ?, 'done', ?, ?)",
        [s, projectId, i, "x".repeat(4000), NOW - 200 * DAY],
      );
    }
    db.run("PRAGMA wal_checkpoint(TRUNCATE)");
    const before = statSync(join(dataDir, DB_FILE)).size;
    const report = await compact(db, { now: NOW, vacuum: true });
    expect(report.bytesBefore).toBe(before);
    expect(report.bytesAfter).toBeLessThan(before);
  });
});

describe("wizardingcode-mem compact", () => {
  test("says what it removed and how much space it freed", async () => {
    const old = session("old", NOW - 200 * DAY);
    turn(old, 1, "done", NOW - 200 * DAY);
    db.close();
    const result = await runCliWith({ env: { WIZARDINGCODE_MEM_DATA_DIR: dataDir } }, "compact");
    db = openDb({ dataDir, busyTimeoutMs: 2000 });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toMatch(
      /^compact: 1 turn, 1 session, 0 hook runs removed · .* → .*\nknowledge shown: 0 rows\n$/,
    );
    expect(count("turns")).toBe(0);
  });

  test("--dry-run only reports", async () => {
    const old = session("old", NOW - 200 * DAY);
    turn(old, 1, "done", NOW - 200 * DAY);
    db.close();
    const result = await runCliWith(
      { env: { WIZARDINGCODE_MEM_DATA_DIR: dataDir } },
      "compact",
      "--dry-run",
    );
    db = openDb({ dataDir, busyTimeoutMs: 2000 });
    expect(result.stdout).toContain("would remove");
    expect(result.stdout.endsWith("\nknowledge shown: 0 rows\n")).toBe(true);
    expect(count("turns")).toBe(1);
  });

  test("refuses while a history run goes, and says so", async () => {
    const old = session("old", NOW - 200 * DAY);
    turn(old, 1, "done", NOW - 200 * DAY);
    claimLease(db, "history.lease", "run-1", Date.now(), 120_000);
    db.close();
    const result = await runCliWith({ env: { WIZARDINGCODE_MEM_DATA_DIR: dataDir } }, "compact");
    db = openDb({ dataDir, busyTimeoutMs: 2000 });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("background work is running");
    expect(count("turns")).toBe(1);
  });

  test("honours WIZARDINGCODE_MEM_RETENTION_DAYS from the settings file", async () => {
    writeFileSync(join(dataDir, "env"), "WIZARDINGCODE_MEM_RETENTION_DAYS=30\n");
    const recent = session("recent", Date.now() - 31 * DAY);
    turn(recent, 1, "done", Date.now() - 31 * DAY);
    db.close();
    const result = await runCliWith({ env: { WIZARDINGCODE_MEM_DATA_DIR: dataDir } }, "compact");
    db = openDb({ dataDir, busyTimeoutMs: 2000 });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/^compact: 1 turn, 1 session/);
    expect(count("turns")).toBe(0);
  });
});
