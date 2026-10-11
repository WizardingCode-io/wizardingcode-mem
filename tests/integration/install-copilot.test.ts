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
import {
  type CopilotContext,
  copilotContext,
  inspectCopilotHooks,
  installCopilot,
  uninstallCopilot,
} from "../../src/install/copilot.ts";
import { detectAgents } from "../../src/install/detect.ts";

import { runCliWith } from "../helpers/cli.ts";

let home: string;
let configDir: string;
let hooksPath: string;
let mcpPath: string;
let dataDir: string;
let commands: string[][];

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "wizardingcode-mem-install-copilot-"));
  configDir = join(home, ".copilot");
  hooksPath = join(configDir, "hooks", "wizardingcode-mem.json");
  mcpPath = join(configDir, "mcp-config.json");
  dataDir = join(home, ".wizardingcode", "mem");
  commands = [];
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

const BIN = "/opt/wizardingcode-mem/bin/wizardingcode-mem";
const context = (binaryPath = BIN): CopilotContext => ({
  settingsPath: hooksPath,
  mcpPath,
  dataDir,
  binaryPath,
  now: () => 1_700_000_000_000,
  run: (command) => {
    commands.push(command);
    return { ok: true, output: "" };
  },
});
const hooks = () => JSON.parse(readFileSync(hooksPath, "utf8"));
const ours = (event: string, binary = BIN) => [
  { type: "command", command: `'${binary}' hook copilot ${event}`, timeout: 5 },
];
const OURS = {
  version: 1,
  hooks: {
    sessionStart: ours("session-start"),
    userPromptSubmitted: ours("prompt"),
    agentStop: ours("turn-end"),
    sessionEnd: ours("session-end"),
  },
};
const OUR_SERVER = { type: "local", command: BIN, args: ["mcp"], tools: ["*"] };

// The user's own Copilot setup: a hooks file of theirs on the same events, inline hooks with
// comments in settings.json, and an MCP server of theirs.
const THEIR_HOOKS = `${JSON.stringify(
  {
    version: 1,
    hooks: {
      sessionStart: [{ type: "command", bash: "echo hi", timeoutSec: 10 }],
      agentStop: [{ type: "command", bash: "notify.sh" }],
    },
  },
  null,
  2,
)}\n`;
const THEIR_SETTINGS =
  '{\n  // mine\n  "model": "x",\n  "hooks": { "userPromptSubmitted": [{ "type": "command", "bash": "log.sh" }] },\n}\n';
const USER_MCP = {
  mcpServers: { github: { type: "local", command: "gh-mcp", args: [], tools: ["*"] } },
  somethingNew: true,
};
const seedUser = () => {
  mkdirSync(join(configDir, "hooks"), { recursive: true });
  writeFileSync(join(configDir, "hooks", "theirs.json"), THEIR_HOOKS);
  writeFileSync(join(configDir, "settings.json"), THEIR_SETTINGS);
  writeFileSync(mcpPath, `${JSON.stringify(USER_MCP, null, 2)}\n`);
};
const mcp = () => JSON.parse(readFileSync(mcpPath, "utf8"));
const userFilesUntouched = () => {
  expect(readFileSync(join(configDir, "hooks", "theirs.json"), "utf8")).toBe(THEIR_HOOKS);
  expect(readFileSync(join(configDir, "settings.json"), "utf8")).toBe(THEIR_SETTINGS);
};

describe("install copilot", () => {
  test("writes our own hooks file and the MCP server beside the user's, touching nothing of theirs", () => {
    seedUser();
    const result = installCopilot(context());
    expect(result.changed).toBe(true);
    expect(result.settingsPath).toBe(hooksPath);
    expect(result.mcp).toBe("registered");
    expect(result.mcpPath).toBe(mcpPath);
    expect(hooks()).toEqual(OURS);
    expect(mcp()).toEqual({
      ...USER_MCP,
      mcpServers: { github: USER_MCP.mcpServers.github, "wizardingcode-mem": OUR_SERVER },
    });
    userFilesUntouched();
    expect(commands).toEqual([]);
  });

  test("says how to give VS Code the memory tools, without editing its files", () => {
    const result = installCopilot(context());
    const note = result.notes.join("\n");
    expect(note).toContain("VS Code");
    expect(note).toContain(
      `code --add-mcp '{"name":"wizardingcode-mem","command":"${BIN}","args":["mcp"]}'`,
    );
  });

  test("a fresh machine without ~/.copilot gets only the hooks file and mcp-config.json", () => {
    installCopilot(context());
    expect(readdirSync(configDir).sort()).toEqual(["hooks", "mcp-config.json"]);
    expect(readdirSync(join(configDir, "hooks"))).toEqual(["wizardingcode-mem.json"]);
    expect(mcp()).toEqual({ mcpServers: { "wizardingcode-mem": OUR_SERVER } });
    expect(uninstallCopilot(context()).settings).toBe("removed");
    expect(existsSync(hooksPath)).toBe(false);
    expect(existsSync(mcpPath)).toBe(false);
  });

  test("reinstalling is idempotent, and a new binary replaces the old one everywhere", () => {
    seedUser();
    installCopilot(context("/old/wizardingcode-mem"));
    installCopilot(context());
    const once = readFileSync(hooksPath, "utf8");
    const onceMcp = readFileSync(mcpPath, "utf8");
    expect(installCopilot(context()).changed).toBe(false);
    expect(readFileSync(hooksPath, "utf8")).toBe(once);
    expect(readFileSync(mcpPath, "utf8")).toBe(onceMcp);
    expect(once).not.toContain("/old/");
    expect(onceMcp).not.toContain("/old/");
    expect(hooks()).toEqual(OURS);
  });

  test("what install wrote is what inspect finds", () => {
    installCopilot(context());
    expect(inspectCopilotHooks(readFileSync(hooksPath, "utf8"))).toEqual({
      events: ["sessionStart", "userPromptSubmitted", "agentStop", "sessionEnd"],
      binaries: [BIN],
    });
  });

  test("an mcp-config.json that is not plain JSON is refused and left as it was", () => {
    mkdirSync(configDir, { recursive: true });
    writeFileSync(mcpPath, "{ nope");
    expect(() => installCopilot(context())).toThrow("not valid JSON");
    expect(readFileSync(mcpPath, "utf8")).toBe("{ nope");
  });
});

describe("uninstall copilot", () => {
  test("deletes our hooks file, takes only our server out, and leaves the user's files as they were", () => {
    seedUser();
    const originalMcp = readFileSync(mcpPath, "utf8");
    installCopilot(context());
    expect(uninstallCopilot(context()).settings).toBe("removed");
    expect(existsSync(hooksPath)).toBe(false);
    expect(readFileSync(mcpPath, "utf8")).toBe(originalMcp);
    userFilesUntouched();
  });

  test("our hooks file, changed since, still goes when nothing but ours was in it", () => {
    installCopilot(context());
    writeFileSync(hooksPath, JSON.stringify(hooks(), null, 4));
    expect(uninstallCopilot(context()).settings).toBe("removed");
    expect(existsSync(hooksPath)).toBe(false);
  });

  test("something the user added to our file is kept; our hooks are taken out", () => {
    installCopilot(context());
    const added = { ...hooks(), hooks: { ...hooks().hooks, preCompact: [{ bash: "x.sh" }] } };
    writeFileSync(hooksPath, JSON.stringify(added, null, 2));
    expect(uninstallCopilot(context()).settings).toBe("edited");
    expect(hooks()).toEqual({ version: 1, hooks: { preCompact: [{ bash: "x.sh" }] } });
  });

  test("with nothing installed, nothing changes", () => {
    seedUser();
    expect(uninstallCopilot(context()).settings).toBe("untouched");
    userFilesUntouched();
    expect(mcp()).toEqual(USER_MCP);
  });
});

describe("copilotContext", () => {
  test("is ~/.copilot under HOME", () => {
    const c = copilotContext(BIN, { HOME: "/h" });
    expect(c.configDir).toBe("/h/.copilot");
    expect(c.settingsPath).toBe("/h/.copilot/hooks/wizardingcode-mem.json");
    expect(c.mcpPath).toBe("/h/.copilot/mcp-config.json");
  });

  test("COPILOT_HOME moves it; empty is unset", () => {
    const c = copilotContext(BIN, { HOME: "/h", COPILOT_HOME: "/elsewhere/copilot" });
    expect(c.configDir).toBe("/elsewhere/copilot");
    expect(c.settingsPath).toBe("/elsewhere/copilot/hooks/wizardingcode-mem.json");
    expect(c.mcpPath).toBe("/elsewhere/copilot/mcp-config.json");
    expect(copilotContext(BIN, { HOME: "/h", COPILOT_HOME: "" }).configDir).toBe("/h/.copilot");
  });
});

describe("detectAgents finds GitHub Copilot", () => {
  test("by its command on PATH, before ~/.copilot exists", () => {
    const found = detectAgents({
      env: { HOME: home },
      which: (command) => (command === "copilot" ? "/usr/local/bin/copilot" : null),
    });
    expect(found).toContain("copilot");
    expect(existsSync(configDir)).toBe(false);
  });

  test("by its configuration directory, wherever COPILOT_HOME puts it", () => {
    mkdirSync(configDir);
    expect(detectAgents({ env: { HOME: home }, which: () => null })).toEqual(["copilot"]);
    const moved = join(home, "elsewhere");
    mkdirSync(moved);
    rmSync(configDir, { recursive: true });
    expect(detectAgents({ env: { HOME: home, COPILOT_HOME: moved }, which: () => null })).toEqual([
      "copilot",
    ]);
  });
});

describe("wizardingcode-mem install copilot / uninstall copilot / doctor", () => {
  const env = () => ({
    HOME: home,
    CLAUDE_CONFIG_DIR: join(home, ".claude"),
    WIZARDINGCODE_MEM_DATA_DIR: dataDir,
    PATH: "/nonexistent",
  });

  test("installs with an explicit binary, doctor sees it, then uninstalls cleanly", async () => {
    seedUser();
    const binary = join(home, "wizardingcode-mem");
    writeFileSync(binary, "");
    const installed = await runCliWith({ env: env() }, "install", "copilot", "--binary", binary);
    expect(installed.stderr).toBe("");
    expect(installed.exitCode).toBe(0);
    expect(installed.stdout).toContain("Installed wizardingcode-mem for GitHub Copilot.");
    expect(installed.stdout).toContain(`MCP:    registered in ${mcpPath}`);
    expect(installed.stdout).toContain("code --add-mcp");
    expect(hooks().hooks.agentStop[0].command).toBe(`'${binary}' hook copilot turn-end`);

    const doctor = await runCliWith({ env: env() }, "doctor");
    const line = doctor.stdout.split("\n").find((l) => l.includes("GitHub Copilot:"));
    expect(line).toBe(`ok    GitHub Copilot: installed, running ${binary}`);

    const removed = await runCliWith({ env: env() }, "uninstall", "copilot");
    expect(removed.exitCode).toBe(0);
    expect(removed.stdout).toContain("Removed wizardingcode-mem from GitHub Copilot.");
    expect(existsSync(hooksPath)).toBe(false);
    expect(mcp()).toEqual(USER_MCP);
    userFilesUntouched();
  });

  test("doctor skips GitHub Copilot when it is not on the machine", async () => {
    const doctor = await runCliWith({ env: env() }, "doctor");
    const line = doctor.stdout.split("\n").find((l) => l.includes("GitHub Copilot:"));
    expect(line).toStartWith("skip");
  });

  test("install's usage names copilot", async () => {
    const result = await runCliWith({ env: env() }, "install", "nope");
    expect(result.stderr).toContain("copilot");
  });
});
