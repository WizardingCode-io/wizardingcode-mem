import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openHistoryDb } from "../../src/history/db.ts";
import {
  historyReadFailure,
  recentHistory,
  renderHits,
  searchHistory,
} from "../../src/history/search.ts";

let dir: string;
let hdb: Database;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wizardingcode-mem-history-search-"));
  const opened = openHistoryDb(dir, { create: true });
  if (opened === null) throw new Error("history db was not created");
  hdb = opened;
  hdb.run(
    "INSERT INTO files (path, agent, size, mtime, indexed_at) VALUES ('/f', 'codex', 1, 1, 1)",
  );
});
afterEach(() => {
  hdb.close();
  rmSync(dir, { recursive: true, force: true });
});

let n = 0;
function turn(o: {
  project: string;
  projectId: number;
  prompt: string;
  answer?: string | null;
  endedAt?: number;
}) {
  n++;
  hdb.run(
    `INSERT INTO turns (path, agent, session_id, turn_id, project_id, project_name, cwd, started_at, ended_at, prompt, final_text)
     VALUES ('/f', 'claude-code', 's1', ?, ?, ?, '/w', 1, ?, ?, ?)`,
    [
      `t${n}`,
      o.projectId,
      o.project,
      o.endedAt ?? Date.parse("2026-09-01T10:00:00Z"),
      o.prompt,
      o.answer ?? null,
    ],
  );
}

describe("searchHistory", () => {
  test("finds a turn by a word in the answer", () => {
    turn({ project: "shop", projectId: 1, prompt: "why", answer: "the cache was stale" });
    turn({ project: "shop", projectId: 1, prompt: "other", answer: "unrelated" });
    const hits = searchHistory(hdb, { query: "stale cache" });
    expect(hits.map((h) => h.prompt)).toEqual(["why"]);
    expect(hits[0]?.project).toBe("shop");
    expect(hits[0]?.agent).toBe("claude-code");
    expect(hits[0]?.sessionId).toBe("s1");
  });

  test("projectId and projectName limit to one project", () => {
    turn({ project: "shop", projectId: 1, prompt: "pragma here" });
    turn({ project: "blog", projectId: 2, prompt: "pragma there" });
    expect(searchHistory(hdb, { query: "pragma", projectId: 2 }).map((h) => h.project)).toEqual([
      "blog",
    ]);
    expect(
      searchHistory(hdb, { query: "pragma", projectName: "shop" }).map((h) => h.project),
    ).toEqual(["shop"]);
  });

  test("folds accents", () => {
    turn({ project: "shop", projectId: 1, prompt: "the pragmá ran late" });
    expect(searchHistory(hdb, { query: "pragma" })).toHaveLength(1);
  });

  test("honours the limit: default 10, at most 25", () => {
    for (let i = 0; i < 30; i++) turn({ project: "shop", projectId: 1, prompt: `needle ${i}` });
    expect(searchHistory(hdb, { query: "needle" })).toHaveLength(10);
    expect(searchHistory(hdb, { query: "needle", limit: 3 })).toHaveLength(3);
    expect(searchHistory(hdb, { query: "needle", limit: 100 })).toHaveLength(25);
  });

  test("nothing searchable gives no hits", () => {
    expect(searchHistory(hdb, { query: "?!" })).toEqual([]);
  });

  test("a hit names its turn, folder and start, for a viewer to show", () => {
    turn({ project: "shop", projectId: 1, prompt: "pragma", endedAt: 5000 });
    const [hit] = searchHistory(hdb, { query: "pragma" });
    expect(hit).toMatchObject({ cwd: "/w", startedAt: 1, endedAt: 5000 });
    expect(typeof hit?.id).toBe("number");
  });
});

describe("recentHistory", () => {
  test("the latest turns first, in one project or all, up to 100", () => {
    turn({ project: "shop", projectId: 1, prompt: "old", endedAt: 1000 });
    turn({ project: "blog", projectId: 2, prompt: "newest", endedAt: 3000 });
    turn({ project: "shop", projectId: 1, prompt: "middle", endedAt: 2000 });
    expect(recentHistory(hdb, {}).map((h) => h.prompt)).toEqual(["newest", "middle", "old"]);
    expect(recentHistory(hdb, { projectId: 1, limit: 1 }).map((h) => h.prompt)).toEqual(["middle"]);
    for (let i = 0; i < 120; i++) turn({ project: "shop", projectId: 1, prompt: `n${i}` });
    expect(recentHistory(hdb, { limit: 500 })).toHaveLength(100);
    expect(recentHistory(hdb, {})).toHaveLength(50);
  });
});

describe("renderHits", () => {
  test("shows project, date, prompt and answer, and clips long text", () => {
    const text = renderHits([
      {
        project: "shop",
        agent: "codex",
        sessionId: "s1",
        endedAt: Date.parse("2026-09-01T10:00:00Z"),
        prompt: "fix the thing",
        answer: "x".repeat(1000),
      },
    ]);
    expect(text).toContain("shop");
    expect(text).toContain("2026-09-01");
    expect(text).toContain("fix the thing");
    expect(text).toContain("…");
    expect(text).not.toContain("x".repeat(601));
  });

  test("a turn without an answer still renders", () => {
    const text = renderHits([
      { project: "p", agent: "codex", sessionId: "s", endedAt: 0, prompt: "q", answer: null },
    ]);
    expect(text).toContain("q");
  });
});

describe("historyReadFailure", () => {
  test("only a busy database is busy; anything else says how to rebuild", () => {
    const busy = Object.assign(new Error("database is locked"), { code: "SQLITE_BUSY" });
    expect(historyReadFailure(busy)).toBe("The history index is busy; try again in a moment.");
    const broken = Object.assign(new Error("file is not a database"), { code: "SQLITE_NOTADB" });
    expect(historyReadFailure(broken)).toBe(
      "The history index could not be read. The user can rebuild it: wizardingcode-mem history forget, then wizardingcode-mem history index",
    );
    expect(historyReadFailure(new Error("no code"))).toContain("could not be read");
  });
});
