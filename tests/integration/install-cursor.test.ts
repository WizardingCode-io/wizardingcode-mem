import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cursorContext, installCursor, uninstallCursor } from "../../src/install/cursor.ts";
import type { InstallContext } from "../../src/install/hooks-file.ts";
import { runCliWith } from "../helpers/cli.ts";

let home: string;
let hooksPath: string;
let mcpPath: string;
let dataDir: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "wizardingcode-mem-install-cursor-"));
  mkdirSync(join(home, ".cursor"));
  hooksPath = join(home, ".cursor", "hooks.json");
  mcpPath = join(home, ".cursor", "mcp.json");
  dataDir = join(home, ".wizardingcode", "mem");
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

const BIN = "/opt/wizardingcode-mem/bin/wizardingcode-mem";
const context = (binaryPath = BIN): InstallContext & { mcpPath: string } => ({
  settingsPath: hooksPath,
  mcpPath,
  dataDir,
  binaryPath,
  now: () => 1_700_000_000_000,
  run: () => ({ ok: false, output: "" }),
});
const hooks = () => JSON.parse(readFileSync(hooksPath, "utf8"));
const mcp = () => JSON.parse(readFileSync(mcpPath, "utf8"));
const ours = (event: string) => ({ command: `'${BIN}' hook cursor ${event}`, timeout: 5 });

describe("install cursor", () => {
  test("writes hooks.json in Cursor's flat layout, with its version, and the MCP server into mcp.json", () => {
    const result = installCursor(context());
    expect(result.changed).toBe(true);
    expect(result.mcp).toBe("registered");
    expect(hooks()).toEqual({
      version: 1,
      hooks: {
        sessionStart: [ours("session-start")],
        beforeSubmitPrompt: [ours("prompt")],
        afterAgentResponse: [ours("turn-end")],
        sessionEnd: [ours("session-end")],
      },
    });
    expect(mcp()).toEqual({ mcpServers: { "wizardingcode-mem": { command: BIN, args: ["mcp"] } } });
  });

  test("keeps the user's own hooks and MCP servers, and replaces an older binary of ours", () => {
    const theirs = { command: "lint.sh", matcher: "\\.ts$" };
    writeFileSync(
      hooksPath,
      JSON.stringify(
        { version: 1, hooks: { afterFileEdit: [theirs], sessionStart: [theirs] } },
        null,
        2,
      ),
    );
    writeFileSync(
      mcpPath,
      JSON.stringify({ mcpServers: { github: { url: "https://x" } } }, null, 2),
    );
    installCursor(context("/old/wizardingcode-mem"));
    installCursor(context());
    expect(hooks().hooks.afterFileEdit).toEqual([theirs]);
    expect(hooks().hooks.sessionStart).toEqual([theirs, ours("session-start")]);
    expect(readFileSync(hooksPath, "utf8")).not.toContain("/old/");
    expect(mcp().mcpServers.github).toEqual({ url: "https://x" });
    expect(mcp().mcpServers["wizardingcode-mem"].command).toBe(BIN);
  });

  test("takes the place of a shibaox-mem install, hooks and MCP server alike", () => {
    writeFileSync(
      mcpPath,
      JSON.stringify({
        mcpServers: { "shibaox-mem": { command: "/x/shibaox-mem", args: ["mcp"] } },
      }),
    );
    installCursor(context("/Users/me/.shibaox/mem/bin/shibaox-mem"));
    installCursor(context());
    expect(readFileSync(hooksPath, "utf8")).not.toContain("shibaox");
    expect(hooks().hooks.sessionStart).toEqual([ours("session-start")]);
    expect(Object.keys(mcp().mcpServers)).toEqual(["wizardingcode-mem"]);
  });

  test("installing twice changes nothing the second time", () => {
    installCursor(context());
    const first = readFileSync(hooksPath, "utf8");
    expect(installCursor(context()).changed).toBe(false);
    expect(readFileSync(hooksPath, "utf8")).toBe(first);
  });
});

describe("an invalid mcp.json stops install before anything is written", () => {
  test("the user's hooks.json is left as it was, with no receipt", () => {
    const original = '{"version": 1, "hooks": {}}\n';
    writeFileSync(hooksPath, original);
    writeFileSync(mcpPath, '{\n  /* mine */\n  "mcpServers": {}\n}\n');
    expect(() => installCursor(context())).toThrow(`comments in ${mcpPath} are not supported yet`);
    expect(readFileSync(hooksPath, "utf8")).toBe(original);
    expect(existsSync(join(dataDir, "install"))).toBe(false);
  });
});

describe("uninstall cursor", () => {
  test("puts hooks.json back and takes the server out of mcp.json, keeping the rest", () => {
    const original = '{"version": 1, "hooks": {}}\n';
    writeFileSync(hooksPath, original);
    writeFileSync(
      mcpPath,
      JSON.stringify({ mcpServers: { github: { url: "https://x" } } }, null, 2),
    );
    installCursor(context());
    expect(uninstallCursor(context()).settings).toBe("restored");
    expect(readFileSync(hooksPath, "utf8")).toBe(original);
    expect(mcp()).toEqual({ mcpServers: { github: { url: "https://x" } } });
  });

  test("removes an mcp.json it created and left otherwise empty", () => {
    installCursor(context());
    uninstallCursor(context());
    expect(existsSync(mcpPath)).toBe(false);
  });
});

describe("cursorContext", () => {
  test("uses ~/.cursor", () => {
    const ctx = cursorContext(BIN, { HOME: "/h" });
    expect(ctx.settingsPath).toBe("/h/.cursor/hooks.json");
    expect(ctx.mcpPath).toBe("/h/.cursor/mcp.json");
  });
});

describe("wizardingcode-mem install cursor / uninstall cursor", () => {
  const env = () => ({ HOME: home, WIZARDINGCODE_MEM_DATA_DIR: dataDir, PATH: "/nonexistent" });

  test("installs with an explicit binary, then uninstalls cleanly", async () => {
    const binary = join(home, "wizardingcode-mem");
    writeFileSync(binary, "");
    const installed = await runCliWith({ env: env() }, "install", "cursor", "--binary", binary);
    expect(installed.stderr).toBe("");
    expect(installed.exitCode).toBe(0);
    expect(installed.stdout).toContain("Installed wizardingcode-mem for Cursor.");
    expect(installed.stdout).toContain(hooksPath);
    expect(installed.stdout).toContain(`MCP:    registered in ${mcpPath}`);
    expect(hooks().hooks.afterAgentResponse[0].command).toBe(`'${binary}' hook cursor turn-end`);

    const removed = await runCliWith({ env: env() }, "uninstall", "cursor");
    expect(removed.exitCode).toBe(0);
    expect(existsSync(hooksPath)).toBe(false);
    expect(existsSync(mcpPath)).toBe(false);
  });
});
