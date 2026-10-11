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
  db.query<{ status: string }, [number]>("SELECT status FROM memories WHERE id = ?").get(id)
    ?.status;

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
