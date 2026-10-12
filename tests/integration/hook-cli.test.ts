import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveProject } from "../../src/core/project.ts";
import type { Redacted } from "../../src/core/redact.ts";
import { DB_FILE, openDb } from "../../src/store/db.ts";
import { insertMemory } from "../../src/store/memories.ts";
import { runCliWith } from "../helpers/cli.ts";

const FIXTURES = new URL("../fixtures/", import.meta.url).pathname;
const payload = (name: string, agent = "claude-code") =>
  readFileSync(join(FIXTURES, agent, "payloads", `${name}.json`), "utf8");

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wizardingcode-mem-hook-cli-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const hook = (input: string, ...args: string[]) =>
  runCliWith(
    {
      input,
      env: {
        WIZARDINGCODE_MEM_DATA_DIR: dir,
        WIZARDINGCODE_MEM_DISTILL: "off",
        WIZARDINGCODE_MEM_UI_AUTO_OPEN: "off",
      },
    },
    "hook",
    ...args,
  );

function rows<T>(sql: string): T[] {
  const db = new Database(join(dir, DB_FILE), { readonly: true });
  // A reader meeting a writer mid-checkpoint must wait, not fail.
  db.run("PRAGMA busy_timeout = 5000");
  try {
    return db.query<T, []>(sql).all();
  } finally {
    db.close();
  }
}

const SILENT_SUCCESS = { exitCode: 0, stdout: "", stderr: "" };

describe("wizardingcode-mem hook", () => {
  test("a prompt payload from Claude Code is stored, silently", async () => {
    expect(await hook(payload("user-prompt-submit"), "claude-code", "prompt")).toEqual(
      SILENT_SUCCESS,
    );
    expect(rows("SELECT agent_turn_id, state FROM turns")).toEqual([
      { agent_turn_id: "39fa363e-4bbd-4d72-b47f-3c439e8e291f", state: "open" },
    ]);
  });

  test.each([
    ["file-read", "post-tool-use.read"],
    ["tool-failed", "post-tool-use-failure.bash"],
  ])("%s is accepted, silent, opens no turn and is recorded", async (event, fixture) => {
    expect(await hook(payload(fixture), "claude-code", event)).toEqual(SILENT_SUCCESS);
    expect(rows("SELECT event, outcome FROM hook_runs")).toEqual([{ event, outcome: "ok" }]);
    expect(rows("SELECT id FROM turns")).toEqual([]);
  });

  test("a whole turn: prompt then turn end leaves one queued turn", async () => {
    await hook(payload("user-prompt-submit"), "claude-code", "prompt");
    expect(await hook(payload("stop"), "claude-code", "turn-end")).toEqual(SILENT_SUCCESS);
    expect(rows("SELECT state, completeness, final_text FROM turns")).toEqual([
      { state: "pending", completeness: "full", final_text: "done" },
    ]);
  });

  test("a whole turn from Codex, through its own adapter, is stored the same way", async () => {
    await hook(payload("session-start.startup", "codex"), "codex", "session-start");
    await hook(payload("user-prompt-submit", "codex"), "codex", "prompt");
    expect(await hook(payload("stop", "codex"), "codex", "turn-end")).toEqual(SILENT_SUCCESS);
    expect(rows("SELECT agent FROM sessions")).toEqual([{ agent: "codex" }]);
    expect(rows("SELECT agent_turn_id, state, completeness, final_text FROM turns")).toEqual([
      {
        agent_turn_id: "01a10d0a-2d34-7fa2-9d91-bedf67023d6d",
        state: "pending",
        completeness: "full",
        final_text: "done",
      },
    ]);
  });

  test("a whole turn from Qwen Code, through its own adapter, is stored under its prompt_id", async () => {
    await hook(payload("session-start.startup", "qwen"), "qwen", "session-start");
    await hook(payload("user-prompt-submit", "qwen"), "qwen", "prompt");
    expect(await hook(payload("stop", "qwen"), "qwen", "turn-end")).toEqual(SILENT_SUCCESS);
    expect(rows("SELECT agent FROM sessions")).toEqual([{ agent: "qwen" }]);
    expect(rows("SELECT agent_turn_id, state, completeness, final_text FROM turns")).toEqual([
      { agent_turn_id: "prompt-1", state: "pending", completeness: "full", final_text: "done" },
    ]);
  });

  test("a Qwen Code payload missing what is needed is silent success", async () => {
    for (const event of ["session-start", "prompt", "turn-end", "session-end"]) {
      expect(await hook('{"prompt":"x","extra":1}', "qwen", event)).toEqual(SILENT_SUCCESS);
    }
  });

  test("a whole turn from Factory Droid, which names no turn, closes the session's open one", async () => {
    await hook(payload("session-start.startup", "droid"), "droid", "session-start");
    await hook(payload("user-prompt-submit", "droid"), "droid", "prompt");
    expect(await hook(payload("stop", "droid"), "droid", "turn-end")).toEqual(SILENT_SUCCESS);
    expect(rows("SELECT agent FROM sessions")).toEqual([{ agent: "droid" }]);
    expect(rows("SELECT state FROM turns")).toEqual([{ state: "pending" }]);
    expect(rows("SELECT id FROM turns WHERE state = 'open'")).toEqual([]);
  });

  test("a whole turn from the Copilot CLI is captured; its prompt prints nothing", async () => {
    await hook(payload("session-start", "copilot"), "copilot", "session-start");
    expect(await hook(payload("user-prompt-submitted", "copilot"), "copilot", "prompt")).toEqual(
      SILENT_SUCCESS,
    );
    expect(rows("SELECT state FROM turns")).toEqual([{ state: "open" }]);
    expect(await hook(payload("agent-stop", "copilot"), "copilot", "turn-end")).toEqual(
      SILENT_SUCCESS,
    );
    expect(rows("SELECT agent FROM sessions")).toEqual([{ agent: "copilot" }]);
    expect(rows("SELECT state FROM turns")).toHaveLength(1);
    expect(await hook(payload("session-end", "copilot"), "copilot", "session-end")).toEqual(
      SILENT_SUCCESS,
    );
  });

  test("a whole turn from VS Code, through the same hooks, is captured under the same agent", async () => {
    await hook(payload("vscode.session-start", "copilot"), "copilot", "session-start");
    expect(
      await hook(payload("vscode.user-prompt-submit", "copilot"), "copilot", "prompt"),
    ).toEqual(SILENT_SUCCESS);
    expect(await hook(payload("vscode.stop", "copilot"), "copilot", "turn-end")).toEqual(
      SILENT_SUCCESS,
    );
    expect(rows("SELECT agent FROM sessions")).toEqual([{ agent: "copilot" }]);
    expect(rows("SELECT state FROM turns")).toHaveLength(1);
  });

  test("a Copilot session start answers each host in its own shape", async () => {
    const project = join(dir, "copilot-project");
    mkdirSync(project);
    const db = openDb({ dataDir: dir, busyTimeoutMs: 5000 });
    insertMemory(db, {
      projectId: resolveProject(db, project, Date.now()).id,
      kind: "gotcha",
      title: "Run the pinned bun",
      body: "The global one hangs on gzip streams." as Redacted,
      terms: "",
      importance: 4,
      branch: null,
      commit: null,
      origin: "manual",
      judge: "heuristic",
      judgeVersion: "1",
      sourceTurnId: null,
      files: [],
      now: Date.now(),
    });
    db.close();
    const at = (name: string, session: string) =>
      JSON.stringify({
        ...JSON.parse(payload(name, "copilot")),
        cwd: project,
        ...(name.startsWith("vscode.") ? { session_id: session } : { sessionId: session }),
      });

    const cli = await hook(at("session-start", "cli-1"), "copilot", "session-start");
    expect(cli.exitCode).toBe(0);
    expect(JSON.parse(cli.stdout).additionalContext).toContain("Run the pinned bun");

    const vscode = await hook(at("vscode.session-start", "vs-1"), "copilot", "session-start");
    expect(vscode.exitCode).toBe(0);
    const out = JSON.parse(vscode.stdout);
    expect(out.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(out.hookSpecificOutput.additionalContext).toContain("Run the pinned bun");
    expect(out.additionalContext).toBeUndefined();

    expect(
      await hook(
        at("vscode.user-prompt-submit", "vs-1").replace("hello.txt", "bun"),
        "copilot",
        "prompt",
      ),
    ).toEqual(SILENT_SUCCESS);
  });

  test("an Antigravity conversation gets the brief before its first model call only", async () => {
    const project = join(dir, "antigravity-project");
    mkdirSync(project);
    const db = openDb({ dataDir: dir, busyTimeoutMs: 5000 });
    insertMemory(db, {
      projectId: resolveProject(db, project, Date.now()).id,
      kind: "gotcha",
      title: "Run the pinned bun",
      body: "The global one hangs on gzip streams." as Redacted,
      terms: "",
      importance: 4,
      branch: null,
      commit: null,
      origin: "manual",
      judge: "heuristic",
      judgeVersion: "1",
      sourceTurnId: null,
      files: [],
      now: Date.now(),
    });
    db.close();
    const at = (name: string, change: Record<string, unknown> = {}) =>
      JSON.stringify({
        ...JSON.parse(payload(name, "antigravity")),
        workspacePaths: [project],
        ...change,
      });

    const first = await hook(at("pre-invocation.first"), "antigravity", "session-start");
    expect(first.exitCode).toBe(0);
    expect(first.stderr).toBe("");
    const out = JSON.parse(first.stdout);
    expect(Object.keys(out)).toEqual(["injectSteps"]);
    expect(out.injectSteps).toHaveLength(1);
    expect(Object.keys(out.injectSteps[0])).toEqual(["ephemeralMessage"]);
    expect(out.injectSteps[0].ephemeralMessage).toContain("Run the pinned bun");

    // Every later model call of the conversation, in this turn or the next, is silent.
    for (const invocationNum of [1, 2, 7]) {
      expect(
        await hook(at("pre-invocation.first", { invocationNum }), "antigravity", "session-start"),
      ).toEqual(SILENT_SUCCESS);
    }
    // Stop's `decision` is documented as required: ours always allows the stop.
    expect(await hook(at("stop"), "antigravity", "turn-end")).toEqual({
      exitCode: 0,
      stdout: '{"decision":"stop"}',
      stderr: "",
    });
    expect(rows("SELECT agent FROM sessions")).toEqual([{ agent: "antigravity" }]);
    // Nothing of the turn reaches us, so nothing is queued to distil.
    expect(rows("SELECT id FROM turns")).toEqual([]);
  });

  test("an Antigravity payload missing what is needed is silent success", async () => {
    for (const event of ["session-start", "prompt", "turn-end", "session-end"]) {
      expect(await hook('{"invocationNum":0,"extra":1}', "antigravity", event)).toEqual(
        SILENT_SUCCESS,
      );
      expect(
        await hook(
          '{"conversationId":"c","workspacePaths":[],"invocationNum":0}',
          "antigravity",
          event,
        ),
      ).toEqual(SILENT_SUCCESS);
    }
  });

  test("a GitHub Copilot payload missing what is needed is silent success", async () => {
    for (const event of ["session-start", "prompt", "turn-end", "session-end"]) {
      expect(await hook('{"prompt":"x","extra":1}', "copilot", event)).toEqual(SILENT_SUCCESS);
      expect(await hook('{"hook_event_name":"Stop","cwd":"/p"}', "copilot", event)).toEqual(
        SILENT_SUCCESS,
      );
    }
  });

  test("a Factory Droid payload missing what is needed is silent success", async () => {
    for (const event of ["session-start", "prompt", "turn-end", "session-end"]) {
      expect(await hook('{"prompt":"x","extra":1}', "droid", event)).toEqual(SILENT_SUCCESS);
    }
  });

  test("a whole turn from Cursor: the prompt is let through, the response closes the turn", async () => {
    const common = { conversation_id: "conv-1", generation_id: "g1", workspace_roots: [dir] };
    const before = await hook(
      JSON.stringify({
        ...common,
        hook_event_name: "beforeSubmitPrompt",
        prompt: "why does it fail?",
      }),
      "cursor",
      "prompt",
    );
    expect(before).toEqual({ exitCode: 0, stdout: '{"continue":true}', stderr: "" });
    await hook(
      JSON.stringify({ ...common, hook_event_name: "afterAgentResponse", text: "Because of X." }),
      "cursor",
      "turn-end",
    );
    expect(rows("SELECT state, completeness, final_text FROM turns")).toEqual([
      { state: "pending", completeness: "full", final_text: "Because of X." },
    ]);
  });

  test("run as the Claude Code plugin while the direct install is also there, it stands down: one memory speaks", async () => {
    const config = join(dir, "claude");
    mkdirSync(config);
    const direct = {
      hooks: {
        UserPromptSubmit: [
          {
            hooks: [
              {
                type: "command",
                command: "/opt/wizardingcode-mem/bin/wizardingcode-mem",
                args: ["hook", "claude-code", "prompt"],
              },
            ],
          },
        ],
      },
    };
    writeFileSync(join(config, "settings.json"), JSON.stringify(direct));
    const asPlugin = (input: string, ...args: string[]) =>
      runCliWith(
        {
          input,
          env: {
            WIZARDINGCODE_MEM_DATA_DIR: dir,
            WIZARDINGCODE_MEM_DISTILL: "off",
            WIZARDINGCODE_MEM_UI_AUTO_OPEN: "off",
            CLAUDE_CONFIG_DIR: config,
            CLAUDE_PLUGIN_ROOT: "/plugins/wizardingcode-mem",
          },
        },
        "hook",
        ...args,
      );
    expect(await asPlugin(payload("user-prompt-submit"), "claude-code", "prompt")).toEqual(
      SILENT_SUCCESS,
    );
    expect(existsSync(join(dir, DB_FILE))).toBe(false);

    // Without the direct install, the plugin is the one that speaks.
    writeFileSync(join(config, "settings.json"), JSON.stringify({ hooks: {} }));
    await asPlugin(payload("user-prompt-submit"), "claude-code", "prompt");
    expect(rows("SELECT state FROM turns")).toEqual([{ state: "open" }]);
  });

  test.each([
    ["codex", { CODEX_HOME: "codex" }, "codex/hooks.json", "user-prompt-submit"],
  ] as const)(
    "%s: run through its plugin while the direct install is also there, it stands down",
    async (agent, homes, file, fixture) => {
      const binary = join(dir, "wizardingcode-mem");
      writeFileSync(binary, "");
      const env = Object.fromEntries(
        Object.entries(homes).map(([name, sub]) => [name, join(dir, sub)]),
      );
      const direct = await runCliWith(
        {
          env: {
            ...env,
            HOME: dir,
            WIZARDINGCODE_MEM_DATA_DIR: join(dir, "data"),
            PATH: "/nonexistent",
          },
        },
        "install",
        agent,
        "--binary",
        binary,
      );
      expect(direct.exitCode).toBe(0);
      expect(existsSync(join(dir, file))).toBe(true);
      const viaPlugin = (...flags: string[]) =>
        runCliWith(
          {
            input: payload(fixture, agent),
            env: {
              ...env,
              HOME: dir,
              WIZARDINGCODE_MEM_DATA_DIR: join(dir, "data"),
              WIZARDINGCODE_MEM_DISTILL: "off",
              WIZARDINGCODE_MEM_UI_AUTO_OPEN: "off",
            },
          },
          "hook",
          agent,
          "prompt",
          ...flags,
        );
      const turns = () => {
        if (!existsSync(join(dir, "data", DB_FILE))) return 0;
        const db = new Database(join(dir, "data", DB_FILE), { readonly: true });
        try {
          return db.query<{ n: number }, []>("SELECT count(*) AS n FROM turns").get()?.n;
        } finally {
          db.close();
        }
      };
      expect(await viaPlugin("--via-plugin")).toEqual(SILENT_SUCCESS);
      expect(turns()).toBe(0);
      // The direct install's own run, without the flag, is the one that records.
      await viaPlugin();
      expect(turns()).toBe(1);
    },
  );

  test("an interrupted turn is queued by the session end that follows it", async () => {
    await hook(payload("interrupted.user-prompt-submit"), "claude-code", "prompt");
    await hook(payload("interrupted.session-end"), "claude-code", "session-end");
    expect(rows("SELECT state, completeness FROM turns")).toEqual([
      { state: "pending", completeness: "interrupted" },
    ]);
  });

  test("each run records its latency, and nothing about its content", async () => {
    await hook(payload("user-prompt-submit"), "claude-code", "prompt");
    const runs = rows<{ agent: string; event: string; ms: number; outcome: string }>(
      "SELECT agent, event, ms, outcome FROM hook_runs",
    );
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ agent: "claude-code", event: "prompt", outcome: "ok" });
    expect(runs[0]?.ms).toBeGreaterThanOrEqual(0);
  });

  test("events from inside a subagent are ignored", async () => {
    const inSubagent = JSON.stringify({
      ...JSON.parse(payload("user-prompt-submit")),
      agent_id: "sub-1",
    });
    expect(await hook(inSubagent, "claude-code", "prompt")).toEqual(SILENT_SUCCESS);
    expect(existsSync(join(dir, DB_FILE))).toBe(false);
  });

  // Whatever goes wrong, the host must see a successful, silent hook: exit code 2
  // would block the user's prompt, and stray output would be read as context.
  test.each([
    ["garbage on stdin", "this is not json", ["claude-code", "prompt"]],
    ["empty stdin", "", ["claude-code", "prompt"]],
    ["an unknown agent", "{}", ["some-future-agent", "prompt"]],
    ["an unknown event", "{}", ["claude-code", "some-future-event"]],
    ["no arguments", "{}", []],
  ])("%s is a silent success", async (_label, input, args) => {
    expect(await hook(input, ...args)).toEqual(SILENT_SUCCESS);
  });

  test("a database from a newer version is left alone: silent success, one log line, no payload", async () => {
    const db = openDb({ dataDir: dir, busyTimeoutMs: 2000 });
    db.run("PRAGMA user_version = 99");
    db.close();

    expect(await hook(payload("user-prompt-submit"), "claude-code", "prompt")).toEqual(
      SILENT_SUCCESS,
    );
    const log = readFileSync(join(dir, "logs", "wizardingcode-mem.log"), "utf8");
    expect(log.trim().split("\n")).toHaveLength(1);
    expect(log).toContain("hook claude-code prompt");
    expect(log).toContain("SchemaTooNewError");
    expect(log).not.toContain("hello.txt");
    expect(rows("SELECT count(*) AS n FROM turns")).toEqual([{ n: 0 }]);
  });

  test("a database locked by another process is a quick, silent success", async () => {
    const db = openDb({ dataDir: dir, busyTimeoutMs: 2000 });
    db.run("BEGIN IMMEDIATE");
    try {
      const started = performance.now();
      const result = await hook(payload("user-prompt-submit"), "claude-code", "prompt");
      expect(result).toEqual(SILENT_SUCCESS);
      // The prompt hook waits about a tenth of a second for the lock, never the user's patience.
      expect(performance.now() - started).toBeLessThan(2000);
    } finally {
      db.run("ROLLBACK");
      db.close();
    }
    expect(readFileSync(join(dir, "logs", "wizardingcode-mem.log"), "utf8")).toContain(
      "SQLITE_BUSY",
    );
  });

  test("an enormous, hostile prompt is handled quickly", async () => {
    const blob = "0123456789abcdef".repeat(20_000);
    const input = JSON.stringify({ ...JSON.parse(payload("user-prompt-submit")), prompt: blob });
    const started = performance.now();
    expect(await hook(input, "claude-code", "prompt")).toEqual(SILENT_SUCCESS);
    expect(performance.now() - started).toBeLessThan(1500);
    expect(rows<{ n: number }>("SELECT length(prompt) AS n FROM turns")[0]?.n).toBeLessThanOrEqual(
      8192,
    );
  });

  // A host that never closes the pipe must not leave the hook waiting on it.
  test("gives up on a stdin that is never closed, silently", async () => {
    const main = new URL("../../src/cli/main.ts", import.meta.url).pathname;
    const proc = Bun.spawn([process.execPath, main, "hook", "claude-code", "prompt"], {
      env: {
        ...process.env,
        WIZARDINGCODE_MEM_DATA_DIR: dir,
        WIZARDINGCODE_MEM_DISTILL: "off",
        WIZARDINGCODE_MEM_UI_AUTO_OPEN: "off",
      },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    const started = performance.now();
    const exit = await Promise.race([proc.exited, Bun.sleep(4000).then(() => "still running")]);
    const elapsed = performance.now() - started;
    if (exit === "still running") proc.kill();
    expect(exit).toBe(0);
    expect(elapsed).toBeLessThan(3000);
    expect(await new Response(proc.stdout).text()).toBe("");
  }, 15_000);

  test("an unusable data directory is still a silent success", async () => {
    const file = join(dir, "not-a-directory");
    writeFileSync(file, "");
    const result = await runCliWith(
      {
        input: payload("user-prompt-submit"),
        env: {
          WIZARDINGCODE_MEM_DATA_DIR: file,
          WIZARDINGCODE_MEM_DISTILL: "off",
          WIZARDINGCODE_MEM_UI_AUTO_OPEN: "off",
        },
      },
      "hook",
      "claude-code",
      "prompt",
    );
    expect(result).toEqual(SILENT_SUCCESS);
  });
});

describe("the viewer at session start, from the command line", () => {
  test("is not opened where there is no one to see it (CI), and the hook stays silent", async () => {
    const result = await runCliWith(
      {
        input: payload("session-start.startup", "codex"),
        env: {
          WIZARDINGCODE_MEM_DATA_DIR: dir,
          WIZARDINGCODE_HOME: join(dir, "home"),
          WIZARDINGCODE_MEM_DISTILL: "off",
          WIZARDINGCODE_MEM_UI_AUTO_OPEN: "on",
          CI: "1",
        },
      },
      "hook",
      "codex",
      "session-start",
    );
    expect(result).toEqual(SILENT_SUCCESS);
    await Bun.sleep(500);
    expect(await Bun.file(join(dir, "ui.json")).exists()).toBe(false);
    expect(await Bun.file(join(dir, "home", "ui.json")).exists()).toBe(false);
  });
});

describe("backups from the command line hooks", () => {
  test("a turn's end with a backup target due writes a copy there, and the hook stays silent", async () => {
    const nas = join(dir, "nas");
    const env = {
      WIZARDINGCODE_MEM_DATA_DIR: dir,
      WIZARDINGCODE_MEM_DISTILL: "off",
      WIZARDINGCODE_MEM_UI_AUTO_OPEN: "off",
      WIZARDINGCODE_MEM_BACKUP_TO: nas,
      WIZARDINGCODE_MEM_BACKUP_EVERY_HOURS: "1",
    };
    expect(
      await runCliWith(
        { input: payload("user-prompt-submit"), env },
        "hook",
        "claude-code",
        "prompt",
      ),
    ).toEqual(SILENT_SUCCESS);
    expect(
      await runCliWith({ input: payload("stop"), env }, "hook", "claude-code", "turn-end"),
    ).toEqual(SILENT_SUCCESS);
    let copies: string[] = [];
    for (let i = 0; i < 100 && copies.length === 0; i++) {
      await Bun.sleep(50);
      copies = await Bun.file(nas)
        .exists()
        .then(() => [] as string[])
        .catch(() => []);
      try {
        copies = (await import("node:fs")).readdirSync(nas).filter((n) => n.endsWith(".db.gz"));
      } catch {
        copies = [];
      }
    }
    expect(copies).toHaveLength(1);
    expect(copies[0]).toMatch(/^wizardingcode-mem-\d{8}T\d{6}Z-v\d+\.db\.gz$/);
  }, 15_000);
});

describe("parallel file reads in one session", () => {
  test("no memory is injected twice in one context, however the reads interleave", async () => {
    const project = join(dir, "project");
    mkdirSync(project);
    const db = openDb({ dataDir: dir, busyTimeoutMs: 5000 });
    const projectId = resolveProject(db, project, Date.now()).id;
    // Four notes share a.ts and b.ts, so every parallel read competes for the same ones.
    for (let n = 0; n < 4; n++) {
      insertMemory(db, {
        projectId,
        kind: "gotcha",
        title: `Shared rule ${n}`,
        body: "Keep it short." as Redacted,
        terms: "",
        importance: 3,
        branch: null,
        commit: null,
        origin: "manual",
        judge: "heuristic",
        judgeVersion: "1",
        sourceTurnId: null,
        files: ["a.ts", "b.ts"].map((path) => ({ path, role: "changed" as const })),
        now: Date.now(),
      });
    }
    db.close();

    const shown: string[] = [];
    for (let round = 0; round < 4; round++) {
      const reads = ["a.ts", "b.ts", "a.ts", "b.ts", "a.ts", "b.ts"].map((file) =>
        hook(
          JSON.stringify({
            session_id: `parallel-${round}`,
            transcript_path: "/tmp/t.jsonl",
            cwd: project,
            hook_event_name: "PostToolUse",
            tool_name: "Read",
            tool_input: { file_path: join(project, file) },
            tool_use_id: "toolu_01",
          }),
          "claude-code",
          "file-read",
        ),
      );
      for (const result of await Promise.all(reads)) {
        expect(result.exitCode).toBe(0);
        for (const match of result.stdout.matchAll(/#(\d+) \[/g))
          shown.push(`${round}:${match[1]}`);
      }
    }
    // The invariant is the same whatever got through before the busy timeout: never twice.
    expect(new Set(shown).size).toBe(shown.length);
    expect(
      rows<{ n: number }>(
        `SELECT count(*) AS n FROM (SELECT 1 FROM injections WHERE event = 'file-read'
          GROUP BY session_id, context_epoch, memory_id HAVING count(*) > 1)`,
      )[0]?.n,
    ).toBe(0);
    expect(shown.length).toBeGreaterThan(0);
  });
});
