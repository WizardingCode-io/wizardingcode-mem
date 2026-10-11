import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveProject } from "../../src/core/project.ts";
import { redact } from "../../src/core/redact.ts";
import { openHistoryDb } from "../../src/history/db.ts";
import { openDb } from "../../src/store/db.ts";
import { insertMemory } from "../../src/store/memories.ts";
import { runCliWith } from "../helpers/cli.ts";

let base: string;
let dataDir: string;
let project: string;

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "wizardingcode-mem-tool-cli-")));
  dataDir = join(base, "data");
  project = join(base, "project");
  mkdirSync(project);
  const db = openDb({ dataDir, busyTimeoutMs: 2000 });
  const { id } = resolveProject(db, project, 1_700_000_000_000);
  insertMemory(db, {
    projectId: id,
    kind: "convention",
    title: "The request limit is five per minute.",
    body: redact("Raised from three after the outage.", { env: {} }),
    terms: "",
    importance: 3,
    branch: null,
    commit: null,
    origin: "manual",
    judge: "heuristic",
    judgeVersion: "1",
    sourceTurnId: null,
    files: [],
    now: 1_700_000_000_000,
  });
  db.close();
});
afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

const tool = (name: string, args: unknown, ...flags: string[]) =>
  runCliWith(
    { input: JSON.stringify(args), env: { WIZARDINGCODE_MEM_DATA_DIR: dataDir } },
    "tool",
    name,
    "--project",
    project,
    ...flags,
  );

describe("wizardingcode-mem tool", () => {
  test("memory_search answers like the MCP tool, for the project given", async () => {
    const result = await tool("memory_search", { query: "limit" });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("The request limit is five per minute.");
  });

  test("memory_get reads notes in full, and memory_save stores one", async () => {
    const saved = await tool("memory_save", {
      text: "Never deploy on Fridays. Support is thin at the weekend.",
      kind: "convention",
    });
    expect(saved.exitCode).toBe(0);
    expect(saved.stdout).toMatch(/saved/i);
    const got = await tool("memory_get", { ids: [1] });
    expect(got.stdout).toContain("Raised from three after the outage.");
  });

  test("arguments that do not fit the tool are a usage error that names the problem", async () => {
    const result = await tool("memory_get", { ids: "one" });
    expect(result.exitCode).toBe(64);
    expect(result.stderr).toContain("ids");
  });

  test("an unknown tool, or no --project, is a usage error", async () => {
    expect((await tool("memory_forget", {})).exitCode).toBe(64);
    const noProject = await runCliWith(
      { input: "{}", env: { WIZARDINGCODE_MEM_DATA_DIR: dataDir } },
      "tool",
      "memory_search",
    );
    expect(noProject.exitCode).toBe(64);
    expect(noProject.stderr).toContain("--project");
  });
});

/** A history index in the data dir with one turn for `projectId` and one for another project. */
function seedHistory(projectId: number) {
  const hdb = openHistoryDb(dataDir, { create: true });
  if (hdb === null) throw new Error("no history db");
  hdb.run(
    "INSERT INTO files(path, agent, size, mtime, indexed_at) VALUES ('/t', 'codex', 1, 1, 1)",
  );
  const turn = (id: number, pid: number | null, name: string, prompt: string) =>
    hdb.run(
      `INSERT INTO turns(id, path, agent, session_id, turn_id, project_id, project_name, cwd, started_at, ended_at, prompt, final_text)
       VALUES (?, '/t', 'codex', 's' || ?, 't' || ?, ?, ?, '/x', 1700000000000, 1700000000000, ?, 'Done.')`,
      [id, id, id, pid, name, prompt],
    );
  turn(1, projectId, "project", "Why is the zebra cache cold?");
  turn(2, 999, "elsewhere", "The zebra migration plan.");
  hdb.close();
}

const NO_INDEX =
  "No past conversations are indexed yet. The user can run: wizardingcode-mem history import";

describe("history_search", () => {
  test("without an index it says how to build one, and creates nothing", async () => {
    const result = await tool("history_search", { query: "zebra" });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(NO_INDEX);
    expect(existsSync(join(dataDir, "history.db"))).toBe(false);
  });

  test("in a project it finds that project's turns only", async () => {
    seedHistory(1);
    const result = await tool("history_search", { query: "zebra" });
    expect(result.stdout).toContain("zebra cache");
    expect(result.stdout).not.toContain("migration plan");
  });

  test("a query that matches nothing says so", async () => {
    seedHistory(1);
    expect((await tool("history_search", { query: "giraffe" })).stdout).toContain("No ");
  });
});

describe("wizardingcode-mem tool --global (Claude Desktop's chat: every project)", () => {
  const global = (name: string, args: unknown) =>
    runCliWith(
      { input: JSON.stringify(args), env: { WIZARDINGCODE_MEM_DATA_DIR: dataDir } },
      "tool",
      name,
      "--global",
    );

  test("memory_search finds across projects and names the project", async () => {
    const result = await global("memory_search", { query: "limit" });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("[project]");
    expect(result.stdout).toContain("The request limit is five per minute.");
  });

  test("memory_projects lists the projects; memory_save needs one", async () => {
    expect((await global("memory_projects", {})).stdout).toContain("project · 1 memory");
    expect(
      (await global("memory_save", { text: "Buttons are violet.", kind: "convention" })).stdout,
    ).toContain("Say which project");
    expect(
      (
        await global("memory_save", {
          text: "Buttons are violet. Brand rule.",
          kind: "convention",
          project: "project",
        })
      ).stdout,
    ).toMatch(/Saved as #\d+ in project\./);
  });

  test("history_search spans projects, or one by name, and names each project", async () => {
    seedHistory(1);
    const all = await global("history_search", { query: "zebra" });
    expect(all.stdout).toContain("project (");
    expect(all.stdout).toContain("elsewhere (");
    const one = await global("history_search", { query: "zebra", project: "elsewhere" });
    expect(one.stdout).toContain("migration plan");
    expect(one.stdout).not.toContain("zebra cache");
  });

  test("history_search without an index returns the plain sentence", async () => {
    expect((await global("history_search", { query: "zebra" })).stdout.trim()).toBe(NO_INDEX);
  });
});
