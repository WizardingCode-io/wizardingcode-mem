import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { PLUGIN_MARKER, pluginSource } from "../../src/install/opencode-plugin.ts";

// The plugin runs inside OpenCode. Here it runs against a fake OpenCode: a recorded
// runner in place of the binary, a canned message store in place of the SDK client.

interface Call {
  args: string[];
  stdin: unknown;
}

let dir: string;
let calls: Call[];
let answers: Record<string, string>;
let messages: unknown[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wizardingcode-mem-opencode-plugin-"));
  calls = [];
  answers = {};
  messages = [];
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

// OpenCode's `tool` keeps the definition and exposes zod as `tool.schema`.
const fakeTool = Object.assign((definition: unknown) => ({ definition }), { schema: z });

// The plugin is untyped JavaScript inside OpenCode; the test calls its hooks loosely.
type Hook = (...args: unknown[]) => Promise<unknown>;
interface Hooks {
  event: Hook;
  "chat.message": Hook;
  "experimental.chat.system.transform": Hook;
  tool: Record<
    string,
    {
      definition: {
        args: Record<string, unknown>;
        execute: (args: unknown, ctx: unknown) => Promise<string>;
      };
    }
  >;
}

async function load(): Promise<Hooks> {
  const path = join(dir, "wizardingcode-mem.ts");
  writeFileSync(
    path,
    pluginSource("/opt/wizardingcode-mem/bin/wizardingcode-mem", { exportFactory: true }),
  );
  const mod = (await import(path)) as {
    createPlugin: (deps: unknown) => (input: unknown) => Promise<Record<string, unknown>>;
  };
  const run = async (args: string[], stdin: string) => {
    calls.push({ args, stdin: JSON.parse(stdin) });
    // [bin, "hook", "opencode", <event>] or [bin, "tool", <name>, ...]
    return answers[args[1] === "hook" ? (args[3] ?? "") : (args[2] ?? "")] ?? "";
  };
  const client = { session: { messages: async () => ({ data: messages }) } };
  return (await mod.createPlugin({ run, tool: fakeTool })({
    directory: "/Users/dev/project",
    client,
  })) as unknown as Hooks;
}

const BIN = "/opt/wizardingcode-mem/bin/wizardingcode-mem";
const SESSION = "ses_1";

describe("the OpenCode plugin", () => {
  test("the generated file carries the binary path and a marker to recognise it by", () => {
    const source = pluginSource(BIN);
    expect(source).toContain(PLUGIN_MARKER);
    expect(source).toContain(JSON.stringify(BIN));
    expect(source).not.toContain("export function createPlugin");
    expect(source).toContain("export const WizardingCodeMem");
  });

  test("a created session starts one in wizardingcode-mem, and its brief goes into the system prompt", async () => {
    answers["session-start"] = "<wizardingcode-mem-notes>brief</wizardingcode-mem-notes>";
    const hooks = await load();
    await hooks.event({
      event: {
        type: "session.created",
        properties: { sessionID: SESSION, info: { directory: "/Users/dev/project" } },
      },
    });
    expect(calls).toEqual([
      {
        args: [BIN, "hook", "opencode", "session-start"],
        stdin: { session_id: SESSION, cwd: "/Users/dev/project", source: "startup" },
      },
    ]);
    const output = { system: ["You are opencode."] };
    await hooks["experimental.chat.system.transform"]({ sessionID: SESSION }, output);
    expect(output.system).toEqual([
      "You are opencode.",
      "<wizardingcode-mem-notes>brief</wizardingcode-mem-notes>",
    ]);
  });

  test("a user message opens a turn named by its id, and the notes replace the previous turn's", async () => {
    const hooks = await load();
    answers.prompt = "notes for turn one";
    await hooks["chat.message"](
      { sessionID: SESSION },
      {
        message: { id: "msg_1", role: "user" },
        parts: [
          { type: "text", text: "why does " },
          { type: "file" },
          { type: "text", text: "it fail?" },
        ],
      },
    );
    expect(calls.at(-1)).toEqual({
      args: [BIN, "hook", "opencode", "prompt"],
      stdin: {
        session_id: SESSION,
        cwd: "/Users/dev/project",
        turn_id: "msg_1",
        prompt: "why does \nit fail?",
      },
    });
    answers.prompt = "notes for turn two";
    await hooks["chat.message"](
      { sessionID: SESSION },
      { message: { id: "msg_2", role: "user" }, parts: [{ type: "text", text: "and now?" }] },
    );
    const output = { system: [] as string[] };
    await hooks["experimental.chat.system.transform"]({ sessionID: SESSION }, output);
    expect(output.system).toEqual(["notes for turn two"]);
  });

  test("an idle session ends the turn with the assistant's last text, under the user message's id", async () => {
    const hooks = await load();
    messages = [
      { info: { id: "msg_1", role: "user" }, parts: [{ type: "text", text: "fix it" }] },
      {
        info: { id: "msg_2", role: "assistant" },
        parts: [
          { type: "reasoning", text: "hmm" },
          { type: "text", text: "Fixed: " },
          { type: "tool" },
          { type: "text", text: "the limit." },
        ],
      },
    ];
    await hooks.event({ event: { type: "session.idle", properties: { sessionID: SESSION } } });
    expect(calls).toEqual([
      {
        args: [BIN, "hook", "opencode", "turn-end"],
        stdin: {
          session_id: SESSION,
          cwd: "/Users/dev/project",
          turn_id: "msg_1",
          last_assistant_message: "Fixed: \nthe limit.",
        },
      },
    ]);
  });

  test("an idle session with no assistant answer ends the turn without a message", async () => {
    const hooks = await load();
    messages = [{ info: { id: "msg_1", role: "user" }, parts: [{ type: "text", text: "fix it" }] }];
    await hooks.event({ event: { type: "session.idle", properties: { sessionID: SESSION } } });
    expect(calls[0]?.stdin).toMatchObject({ turn_id: "msg_1", last_assistant_message: null });
  });

  test("other events, and a failing client, do nothing and never throw", async () => {
    const hooks = await load();
    await hooks.event({ event: { type: "message.updated", properties: {} } });
    messages = null as never;
    await hooks.event({ event: { type: "session.idle", properties: { sessionID: SESSION } } });
    expect(calls).toEqual([]);
  });

  test("defines the memory tools and history_search, each running the binary for the session's project", async () => {
    const hooks = await load();
    expect(Object.keys(hooks.tool).sort()).toEqual([
      "history_search",
      "knowledge_get",
      "knowledge_save",
      "knowledge_search",
      "knowledge_update",
      "memory_get",
      "memory_save",
      "memory_search",
      "project_links",
    ]);
    answers.memory_search = "#1 The limit is five.";
    const search = hooks.tool.memory_search;
    if (search === undefined) throw new Error("memory_search missing");
    const result = await search.definition.execute({ query: "limit" }, { sessionID: SESSION });
    expect(result).toBe("#1 The limit is five.");
    expect(calls.at(-1)).toEqual({
      args: [BIN, "tool", "memory_search", "--project", "/Users/dev/project"],
      stdin: { query: "limit" },
    });
    await search.definition.execute({ query: "limit", project: "web" }, { sessionID: SESSION });
    expect(calls.at(-1)?.stdin).toEqual({ query: "limit", project: "web" });
    expect(Object.keys(search.definition.args)).toContain("project");
    const links = hooks.tool.project_links;
    if (links === undefined) throw new Error("project_links missing");
    expect(Object.keys(links.definition.args).sort()).toEqual(["action", "id", "kind", "project"]);
    await links.definition.execute(
      { action: "link", project: "web", kind: "product" },
      { sessionID: SESSION },
    );
    expect(calls.at(-1)).toEqual({
      args: [BIN, "tool", "project_links", "--project", "/Users/dev/project"],
      stdin: { action: "link", project: "web", kind: "product" },
    });
    const past = hooks.tool.history_search;
    if (past === undefined) throw new Error("history_search missing");
    await past.definition.execute({ query: "zebra", limit: 3 }, { sessionID: SESSION });
    expect(calls.at(-1)).toEqual({
      args: [BIN, "tool", "history_search", "--project", "/Users/dev/project"],
      stdin: { query: "zebra", limit: 3 },
    });
  });

  test("defines knowledge's tools with the spec's arguments, each running the binary", async () => {
    const hooks = await load();
    const args = (name: string) => Object.keys(hooks.tool[name]?.definition.args ?? {}).sort();
    expect(args("knowledge_search")).toEqual(["limit", "query"]);
    expect(args("knowledge_get")).toEqual(["slugs"]);
    expect(args("knowledge_save")).toEqual(["body", "essential", "kind", "slug", "tags", "title"]);
    expect(args("knowledge_update")).toEqual([
      "body",
      "essential",
      "kind",
      "slug",
      "status",
      "tags",
      "title",
    ]);
    for (const name of [
      "knowledge_search",
      "knowledge_get",
      "knowledge_save",
      "knowledge_update",
    ]) {
      const tool = hooks.tool[name];
      if (tool === undefined) throw new Error(`${name} missing`);
      await tool.definition.execute({ slug: "x" }, { sessionID: SESSION });
      expect(calls.at(-1)).toEqual({
        args: [BIN, "tool", name, "--project", "/Users/dev/project"],
        stdin: { slug: "x" },
      });
    }
  });
});

describe("the generated OpenCode package", () => {
  test("is what pluginSource writes, project_links included (bun run plugins)", async () => {
    const generated = await Bun.file(
      new URL("../../plugins/opencode/index.js", import.meta.url).pathname,
    ).text();
    expect(generated).toBe(pluginSource("npm"));
    expect(generated).toContain("project_links: toolApi({");
  });
});
