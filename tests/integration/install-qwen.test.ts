import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { detectAgents } from "../../src/install/detect.ts";
import type { InstallContext } from "../../src/install/hooks-file.ts";
import {
  inspectQwenSettings,
  installQwen,
  qwenContext,
  uninstallQwen,
} from "../../src/install/qwen.ts";
import { runCliWith } from "../helpers/cli.ts";

let home: string;
let configDir: string;
let settingsPath: string;
let dataDir: string;
let commands: string[][];

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "wizardingcode-mem-install-qwen-"));
  configDir = join(home, ".qwen");
  settingsPath = join(configDir, "settings.json");
  dataDir = join(home, ".wizardingcode", "mem");
  commands = [];
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

const BIN = "/opt/wizardingcode-mem/bin/wizardingcode-mem";
const context = (binaryPath = BIN): InstallContext => ({
  settingsPath,
  dataDir,
  binaryPath,
  now: () => 1_700_000_000_000,
  run: (command) => {
    commands.push(command);
    return { ok: true, output: "" };
  },
});
const settings = () => JSON.parse(readFileSync(settingsPath, "utf8"));
const ours = (event: string, binary = BIN) => ({
  hooks: [
    {
      name: "wizardingcode-mem",
      type: "command",
      command: `'${binary}' hook qwen ${event}`,
      timeout: 5,
    },
  ],
});
const OUR_SERVER = { command: BIN, args: ["mcp"] };

// A user's own settings: their hooks on the same events, their MCP server, other keys.
const theirHook = {
  matcher: "",
  hooks: [{ type: "command", command: "echo hi", name: "greet", timeout: 10 }],
};
const theirStop = { hooks: [{ type: "command", command: "notify.sh" }] };
const USER = {
  model: { name: "qwen3-coder-plus" },
  general: { vimMode: false },
  mcpServers: { github: { command: "gh-mcp", args: [] } },
  hooks: { SessionStart: [theirHook], Stop: [theirStop], PreToolUse: [theirStop] },
  somethingNew: [1, 2, 3],
};
const seedUser = (text = `${JSON.stringify(USER, null, 2)}\n`) => {
  mkdirSync(configDir, { recursive: true });
  writeFileSync(settingsPath, text);
  return text;
};

describe("install qwen", () => {
  test("adds the four hooks beside the user's own, named, with the timeout in seconds, and the MCP server in mcpServers", () => {
    seedUser();
    const result = installQwen(context());
    expect(result.changed).toBe(true);
    expect(result.mcp).toBe("registered");
    expect(result.mcpPath).toBe(settingsPath);
    expect(settings()).toEqual({
      ...USER,
      mcpServers: { github: USER.mcpServers.github, "wizardingcode-mem": OUR_SERVER },
      hooks: {
        SessionStart: [theirHook, ours("session-start")],
        Stop: [theirStop, ours("turn-end")],
        PreToolUse: [theirStop],
        UserPromptSubmit: [ours("prompt")],
        SessionEnd: [ours("session-end")],
      },
    });
    // The file is written directly: no host command is run.
    expect(commands).toEqual([]);
  });

  test("a fresh machine without ~/.qwen gets only the directory and the settings file", () => {
    installQwen(context());
    expect(settings()).toEqual({
      hooks: {
        SessionStart: [ours("session-start")],
        UserPromptSubmit: [ours("prompt")],
        Stop: [ours("turn-end")],
        SessionEnd: [ours("session-end")],
      },
      mcpServers: { "wizardingcode-mem": OUR_SERVER },
    });
    expect(uninstallQwen(context()).settings).toBe("removed");
    expect(existsSync(settingsPath)).toBe(false);
  });

  test("reinstalling is idempotent, and a new binary replaces the old one everywhere", () => {
    seedUser();
    installQwen(context("/old/wizardingcode-mem"));
    installQwen(context());
    const once = readFileSync(settingsPath, "utf8");
    expect(installQwen(context()).changed).toBe(false);
    expect(readFileSync(settingsPath, "utf8")).toBe(once);
    expect(once).not.toContain("/old/");
    expect(settings().hooks.Stop).toEqual([theirStop, ours("turn-end")]);
    expect(settings().mcpServers["wizardingcode-mem"]).toEqual(OUR_SERVER);
  });

  test("what install wrote is what inspect finds", () => {
    seedUser();
    installQwen(context());
    expect(inspectQwenSettings(readFileSync(settingsPath, "utf8"))).toEqual({
      events: ["SessionStart", "UserPromptSubmit", "Stop", "SessionEnd"],
      binaries: [BIN],
    });
  });

  test("a settings file that is not plain JSON is refused and left exactly as it was", () => {
    const withComment = '{\n  // mine\n  "model": { "name": "x" }\n}\n';
    seedUser(withComment);
    expect(() => installQwen(context())).toThrow("not valid JSON");
    expect(readFileSync(settingsPath, "utf8")).toBe(withComment);
  });
});

test("an mcpServers that is not an object is refused, not overwritten", () => {
  const odd = `${JSON.stringify({ mcpServers: ["x"] })}\n`;
  seedUser(odd);
  expect(() => installQwen(context())).toThrow('"mcpServers"');
  expect(readFileSync(settingsPath, "utf8")).toBe(odd);
});

describe("uninstall qwen", () => {
  test("an untouched file goes back byte for byte", () => {
    const original = seedUser();
    installQwen(context());
    expect(uninstallQwen(context()).settings).toBe("restored");
    expect(readFileSync(settingsPath, "utf8")).toBe(original);
  });

  test("a file changed since takes out only what is ours: hooks and server", () => {
    seedUser();
    installQwen(context());
    const changed = { ...settings(), theme: "Dark" };
    writeFileSync(settingsPath, JSON.stringify(changed, null, 2));
    expect(uninstallQwen(context()).settings).toBe("edited");
    expect(settings()).toEqual({ ...USER, theme: "Dark" });
  });

  test("with nothing installed, nothing changes", () => {
    const original = seedUser();
    expect(uninstallQwen(context()).settings).toBe("untouched");
    expect(readFileSync(settingsPath, "utf8")).toBe(original);
  });
});

describe("qwenContext", () => {
  test("follows QWEN_HOME (absolute, ~, relative), and otherwise ~/.qwen; empty is unset", () => {
    expect(qwenContext(BIN, { QWEN_HOME: "/x/q", HOME: "/h" }).settingsPath).toBe(
      "/x/q/settings.json",
    );
    expect(qwenContext(BIN, { QWEN_HOME: "~/q", HOME: "/h" }).settingsPath).toBe(
      "/h/q/settings.json",
    );
    expect(qwenContext(BIN, { QWEN_HOME: "rel/q", HOME: "/h" }).settingsPath).toBe(
      join(resolve("rel/q"), "settings.json"),
    );
    expect(qwenContext(BIN, { QWEN_HOME: "", HOME: "/h" }).settingsPath).toBe(
      "/h/.qwen/settings.json",
    );
    expect(qwenContext(BIN, { HOME: "/h" }).configDir).toBe("/h/.qwen");
  });
});

describe("detectAgents finds Qwen Code", () => {
  test("by its command on PATH, before ~/.qwen exists", () => {
    const found = detectAgents({
      env: { HOME: home },
      which: (command) => (command === "qwen" ? "/usr/local/bin/qwen" : null),
    });
    expect(found).toContain("qwen");
    expect(existsSync(configDir)).toBe(false);
  });

  test("by its configuration directory, honouring QWEN_HOME", () => {
    mkdirSync(join(home, "elsewhere"));
    expect(
      detectAgents({ env: { HOME: home, QWEN_HOME: join(home, "elsewhere") }, which: () => null }),
    ).toEqual(["qwen"]);
  });
});

describe("wizardingcode-mem install qwen / uninstall qwen / doctor", () => {
  const env = () => ({
    HOME: home,
    QWEN_HOME: configDir,
    CLAUDE_CONFIG_DIR: join(home, ".claude"),
    WIZARDINGCODE_MEM_DATA_DIR: dataDir,
    PATH: "/nonexistent",
  });

  test("installs with an explicit binary, doctor sees it, then uninstalls cleanly", async () => {
    const binary = join(home, "wizardingcode-mem");
    writeFileSync(binary, "");
    const installed = await runCliWith({ env: env() }, "install", "qwen", "--binary", binary);
    expect(installed.stderr).toBe("");
    expect(installed.exitCode).toBe(0);
    expect(installed.stdout).toContain("Installed wizardingcode-mem for Qwen Code.");
    expect(installed.stdout).toContain(`MCP:    registered in ${settingsPath}`);
    expect(settings().hooks.Stop[0].hooks[0].command).toBe(`'${binary}' hook qwen turn-end`);

    const doctor = await runCliWith({ env: env() }, "doctor");
    const line = doctor.stdout.split("\n").find((l) => l.includes("Qwen Code:"));
    expect(line).toBe(`ok    Qwen Code: installed, running ${binary}`);

    const removed = await runCliWith({ env: env() }, "uninstall", "qwen");
    expect(removed.exitCode).toBe(0);
    expect(removed.stdout).toContain("Removed wizardingcode-mem from Qwen Code.");
    expect(existsSync(settingsPath)).toBe(false);
  });

  test("doctor skips Qwen Code when it is not on the machine", async () => {
    const doctor = await runCliWith({ env: env() }, "doctor");
    const line = doctor.stdout.split("\n").find((l) => l.includes("Qwen Code:"));
    expect(line).toStartWith("skip");
  });

  test("install's usage names qwen", async () => {
    const result = await runCliWith({ env: env() }, "install", "nope");
    expect(result.stderr).toContain("qwen");
  });
});
