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
  type AntigravityContext,
  antigravityContext,
  inspectAntigravityHooks,
  installAntigravity,
  uninstallAntigravity,
} from "../../src/install/antigravity.ts";
import { detectAgents } from "../../src/install/detect.ts";
import {
  findGeminiLeftover,
  geminiLeftoverContext,
  removeGeminiLeftover,
} from "../../src/install/gemini-leftover.ts";
import { runCliWith } from "../helpers/cli.ts";

let home: string;
let gemini: string;
let configDir: string;
let hooksPath: string;
let mcpPath: string;
let dataDir: string;
let commands: string[][];

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "wizardingcode-mem-install-antigravity-"));
  gemini = join(home, ".gemini");
  configDir = join(gemini, "config");
  hooksPath = join(configDir, "hooks.json");
  mcpPath = join(configDir, "mcp_config.json");
  dataDir = join(home, ".wizardingcode", "mem");
  commands = [];
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

const BIN = "/opt/wizardingcode-mem/bin/wizardingcode-mem";
const run = (command: string[]) => {
  commands.push(command);
  return { ok: true, output: "" };
};
const context = (binaryPath = BIN): AntigravityContext => ({
  settingsPath: hooksPath,
  mcpPath,
  dataDir,
  binaryPath,
  now: () => 1_700_000_000_000,
  run,
});
const hooks = () => JSON.parse(readFileSync(hooksPath, "utf8"));
const mcp = () => JSON.parse(readFileSync(mcpPath, "utf8"));
const ours = (event: string, binary = BIN) => [
  { type: "command", command: `'${binary}' hook antigravity ${event}`, timeout: 5 },
];
// The file maps hook names to their events; ours is one named definition.
const OUR_DEFINITION = {
  PreInvocation: ours("session-start"),
  Stop: ours("turn-end"),
};
const OUR_SERVER = { command: BIN, args: ["mcp"] };

// The user's own Antigravity setup: hook definitions of theirs on the same events (one
// disabled), and an MCP server of theirs.
const THEIR_HOOKS = `${JSON.stringify(
  {
    "my-linter-hook": {
      PostToolUse: [
        {
          matcher: "run_command",
          hooks: [{ type: "command", command: "./scripts/lint.sh", timeout: 10 }],
        },
      ],
    },
    reminder: { PreInvocation: [{ type: "command", command: "./scripts/reminder.sh" }] },
    "safety-gate": { enabled: false, Stop: [{ command: "./scripts/done.sh" }] },
  },
  null,
  2,
)}\n`;
const THEIR_MCP = `${JSON.stringify(
  {
    mcpServers: {
      "sqlite-explorer": { command: "node", args: ["/usr/local/bin/sqlite-mcp-server.js"] },
      "my-remote-server": { serverUrl: "https://api.example.com/mcp/" },
    },
  },
  null,
  2,
)}\n`;
const seedUser = () => {
  mkdirSync(configDir, { recursive: true });
  writeFileSync(hooksPath, THEIR_HOOKS);
  writeFileSync(mcpPath, THEIR_MCP);
};

describe("install antigravity", () => {
  test("adds our named hook definition and MCP server beside the user's, which stay as they were", () => {
    seedUser();
    const result = installAntigravity(context());
    expect(result.changed).toBe(true);
    expect(result.settingsPath).toBe(hooksPath);
    expect(result.mcp).toBe("registered");
    expect(result.mcpPath).toBe(mcpPath);
    expect(hooks()).toEqual({
      ...JSON.parse(THEIR_HOOKS),
      "wizardingcode-mem": OUR_DEFINITION,
    });
    expect(mcp()).toEqual({
      mcpServers: { ...JSON.parse(THEIR_MCP).mcpServers, "wizardingcode-mem": OUR_SERVER },
    });
    expect(commands).toEqual([]);
  });

  test("a fresh machine without ~/.gemini gets only hooks.json and mcp_config.json", () => {
    installAntigravity(context());
    expect(readdirSync(gemini)).toEqual(["config"]);
    expect(readdirSync(configDir).sort()).toEqual(["hooks.json", "mcp_config.json"]);
    expect(hooks()).toEqual({ "wizardingcode-mem": OUR_DEFINITION });
    expect(mcp()).toEqual({ mcpServers: { "wizardingcode-mem": OUR_SERVER } });
    expect(uninstallAntigravity(context()).settings).toBe("removed");
    expect(existsSync(hooksPath)).toBe(false);
    expect(existsSync(mcpPath)).toBe(false);
    // The directory install made for them goes too; ~/.gemini is never removed.
    expect(existsSync(configDir)).toBe(false);
    expect(existsSync(gemini)).toBe(true);
  });

  test("reinstalling is idempotent, and a new binary replaces the old one everywhere", () => {
    seedUser();
    installAntigravity(context("/old/wizardingcode-mem"));
    installAntigravity(context());
    const once = readFileSync(hooksPath, "utf8");
    const onceMcp = readFileSync(mcpPath, "utf8");
    expect(installAntigravity(context()).changed).toBe(false);
    expect(readFileSync(hooksPath, "utf8")).toBe(once);
    expect(readFileSync(mcpPath, "utf8")).toBe(onceMcp);
    expect(once).not.toContain("/old/");
    expect(onceMcp).not.toContain("/old/");
    expect(hooks()["wizardingcode-mem"]).toEqual(OUR_DEFINITION);
  });

  test("a user who turned our hooks off keeps them off through a reinstall", () => {
    installAntigravity(context("/old/wizardingcode-mem"));
    writeFileSync(
      hooksPath,
      JSON.stringify({ "wizardingcode-mem": { enabled: false, ...hooks()["wizardingcode-mem"] } }),
    );
    installAntigravity(context());
    expect(hooks()).toEqual({ "wizardingcode-mem": { enabled: false, ...OUR_DEFINITION } });
  });

  test("what install wrote is what inspect finds", () => {
    seedUser();
    installAntigravity(context());
    expect(inspectAntigravityHooks(readFileSync(hooksPath, "utf8"))).toEqual({
      events: ["PreInvocation", "Stop"],
      binaries: [BIN],
    });
    expect(inspectAntigravityHooks(THEIR_HOOKS)).toEqual({ events: [], binaries: [] });
  });

  test("a hooks.json that is not plain JSON is refused, and nothing is written", () => {
    mkdirSync(configDir, { recursive: true });
    writeFileSync(hooksPath, "{ nope");
    expect(() => installAntigravity(context())).toThrow("not valid JSON");
    expect(readFileSync(hooksPath, "utf8")).toBe("{ nope");
    expect(existsSync(mcpPath)).toBe(false);
  });

  test("a definition named like ours that is not an object is refused", () => {
    mkdirSync(configDir, { recursive: true });
    writeFileSync(hooksPath, '{ "wizardingcode-mem": [] }');
    expect(() => installAntigravity(context())).toThrow("is not an object");
    expect(readFileSync(hooksPath, "utf8")).toBe('{ "wizardingcode-mem": [] }');
  });
});

describe("uninstall antigravity", () => {
  test("puts the user's files back exactly as they were", () => {
    seedUser();
    installAntigravity(context());
    expect(uninstallAntigravity(context()).settings).toBe("restored");
    expect(readFileSync(hooksPath, "utf8")).toBe(THEIR_HOOKS);
    expect(readFileSync(mcpPath, "utf8")).toBe(THEIR_MCP);
  });

  test("after the user changed the file, takes only our definition out", () => {
    seedUser();
    installAntigravity(context());
    const changed = { ...hooks(), mine: { Stop: [{ command: "./later.sh" }] } };
    writeFileSync(hooksPath, JSON.stringify(changed, null, 2));
    expect(uninstallAntigravity(context()).settings).toBe("edited");
    expect(hooks()).toEqual({
      ...JSON.parse(THEIR_HOOKS),
      mine: { Stop: [{ command: "./later.sh" }] },
    });
  });

  test("our definition, turned off by the user, leaves nothing behind", () => {
    seedUser();
    installAntigravity(context());
    const off = { ...hooks(), "wizardingcode-mem": { enabled: false, ...OUR_DEFINITION } };
    writeFileSync(hooksPath, JSON.stringify(off, null, 2));
    expect(uninstallAntigravity(context()).settings).toBe("edited");
    expect(hooks()).toEqual(JSON.parse(THEIR_HOOKS));
  });

  test("with nothing installed, nothing changes", () => {
    seedUser();
    expect(uninstallAntigravity(context()).settings).toBe("untouched");
    expect(readFileSync(hooksPath, "utf8")).toBe(THEIR_HOOKS);
    expect(readFileSync(mcpPath, "utf8")).toBe(THEIR_MCP);
  });
});

// Antigravity shares ~/.gemini with the old Gemini CLI install, which is no longer supported:
// each keeps to its own files and entries.
describe("Antigravity beside an old Gemini CLI install in one ~/.gemini", () => {
  const geminiSettings = () => join(gemini, "settings.json");
  const geminiCtx = () => ({ ...geminiLeftoverContext({ HOME: home }), dataDir, run });
  const OLD_GEMINI = `${JSON.stringify(
    {
      theme: "dark",
      hooks: {
        SessionStart: [
          {
            hooks: [
              {
                name: "wizardingcode-mem",
                type: "command",
                command: `'${BIN}' hook gemini session-start`,
                timeout: 5000,
              },
            ],
          },
        ],
      },
    },
    null,
    2,
  )}\n`;

  test("installing and uninstalling Antigravity leaves Gemini's settings and hooks alone", () => {
    mkdirSync(gemini, { recursive: true });
    writeFileSync(geminiSettings(), OLD_GEMINI);

    installAntigravity(context());
    expect(readFileSync(geminiSettings(), "utf8")).toBe(OLD_GEMINI);
    expect(readFileSync(hooksPath, "utf8")).not.toContain("hook gemini");
    uninstallAntigravity(context());
    expect(readFileSync(geminiSettings(), "utf8")).toBe(OLD_GEMINI);
    expect(findGeminiLeftover(geminiSettings())?.hooks).toEqual(["SessionStart"]);
  });

  test("removing the old Gemini install leaves Antigravity's hooks and server alone", () => {
    seedUser();
    installAntigravity(context());
    const hooksText = readFileSync(hooksPath, "utf8");
    const mcpText = readFileSync(mcpPath, "utf8");
    writeFileSync(geminiSettings(), OLD_GEMINI);

    expect(findGeminiLeftover(geminiSettings())).not.toBeNull();
    removeGeminiLeftover(geminiCtx());
    expect(findGeminiLeftover(geminiSettings())).toBeNull();
    expect(readFileSync(hooksPath, "utf8")).toBe(hooksText);
    expect(readFileSync(mcpPath, "utf8")).toBe(mcpText);
    expect(readFileSync(geminiSettings(), "utf8")).not.toContain("hook antigravity");

    expect(uninstallAntigravity(context()).settings).toBe("restored");
  });

  test("an Antigravity entry is not Gemini's, and a Gemini entry is not Antigravity's", () => {
    const named = (definition: unknown) => JSON.stringify({ "wizardingcode-mem": definition });
    expect(inspectAntigravityHooks(named({ Stop: ours("turn-end") })).events).toEqual(["Stop"]);
    // Gemini's settings.json shape, even holding an entry of ours, is not Antigravity's file.
    const asGeminiSettings = JSON.stringify({ hooks: { PreInvocation: [{ hooks: ours("x") }] } });
    expect(inspectAntigravityHooks(asGeminiSettings).events).toEqual([]);
    const geminiEntry = { type: "command", command: `'${BIN}' hook gemini turn-end` };
    expect(inspectAntigravityHooks(named({ Stop: [geminiEntry] })).events).toEqual([]);
  });
});

describe("antigravityContext", () => {
  test("is ~/.gemini/config under HOME", () => {
    const c = antigravityContext(BIN, { HOME: "/h" });
    expect(c.configDir).toBe("/h/.gemini/config");
    expect(c.settingsPath).toBe("/h/.gemini/config/hooks.json");
    expect(c.mcpPath).toBe("/h/.gemini/config/mcp_config.json");
  });

  test("is not moved by Gemini CLI's own variable", () => {
    const c = antigravityContext(BIN, { HOME: "/h", GEMINI_CLI_HOME: "/elsewhere" });
    expect(c.settingsPath).toBe("/h/.gemini/config/hooks.json");
  });
});

describe("detectAgents finds Antigravity", () => {
  test("by its command, agy, on PATH, before any directory of its exists", () => {
    const found = detectAgents({
      env: { HOME: home },
      which: (command) => (command === "agy" ? "/usr/local/bin/agy" : null),
    });
    expect(found).toContain("antigravity");
    expect(existsSync(gemini)).toBe(false);
  });

  test.each(["antigravity-cli", "antigravity", "antigravity-ide", "config"])(
    "by its directory ~/.gemini/%s",
    (dir) => {
      mkdirSync(join(gemini, dir), { recursive: true });
      expect(detectAgents({ env: { HOME: home }, which: () => null })).toContain("antigravity");
    },
  );

  test("not by a Gemini CLI setup alone", () => {
    mkdirSync(gemini, { recursive: true });
    writeFileSync(join(gemini, "settings.json"), "{}");
    expect(detectAgents({ env: { HOME: home }, which: () => null })).not.toContain("antigravity");
  });
});

describe("wizardingcode-mem install antigravity / uninstall antigravity / doctor", () => {
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
    const installed = await runCliWith(
      { env: env() },
      "install",
      "antigravity",
      "--binary",
      binary,
    );
    expect(installed.stderr).toBe("");
    expect(installed.exitCode).toBe(0);
    expect(installed.stdout).toContain("Installed wizardingcode-mem for Antigravity.");
    expect(installed.stdout).toContain(`MCP:    registered in ${mcpPath}`);
    expect(hooks()["wizardingcode-mem"].Stop[0].command).toBe(
      `'${binary}' hook antigravity turn-end`,
    );

    const doctor = await runCliWith({ env: env() }, "doctor");
    const line = doctor.stdout.split("\n").find((l) => l.includes("Antigravity:"));
    expect(line).toBe(`ok    Antigravity: installed, running ${binary}`);

    const removed = await runCliWith({ env: env() }, "uninstall", "antigravity");
    expect(removed.exitCode).toBe(0);
    expect(removed.stdout).toContain("Removed wizardingcode-mem from Antigravity.");
    expect(readFileSync(hooksPath, "utf8")).toBe(THEIR_HOOKS);
    expect(readFileSync(mcpPath, "utf8")).toBe(THEIR_MCP);
  });

  test("doctor skips Antigravity when it is not on the machine", async () => {
    const doctor = await runCliWith({ env: env() }, "doctor");
    const line = doctor.stdout.split("\n").find((l) => l.includes("Antigravity:"));
    expect(line).toStartWith("skip");
  });

  test("install's usage names antigravity", async () => {
    const result = await runCliWith({ env: env() }, "install", "nope");
    expect(result.stderr).toContain("antigravity");
  });
});
