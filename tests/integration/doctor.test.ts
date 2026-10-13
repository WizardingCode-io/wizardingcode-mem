import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pkg from "../../package.json" with { type: "json" };
import { resolveProject } from "../../src/core/project.ts";
import type { Redacted } from "../../src/core/redact.ts";
import { loadModel } from "../../src/embed/model.ts";
import { writeMemoryVector } from "../../src/embed/vectors.ts";
import { type Db, MIGRATIONS, openDb } from "../../src/store/db.ts";
import { insertMemory } from "../../src/store/memories.ts";
import { setMeta } from "../../src/store/meta.ts";
import { runCliWith } from "../helpers/cli.ts";

let home: string;
let project: string;
let dataDir: string;
let settingsPath: string;

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), "wizardingcode-mem-doctor-")));
  project = join(home, "demo");
  dataDir = join(home, ".wizardingcode-mem");
  mkdirSync(project);
  mkdirSync(join(home, ".claude"));
  settingsPath = join(home, ".claude", "settings.json");
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

const env = () => ({
  HOME: home,
  CLAUDE_CONFIG_DIR: join(home, ".claude"),
  WIZARDINGCODE_MEM_DATA_DIR: dataDir,
  PATH: "/nonexistent",
});
const cli = (...args: string[]) => cliWith({}, ...args);
const cliWith = (extra: Record<string, string>, ...args: string[]) => {
  const main = new URL("../../src/cli/main.ts", import.meta.url).pathname;
  const proc = Bun.spawn([process.execPath, main, ...args], {
    cwd: project,
    env: { ...process.env, ...env(), ...extra },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  return Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]).then(([stdout, stderr, exitCode]) => ({ stdout, stderr, exitCode }));
};

function seed(fn: (db: Db, projectId: number) => void): void {
  const db = openDb({ dataDir, busyTimeoutMs: 2000 });
  try {
    fn(db, resolveProject(db, project, 1_700_000_000_000).id);
  } finally {
    db.close();
  }
}

function memory(db: Db, projectId: number, title: string): number {
  return insertMemory(db, {
    projectId,
    kind: "decision",
    title,
    body: "" as Redacted,
    terms: "",
    importance: 2,
    branch: null,
    commit: null,
    origin: "manual",
    judge: "heuristic",
    judgeVersion: "1",
    sourceTurnId: null,
    files: [],
    now: 1_700_000_000_000,
  });
}

function installHooks(binary: string): void {
  const hook = (event: string) => ({
    hooks: [{ type: "command", command: binary, args: ["hook", "claude-code", event], timeout: 5 }],
  });
  writeFileSync(
    settingsPath,
    JSON.stringify({
      hooks: {
        SessionStart: [hook("session-start")],
        UserPromptSubmit: [hook("prompt")],
        Stop: [hook("turn-end")],
        SessionEnd: [hook("session-end")],
        PostToolUse: [{ matcher: "Read", ...hook("file-read") }],
      },
    }),
  );
}

const line = (output: string, name: string) =>
  output.split("\n").find((candidate) => candidate.includes(name)) ?? "";

describe("wizardingcode-mem doctor", () => {
  test("a healthy installation passes every check", async () => {
    const binary = join(home, "wizardingcode-mem");
    writeFileSync(binary, "");
    installHooks(binary);
    seed(() => {});
    const result = await cli("doctor");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    for (const name of ["data directory", "database", "full-text search", "queue", "Claude Code"]) {
      expect(line(result.stdout, name)).toStartWith("ok");
    }
    expect(result.stdout).toEndWith("All checks passed.\n");
  });

  test("an install from before the file-read hook is a warning, not an error", async () => {
    const binary = join(home, "wizardingcode-mem");
    writeFileSync(binary, "");
    const hook = (event: string) => ({
      hooks: [
        { type: "command", command: binary, args: ["hook", "claude-code", event], timeout: 5 },
      ],
    });
    writeFileSync(
      settingsPath,
      JSON.stringify({
        hooks: {
          SessionStart: [hook("session-start")],
          UserPromptSubmit: [hook("prompt")],
          Stop: [hook("turn-end")],
          SessionEnd: [hook("session-end")],
          PostToolUse: [{ matcher: "Edit", hooks: [{ type: "command", command: "fmt" }] }],
        },
      }),
    );
    seed(() => {});
    const result = await cli("doctor");
    expect(result.exitCode).toBe(0);
    const claude = line(result.stdout, "Claude Code");
    expect(claude).toStartWith("warn");
    expect(claude).toContain("no PostToolUse hook");
    expect(claude).not.toContain("PostToolUseFailure");
    expect(claude).toContain("wizardingcode-mem install claude-code");
  });

  test("before first use there is nothing wrong, only nothing installed", async () => {
    const result = await cli("doctor");
    expect(result.exitCode).toBe(0);
    expect(line(result.stdout, "Claude Code")).toStartWith("warn");
    expect(line(result.stdout, "Claude Code")).toContain(
      "claude plugin install wizardingcode-mem@wizardingcode-plugins",
    );
    expect(result.stdout).toContain("1 warning");
  });

  test("agents that are not on this machine are skipped, not warned about", async () => {
    const result = await cli("doctor");
    for (const name of [
      "Codex",
      "Cursor",
      "OpenCode",
      "Qwen Code",
      "Factory Droid",
      "GitHub Copilot",
      "Antigravity",
    ]) {
      expect(line(result.stdout, name)).toStartWith("skip");
      expect(line(result.stdout, name)).toContain("not found on this machine");
    }
  });

  test("an agent that is on the machine but has no wizardingcode-mem is a warning that says how to install", async () => {
    const bin = join(home, "bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "codex"), "#!/bin/sh\n", { mode: 0o755 });
    const result = await cliWith({ PATH: bin }, "doctor");
    expect(line(result.stdout, "Codex")).toStartWith("warn");
    expect(line(result.stdout, "Codex")).toContain(
      "codex plugin add wizardingcode-mem@wizardingcode-plugins",
    );
    expect(result.stdout).not.toContain("Gemini");
  });

  test("an agent that has wizardingcode-mem as its own plugin or extension is installed, and says how", async () => {
    writeFileSync(
      settingsPath,
      JSON.stringify({
        enabledPlugins: { "wizardingcode-mem@wizardingcode-plugins": true, "other@x": true },
      }),
    );
    mkdirSync(join(home, ".codex"));
    writeFileSync(
      join(home, ".codex", "config.toml"),
      'model = "x"\n\n[plugins."other@x"]\nenabled = true\n\n[plugins."wizardingcode-mem@wizardingcode-plugins"]\nenabled = true\n',
    );
    mkdirSync(join(home, ".config", "opencode"), { recursive: true });
    writeFileSync(
      join(home, ".config", "opencode", "opencode.jsonc"),
      '{\n  // plugins\n  "plugin": ["wizardingcode-mem-opencode"]\n}\n',
    );
    const nativeEnv = {
      CODEX_HOME: join(home, ".codex"),
      XDG_CONFIG_HOME: join(home, ".config"),
    };
    const result = await cliWith(nativeEnv, "doctor");
    expect(line(result.stdout, "Claude Code")).toBe(
      "ok    Claude Code: installed as a plugin (wizardingcode-mem@wizardingcode-plugins)",
    );
    expect(line(result.stdout, "Codex")).toBe(
      "ok    Codex: installed as a plugin (wizardingcode-mem@wizardingcode-plugins)",
    );
    expect(line(result.stdout, "OpenCode")).toBe(
      "ok    OpenCode: installed as an npm plugin (wizardingcode-mem-opencode)",
    );

    // Turned off in the agent, it is not installed.
    writeFileSync(
      settingsPath,
      JSON.stringify({ enabledPlugins: { "wizardingcode-mem@wizardingcode-plugins": false } }),
    );
    writeFileSync(
      join(home, ".codex", "config.toml"),
      '[plugins."wizardingcode-mem@wizardingcode-plugins"]\nenabled = false\n',
    );
    const off = await cliWith(nativeEnv, "doctor");
    expect(line(off.stdout, "Claude Code")).toStartWith("warn");
    expect(line(off.stdout, "Codex")).not.toStartWith("ok");
  });

  test("agents with wizardingcode-mem installed are reported, whether or not their command is on PATH", async () => {
    const binary = join(home, "wizardingcode-mem");
    writeFileSync(binary, "");
    const codexEnv = {
      CODEX_HOME: join(home, ".codex"),
      QWEN_HOME: join(home, ".qwen"),
      COPILOT_HOME: join(home, ".copilot"),
      XDG_CONFIG_HOME: join(home, ".config"),
    };
    for (const agent of [
      "codex",
      "cursor",
      "opencode",
      "qwen",
      "droid",
      "copilot",
      "antigravity",
    ]) {
      const installed = await cliWith(codexEnv, "install", agent, "--binary", binary);
      expect(installed.exitCode).toBe(0);
    }
    const result = await cliWith(codexEnv, "doctor");
    for (const name of [
      "Codex",
      "Cursor",
      "OpenCode",
      "Qwen Code",
      "Factory Droid",
      "GitHub Copilot",
      "Antigravity",
    ]) {
      expect(line(result.stdout, name)).toStartWith("ok");
      expect(line(result.stdout, name)).toContain(binary);
    }
    rmSync(binary);
    const broken = await cliWith(codexEnv, "doctor");
    for (const name of [
      "Codex",
      "Cursor",
      "OpenCode",
      "Qwen Code",
      "Factory Droid",
      "GitHub Copilot",
      "Antigravity",
    ]) {
      expect(line(broken.stdout, name)).toStartWith("FAIL");
    }
  });

  test("a database from a newer version fails, and says what to do", async () => {
    seed((db) => db.run("PRAGMA user_version = 99"));
    const result = await cli("doctor");
    expect(result.exitCode).toBe(1);
    expect(line(result.stdout, "database")).toStartWith("FAIL");
    expect(line(result.stdout, "database")).toContain("upgrade wizardingcode-mem");
  });

  test("a database from before a migration is read as it is: its version, that it will be migrated, and no check that needs a newer table", async () => {
    const old = openDb({ dataDir, busyTimeoutMs: 2000, migrations: MIGRATIONS.slice(0, 2) });
    old.run("INSERT INTO projects (key, name, created_at) VALUES ('path:/p', 'p', 1)");
    old.run(
      `INSERT INTO memories (project_id, kind, title, body, importance, origin, judge, judge_version, created_at, updated_at)
       VALUES (1, 'decision', 't', 'b', 3, 'manual', 'heuristic', '1', 1, 1)`,
    );
    old.close();
    mkdirSync(join(dataDir, "models"), { recursive: true });
    copyFileSync(
      join(import.meta.dir, "../fixtures/embed/subset.wcpack"),
      join(dataDir, "models", "potion-multilingual-128M.wcpack"),
    );
    const result = await cli("doctor");
    expect(result.stderr).toBe("");
    expect(line(result.stdout, "database")).toStartWith("ok");
    expect(line(result.stdout, "database")).toContain(
      "schema version 2, will be migrated on next use",
    );
    expect(line(result.stdout, "semantic search")).toStartWith("skip");
    expect(line(result.stdout, "semantic search")).toContain("migrated");
    expect(result.stdout).not.toContain("no such table");
    // Looked at only: still version 2.
    const after = new (await import("bun:sqlite")).Database(join(dataDir, "wizardingcode-mem.db"));
    expect(after.query("PRAGMA user_version").get()).toEqual({ user_version: 2 });
    after.close();
  });

  test("hooks that point at a binary that is gone fail", async () => {
    installHooks(join(home, "removed", "wizardingcode-mem"));
    seed(() => {});
    const result = await cli("doctor");
    expect(result.exitCode).toBe(1);
    expect(line(result.stdout, "Claude Code")).toStartWith("FAIL");
    expect(line(result.stdout, "Claude Code")).toContain(
      join(home, "removed", "wizardingcode-mem"),
    );
  });

  test("turns that could not be distilled are a warning with a count", async () => {
    seed((db, projectId) => {
      db.run(
        "INSERT INTO sessions (agent, agent_session_id, project_id, cwd, started_at, last_seen_at) VALUES ('claude-code', 's', ?, ?, 1, 1)",
        [projectId, project],
      );
      for (let seq = 1; seq <= 2; seq++) {
        db.run(
          "INSERT INTO turns (session_id, project_id, seq, state, prompt, started_at, last_error) VALUES (1, ?, ?, 'failed', '', 1, 'Error: boom')",
          [projectId, seq],
        );
      }
    });
    const result = await cli("doctor");
    expect(result.exitCode).toBe(0);
    expect(line(result.stdout, "queue")).toStartWith("warn");
    expect(line(result.stdout, "queue")).toContain("2 failed");
  });

  test("without a TypeSafe key, says the heuristic judge works alone and nothing leaves the machine", async () => {
    const result = await cli("doctor");
    expect(line(result.stdout, "TypeSafe")).toStartWith("ok");
    expect(line(result.stdout, "TypeSafe")).toContain("not configured");
  });

  test("with a key, says so without showing it", async () => {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, "env"), "TYPESAFE_API_KEY=apikey_test_0000000000000000\n");
    const result = await cli("doctor");
    expect(line(result.stdout, "TypeSafe")).toStartWith("ok");
    expect(result.stdout).not.toContain("apikey_test");
  });

  test("a key the service rejected is a failure that says where to fix it", async () => {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, "env"), "TYPESAFE_API_KEY=apikey_test_0000000000000000\n");
    seed((db) => {
      const { Breaker } = require("../../src/judge/breaker.ts");
      const { keyFingerprint } = require("../../src/judge/key.ts");
      new Breaker(db, { keyFingerprint: keyFingerprint("apikey_test_0000000000000000") }).failure(
        "auth",
        Date.now(),
      );
    });
    const result = await cli("doctor");
    expect(result.exitCode).toBe(1);
    expect(line(result.stdout, "TypeSafe")).toStartWith("FAIL");
    expect(line(result.stdout, "TypeSafe")).toContain("console.typesafe.ai");
  });

  test("a service that has been failing is a warning, and the heuristic judge is standing in", async () => {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, "env"), "TYPESAFE_API_KEY=apikey_test_0000000000000000\n");
    seed((db) => {
      const { Breaker } = require("../../src/judge/breaker.ts");
      const { keyFingerprint } = require("../../src/judge/key.ts");
      const breaker = new Breaker(db, {
        keyFingerprint: keyFingerprint("apikey_test_0000000000000000"),
      });
      for (let i = 0; i < 3; i++) breaker.failure("network", Date.now());
    });
    const result = await cli("doctor");
    expect(result.exitCode).toBe(0);
    expect(line(result.stdout, "TypeSafe")).toStartWith("warn");
  });

  // What was slow last week says nothing about today's binary.
  test("hook speed is judged on the most recent runs only", async () => {
    seed((db) => {
      db.run(
        `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 300)
         INSERT INTO hook_runs (at, agent, event, ms, outcome)
         SELECT i, 'claude-code', 'prompt', CASE WHEN i <= 100 THEN 900 ELSE 20 END, 'ok' FROM n`,
      );
    });
    const result = await cli("doctor");
    expect(line(result.stdout, "hook speed")).toStartWith("ok");
    expect(line(result.stdout, "hook speed")).toContain("200 runs");
  });

  test("a data directory inside a synced folder is a warning", async () => {
    const synced = join(home, "Dropbox", "wizardingcode-mem");
    const result = await runCliWith(
      { env: { ...env(), WIZARDINGCODE_MEM_DATA_DIR: synced } },
      "doctor",
    );
    expect(line(result.stdout, "data directory")).toStartWith("warn");
    expect(line(result.stdout, "data directory")).toContain("synced");
  });
});

describe("wizardingcode-mem status", () => {
  test("before anything is stored, says so", async () => {
    const result = await cli("status");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("No memories yet for this project.");
  });

  test("reports what is stored, how the queue stands and how fast the hooks are", async () => {
    seed((db, projectId) => {
      const old = memory(db, projectId, "The limit is three.");
      const current = memory(db, projectId, "The limit is five.");
      memory(db, projectId, "Never mock the database.");
      const stale = memory(db, projectId, "The gone module holds the limit.");
      const archived = memory(db, projectId, "All tests passing after the change.");
      db.run("UPDATE memories SET status = 'superseded', superseded_by = ? WHERE id = ?", [
        current,
        old,
      ]);
      db.run("UPDATE memories SET status = 'archived' WHERE id = ?", [archived]);
      db.run("UPDATE memories SET stale = 1 WHERE id = ?", [stale]);
      db.run(
        "INSERT INTO sessions (agent, agent_session_id, project_id, cwd, started_at, last_seen_at) VALUES ('claude-code', 's', ?, ?, 1, 1)",
        [projectId, project],
      );
      const states = ["done", "done", "done", "skipped", "failed", "pending"];
      states.forEach((state, index) => {
        db.run(
          "INSERT INTO turns (session_id, project_id, seq, state, prompt, started_at) VALUES (1, ?, ?, ?, '', 1)",
          [projectId, index + 1, state],
        );
      });
      for (let ms = 1; ms <= 20; ms++) {
        db.run(
          "INSERT INTO hook_runs (at, agent, event, ms, outcome) VALUES (1, 'claude-code', 'prompt', ?, ?)",
          [ms, ms === 20 ? "SQLiteError(SQLITE_BUSY)" : "ok"],
        );
      }
      db.run(
        "INSERT INTO hook_runs (at, agent, event, ms, outcome) VALUES (1, 'claude-code', 'turn-end', 4, 'ok')",
      );
    });

    const result = await cli("status");
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(
      [
        `wizardingcode-mem ${pkg.version}`,
        `project   demo (path:${project})`,
        "memories  3 active (1 stale) · 1 superseded · 1 archived",
        "turns     3 distilled · 1 skipped · 1 failed · 1 queued",
        "hooks     prompt p50 10 ms, p95 19 ms · turn-end p50 4 ms, p95 4 ms · 21 runs, 1 error",
        "judge     heuristic only (no TypeSafe key) · model calls made by wizardingcode-mem: 0",
        `data      ${dataDir}`,
        "",
      ].join("\n"),
    );
  });

  test("the same as JSON", async () => {
    seed((db, projectId) => void memory(db, projectId, "Never mock the database."));
    const result = await cli("status", "--json");
    expect(JSON.parse(result.stdout)).toMatchObject({
      version: pkg.version,
      project: { name: "demo" },
      memories: { active: 1, stale: 0, superseded: 0, archived: 0 },
      turns: { distilled: 0, skipped: 0, failed: 0, queued: 0 },
      modelCalls: 0,
      judge: { configured: "heuristic", requests: 0, inputTokens: 0, byJudge: { heuristic: 1 } },
    });
  });

  test("with a TypeSafe key, shows the judge, what it cost and who judged what", async () => {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, "env"), "TYPESAFE_API_KEY=apikey_test_0000000000000000\n");
    seed((db, projectId) => {
      memory(db, projectId, "Judged by rules.");
      db.run("UPDATE memories SET judge = 'typesafe'");
      memory(db, projectId, "Judged by rules too.");
      db.run(
        "INSERT INTO meta (key, value) VALUES ('typesafe.requests', '12'), ('typesafe.input_tokens', '17000')",
      );
    });
    const result = await cli("status");
    expect(result.stdout).toContain(
      "judge     typesafe, heuristic as fallback · 12 requests, 17000 input tokens (≈ $0.0007) · memories by judge: typesafe 1, heuristic 1",
    );
    expect(JSON.parse((await cli("status", "--json")).stdout).judge).toEqual({
      configured: "typesafe",
      requests: 12,
      inputTokens: 17000,
      byJudge: { typesafe: 1, heuristic: 1 },
    });
  });

  test("a database it cannot read is an error a person can read", async () => {
    seed((db) => db.run("PRAGMA user_version = 99"));
    const result = await cli("status");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("newer than this wizardingcode-mem supports");
  });
});

describe("doctor: backups", () => {
  test("says when none are configured, and warns when the schedule has slipped", async () => {
    seed((db, projectId) => void memory(db, projectId, "one"));
    const off = await cli("doctor");
    expect(off.stdout).toMatch(/ok {2}\s+backups: not configured/);

    const nas = join(home, "nas");
    const fresh = await cliWith(
      { WIZARDINGCODE_MEM_BACKUP_TO: nas, WIZARDINGCODE_MEM_BACKUP_EVERY_HOURS: "1" },
      "doctor",
    );
    expect(fresh.stdout).toMatch(/warn\s+backups: none yet/);

    seed((db) =>
      setMeta(
        db,
        "backup.last",
        JSON.stringify({ name: "x", bytes: 1, at: Date.now() - 3 * 3_600_000, label: nas }),
      ),
    );
    const late = await cliWith(
      { WIZARDINGCODE_MEM_BACKUP_TO: nas, WIZARDINGCODE_MEM_BACKUP_EVERY_HOURS: "1" },
      "doctor",
    );
    expect(late.stdout).toMatch(/warn\s+backups: the last copy is 3 h old/);

    seed((db) =>
      setMeta(
        db,
        "backup.last",
        JSON.stringify({ name: "x", bytes: 1, at: Date.now() - 600_000, label: nas }),
      ),
    );
    const good = await cliWith(
      { WIZARDINGCODE_MEM_BACKUP_TO: nas, WIZARDINGCODE_MEM_BACKUP_EVERY_HOURS: "1" },
      "doctor",
    );
    expect(good.stdout).toMatch(/ok {2}\s+backups: last copy 10 min ago/);
  });
});

describe("wizardingcode-mem doctor, after shibaox-mem", () => {
  test("a shibaox-mem plugin still enabled is a warning that says how to remove it", async () => {
    writeFileSync(
      settingsPath,
      JSON.stringify({ enabledPlugins: { "shibaox-mem@shibaox-plugins": true } }),
    );
    const result = await cli("doctor");
    expect(line(result.stdout, "shibaox-mem")).toStartWith("warn");
    expect(line(result.stdout, "shibaox-mem")).toContain(
      "claude plugin uninstall shibaox-mem@shibaox-plugins",
    );
  });

  test("old variables still work, and are pointed out", async () => {
    const result = await cliWith({ SHIBAOX_MEM_RETENTION_DAYS: "30" }, "doctor");
    expect(line(result.stdout, "shibaox-mem")).toStartWith("warn");
    expect(line(result.stdout, "shibaox-mem")).toContain(
      "SHIBAOX_MEM_RETENTION_DAYS → WIZARDINGCODE_MEM_RETENTION_DAYS",
    );
  });

  test("nothing of it left: no line at all", async () => {
    const result = await cli("doctor");
    expect(result.stdout).not.toContain("shibaox");
  });
});

describe("doctor: semantic search", () => {
  const placeModel = (content?: string) => {
    mkdirSync(join(dataDir, "models"), { recursive: true });
    const target = join(dataDir, "models", "potion-multilingual-128M.wcpack");
    if (content === undefined)
      copyFileSync(join(import.meta.dir, "../fixtures/embed/subset.wcpack"), target);
    else writeFileSync(target, content);
  };

  test("without the model: ok, words only, and how to get it", async () => {
    seed((db, projectId) => void memory(db, projectId, "one"));
    const result = await cli("doctor");
    expect(result.stdout).toMatch(/ok {2}\s+semantic search: not downloaded/);
    expect(line(result.stdout, "semantic search")).toContain("wizardingcode-mem embed download");
  });

  test("with the model: ready, the memories with vectors, and the backfill when some lack one", async () => {
    placeModel();
    let first = 0;
    seed((db, projectId) => {
      first = memory(db, projectId, "one");
      memory(db, projectId, "two");
    });
    seed((db) => {
      const model = loadModel({ dataDir, env: {} });
      writeMemoryVector(db, model, first, "one", "");
    });
    const result = await cli("doctor");
    const found = line(result.stdout, "semantic search");
    expect(found).toMatch(/ok {2}\s+semantic search: ready/);
    expect(found).toContain("1 of 2 active memories");
    expect(found).toContain("wizardingcode-mem embed backfill");
  });

  test("turned off by the environment: names the variable", async () => {
    placeModel();
    const result = await cliWith({ WIZARDINGCODE_MEM_SEMANTIC: "off" }, "doctor");
    const found = line(result.stdout, "semantic search");
    expect(found).toMatch(/ok {2}\s+semantic search: turned off by WIZARDINGCODE_MEM_SEMANTIC/);
  });

  test("turned off in the settings: says so, and that the model is kept", async () => {
    placeModel();
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, "env"), "WIZARDINGCODE_MEM_SEMANTIC=off\n", { mode: 0o600 });
    const result = await cliWith({ WIZARDINGCODE_MEM_SEMANTIC: "" }, "doctor");
    const found = line(result.stdout, "semantic search");
    expect(found).toMatch(/ok {2}\s+semantic search: turned off in the settings/);
    expect(found).toContain("the model is kept");
  });

  test("not downloaded after a failed download: shows the error", async () => {
    seed((db) => setMeta(db, "embed.download.error", "download failed: offline"));
    const found = line((await cli("doctor")).stdout, "semantic search");
    expect(found).toMatch(/ok {2}\s+semantic search: not downloaded/);
    expect(found).toContain("the last download failed (download failed: offline)");
  });

  test("while a download runs: says so", async () => {
    seed((db) =>
      setMeta(
        db,
        "embed.download.lease",
        JSON.stringify({ owner: `${process.pid}-x`, until: Date.now() + 600_000 }),
      ),
    );
    const found = line((await cli("doctor")).stdout, "semantic search");
    expect(found).toMatch(/ok {2}\s+semantic search: the search model is downloading/);
  });

  test("a model that cannot be read is a warning, with the way out", async () => {
    placeModel("not a pack");
    const result = await cli("doctor");
    const found = line(result.stdout, "semantic search");
    expect(found).toMatch(/warn\s+semantic search: the model cannot be used/);
    expect(found).toContain("embed delete");
  });
});
