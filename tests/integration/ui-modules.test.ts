import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { memory } from "../../src/modules/memory/index.ts";
import { startUi, type UiServer } from "../../src/ui/server.ts";
import { ECHO_VIEW, echo } from "../fixtures/echo-module.ts";

// The viewer asks which modules are on and draws their views in the rail.

let base: string;
let server: UiServer | undefined;

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "wizardingcode-mem-ui-modules-")));
});
afterEach(async () => {
  await server?.stop();
  server = undefined;
  rmSync(base, { recursive: true, force: true });
});

const start = async (env: Record<string, string | undefined>) => {
  server = await startUi({
    dataDir: join(base, "data"),
    port: 0,
    open: false,
    env: { WIZARDINGCODE_MEM_STORE_DIR: undefined, ...env },
    modules: [memory, echo],
  });
  return server;
};
const modules = async (s: UiServer) => {
  const response = await fetch(`${s.origin}/api/modules`, {
    headers: { Authorization: `Bearer ${s.token}` },
  });
  expect(response.status).toBe(200);
  return (await response.json()) as { id: string; name: string; views: unknown[] }[];
};

describe("GET /api/modules", () => {
  test("memory alone: its id, its name and today's five views", async () => {
    const s = await start({});
    expect(await modules(s)).toEqual([{ id: "memory", name: "Memory", views: memory.views ?? [] }]);
  });

  test("the fixture's view appears only when it is on, after memory's", async () => {
    const s = await start({ WIZARDINGCODE_MODULES: "memory,echo" });
    const on = await modules(s);
    expect(on.map((m) => m.id)).toEqual(["memory", "echo"]);
    expect(on[1]?.views).toEqual([ECHO_VIEW]);
  });

  test("a module that is off shows nothing, and memory cannot be off", async () => {
    const s = await start({ WIZARDINGCODE_MODULES: "echo" });
    expect((await modules(s)).map((m) => m.id)).toEqual(["memory", "echo"]);
    const alone = await start({ WIZARDINGCODE_MODULES: "knowledge" });
    expect((await modules(alone)).map((m) => m.id)).toEqual(["memory"]);
  });

  test("behind the token, like every other route", async () => {
    const s = await start({});
    expect((await fetch(`${s.origin}/api/modules`)).status).toBe(401);
    expect((await fetch(`${s.origin}/api/modules?token=wrong`)).status).toBe(401);
  });
});
