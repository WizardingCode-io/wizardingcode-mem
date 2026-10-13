import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliWith } from "../helpers/cli.ts";

// What an agent is offered, pinned from the code before the tools came from the modules:
// with memory alone, the MCP tool lists (inside a project and with --global: names,
// titles, descriptions, schemas, order) and the names the OpenCode bridge accepts never change.

const MAIN = new URL("../../src/cli/main.ts", import.meta.url).pathname;

let base: string;
let env: Record<string, string>;

beforeAll(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "wizardingcode-mem-tools-list-")));
  mkdirSync(join(base, "project"));
  env = {
    WIZARDINGCODE_MEM_DATA_DIR: join(base, "data"),
    WIZARDINGCODE_HOME: join(base, "home"),
    WIZARDINGCODE_MEM_STORE_DIR: join(base, "store"),
    WIZARDINGCODE_MEM_MIGRATE: "off",
    WIZARDINGCODE_MODULES: "", // blank means the default, memory
    // Whatever the shell has, nothing here can reach a real home or a real store.
    HOME: join(base, "home"),
    USERPROFILE: join(base, "home"),
  };
});
afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

/** Starts `mcp`, asks for its tools over stdio and returns the reply's `result`. */
async function listTools(...flags: string[]): Promise<{ tools: unknown[] }> {
  const lines = [
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test", version: "0" },
      },
    },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
  ];
  const proc = Bun.spawn([process.execPath, MAIN, "mcp", ...flags], {
    cwd: join(base, "project"),
    env: { ...process.env, ...env, CLAUDE_PROJECT_DIR: join(base, "project") },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  for (const line of lines) proc.stdin.write(`${JSON.stringify(line)}\n`);
  await proc.stdin.flush();
  const reader = proc.stdout.getReader();
  let buffered = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) throw new Error(`mcp ended early: ${buffered}`);
      buffered += new TextDecoder().decode(value);
      for (const line of buffered.split("\n")) {
        if (line.trim() === "") continue;
        const message = JSON.parse(line) as { id?: number; result?: { tools: unknown[] } };
        if (message.id === 2 && message.result !== undefined) return message.result;
      }
    }
  } finally {
    proc.stdin.end();
    proc.kill();
    await proc.exited;
  }
}

describe("MCP tool list with memory alone", () => {
  test("inside a project", async () => {
    expect(await listTools()).toMatchSnapshot();
  }, 20_000);

  test("with --global", async () => {
    expect(await listTools("--global")).toMatchSnapshot();
  }, 20_000);
});

describe("the OpenCode bridge's names with memory alone", () => {
  const usage = async (...args: string[]) =>
    (await runCliWith({ input: "{}", env }, "tool", ...args)).stderr;

  test("an unknown name is refused with the names it accepts", async () => {
    expect(await usage("nope", "--project", join(base, "project"))).toMatchSnapshot();
  });

  const accepted = async (name: string, ...flags: string[]) =>
    !(await usage(name, ...flags)).includes("unknown tool");

  test("inside a project it accepts exactly these names", async () => {
    const names = [
      "memory_search",
      "memory_get",
      "memory_save",
      "history_search",
      "project_links",
      "memory_projects",
    ];
    const flags = ["--project", join(base, "project")];
    const result: Record<string, boolean> = {};
    for (const name of names) result[name] = await accepted(name, ...flags);
    expect(result).toEqual({
      memory_search: true,
      memory_get: true,
      memory_save: true,
      history_search: true,
      project_links: true,
      memory_projects: false,
    });
  }, 30_000);

  test("with --global it accepts exactly these names", async () => {
    const names = [
      "memory_search",
      "memory_get",
      "memory_save",
      "history_search",
      "memory_projects",
      "project_links",
    ];
    const result: Record<string, boolean> = {};
    for (const name of names) result[name] = await accepted(name, "--global");
    expect(result).toEqual({
      memory_search: true,
      memory_get: true,
      memory_save: true,
      history_search: true,
      memory_projects: true,
      project_links: false,
    });
  }, 30_000);
});

describe("the bridge follows the setting", () => {
  test("a list without memory still offers memory's tools (memory is always on)", async () => {
    const result = await runCliWith(
      {
        input: JSON.stringify({ query: "x" }),
        env: { ...env, WIZARDINGCODE_MODULES: "knowledge" },
      },
      "tool",
      "memory_search",
      "--project",
      join(base, "project"),
    );
    expect(result.stderr).not.toContain("unknown tool");
  });
});
