import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveProject } from "../../src/core/project.ts";
import type { Redacted } from "../../src/core/redact.ts";
import type { MemoryKind } from "../../src/core/types.ts";
import { loadModel, modelPath } from "../../src/embed/model.ts";
import { heuristicJudge } from "../../src/judge/heuristic.ts";
import { globalSearch } from "../../src/mcp/global.ts";
import { getMemories, saveMemory, searchMemories } from "../../src/mcp/tools.ts";
import { refreshStaleness } from "../../src/retrieve/staleness.ts";
import { type Db, openDb } from "../../src/store/db.ts";
import { linkProjects } from "../../src/store/links.ts";
import { insertMemory } from "../../src/store/memories.ts";

const NOW = Date.UTC(2026, 9, 5, 12);
const DAY = 86_400_000;

let base: string;
let project: string;
let dataDir: string;
let db: Db;
let projectId: number;

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "wizardingcode-mem-mcp-")));
  project = join(base, "project");
  dataDir = join(base, "data");
  mkdirSync(project);
  db = openDb({ dataDir, busyTimeoutMs: 2000 });
  projectId = resolveProject(db, project, NOW).id;
});
afterEach(() => {
  db.close();
  rmSync(base, { recursive: true, force: true });
});

function memory(
  title: string,
  body = "",
  extra: { kind?: MemoryKind; importance?: number; projectId?: number; files?: string[] } = {},
): number {
  const files = (extra.files ?? []).map((path) => ({ path, role: "changed" as const }));
  return insertMemory(db, {
    projectId: extra.projectId ?? projectId,
    kind: extra.kind ?? "decision",
    title,
    body: body as Redacted,
    terms: files.map((file) => file.path).join(" "),
    importance: extra.importance ?? 2,
    branch: null,
    commit: null,
    origin: "manual",
    judge: "heuristic",
    judgeVersion: "1",
    sourceTurnId: null,
    files,
    now: NOW - 2 * DAY,
  });
}

const context = () => ({
  db,
  judge: heuristicJudge,
  projectId,
  root: project,
  branch: null,
  now: NOW,
});
const search = (query: string, extra: { kind?: MemoryKind; limit?: number } = {}) =>
  searchMemories(context(), { query, ...extra });

describe("memory_search", () => {
  test("an explicit search needs only one word", () => {
    const id = memory("The pragma busy_timeout must come first.", "Otherwise queries fail.", {
      kind: "gotcha",
      files: ["src/store/db.ts"],
    });
    memory("Hooks never exit with code two.");
    expect(search("pragma")).toBe(
      `#${id} [gotcha · 2026-10-03 · src/store/db.ts] The pragma busy_timeout must come first.`,
    );
  });

  test("answers with headings only: the body is fetched separately", () => {
    memory("The pragma busy_timeout must come first.", "Otherwise queries fail at once.");
    expect(search("pragma")).not.toContain("Otherwise");
  });

  test("can be narrowed to one kind", () => {
    memory("The pragma busy_timeout must come first.", "", { kind: "gotcha" });
    const fix = memory("Fixed the pragma order in openDb.", "", { kind: "fix" });
    expect(search("pragma", { kind: "fix" })).toStartWith(`#${fix} [fix`);
    expect(search("pragma", { kind: "fix" }).split("\n")).toHaveLength(1);
  });

  test("an empty query lists what matters most", () => {
    const minor = memory("A minor note about naming.", "", { importance: 1 });
    const major = memory("Never mock the database.", "", { importance: 5 });
    expect(
      search("")
        .split("\n")
        .map((line) => line.split(" ")[0]),
    ).toEqual([`#${major}`, `#${minor}`]);
  });

  test("returns ten by default and never more than twenty-five", () => {
    for (let i = 0; i < 40; i++) memory(`Note ${i} about the pragma order.`);
    expect(search("pragma").split("\n")).toHaveLength(10);
    expect(search("pragma", { limit: 3 }).split("\n")).toHaveLength(3);
    expect(search("pragma", { limit: 999 }).split("\n")).toHaveLength(25);
  });

  test("sees only this project's current memories", () => {
    const other = join(base, "other");
    mkdirSync(other);
    memory("The pragma order matters elsewhere.", "", {
      projectId: resolveProject(db, other, NOW).id,
    });
    const replaced = memory("The pragma comes last.");
    db.run("UPDATE memories SET status = 'superseded' WHERE id = ?", [replaced]);
    expect(search("pragma")).toBe("No memories match.");
  });

  test("a query made only of punctuation or query syntax is harmless", () => {
    memory("The pragma busy_timeout must come first.");
    expect(search('") OR NOT * ^ (')).toBe("No memories match.");
  });
});

describe("memory_search over linked projects", () => {
  const other = (name: string) => {
    mkdirSync(join(base, name));
    return resolveProject(db, join(base, name), NOW).id;
  };

  test("finds a linked project's memory, and names the project of every result", () => {
    const web = other("web");
    linkProjects(db, web, projectId, "product", NOW);
    const own = memory("The pragma order matters here.");
    const theirs = memory("The pragma order matters on the web too.", "", { projectId: web });
    const out = search("pragma").split("\n");
    expect(out).toHaveLength(2);
    expect(out).toContainEqual(expect.stringMatching(new RegExp(`^\\[project\\] #${own} `)));
    expect(out).toContainEqual(expect.stringMatching(new RegExp(`^\\[web\\] #${theirs} `)));
  });

  test("a consumer sees its library; the library does not see its consumer", () => {
    const lib = other("lib");
    linkProjects(db, projectId, lib, "uses", NOW);
    const libNote = memory("The pragma helper lives in the library.", "", { projectId: lib });
    expect(search("pragma")).toStartWith(`[lib] #${libNote} `);
    memory("The pragma of the consumer.");
    const fromLib = searchMemories({ ...context(), projectId: lib }, { query: "pragma" });
    expect(fromLib).toBe(
      `#${libNote} [decision · 2026-10-03] The pragma helper lives in the library.`,
    );
  });

  test("a suggested or rejected link adds nothing", () => {
    const web = other("web");
    db.run(
      "INSERT INTO project_links (from_project, to_project, kind, status, origin, signals, created_at) VALUES (?, ?, 'product', 'suggested', 'suggested', '[]', 1)",
      [projectId, web],
    );
    memory("The pragma order matters on the web.", "", { projectId: web });
    expect(search("pragma")).toBe("No memories match.");
  });

  test("an empty query lists the group's most important notes", () => {
    const web = other("web");
    linkProjects(db, projectId, web, "product", NOW);
    const major = memory("Never mock the database.", "", { importance: 5, projectId: web });
    expect(search("").split("\n")[0]).toStartWith(`[web] #${major} `);
  });

  test("the project argument narrows to this project or one linked project", () => {
    const web = other("web");
    linkProjects(db, projectId, web, "product", NOW);
    const own = memory("The pragma order matters here.");
    const theirs = memory("The pragma order matters on the web.", "", { projectId: web });
    expect(searchMemories(context(), { query: "pragma", project: "web" })).toBe(
      search("pragma")
        .split("\n")
        .filter((line) => line.includes(`#${theirs} `))
        .join("\n"),
    );
    // This project alone reads as it always has, without a label.
    expect(searchMemories(context(), { query: "pragma", project: "Project" })).toStartWith(
      `#${own} `,
    );
    const stranger = other("stranger");
    memory("The pragma of a stranger.", "", { projectId: stranger });
    expect(searchMemories(context(), { query: "pragma", project: "stranger" })).toBe(
      "No project called “stranger” here. This project and its linked ones: project, web.",
    );
  });

  test("--global is unchanged: a named project is searched alone", () => {
    const web = other("web");
    linkProjects(db, projectId, web, "product", NOW);
    memory("The pragma order matters here.");
    memory("The pragma order matters on the web.", "", { projectId: web });
    const out = globalSearch(db, NOW, { query: "pragma", project: "project" });
    expect(out.split("\n")).toHaveLength(1);
    expect(out).toStartWith("#");
    expect(out).toContain("matters here");
  });

  test("memory_get reads a linked project's memory and names it", () => {
    const web = other("web");
    linkProjects(db, projectId, web, "product", NOW);
    const theirs = memory("The web caches for a day.", "", { projectId: web });
    expect(getMemories(context(), { ids: [theirs] })).toStartWith(`[web] - #${theirs} `);
  });
});

describe("memory_get", () => {
  test("returns the whole note and counts as a use", () => {
    const id = memory("The pragma busy_timeout must come first.", "Otherwise queries fail.", {
      kind: "gotcha",
    });
    expect(getMemories(context(), { ids: [id] })).toBe(
      `- #${id} [gotcha · 2026-10-03] The pragma busy_timeout must come first.\n  Otherwise queries fail.`,
    );
    expect(db.query("SELECT use_count, last_used_at FROM memories WHERE id = ?").get(id)).toEqual({
      use_count: 1,
      last_used_at: NOW,
    });
  });

  test("says which ids it could not find, including another project's", () => {
    const other = join(base, "other");
    mkdirSync(other);
    const foreign = memory("Elsewhere.", "", { projectId: resolveProject(db, other, NOW).id });
    const id = memory("Here.");
    const out = getMemories(context(), { ids: [id, foreign, 9999] });
    expect(out).toContain(`- #${id} `);
    expect(out).toContain(`Not found in this project: #${foreign}, #9999`);
    expect(out).not.toContain("Elsewhere.");
  });
});

describe("memory_save", () => {
  const save = (text: string, kind: MemoryKind = "convention", extra: { files?: string[] } = {}) =>
    saveMemory(context(), { text, kind, ...extra });
  const stored = () =>
    db
      .query<
        {
          kind: string;
          title: string;
          body: string;
          origin: string;
          importance: number;
          status: string;
          evidence_count: number;
        },
        []
      >(
        "SELECT kind, title, body, origin, importance, status, evidence_count FROM memories ORDER BY id",
      )
      .all();

  test("with the semantic model, a saved memory gets its vector", async () => {
    mkdirSync(join(dataDir, "models"), { recursive: true });
    copyFileSync(join(import.meta.dir, "../fixtures/embed/subset.wcpack"), modelPath(dataDir));
    const model = loadModel({ dataDir, env: {} });
    expect(model).not.toBeNull();
    const out = await saveMemory(
      { ...context(), model },
      { text: "Never mock the database in these tests.", kind: "convention" },
    );
    expect(out).toStartWith("Saved as #");
    expect(db.query("SELECT model FROM memory_vectors").all()).toEqual([{ model: model?.id }]);
  });

  test("stores what the agent was told to remember, title first", async () => {
    expect(
      await save(
        "We always test against a real SQLite file. Mocks hid a migration bug once.",
        "convention",
        {
          files: ["tests/integration/db.test.ts"],
        },
      ),
    ).toBe("Saved as #1.");
    expect(stored()).toEqual([
      {
        kind: "convention",
        title: "We always test against a real SQLite file.",
        body: "Mocks hid a migration bug once.",
        origin: "manual",
        importance: 3,
        status: "active",
        evidence_count: 1,
      },
    ]);
    expect(db.query("SELECT path, role FROM memory_files").all()).toEqual([
      { path: "tests/integration/db.test.ts", role: "changed" },
    ]);
    expect(search("mocks")).toContain("#1 ");
  });

  test("file paths are kept relative to the project, whatever form they arrive in", async () => {
    mkdirSync(join(project, "src"));
    writeFileSync(join(project, "src/db.ts"), "");
    await save("We open the database in WAL mode for the hooks.", "decision", {
      files: [
        join(project, "src/db.ts"),
        "./src/other.ts",
        "/etc/passwd",
        `src/${"x".repeat(600)}.ts`,
        ["config/AWS_SECRET_ACCESS_KEY=", "abcd1234efgh5678ijkl"].join(""),
      ],
    });
    expect(db.query("SELECT path FROM memory_files ORDER BY path").all()).toEqual([
      { path: "src/db.ts" },
      { path: "src/other.ts" },
    ]);
    expect(JSON.stringify(db.query("SELECT terms FROM memories").all())).not.toContain("abcd1234");
  });

  test("a note saved with a file that exists is not marked stale", async () => {
    mkdirSync(join(project, "src"));
    writeFileSync(join(project, "src/db.ts"), "");
    await save("We open the database in WAL mode for the hooks.", "decision", {
      files: [join(project, "src/db.ts")],
    });
    refreshStaleness(db, projectId);
    expect(db.query("SELECT stale FROM memories").all()).toEqual([{ stale: 0 }]);
  });

  test("a short note is kept as it is", async () => {
    await save("We use pnpm.");
    expect(stored()[0]).toMatchObject({ title: "We use pnpm.", body: "" });
  });

  test("secrets are removed before anything is stored", async () => {
    const token = ["ghp_", "0123456789abcdefghijklmnopqrstuvwxyzAB"].join("");
    await save(`The deploy token is ${token} and it rotates monthly.`, "discovery");
    const all = JSON.stringify(db.query("SELECT * FROM memories").all());
    expect(all).not.toContain(token);
    expect(all).toContain("[REDACTED:github-token]");
  });

  test("saving what is already known adds evidence instead of a copy", async () => {
    await save("We always test against a real SQLite file, never a mock.");
    expect(await save("We always test against a real SQLite file, never a mock.")).toBe(
      "Already known as #1; counted as further evidence.",
    );
    expect(stored()).toHaveLength(1);
    expect(stored()[0]?.evidence_count).toBe(2);
  });

  test("saving what replaces an older note supersedes it", async () => {
    await save("The retry limit is three attempts for upstream calls.", "decision");
    expect(
      await save(
        "The retry limit is five attempts for upstream calls; it is no longer three.",
        "decision",
      ),
    ).toBe("Saved as #2, replacing #1.");
    expect(stored().map((row) => row.status)).toEqual(["superseded", "active"]);
  });

  test("refuses to save nothing", async () => {
    expect(await save("   ")).toBe("Nothing to save: the text is empty.");
    expect(stored()).toEqual([]);
  });
});

describe("wizardingcode-mem mcp", () => {
  test("speaks MCP over stdio: three tools, and a save can be searched and fetched", async () => {
    const main = new URL("../../src/cli/main.ts", import.meta.url).pathname;
    const proc = Bun.spawn([process.execPath, main, "mcp"], {
      cwd: project,
      env: { ...process.env, WIZARDINGCODE_MEM_DATA_DIR: dataDir },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let nextId = 0;
    const request = async (method: string, params: Record<string, unknown>) => {
      const id = ++nextId;
      proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      proc.stdin.flush();
      for (;;) {
        const newline = buffer.indexOf("\n");
        if (newline === -1) {
          const { value, done } = await reader.read();
          if (done) throw new Error("server closed its output");
          buffer += decoder.decode(value, { stream: true });
          continue;
        }
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        const message = JSON.parse(line) as { id?: number; result?: Record<string, unknown> };
        if (message.id === id) return message.result ?? {};
      }
    };
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = await request("tools/call", { name, arguments: args });
      return (result.content as { text: string }[])[0]?.text;
    };

    try {
      await request("initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test", version: "0" },
      });
      proc.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
      );

      const tools = (await request("tools/list", {})).tools as { name: string }[];
      expect(tools.map((tool) => tool.name).sort()).toEqual([
        "history_search",
        "memory_get",
        "memory_save",
        "memory_search",
        "project_links",
      ]);

      expect(
        await call("memory_save", {
          text: "The staging database is rebuilt every night. Never keep data there.",
          kind: "gotcha",
        }),
      ).toBe("Saved as #1.");
      expect(await call("memory_search", { query: "staging" })).toStartWith("#1 [gotcha");
      expect(await call("memory_get", { ids: [1] })).toContain("Never keep data there.");
      expect(await call("project_links", { action: "list" })).toBe(
        "No linked projects and no suggestions for project.",
      );
    } finally {
      proc.stdin.end();
    }
    expect(await proc.exited).toBe(0);
    expect(await new Response(proc.stderr).text()).toBe("");
  }, 30_000);
});
