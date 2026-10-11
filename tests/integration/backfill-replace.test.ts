import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  projectsReadyForReplacement,
  replaceAllImports,
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
/** A history turn that spans from `fromDaysAgo` to `toDaysAgo` (the covered period). */
function covered(fromDaysAgo: number, toDaysAgo: number, state = "done"): number {
  const session = db
    .query<{ id: number }, [number, number, number]>(
      `INSERT INTO sessions (agent, agent_session_id, project_id, cwd, started_at, last_seen_at)
       VALUES ('claude-code', 's' || abs(random()), ?, '/shop', ?, ?) RETURNING id`,
    )
    .get(projectId, NOW, NOW)?.id as number;
  return db
    .query<{ id: number }, [number, number, string, number, number]>(
      `INSERT INTO turns (session_id, project_id, seq, state, origin, prompt, started_at, ended_at)
       VALUES (?, ?, 1, ?, 'history', 'q', ?, ?) RETURNING id`,
    )
    .get(session, projectId, state, NOW - fromDaysAgo * DAY, NOW - toDaysAgo * DAY)?.id as number;
}
const status = (id: number) =>
  db.query<{ status: string }, [number]>("SELECT status FROM memories WHERE id = ?").get(id)
    ?.status;

describe("replacing claude-mem imports", () => {
  test("imports inside the covered span are archived; others, distilled and archived ones are not", () => {
    covered(60, 10);
    const inside = memory("imported", 30);
    const before = memory("imported", 100);
    const after = memory("imported", 2);
    const ours = memory("distilled", 30);
    const rejudged = memory("imported", 30, "archived");
    expect(replaceImports(db, projectId, { now: NOW })).toEqual({ archived: 1, spared: 0 });
    expect([status(inside), status(before), status(after), status(ours), status(rejudged)]).toEqual(
      ["archived", "active", "active", "active", "archived"],
    );
  });

  test("a project with no history turns archives nothing", () => {
    const old = memory("imported", 30);
    expect(replaceImports(db, projectId, { now: NOW })).toEqual({ archived: 0, spared: 0 });
    expect(status(old)).toBe("active");
  });

  test("restoring reactivates exactly what replacement archived", () => {
    covered(60, 10);
    const inside = memory("imported", 30);
    const rejudged = memory("imported", 30, "archived");
    replaceImports(db, projectId, { now: NOW });
    expect(restoreImports(db)).toBe(1);
    expect([status(inside), status(rejudged)]).toEqual(["active", "archived"]);
  });

  test("a project is ready once its history is all finished with something distilled", () => {
    const turn = covered(5, 5, "pending");
    expect(projectsReadyForReplacement(db)).toEqual([]);
    db.run("UPDATE turns SET state = 'done' WHERE id = ?", [turn]);
    expect(projectsReadyForReplacement(db)).toEqual([projectId]);
    replaceImports(db, projectId, { now: NOW });
    // No marker: still ready, and running again archives nothing more.
    expect(projectsReadyForReplacement(db)).toEqual([projectId]);
  });

  test("a project whose history only failed is not ready", () => {
    covered(5, 5, "failed");
    covered(4, 4, "failed");
    expect(projectsReadyForReplacement(db)).toEqual([]);
  });

  test("replacing twice is idempotent", () => {
    covered(60, 10);
    memory("imported", 30);
    expect(replaceImports(db, projectId, { now: NOW }).archived).toBe(1);
    expect(replaceImports(db, projectId, { now: NOW })).toEqual({ archived: 0, spared: 0 });
  });

  test("an import that history reinforced stays", () => {
    const turn = covered(60, 10);
    const confirmed = memory("imported", 30);
    const other = memory("imported", 31);
    db.run("INSERT INTO memory_sources (memory_id, turn_id, relation) VALUES (?, ?, 'duplicate')", [
      confirmed,
      turn,
    ]);
    expect(replaceImports(db, projectId, { now: NOW })).toEqual({ archived: 1, spared: 1 });
    expect([status(confirmed), status(other)]).toEqual(["active", "archived"]);
  });

  test("an import that superseded a history memory stays", () => {
    const turn = covered(60, 10);
    const confirmed = memory("imported", 30);
    const fromHistory = memory("distilled", 40, "superseded");
    db.run("UPDATE memories SET source_turn_id = ?, superseded_by = ? WHERE id = ?", [
      turn,
      confirmed,
      fromHistory,
    ]);
    expect(replaceImports(db, projectId, { now: NOW })).toEqual({ archived: 0, spared: 1 });
    expect(status(confirmed)).toBe("active");
  });

  test("an import confirmed only by a live turn is still replaced", () => {
    covered(60, 10);
    const imported = memory("imported", 30);
    const session = db.query<{ id: number }, []>("SELECT id FROM sessions").get()?.id as number;
    const live = db
      .query<{ id: number }, [number, number, number]>(
        `INSERT INTO turns (session_id, project_id, seq, state, prompt, started_at)
         VALUES (?, ?, 2, 'done', 'q', ?) RETURNING id`,
      )
      .get(session, projectId, NOW - 30 * DAY)?.id as number;
    db.run("INSERT INTO memory_sources (memory_id, turn_id, relation) VALUES (?, ?, 'duplicate')", [
      imported,
      live,
    ]);
    expect(replaceImports(db, projectId, { now: NOW }).archived).toBe(1);
  });

  test("the span is computed afresh when history widens", () => {
    covered(60, 10);
    const older = memory("imported", 80);
    expect(replaceImports(db, projectId, { now: NOW }).archived).toBe(0);
    covered(90, 85);
    expect(replaceImports(db, projectId, { now: NOW }).archived).toBe(1);
    expect(status(older)).toBe("archived");
  });

  test("replacing and restoring leave updated_at alone", () => {
    covered(60, 10);
    const inside = memory("imported", 30);
    const updatedAt = () =>
      db
        .query<{ u: number }, [number]>("SELECT updated_at AS u FROM memories WHERE id = ?")
        .get(inside)?.u;
    const before = updatedAt();
    replaceImports(db, projectId, { now: NOW });
    expect(updatedAt()).toBe(before);
    restoreImports(db);
    expect(updatedAt()).toBe(before);
  });

  test("replacing every ready project reports the totals", () => {
    covered(60, 10);
    memory("imported", 30);
    expect(replaceAllImports(db, { now: NOW })).toEqual({ projects: 1, archived: 1, spared: 0 });
    expect(replaceAllImports(db, { now: NOW })).toEqual({ projects: 1, archived: 0, spared: 0 });
  });
});

describe("replacing with the count the user saw", () => {
  test("the count is checked inside the write: a different one archives nothing and says the new count", () => {
    covered(60, 10);
    const a = memory("imported", 30);
    memory("imported", 20);
    expect(replaceAllImports(db, { now: NOW, expected: 1 })).toEqual({ stale: true, count: 2 });
    expect(status(a)).toBe("active");
    expect(replaceAllImports(db, { now: NOW, expected: 2 })).toEqual({
      projects: 1,
      archived: 2,
      spared: 0,
    });
    expect(status(a)).toBe("archived");
  });
});
