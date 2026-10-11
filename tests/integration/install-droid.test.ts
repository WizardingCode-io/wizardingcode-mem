import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectAgents } from "../../src/install/detect.ts";
import {
  type DroidContext,
  droidContext,
  inspectDroidSettings,
  installDroid,
  uninstallDroid,
} from "../../src/install/droid.ts";

import { runCliWith } from "../helpers/cli.ts";

let home: string;
let configDir: string;
let settingsPath: string;
let mcpPath: string;
let dataDir: string;
let commands: string[][];

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "wizardingcode-mem-install-droid-"));
  configDir = join(home, ".factory");
  settingsPath = join(configDir, "hooks.json");
  mcpPath = join(configDir, "mcp.json");
  dataDir = join(home, ".wizardingcode", "mem");
  commands = [];
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

const BIN = "/opt/wizardingcode-mem/bin/wizardingcode-mem";
const context = (binaryPath = BIN): DroidContext => ({
  settingsPath,
  mcpPath,
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
      type: "command",
      command: `'${binary}' hook droid ${event}`,
      timeout: 5,
    },
  ],
});
const OUR_SERVER = { command: BIN, args: ["mcp"] };

// A user's own hooks.json (keyed by event): their hooks on the same events, their MCP server, other keys.
const theirHook = {
  matcher: "",
  hooks: [{ type: "command", command: "echo hi", name: "greet", timeout: 10 }],
};
const theirStop = { hooks: [{ type: "command", command: "notify.sh" }] };
const USER = {
  SessionStart: [theirHook],
  Stop: [theirStop],
  PreToolUse: [theirStop],
  somethingNew: [1, 2, 3],
};
const USER_MCP = { mcpServers: { github: { type: "stdio", command: "gh-mcp", args: [] } } };
const seedMcp = () => {
  mkdirSync(configDir, { recursive: true });
  writeFileSync(mcpPath, `${JSON.stringify(USER_MCP, null, 2)}\n`);
};
const mcp = () => JSON.parse(readFileSync(mcpPath, "utf8"));
const seedUser = (text = `${JSON.stringify(USER, null, 2)}\n`) => {
  mkdirSync(configDir, { recursive: true });
  writeFileSync(settingsPath, text);
  return text;
};

describe("install droid", () => {
  test("adds the four hooks beside the user's own and the MCP server in mcp.json beside theirs", () => {
    seedUser();
    seedMcp();
    const result = installDroid(context());
    expect(result.changed).toBe(true);
    expect(result.mcp).toBe("registered");
    expect(result.mcpPath).toBe(mcpPath);
    expect(settings()).toEqual({
      ...USER,
      SessionStart: [theirHook, ours("session-start")],
      Stop: [theirStop, ours("turn-end")],
      UserPromptSubmit: [ours("prompt")],
      SessionEnd: [ours("session-end")],
    });
    expect(mcp()).toEqual({
      mcpServers: { github: USER_MCP.mcpServers.github, "wizardingcode-mem": OUR_SERVER },
    });
    expect(commands).toEqual([]);
  });

  test("a fresh machine without ~/.factory gets only the directory, hooks.json and mcp.json", () => {
    installDroid(context());
    expect(settings()).toEqual({
      SessionStart: [ours("session-start")],
      UserPromptSubmit: [ours("prompt")],
      Stop: [ours("turn-end")],
      SessionEnd: [ours("session-end")],
    });
    expect(mcp()).toEqual({ mcpServers: { "wizardingcode-mem": OUR_SERVER } });
    expect(readdirSync(configDir).sort()).toEqual(["hooks.json", "mcp.json"]);
    expect(uninstallDroid(context()).settings).toBe("removed");
    expect(existsSync(settingsPath)).toBe(false);
    expect(existsSync(mcpPath)).toBe(false);
  });

  test("beside a user's hooks.json with their own SessionStart group, theirs stays first and uninstall takes only ours", () => {
    seedUser();
    installDroid(context());
    expect(settings().SessionStart[0]).toEqual(theirHook);
    expect(settings().SessionStart).toHaveLength(2);
    // Changed since: uninstall edits rather than restores.
    writeFileSync(settingsPath, JSON.stringify({ ...settings(), Notification: [] }, null, 2));
    uninstallDroid(context());
    expect(settings()).toEqual({ ...USER, Notification: [] });
  });

  test("reinstalling is idempotent, and a new binary replaces the old one everywhere", () => {
    seedUser();
    seedMcp();
    installDroid(context("/old/wizardingcode-mem"));
    installDroid(context());
    const once = readFileSync(settingsPath, "utf8");
    const onceMcp = readFileSync(mcpPath, "utf8");
    expect(installDroid(context()).changed).toBe(false);
    expect(readFileSync(settingsPath, "utf8")).toBe(once);
    expect(readFileSync(mcpPath, "utf8")).toBe(onceMcp);
    expect(once).not.toContain("/old/");
    expect(onceMcp).not.toContain("/old/");
    expect(settings().Stop).toEqual([theirStop, ours("turn-end")]);
  });

  test("inspect names the file it read when that file is broken", () => {
    expect(() => inspectDroidSettings("{ nope")).toThrow("hooks.json is not valid JSON");
  });

  test("what install wrote is what inspect finds", () => {
    seedUser();
    installDroid(context());
    expect(inspectDroidSettings(readFileSync(settingsPath, "utf8"))).toEqual({
      events: ["SessionStart", "UserPromptSubmit", "Stop", "SessionEnd"],
      binaries: [BIN],
    });
  });

  test("a hooks file with comments is refused, saying so, and left exactly as it was", () => {
    const withComment = '{\n  // mine\n  "model": { "name": "x" }\n}\n';
    seedUser(withComment);
    expect(() => installDroid(context())).toThrow(
      `comments in ${settingsPath} are not supported yet; remove them and run this again`,
    );
    expect(readFileSync(settingsPath, "utf8")).toBe(withComment);
  });
});

test("an mcp.json that is not plain JSON is refused and left as it was", () => {
  mkdirSync(configDir, { recursive: true });
  writeFileSync(mcpPath, "{ nope");
  expect(() => installDroid(context())).toThrow("not valid JSON");
  expect(readFileSync(mcpPath, "utf8")).toBe("{ nope");
});

describe("an invalid mcp.json stops install before anything is written", () => {
  const receipts = () =>
    existsSync(join(dataDir, "install")) ? readdirSync(join(dataDir, "install")) : [];

  test("a comment in mcp.json: no hooks.json, no receipt, and an error that names the comment", () => {
    mkdirSync(configDir, { recursive: true });
    const theirs = '{ // mine\n "mcpServers": {} }';
    writeFileSync(mcpPath, theirs);
    expect(() => installDroid(context())).toThrow(
      `comments in ${mcpPath} are not supported yet; remove them and run this again`,
    );
    expect(existsSync(settingsPath)).toBe(false);
    expect(receipts()).toEqual([]);
    expect(readFileSync(mcpPath, "utf8")).toBe(theirs);
  });

  test("the user's own hooks.json stays byte for byte", () => {
    const original = seedUser();
    writeFileSync(mcpPath, "[1]");
    expect(() => installDroid(context())).toThrow("does not hold a JSON object");
    expect(readFileSync(settingsPath, "utf8")).toBe(original);
    expect(receipts()).toEqual([]);
  });
});

// Droid reads settings.json's "hooks" only while hooks.json is absent, so creating hooks.json
// would silence them: they are copied in beside ours, and settings.json is never written.
describe("the user's settings.json hooks keep running", () => {
  const userSettingsPath = () => join(configDir, "settings.json");
  const mine = { hooks: [{ type: "command", command: "my-notify" }] };
  const SETTINGS = `${JSON.stringify({ model: "x", hooks: { Stop: [mine], PreToolUse: [mine] } }, null, 2)}\n`;
  const seedSettings = (text = SETTINGS) => {
    mkdirSync(configDir, { recursive: true });
    writeFileSync(userSettingsPath(), text);
  };
  const receipts = () =>
    existsSync(join(dataDir, "install")) ? readdirSync(join(dataDir, "install")) : [];

  test("with no hooks.json, install starts it from a copy of settings.json's hooks", () => {
    seedSettings();
    installDroid(context());
    expect(settings()).toEqual({
      Stop: [mine, ours("turn-end")],
      PreToolUse: [mine],
      SessionStart: [ours("session-start")],
      UserPromptSubmit: [ours("prompt")],
      SessionEnd: [ours("session-end")],
    });
    expect(readFileSync(userSettingsPath(), "utf8")).toBe(SETTINGS);
  });

  test("uninstall takes the hooks.json it created away, so Droid reads settings.json again", () => {
    seedSettings();
    installDroid(context());
    expect(uninstallDroid(context()).settings).toBe("removed");
    expect(existsSync(settingsPath)).toBe(false);
    expect(readFileSync(userSettingsPath(), "utf8")).toBe(SETTINGS);
  });

  test("even after hooks.json was reformatted, holding only the copy and ours, it goes", () => {
    seedSettings();
    installDroid(context());
    writeFileSync(settingsPath, JSON.stringify(settings(), null, 4));
    expect(uninstallDroid(context()).settings).toBe("removed");
    expect(existsSync(settingsPath)).toBe(false);
  });

  test("a hook the user added to that hooks.json since keeps the file, without ours", () => {
    seedSettings();
    installDroid(context());
    writeFileSync(settingsPath, JSON.stringify({ ...settings(), Notification: [mine] }, null, 2));
    expect(uninstallDroid(context()).settings).toBe("edited");
    expect(settings()).toEqual({ Stop: [mine], PreToolUse: [mine], Notification: [mine] });
  });

  test("reinstalling keeps the record of the copy", () => {
    seedSettings();
    installDroid(context("/old/wizardingcode-mem"));
    installDroid(context());
    expect(settings().Stop).toEqual([mine, ours("turn-end")]);
    expect(uninstallDroid(context()).settings).toBe("removed");
    expect(existsSync(settingsPath)).toBe(false);
  });

  test("a hooks.json that was already there is not seeded, and goes back as it was", () => {
    seedSettings();
    const original = seedUser();
    installDroid(context());
    expect(settings().PreToolUse).toEqual(USER.PreToolUse);
    expect(JSON.stringify(settings())).not.toContain("my-notify");
    expect(uninstallDroid(context()).settings).toBe("restored");
    expect(readFileSync(settingsPath, "utf8")).toBe(original);
  });

  test("settings.json without hooks seeds nothing", () => {
    seedSettings('{ "model": "x" }\n');
    installDroid(context());
    expect(Object.keys(settings()).sort()).toEqual([
      "SessionEnd",
      "SessionStart",
      "Stop",
      "UserPromptSubmit",
    ]);
  });

  test("a settings.json with comments is refused before anything is written, and left as it was", () => {
    const theirs = '{\n  // mine\n  "hooks": {"Stop": []}\n}\n';
    seedSettings(theirs);
    expect(() => installDroid(context())).toThrow(
      `comments in ${userSettingsPath()} are not supported yet; remove them and run this again`,
    );
    expect(readFileSync(userSettingsPath(), "utf8")).toBe(theirs);
    expect(existsSync(settingsPath)).toBe(false);
    expect(existsSync(mcpPath)).toBe(false);
    expect(receipts()).toEqual([]);
  });

  test("once hooks.json exists, settings.json is not read at all", () => {
    const theirs = '{\n  // mine\n  "hooks": {"Stop": []}\n}\n';
    seedSettings(theirs);
    seedUser();
    installDroid(context());
    uninstallDroid(context());
    expect(readFileSync(userSettingsPath(), "utf8")).toBe(theirs);
  });
});

describe("uninstall droid", () => {
  test("untouched files go back byte for byte", () => {
    const original = seedUser();
    seedMcp();
    const originalMcp = readFileSync(mcpPath, "utf8");
    installDroid(context());
    expect(uninstallDroid(context()).settings).toBe("restored");
    expect(readFileSync(settingsPath, "utf8")).toBe(original);
    expect(readFileSync(mcpPath, "utf8")).toBe(originalMcp);
    expect(mcp()).toEqual(USER_MCP);
  });

  test("a file changed since takes out only what is ours", () => {
    seedUser();
    seedMcp();
    installDroid(context());
    writeFileSync(settingsPath, JSON.stringify({ ...settings(), Notification: [] }, null, 2));
    expect(uninstallDroid(context()).settings).toBe("edited");
    expect(settings()).toEqual({ ...USER, Notification: [] });
    expect(mcp()).toEqual(USER_MCP);
  });

  test("with nothing installed, nothing changes", () => {
    const original = seedUser();
    expect(uninstallDroid(context()).settings).toBe("untouched");
    expect(readFileSync(settingsPath, "utf8")).toBe(original);
  });
});

describe("droidContext", () => {
  test("is ~/.factory under HOME; no environment variable moves it", () => {
    const c = droidContext(BIN, { HOME: "/h", FACTORY_HOME: "/elsewhere" });
    expect(c.configDir).toBe("/h/.factory");
    expect(c.settingsPath).toBe("/h/.factory/hooks.json");
    expect(c.mcpPath).toBe("/h/.factory/mcp.json");
  });
});

describe("detectAgents finds Factory Droid", () => {
  test("by its command on PATH, before ~/.factory exists", () => {
    const found = detectAgents({
      env: { HOME: home },
      which: (command) => (command === "droid" ? "/usr/local/bin/droid" : null),
    });
    expect(found).toContain("droid");
    expect(existsSync(configDir)).toBe(false);
  });

  test("by its configuration directory", () => {
    mkdirSync(configDir);
    expect(detectAgents({ env: { HOME: home }, which: () => null })).toEqual(["droid"]);
  });
});

describe("wizardingcode-mem install droid / uninstall droid / doctor", () => {
  const env = () => ({
    HOME: home,
    CLAUDE_CONFIG_DIR: join(home, ".claude"),
    WIZARDINGCODE_MEM_DATA_DIR: dataDir,
    PATH: "/nonexistent",
  });

  test("installs with an explicit binary, doctor sees it, then uninstalls cleanly", async () => {
    const binary = join(home, "wizardingcode-mem");
    writeFileSync(binary, "");
    const installed = await runCliWith({ env: env() }, "install", "droid", "--binary", binary);
    expect(installed.stderr).toBe("");
    expect(installed.exitCode).toBe(0);
    expect(installed.stdout).toContain("Installed wizardingcode-mem for Factory Droid.");
    expect(installed.stdout).toContain(`MCP:    registered in ${mcpPath}`);
    expect(settings().Stop[0].hooks[0].command).toBe(`'${binary}' hook droid turn-end`);

    const doctor = await runCliWith({ env: env() }, "doctor");
    const line = doctor.stdout.split("\n").find((l) => l.includes("Factory Droid:"));
    expect(line).toBe(`ok    Factory Droid: installed, running ${binary}`);

    const removed = await runCliWith({ env: env() }, "uninstall", "droid");
    expect(removed.exitCode).toBe(0);
    expect(removed.stdout).toContain("Removed wizardingcode-mem from Factory Droid.");
    expect(existsSync(settingsPath)).toBe(false);
  });

  test("doctor skips Factory Droid when it is not on the machine", async () => {
    const doctor = await runCliWith({ env: env() }, "doctor");
    const line = doctor.stdout.split("\n").find((l) => l.includes("Factory Droid:"));
    expect(line).toStartWith("skip");
  });

  test("install's usage names droid", async () => {
    const result = await runCliWith({ env: env() }, "install", "nope");
    expect(result.stderr).toContain("droid");
  });
});
