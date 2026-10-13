import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { retrieveForPrompt } from "../../src/retrieve/prompt.ts";
import { renderNotes } from "../../src/retrieve/render.ts";
import { type Db, openDb } from "../../src/store/db.ts";

// What a prompt counts, every prompt: the memories of the index, to know a common word, and
// the project's active ones, to know a rare one. Counting walks an index, and both have
// cheaper answers: the first is the highest id (memories are never deleted), the second is
// needed only when a candidate's evidence hangs on whether a word is rare.

const NOW = 1_700_000_000_000;
let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "prompt-counts-"));
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

function memories(rows: { title: string; body: string }[]): void {
  db.transaction(() => {
    const insert = db.query(
      `INSERT INTO memories (project_id, kind, title, body, importance, origin, judge, judge_version, created_at, updated_at)
       VALUES (1, 'decision', ?, ?, 3, 'manual', 'heuristic', '1', ?, ?)`,
    );
    for (const [i, row] of rows.entries()) insert.run(row.title, row.body, NOW - i, NOW - i);
  })();
}

/** Every statement the prompt runs. */
function watched(): { db: Db; sql: string[] } {
  const sql: string[] = [];
  const proxy = new Proxy(db, {
    get(target, property, receiver) {
      if (property === "query") {
        return (text: string) => {
          sql.push(text.replace(/\s+/g, " ").trim());
          return target.query(text);
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { db: proxy, sql };
}

const retrieve = (on: Db, prompt: string) =>
  renderNotes(
    retrieveForPrompt(on, { projectId: 1, sessionId: 1, epoch: 0, prompt, branch: null, now: NOW }),
  );

describe("what a prompt counts", () => {
  test("the index's size is its highest id, not a count of every memory", () => {
    // Two words in eleven thousand memories each: past the postings budget.
    memories(
      Array.from({ length: 11_000 }, (_, i) => ({
        title: `kelvorn tamblis note ${i}`,
        body: i === 7 ? "kelvorn tamblis quorvex frindle" : "kelvorn tamblis",
      })),
    );
    const { db: spy, sql } = watched();
    const text = retrieve(spy, "kelvorn tamblis quorvex frindle");
    expect(sql.some((s) => /count\(\*\) AS n FROM memories$/.test(s))).toBe(false);
    expect(sql.some((s) => /max\(id\) AS n FROM memories$/.test(s))).toBe(true);
    expect(text).toBe(retrieve(db, "kelvorn tamblis quorvex frindle"));
    expect(text).toContain("quorvex");
  });

  test("the project's active memories are counted only when a word's rarity decides", () => {
    memories([
      { title: "parseConfigFile reads the settings", body: "parseConfigFile throws on a bad line" },
    ]);
    const { db: spy, sql } = watched();
    expect(retrieve(spy, "why does parseConfigFile throw")).toContain("parseConfigFile");
    expect(sql.some((s) => s.includes("count(*) AS n FROM memories WHERE project_id"))).toBe(false);
  });

  test("and counted once when it does", () => {
    memories([
      { title: "zephyr lanterns flicker", body: "the zephyr lanterns flicker at dusk" },
      { title: "unrelated", body: "nothing here" },
    ]);
    const { db: spy, sql } = watched();
    // Two telling words: weight two, and whether they are rare makes it three.
    expect(retrieve(spy, "zephyr lanterns")).toContain("zephyr");
    expect(
      sql.filter((s) => s.includes("count(*) AS n FROM memories WHERE project_id")),
    ).toHaveLength(1);
  });
});
