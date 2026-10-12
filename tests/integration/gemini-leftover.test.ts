import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  antigravityContext,
  installAntigravity,
  uninstallAntigravity,
} from "../../src/install/antigravity.ts";
import { detectAgents } from "../../src/install/detect.ts";
import {
  findGeminiLeftover,
  type GeminiLeftover,
  geminiLeftoverContext,
  offerGeminiCleanup,
  removeGeminiLeftover,
} from "../../src/install/gemini-leftover.ts";
import { runCliWith } from "../helpers/cli.ts";

// Gemini CLI is no longer supported. What an old install of ours left in ~/.gemini — hooks
// and an MCP server in settings.json, an extension under extensions/ — is recognised and
// removed; nothing else in ~/.gemini is, least of all Antigravity's ~/.gemini/config.

let home: string;
let gemini: string;
let settingsPath: string;
let dataDir: string;
let commands: string[][];

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "wizardingcode-mem-gemini-leftover-"));
  gemini = join(home, ".gemini");
  settingsPath = join(gemini, "settings.json");
  dataDir = join(home, ".wizardingcode", "mem");
  commands = [];
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

const BIN = "/opt/wizardingcode-mem/bin/wizardingcode-mem";
const ourHook = (event: string, binary = BIN) => ({
  name: "wizardingcode-mem",
  type: "command",
  command: `'${binary}' hook gemini ${event}`,
  timeout: 5000,
});
const THEIR_HOOK = { name: "lint", type: "command", command: "npm run lint", timeout: 1000 };
const THEIR_SERVER = { command: "their-server", args: [] };

/** An old install of ours beside the user's own settings, hooks and server. */
function seedOldInstall(): void {
  mkdirSync(gemini, { recursive: true });
  writeFileSync(
    settingsPath,
    `${JSON.stringify(
      {
        theme: "dark",
        hooks: {
          SessionStart: [{ hooks: [THEIR_HOOK] }, { hooks: [ourHook("session-start")] }],
          BeforeAgent: [{ hooks: [ourHook("prompt")] }],
          AfterAgent: [{ hooks: [ourHook("turn-end")] }],
          SessionEnd: [{ hooks: [ourHook("session-end")] }],
        },
        mcpServers: {
          theirs: THEIR_SERVER,
          "wizardingcode-mem": { command: BIN, args: ["mcp"] },
        },
      },
      null,
      2,
    )}\n`,
  );
  const extension = join(gemini, "extensions", "wizardingcode-mem");
  mkdirSync(join(extension, "bin"), { recursive: true });
  writeFileSync(
    join(extension, "gemini-extension.json"),
    JSON.stringify({ name: "wizardingcode-mem", version: "0.4.4" }),
  );
  writeFileSync(join(extension, "bin", "wizardingcode-mem"), "");
  // Another extension of the user's, never touched.
  mkdirSync(join(gemini, "extensions", "theirs"), { recursive: true });
  writeFileSync(join(gemini, "extensions", "theirs", "gemini-extension.json"), "{}");
}

const run = (ok: boolean) => (command: string[]) => {
  commands.push(command);
  return { ok, output: "" };
};
const ctx = (ok = false) => ({ settingsPath, dataDir, run: run(ok) });
const antigravity = () => ({ ...antigravityContext(BIN, { HOME: home }), dataDir, run: run(true) });

describe("findGeminiLeftover", () => {
  test("finds our hooks, our MCP server and our extension, and nothing of the user's", () => {
    seedOldInstall();
    expect(findGeminiLeftover(settingsPath)).toEqual({
      settingsPath,
      hooks: ["SessionStart", "BeforeAgent", "AfterAgent", "SessionEnd"],
      mcp: true,
      extensions: [join(gemini, "extensions", "wizardingcode-mem")],
    });
  });

  test("finds the extension of this product's old name too", () => {
    const old = join(gemini, "extensions", "shibaox-mem");
    mkdirSync(old, { recursive: true });
    writeFileSync(join(old, "gemini-extension.json"), JSON.stringify({ name: "shibaox-mem" }));
    expect(findGeminiLeftover(settingsPath)?.extensions).toEqual([old]);
  });

  test("a directory under our name whose manifest names someone else is not ours, and stays", () => {
    const foreign = join(gemini, "extensions", "wizardingcode-mem");
    mkdirSync(foreign, { recursive: true });
    writeFileSync(join(foreign, "gemini-extension.json"), JSON.stringify({ name: "not-us" }));
    const broken = join(gemini, "extensions", "shibaox-mem");
    mkdirSync(broken, { recursive: true });
    writeFileSync(join(broken, "gemini-extension.json"), "{ not json");
    expect(findGeminiLeftover(settingsPath)).toBeNull();
    expect(removeGeminiLeftover(ctx()).extensions).toEqual([]);
    expect(commands).toEqual([]);
    expect(existsSync(join(foreign, "gemini-extension.json"))).toBe(true);
    expect(existsSync(join(broken, "gemini-extension.json"))).toBe(true);
  });

  test("nothing of ours: null, whatever else ~/.gemini holds", () => {
    expect(findGeminiLeftover(settingsPath)).toBeNull();
    mkdirSync(gemini, { recursive: true });
    writeFileSync(
      settingsPath,
      JSON.stringify({ hooks: { SessionStart: [{ hooks: [THEIR_HOOK] }] } }),
    );
    expect(findGeminiLeftover(settingsPath)).toBeNull();
    writeFileSync(settingsPath, "{ not json");
    expect(findGeminiLeftover(settingsPath)).toBeNull();
  });

  test("an Antigravity install in ~/.gemini/config is not a Gemini leftover", () => {
    installAntigravity(antigravity());
    expect(existsSync(join(gemini, "config", "hooks.json"))).toBe(true);
    expect(findGeminiLeftover(settingsPath)).toBeNull();
  });
});

describe("removeGeminiLeftover", () => {
  test("takes out only ours: the user's hooks, server, settings and extensions stay", () => {
    seedOldInstall();
    const result = removeGeminiLeftover(ctx());
    expect(result.settings).toBe("edited");
    expect(JSON.parse(readFileSync(settingsPath, "utf8"))).toEqual({
      theme: "dark",
      hooks: { SessionStart: [{ hooks: [THEIR_HOOK] }] },
      mcpServers: { theirs: THEIR_SERVER },
    });
    // Gemini's own command is tried first; without it, the directory goes.
    expect(commands).toEqual([["gemini", "extensions", "uninstall", "wizardingcode-mem"]]);
    expect(result.extensions).toEqual([join(gemini, "extensions", "wizardingcode-mem")]);
    expect(existsSync(join(gemini, "extensions", "wizardingcode-mem"))).toBe(false);
    expect(existsSync(join(gemini, "extensions", "theirs", "gemini-extension.json"))).toBe(true);
    expect(findGeminiLeftover(settingsPath)).toBeNull();
  });

  test("with nothing of ours, nothing changes and nothing runs", () => {
    mkdirSync(gemini, { recursive: true });
    const theirs = JSON.stringify({ hooks: { SessionStart: [{ hooks: [THEIR_HOOK] }] } });
    writeFileSync(settingsPath, theirs);
    expect(removeGeminiLeftover(ctx()).settings).toBe("untouched");
    expect(readFileSync(settingsPath, "utf8")).toBe(theirs);
    expect(commands).toEqual([]);
  });

  test("leaves Antigravity's hooks and server alone, and Antigravity's uninstall leaves ours alone", () => {
    seedOldInstall();
    installAntigravity(antigravity());
    const hooksText = readFileSync(join(gemini, "config", "hooks.json"), "utf8");
    const mcpText = readFileSync(join(gemini, "config", "mcp_config.json"), "utf8");
    const settingsText = readFileSync(settingsPath, "utf8");

    // Antigravity's uninstall does not touch the Gemini leftover...
    uninstallAntigravity(antigravity());
    expect(readFileSync(settingsPath, "utf8")).toBe(settingsText);
    expect(findGeminiLeftover(settingsPath)?.hooks).toHaveLength(4);

    // ...and the Gemini cleanup does not touch Antigravity's files.
    installAntigravity(antigravity());
    removeGeminiLeftover(ctx());
    expect(readFileSync(join(gemini, "config", "hooks.json"), "utf8")).toBe(hooksText);
    expect(readFileSync(join(gemini, "config", "mcp_config.json"), "utf8")).toBe(mcpText);
  });
});

describe("offerGeminiCleanup", () => {
  const FOUND: GeminiLeftover = {
    settingsPath: "/h/.gemini/settings.json",
    hooks: ["SessionStart"],
    mcp: true,
    extensions: [],
  };
  function harness(found: GeminiLeftover | null, answer: boolean, tty: boolean) {
    const calls = { asked: [] as string[], removed: 0 };
    const deps = {
      find: () => found,
      remove: () => {
        calls.removed += 1;
        return { settings: "edited" as const, settingsPath: FOUND.settingsPath, extensions: [] };
      },
      tty,
      confirm: (question: string) => {
        calls.asked.push(question);
        return answer;
      },
    };
    return { calls, deps };
  }

  test("nothing left: nothing said, nothing asked", () => {
    const { calls, deps } = harness(null, true, true);
    expect(offerGeminiCleanup([], deps)).toEqual([]);
    expect(calls.asked).toEqual([]);
  });

  test("on a terminal, yes removes it and says so", () => {
    const { calls, deps } = harness(FOUND, true, true);
    const lines = offerGeminiCleanup([], deps);
    expect(calls.asked[0]).toContain("Gemini CLI");
    expect(calls.asked[0]).toContain("Antigravity");
    expect(calls.removed).toBe(1);
    expect(lines.join("\n")).toContain("removed");
  });

  test("on a terminal, no leaves it and says how to remove it later", () => {
    const { calls, deps } = harness(FOUND, false, true);
    const lines = offerGeminiCleanup([], deps);
    expect(calls.removed).toBe(0);
    expect(lines.join("\n")).toContain("wizardingcode-mem uninstall gemini");
  });

  test("without a terminal: one hint line naming the command and Antigravity, nothing removed", () => {
    const { calls, deps } = harness(FOUND, true, false);
    const lines = offerGeminiCleanup([], deps);
    expect(calls.asked).toEqual([]);
    expect(calls.removed).toBe(0);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("wizardingcode-mem uninstall gemini");
    expect(lines[0]).toContain("wizardingcode-mem install antigravity");
  });

  test("--yes removes it without asking", () => {
    const { calls, deps } = harness(FOUND, false, false);
    offerGeminiCleanup(["--yes"], deps);
    expect(calls.asked).toEqual([]);
    expect(calls.removed).toBe(1);
  });
});

describe("geminiLeftoverContext", () => {
  test("is ~/.gemini/settings.json, or under GEMINI_CLI_HOME", () => {
    expect(geminiLeftoverContext({ HOME: "/h" }).settingsPath).toBe("/h/.gemini/settings.json");
    expect(geminiLeftoverContext({ HOME: "/h", GEMINI_CLI_HOME: "/g" }).settingsPath).toBe(
      "/g/settings.json",
    );
  });
});

describe("Gemini CLI on the command line", () => {
  const env = () => ({
    HOME: home,
    CLAUDE_CONFIG_DIR: join(home, ".claude"),
    WIZARDINGCODE_MEM_DATA_DIR: dataDir,
    XDG_CONFIG_HOME: join(home, ".config"),
    PATH: "/nonexistent",
  });

  test("install gemini says support was removed and points to Antigravity", async () => {
    const binary = join(home, "wizardingcode-mem");
    writeFileSync(binary, "");
    const result = await runCliWith({ env: env() }, "install", "gemini", "--binary", binary);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Gemini CLI support was removed");
    expect(result.stderr).toContain("wizardingcode-mem install antigravity");
    expect(existsSync(gemini)).toBe(false);
  });

  test("uninstall gemini removes the leftover, and only it", async () => {
    seedOldInstall();
    const result = await runCliWith({ env: env() }, "uninstall", "gemini");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Gemini CLI");
    expect(findGeminiLeftover(settingsPath)).toBeNull();
    expect(JSON.parse(readFileSync(settingsPath, "utf8")).hooks).toEqual({
      SessionStart: [{ hooks: [THEIR_HOOK] }],
    });
  });

  test("uninstall gemini with nothing left says so", async () => {
    const result = await runCliWith({ env: env() }, "uninstall", "gemini");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("nothing");
  });

  test("install with no agent, without a terminal, hints once and removes nothing", async () => {
    seedOldInstall();
    mkdirSync(join(home, ".codex"));
    const binary = join(home, "wizardingcode-mem");
    writeFileSync(binary, "");
    const before = readFileSync(settingsPath, "utf8");
    const result = await runCliWith(
      { env: { ...env(), CODEX_HOME: join(home, ".codex") } },
      "install",
      "--binary",
      binary,
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Installed wizardingcode-mem for Codex.");
    const hints = result.stdout.split("\n").filter((line) => line.includes("Gemini CLI"));
    expect(hints).toHaveLength(1);
    expect(hints[0]).toContain("wizardingcode-mem uninstall gemini");
    expect(hints[0]).toContain("Antigravity");
    expect(readFileSync(settingsPath, "utf8")).toBe(before);
  });

  test("install with no agent and only ~/.gemini installs nothing for Gemini", async () => {
    seedOldInstall();
    const binary = join(home, "wizardingcode-mem");
    writeFileSync(binary, "");
    const before = readFileSync(settingsPath, "utf8");
    const result = await runCliWith({ env: env() }, "install", "--binary", binary);
    expect(result.stdout).not.toContain("Installed wizardingcode-mem for Gemini");
    expect(result.stdout).toContain("wizardingcode-mem uninstall gemini");
    expect(readFileSync(settingsPath, "utf8")).toBe(before);
    expect(detectAgents({ env: { HOME: home }, which: () => null })).toEqual([]);
  });

  test("doctor names the leftover as a warning, with the command that cleans it", async () => {
    seedOldInstall();
    const result = await runCliWith({ env: env() }, "doctor");
    const line = result.stdout.split("\n").find((each) => each.includes("Gemini CLI")) ?? "";
    expect(line).toStartWith("warn");
    expect(line).toContain("wizardingcode-mem uninstall gemini");

    rmSync(gemini, { recursive: true, force: true });
    const clean = await runCliWith({ env: env() }, "doctor");
    expect(clean.stdout).not.toContain("Gemini");
  });

  test("hook gemini, from an old install, exits 0 with no output and records nothing", async () => {
    const payload = JSON.stringify({
      session_id: "s1",
      cwd: home,
      hook_event_name: "SessionStart",
      source: "startup",
    });
    for (const event of ["session-start", "prompt", "turn-end", "session-end"]) {
      for (const flags of [[], ["--via-plugin"]]) {
        const result = await runCliWith(
          {
            input: payload,
            env: {
              ...env(),
              WIZARDINGCODE_MEM_DISTILL: "off",
              WIZARDINGCODE_MEM_UI_AUTO_OPEN: "off",
            },
          },
          "hook",
          "gemini",
          event,
          ...flags,
        );
        expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
      }
    }
    expect(existsSync(dataDir)).toBe(false);
  });
});
