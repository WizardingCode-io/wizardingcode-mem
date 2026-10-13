import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Db, openDb } from "../../src/store/db.ts";
import { hasQueuedTurns, QUEUED_TURNS } from "../../src/store/turns.ts";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "turns-queue-"));
  db = openDb({ dataDir: dir, busyTimeoutMs: 2000 });
  db.run("INSERT INTO projects (key, name, created_at) VALUES ('path:/p', 'p', 1)");
  db.run(
    `INSERT INTO sessions (project_id, agent, agent_session_id, cwd, started_at, last_seen_at)
     VALUES (1, 'claude-code', 's', '/p', 1, 1)`,
  );
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

let seq = 0;
function turn(state: string, leaseUntil: number | null = null): void {
  db.run(
    `INSERT INTO turns (session_id, project_id, seq, state, prompt, started_at, lease_until)
     VALUES (1, 1, ?, ?, 'p', 1, ?)`,
    [++seq, state, leaseUntil],
  );
}

describe("hasQueuedTurns", () => {
  test("a pending turn, or one whose lease ran out, is work; anything else is not", () => {
    const now = 1000;
    for (const state of ["open", "done", "skipped", "failed"]) turn(state);
    turn("processing", now + 1);
    expect(hasQueuedTurns(db, now)).toBe(false);
    turn("processing", now - 1);
    expect(hasQueuedTurns(db, now)).toBe(true);
    db.run("UPDATE turns SET state = 'done' WHERE state = 'processing' AND lease_until < ?", [now]);
    expect(hasQueuedTurns(db, now)).toBe(false);
    turn("pending");
    expect(hasQueuedTurns(db, now)).toBe(true);
  });

  test("reads the queue's partial index, never the whole table", () => {
    const plan = db
      .query<{ detail: string }, [number]>(`EXPLAIN QUERY PLAN ${QUEUED_TURNS}`)
      .all(0)
      .map((row) => row.detail)
      .join("\n");
    expect(plan).toContain("turns_queue");
    expect(plan).not.toMatch(/SCAN turns(?! USING)/);
  });
});
