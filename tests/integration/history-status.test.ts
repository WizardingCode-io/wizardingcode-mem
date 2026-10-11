import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { previewReplaceImports, replaceAllImports } from "../../src/backfill/replace.ts";
import { openHistoryDb } from "../../src/history/db.ts";
import { historyStatus } from "../../src/history/status.ts";
import { type Db, openDb } from "../../src/store/db.ts";
import { setMeta } from "../../src/store/meta.ts";

let dir: string;
let roots: { claudeCode: string; codex: string };
let db: Db;
const NOW = Date.parse("2026-10-11T12:00:00.000Z");
const DAY = 86_400_000;
let projectId: number;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wizardingcode-mem-hstatus-"));
  roots = { claudeCode: join(dir, "cc"), codex: join(dir, "cx") };
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

function memory(origin: string, daysAgo: number): number {
  const at = NOW - daysAgo * DAY;
  return db
    .query<{ id: number }, [number, string, number, number]>(
      `INSERT INTO memories (project_id, kind, title, body, importance, status, origin, judge, judge_version, created_at, updated_at)
       VALUES (?, 'decision', 't', 'b', 3, 'active', ?, 'x', '1', ?, ?) RETURNING id`,
    )
    .get(projectId, origin, at, at)?.id as number;
}
function historyTurn(state: string, fromDaysAgo = 10, toDaysAgo = 5) {
  const session = db
    .query<{ id: number }, [number, number, number]>(
      `INSERT INTO sessions (agent, agent_session_id, project_id, cwd, started_at, last_seen_at)
       VALUES ('claude-code', 's' || abs(random()), ?, '/shop', ?, ?) RETURNING id`,
    )
    .get(projectId, NOW, NOW)?.id as number;
  db.run(
    `INSERT INTO turns (session_id, project_id, seq, state, origin, prompt, started_at, ended_at)
     VALUES (?, ?, 1, ?, 'history', 'q', ?, ?)`,
    [session, projectId, state, NOW - fromDaysAgo * DAY, NOW - toDaysAgo * DAY],
  );
}

describe("historyStatus", () => {
  test("a fresh store: never run, nothing counted", () => {
    const s = historyStatus(db, dir, roots, NOW);
    expect(s.transcripts).toEqual({ claudeCode: 0, codex: 0 });
    expect(s.run).toEqual({
      state: "never",
      kind: "import",
      startedAt: null,
      finishedAt: null,
      last: null,
    });
    expect(s.import).toEqual({ state: "never", startedAt: null, finishedAt: null });
    expect(s.queue).toEqual({ pending: 0, done: 0, skipped: 0, failed: 0 });
    expect(s.index).toEqual({ exists: false, files: 0, turns: 0, bytes: 0 });
    expect(s.replace).toEqual({ projectsReady: 0, wouldArchive: 0, replaced: 0 });
    expect(s.offer.dismissed).toBe(false);
  });

  test("counts transcripts, queue, index and replacement", () => {
    mkdirSync(join(roots.claudeCode, "p"), { recursive: true });
    writeFileSync(join(roots.claudeCode, "p", "a.jsonl"), "{}\n");
    writeFileSync(join(roots.claudeCode, "p", "b.jsonl"), "{}\n");
    mkdirSync(join(roots.codex, "2026", "10"), { recursive: true });
    writeFileSync(join(roots.codex, "2026", "10", "rollout-x.jsonl"), "{}\n");
    historyTurn("done");
    historyTurn("skipped");
    historyTurn("failed");
    historyTurn("pending");
    const hdb = openHistoryDb(dir, { create: true });
    hdb?.run(
      "INSERT INTO files (path, agent, size, mtime, indexed_at) VALUES ('/f','codex',1,1,1)",
    );
    hdb?.run(
      `INSERT INTO turns (path, agent, session_id, turn_id, project_id, project_name, cwd, started_at, ended_at, prompt)
       VALUES ('/f','codex','s','t',1,'shop','/w',1,2,'p')`,
    );
    hdb?.close();
    setMeta(db, "history.offer.dismissed", "1");
    memory("imported", 7);
    const s = historyStatus(db, dir, roots, NOW);
    expect(s.transcripts.claudeCode).toBe(2);
    expect(s.transcripts.codex).toBeGreaterThanOrEqual(0);
    expect(s.queue).toEqual({ pending: 1, done: 1, skipped: 1, failed: 1 });
    expect(s.index).toMatchObject({ exists: true, files: 1, turns: 1 });
    expect(s.index.bytes).toBeGreaterThan(0);
    expect(s.replace).toEqual({ projectsReady: 0, wouldArchive: 0, replaced: 0 });
    expect(s.offer.dismissed).toBe(true);
  });

  test("previewReplaceImports equals what replaceAllImports then archives", () => {
    historyTurn("done");
    memory("imported", 7);
    memory("imported", 6);
    memory("imported", 30);
    const s = historyStatus(db, dir, roots, NOW);
    expect(s.replace).toEqual({ projectsReady: 1, wouldArchive: 2, replaced: 0 });
    expect(previewReplaceImports(db)).toBe(2);
    expect(replaceAllImports(db, { now: NOW }).archived).toBe(2);
    expect(previewReplaceImports(db)).toBe(0);
    expect(historyStatus(db, dir, roots, NOW).replace.replaced).toBe(2);
  });

  test("run state comes from meta; a running state whose lease expired reads as failed", () => {
    setMeta(db, "history.run.state", "done");
    setMeta(db, "history.run.started_at", "100");
    setMeta(db, "history.run.finished_at", "200");
    setMeta(db, "history.run.report", JSON.stringify({ turns: 3 }));
    expect(historyStatus(db, dir, roots, NOW).run).toEqual({
      state: "done",
      kind: "import",
      startedAt: 100,
      finishedAt: 200,
      last: { turns: 3 },
    });
    setMeta(db, "history.run.state", "running");
    expect(historyStatus(db, dir, roots, NOW).run.state).toBe("failed");
    setMeta(db, "history.lease", JSON.stringify({ owner: "x", until: NOW + 60_000 }));
    expect(historyStatus(db, dir, roots, NOW).run.state).toBe("running");
  });

  test("the last import stands apart from an index run that came after it", () => {
    // Before run kinds were recorded, a run was an import.
    setMeta(db, "history.run.state", "done");
    setMeta(db, "history.run.started_at", "100");
    setMeta(db, "history.run.finished_at", "200");
    expect(historyStatus(db, dir, roots, NOW).import).toEqual({
      state: "done",
      startedAt: 100,
      finishedAt: 200,
    });

    // An index run alone: never imported.
    setMeta(db, "history.run.kind", "index");
    expect(historyStatus(db, dir, roots, NOW).run.kind).toBe("index");
    expect(historyStatus(db, dir, roots, NOW).import).toEqual({
      state: "never",
      startedAt: null,
      finishedAt: null,
    });

    // An index run after an import: the import's own record.
    setMeta(db, "history.import.state", "done");
    setMeta(db, "history.import.started_at", "10");
    setMeta(db, "history.import.finished_at", "20");
    expect(historyStatus(db, dir, roots, NOW).import).toEqual({
      state: "done",
      startedAt: 10,
      finishedAt: 20,
    });

    // An import that died while running, then an index run: the import stopped.
    setMeta(db, "history.import.state", "running");
    expect(historyStatus(db, dir, roots, NOW).import.state).toBe("failed");
  });
});
