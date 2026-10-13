import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Redacted } from "../../src/core/redact.ts";
import { MEMORY_COLUMNS, type MemoryRow } from "../../src/retrieve/notes.ts";
import { projectMatches } from "../../src/retrieve/prompt.ts";
import { type Db, openDb } from "../../src/store/db.ts";
import { insertMemory } from "../../src/store/memories.ts";
import { inProject } from "../../src/util/words.ts";

// The prompt's text search ranks the index alone first, and reads the rows of its best
// hundred only; what it returns must be what the single query over every match returned.

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "prompt-matches-"));
  db = openDb({ dataDir: dir, busyTimeoutMs: 2000 });
  for (const name of ["a", "b"]) {
    db.run("INSERT INTO projects (key, name, created_at) VALUES (?, ?, 1)", [
      `path:/${name}`,
      name,
    ]);
  }
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

/** n memories that all hold the word, each a different length so that none tie on bm25. */
function seed(projectId: number, n: number, kind: "decision" | "fix" = "decision"): number[] {
  const ids: number[] = [];
  for (let i = 0; i < n; i++) {
    ids.push(
      insertMemory(db, {
        projectId,
        kind,
        title: `zorblat ${projectId}-${kind}-${i}`,
        body: `about zorblat ${"padding ".repeat(i % 150)}` as Redacted,
        terms: "",
        importance: 3,
        branch: null,
        commit: null,
        origin: "manual",
        judge: "heuristic",
        judgeVersion: "1",
        sourceTurnId: null,
        files: [],
        now: 1_700_000_000_000 + i,
      }),
    );
  }
  return ids;
}

/** The single query the prompt used before: every match scored and read, then the best 20. */
function reference(search: string, projectId: number, filters: string) {
  return db
    .query<MemoryRow & { bm25: number }, [string, number]>(
      `SELECT ${MEMORY_COLUMNS}, bm25(memories_fts, 4.0, 1.0, 2.0, 0.0) AS bm25
         FROM memories_fts CROSS JOIN memories m ON m.id = memories_fts.rowid
        WHERE memories_fts MATCH ? AND m.project_id = ? AND m.status = 'active' AND ${filters}
        ORDER BY bm25 LIMIT 20`,
    )
    .all(search, projectId);
}

/** The statements run, and whether one of them read the rows of every match. */
function watched(): { db: Db; fullScans: () => number } {
  let full = 0;
  const proxy = new Proxy(db, {
    get(target, property, receiver) {
      if (property === "query") {
        return (sql: string) => {
          if (/MATCH/.test(sql) && /JOIN memories/.test(sql)) full++;
          return target.query(sql);
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { db: proxy, fullScans: () => full };
}

const search = (projectId: number) => inProject('"zorblat"', projectId);

describe("projectMatches", () => {
  test("with enough eligible among the best hundred, reads only theirs, and finds the same twenty", () => {
    seed(1, 400);
    seed(2, 400);
    const { db: spy, fullScans } = watched();
    const found = projectMatches(spy, search(1), 1, "1");
    expect(found).toEqual(reference(search(1), 1, "1"));
    expect(found).toHaveLength(20);
    expect(fullScans()).toBe(0);
  });

  test("when the best hundred are mostly filtered out, falls back to the full search, same result", () => {
    seed(1, 400);
    // The best hundred and fifty, archived: none of the best hundred is left.
    db.run(
      `UPDATE memories SET status = 'archived' WHERE id IN (
         SELECT rowid FROM memories_fts WHERE memories_fts MATCH ? ORDER BY bm25(memories_fts, 4.0, 1.0, 2.0, 0.0) LIMIT 150)`,
      [search(1)],
    );
    const { db: spy, fullScans } = watched();
    const found = projectMatches(spy, search(1), 1, "1");
    expect(found).toEqual(reference(search(1), 1, "1"));
    expect(found).toHaveLength(20);
    expect(fullScans()).toBe(1);
  });

  test("with fewer than a hundred matches, the filters apply exactly, without the full search", () => {
    const ids = seed(1, 60);
    seed(1, 30, "fix");
    const unseen = `m.id NOT IN (${ids.slice(0, 50).join(", ")})`;
    const filters = `${unseen} AND m.kind IN ('decision')`;
    const { db: spy, fullScans } = watched();
    const found = projectMatches(spy, search(1), 1, filters);
    expect(found).toEqual(reference(search(1), 1, filters));
    expect(found).toHaveLength(10);
    expect(fullScans()).toBe(0);
  });

  test("nothing matched, nothing returned", () => {
    seed(1, 5);
    expect(projectMatches(db, inProject('"nowhere"', 1), 1, "1")).toEqual([]);
  });
});
