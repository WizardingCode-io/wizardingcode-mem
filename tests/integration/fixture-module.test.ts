import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeCode } from "../../src/adapters/claude-code/adapter.ts";
import type { AgentAdapter, HookInput } from "../../src/adapters/types.ts";
import { resolveProject } from "../../src/core/project.ts";
import type { Redacted } from "../../src/core/redact.ts";
import type { HookEvent } from "../../src/core/types.ts";
import type { EngineModule } from "../../src/engine/module.ts";
import { enabledModules } from "../../src/engine/modules.ts";
import { handleHook } from "../../src/hooks/handle.ts";
import { memory } from "../../src/modules/memory/index.ts";
import { type Db, openDb } from "../../src/store/db.ts";
import { insertMemory } from "../../src/store/memories.ts";
import { echoModule, echoText } from "../fixtures/echo-module.ts";
import { runCliWith } from "../helpers/cli.ts";

// A second module plugs in through the contract alone: its text comes after memory's,
// within its share, and memory's own text does not change. Each world below is one data
// directory, seeded the same way, so that the same hooks can run with and without it.

/** The context exactly as composed, without an adapter's wrapping. */
const raw: AgentAdapter = { ...claudeCode, render: (_event, context) => context ?? "" };

let base: string;
const worlds: Db[] = [];
beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "wizardingcode-mem-fixture-module-")));
});
afterEach(() => {
  for (const db of worlds.splice(0)) db.close();
  rmSync(base, { recursive: true, force: true });
});

const NOW = Date.UTC(2026, 9, 12);

function seed(db: Db, project: string): void {
  const projectId = resolveProject(db, project, NOW).id;
  const add = (kind: "gotcha" | "fix", title: string, body: string, files: string[]) =>
    insertMemory(db, {
      projectId,
      kind,
      title,
      body: body as Redacted,
      terms: "",
      importance: 4,
      branch: null,
      commit: null,
      origin: "manual",
      judge: "heuristic",
      judgeVersion: "1",
      sourceTurnId: null,
      files: files.map((path) => ({ path, role: "changed" as const })),
      now: NOW,
    });
  add("gotcha", "Run the pinned bun for tests", "The global bun hangs on gzip streams.", []);
  add("fix", "Login token refresh fails after expiry", "Refresh before expiry.", ["src/login.ts"]);
}

/** One world: its own database and project, and a hook runner with the given modules. */
function world(modules: readonly EngineModule[]) {
  const dir = mkdtempSync(join(base, "world-"));
  const project = join(dir, "project");
  mkdirSync(project);
  const db = openDb({ dataDir: join(dir, "data"), busyTimeoutMs: 2000 });
  worlds.push(db);
  seed(db, project);
  let clock = NOW;
  const errors: [string | undefined, unknown][] = [];
  const hook = (event: HookEvent, extra: Partial<HookInput> = {}) => {
    clock += 1000;
    return handleHook(
      {
        db,
        now: () => clock,
        spawnDistill: () => {},
        modules: () => modules,
        onError: (error, scope) => void errors.push([scope, error]),
      },
      raw,
      {
        agent: "claude-code",
        event,
        sessionId: "s1",
        cwd: project,
        turnId: null,
        transcriptPath: null,
        prompt: null,
        finalText: null,
        source: "startup",
        toolFile: null,
        toolError: null,
        subagent: false,
        ...extra,
      },
    );
  };
  return { hook, errors, project };
}

/**
 * The four moments, each with something for memory to say: each in a session of its own,
 * since a note told once is not told again in the same context.
 */
function moments(hook: ReturnType<typeof world>["hook"], project: string): string[] {
  return [
    hook("session-start", { sessionId: "start" }),
    hook("prompt", {
      sessionId: "prompt",
      prompt: "why does the login token refresh fail after expiry",
      source: null,
    }),
    hook("file-read", {
      sessionId: "read",
      toolFile: join(project, "src/login.ts"),
      source: null,
    }),
    hook("tool-failed", {
      sessionId: "failed",
      toolError: "Error: login token refresh fails after expiry",
      source: null,
    }),
  ];
}

describe("a second module", () => {
  test("its text comes after memory's, and memory's text is unchanged", () => {
    const alone = world([memory]);
    const both = world([memory, echoModule()]);
    const expected = moments(alone.hook, alone.project);
    const got = moments(both.hook, both.project);
    // Memory has something to say at every moment, so this compares real text.
    for (const text of expected) expect(text).toContain("<wizardingcode-mem-notes>");
    const names = ["session-start", "prompt", "file-read", "tool-failed"] as const;
    expect(got).toEqual(
      expected.map(
        (text, i) => `${text}\n\n${echoText({ moment: names[i] as (typeof names)[number] })}`,
      ),
    );
    expect(both.errors).toEqual([]);
  });

  test("one that throws on the prompt leaves memory's prompt intact, and still speaks at session start", () => {
    const alone = world([memory]);
    const both = world([memory, echoModule({ throwOn: ["prompt"] })]);
    const expected = moments(alone.hook, alone.project);
    const got = moments(both.hook, both.project);
    expect(got[0]).toBe(`${expected[0]}\n\n${echoText({ moment: "session-start" })}`);
    expect(got[1]).toBe(expected[1] as string);
    expect(both.errors).toHaveLength(1);
    const [scope, error] = both.errors[0] as [string | undefined, unknown];
    expect(scope).toContain("echo");
    expect((error as Error).message).toBe("echo breaks on prompt");
  });

  test("switched off by the setting, it adds nothing", () => {
    const alone = world([memory]);
    const off = world(enabledModules("memory", [memory, echoModule()]));
    expect(moments(off.hook, off.project)).toEqual(moments(alone.hook, alone.project));
  });

  test("a list without memory still injects memory's text", () => {
    const alone = world([memory]);
    const kept = world(enabledModules("personas", [memory], () => {}));
    expect(moments(kept.hook, kept.project)).toEqual(moments(alone.hook, alone.project));
  });
});

describe("WIZARDINGCODE_MODULES through the hook command", () => {
  const startup = (project: string) =>
    JSON.stringify({
      session_id: "205fc789-847d-4d65-a969-6aa483d2fb82",
      cwd: project,
      hook_event_name: "SessionStart",
      source: "startup",
    });

  function dataDir() {
    const dir = join(base, "data");
    const project = join(base, "project");
    mkdirSync(project, { recursive: true });
    const db = openDb({ dataDir: dir, busyTimeoutMs: 5000 });
    seed(db, project);
    db.close();
    return { dir, project };
  }
  const run = (dir: string, project: string, env: Record<string, string> = {}) =>
    runCliWith(
      {
        input: startup(project),
        env: {
          WIZARDINGCODE_MEM_DATA_DIR: dir,
          WIZARDINGCODE_MEM_DISTILL: "off",
          WIZARDINGCODE_MEM_UI_AUTO_OPEN: "off",
          ...env,
        },
      },
      "hook",
      "claude-code",
      "session-start",
    );

  test("unset, memory speaks", async () => {
    const { dir, project } = dataDir();
    const out = await run(dir, project);
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toContain("Run the pinned bun for tests");
  });

  test("a list without memory, from the file: memory still injects, exit 0, the unknown id logged", async () => {
    const { dir, project } = dataDir();
    writeFileSync(join(dir, "env"), "WIZARDINGCODE_MODULES=personas\n");
    const out = await run(dir, project);
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toContain("Run the pinned bun for tests");
    const log = join(dir, "logs", "wizardingcode-mem.log");
    expect(existsSync(log) && readFileSync(log, "utf8")).toContain("unknown module: personas");
  });

  test("the environment wins over the file", async () => {
    const { dir, project } = dataDir();
    writeFileSync(join(dir, "env"), "WIZARDINGCODE_MODULES=personas\n");
    const out = await run(dir, project, { WIZARDINGCODE_MODULES: "memory" });
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toContain("Run the pinned bun for tests");
  });
});
