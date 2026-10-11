import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveProject } from "../../src/core/project.ts";
import type { Redacted } from "../../src/core/redact.ts";
import { heuristicJudge } from "../../src/judge/heuristic.ts";
import { globalGet, globalSave, globalSearch, listProjects } from "../../src/mcp/global.ts";
import { type Db, openDb } from "../../src/store/db.ts";
import { insertMemory } from "../../src/store/memories.ts";

// Claude Desktop's chat has no project folder: there the tools work across every project
// and say which project each memory belongs to; saving names the project.

const NOW = Date.UTC(2026, 9, 10, 12);
let base: string;
let db: Db;
let shop: number;
let site: number;

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "wizardingcode-mem-global-")));
  mkdirSync(join(base, "shop"));
  mkdirSync(join(base, "site"));
  db = openDb({ dataDir: join(base, "data"), busyTimeoutMs: 2000 });
  shop = resolveProject(db, join(base, "shop"), NOW - 86_400_000).id;
  site = resolveProject(db, join(base, "site"), NOW).id;
});
afterEach(() => {
  db.close();
  rmSync(base, { recursive: true, force: true });
});

const memory = (projectId: number, title: string) =>
  insertMemory(db, {
    projectId,
    kind: "decision",
    title,
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
    now: NOW,
  });

describe("across every project", () => {
  test("a search finds memories in any project and names the project of each", () => {
    memory(shop, "The checkout button is violet.");
    memory(site, "The hero button is violet too.");
    const out = globalSearch(db, NOW, { query: "violet button" });
    expect(out).toContain("[shop]");
    expect(out).toContain("[site]");
    expect(out).toContain("checkout button");
    expect(out).toContain("hero button");
  });

  test("naming a project narrows the search to it", () => {
    memory(shop, "The checkout button is violet.");
    memory(site, "The hero button is violet too.");
    const out = globalSearch(db, NOW, { query: "violet", project: "SITE" });
    expect(out).toContain("hero button");
    expect(out).not.toContain("checkout button");
  });

  test("an unknown project is said so, with the projects there are", () => {
    expect(globalSearch(db, NOW, { query: "violet", project: "nope" })).toContain(
      "No project called “nope”",
    );
  });

  test("any memory can be read by id, with its project", () => {
    const id = memory(shop, "The checkout button is violet.");
    const out = globalGet(db, NOW, { ids: [id, 9999] });
    expect(out).toContain("[shop]");
    expect(out).toContain("checkout button");
    expect(out).toContain("#9999");
  });

  test("saving names the project; without one nothing is saved and the projects are listed", async () => {
    const refused = await globalSave(db, heuristicJudge, NOW, {
      text: "Buttons are violet.",
      kind: "convention",
    });
    expect(refused).toContain("Say which project");
    expect(refused).toContain("site");
    const saved = await globalSave(db, heuristicJudge, NOW, {
      text: "Buttons are violet. As the brand says.",
      kind: "convention",
      project: "shop",
    });
    expect(saved).toMatch(/Saved as #\d+ in shop\./);
    const row = db
      .query<{ project_id: number }, []>("SELECT project_id FROM memories ORDER BY id DESC LIMIT 1")
      .get();
    expect(row?.project_id).toBe(shop);
  });

  test("the projects, most recently active first, with their counts", () => {
    memory(shop, "One.");
    memory(shop, "Two.");
    const out = listProjects(db, NOW, {});
    expect(out.indexOf("shop")).toBeLessThan(out.indexOf("site"));
    expect(out).toContain("shop · 2 memories");
    expect(out).toContain("site · 0 memories");
  });
});

describe("the MCP server's tool list", () => {
  test("names each tool for people and marks the ones that only read", async () => {
    const main = new URL("../../src/cli/main.ts", import.meta.url).pathname;
    const lines = [
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "test", version: "1" },
        },
      },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
    ];
    const proc = Bun.spawn([process.execPath, main, "mcp", "--global"], {
      env: { ...process.env, WIZARDINGCODE_MEM_DATA_DIR: join(base, "data") },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "ignore",
    });
    for (const line of lines) proc.stdin.write(`${JSON.stringify(line)}\n`);
    proc.stdin.flush();
    const reader = proc.stdout.getReader();
    let text = "";
    while (!text.includes('"id":2')) {
      const { value, done } = await reader.read();
      if (done) break;
      text += new TextDecoder().decode(value);
    }
    proc.kill();
    const list = text
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l))
      .find((m) => m.id === 2);
    const tools = Object.fromEntries(
      list.result.tools.map((t: { name: string }) => [t.name, t]),
    ) as Record<
      string,
      {
        title?: string;
        annotations?: { readOnlyHint?: boolean; idempotentHint?: boolean };
      }
    >;
    expect(tools.memory_search?.title).toBe("Search memories");
    expect(tools.memory_search?.annotations?.readOnlyHint).toBe(true);
    expect(tools.memory_get?.annotations?.readOnlyHint).toBe(true);
    expect(tools.memory_projects?.annotations?.readOnlyHint).toBe(true);
    expect(tools.history_search?.title).toBe("Search past conversations");
    expect(tools.history_search?.annotations?.readOnlyHint).toBe(true);
    expect(tools.history_search?.annotations?.idempotentHint).toBe(true);
    expect(tools.memory_save?.title).toBe("Save a memory");
    expect(tools.memory_save?.annotations?.readOnlyHint).toBe(false);
  });
});
