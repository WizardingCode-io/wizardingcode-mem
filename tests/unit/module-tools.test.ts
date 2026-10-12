import { describe, expect, test } from "bun:test";
import { enabledModules } from "../../src/engine/modules.ts";
import { moduleTools } from "../../src/mcp/run.ts";
import { memory } from "../../src/modules/memory/index.ts";
import { echo, echoModule } from "../fixtures/echo-module.ts";

// The MCP server and the OpenCode bridge offer the enabled modules' tools, in module order.

const PROJECT = ["memory_search", "memory_get", "memory_save", "history_search", "project_links"];
const GLOBAL = ["memory_search", "memory_get", "memory_save", "history_search", "memory_projects"];
const names = async (...args: Parameters<typeof moduleTools>) =>
  (await moduleTools(...args)).map((tool) => tool.name);

describe("tools come from the modules", () => {
  test("memory alone offers today's tools, in today's order", async () => {
    expect(await names([memory], "project")).toEqual(PROJECT);
    expect(await names([memory], "global")).toEqual(GLOBAL);
  });

  test("the fixture's tool comes after memory's, only when it is on", async () => {
    const both = [memory, echo];
    expect(
      await names(
        enabledModules("memory,echo", both, () => {}),
        "project",
      ),
    ).toEqual([...PROJECT, "echo_say"]);
    expect(
      await names(
        enabledModules("memory", both, () => {}),
        "project",
      ),
    ).toEqual(PROJECT);
    expect(
      await names(
        enabledModules("echo", both, () => {}),
        "project",
      ),
    ).toEqual([...PROJECT, "echo_say"]);
  });

  test("global mode is unchanged by a module without global tools", async () => {
    expect(await names([memory, echo], "global")).toEqual(GLOBAL);
  });

  test("a module whose tools throw offers none; the others keep theirs", async () => {
    const errors: string[] = [];
    const tools = await moduleTools([memory, echoModule({ toolsThrow: true })], "project", (id) =>
      errors.push(id),
    );
    expect(tools.map((tool) => tool.name)).toEqual(PROJECT);
    expect(errors).toEqual(["echo"]);
  });

  test("a name already taken by an earlier module is not offered twice", async () => {
    const twin = { ...echoModule({ id: "twin" }) };
    const tools = await moduleTools([echo, twin], "project", () => {});
    expect(tools.map((tool) => tool.name)).toEqual(["echo_say"]);
  });

  test("a module's tool runs with the call's project", async () => {
    const [say] = await moduleTools([echo], "project");
    const parsed = say?.inputSchema.safeParse({ text: "hi" });
    expect(parsed?.success).toBe(true);
    expect(await say?.run(parsed?.data, { projectDir: "/p" })).toBe("hi (in /p)");
  });

  test("memory's views are today's rail, in order", () => {
    expect(memory.views).toEqual([
      { tab: "memories", label: "Memories", icon: "i-lucide-sticky-note", key: "1" },
      { tab: "turns", label: "Turns", icon: "i-lucide-history", key: "2" },
      { tab: "overview", label: "Overview", icon: "i-lucide-chart-column", key: "3" },
      { tab: "history", label: "History", icon: "i-lucide-messages-square", key: "4" },
      { tab: "projects", label: "Across projects", icon: "i-lucide-link-2", key: "6" },
    ]);
  });
});
