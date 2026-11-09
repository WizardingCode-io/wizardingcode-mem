import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentIdFromClient, checkedAgentId } from "../../src/mcp/agent-id.ts";
import { runCliWith } from "../helpers/cli.ts";

// Who proposes over MCP: the host's name from the handshake, through one table, or the
// id the server was started with. The id is not authenticated; it tells an agent from a
// person, and one agent from another for the hourly rate.

describe("agentIdFromClient", () => {
  test("maps each host's name, lower-cased and by prefix, and anything else to mcp", () => {
    expect(agentIdFromClient("claude-code")).toBe("claude-code");
    expect(agentIdFromClient("Claude Code")).toBe("claude-code");
    expect(agentIdFromClient("codex-cli")).toBe("codex");
    expect(agentIdFromClient("Cursor")).toBe("cursor");
    expect(agentIdFromClient("Claude Desktop")).toBe("claude-desktop");
    expect(agentIdFromClient("something-else")).toBe("mcp");
    expect(agentIdFromClient(undefined)).toBe("mcp");
  });
});

describe("checkedAgentId", () => {
  test("gives back an id of lower-case letters, digits and hyphens, and throws otherwise", () => {
    expect(checkedAgentId("codex")).toBe("codex");
    expect(() => checkedAgentId("Bad Id")).toThrow();
  });
});

describe("mcp --agent", () => {
  let base: string;
  let env: Record<string, string>;
  beforeAll(() => {
    base = realpathSync(mkdtempSync(join(tmpdir(), "wizardingcode-mem-agent-id-")));
    env = {
      WIZARDINGCODE_MEM_DATA_DIR: join(base, "data"),
      WIZARDINGCODE_HOME: join(base, "home"),
      WIZARDINGCODE_MEM_STORE_DIR: join(base, "store"),
      WIZARDINGCODE_MEM_MIGRATE: "off",
      WIZARDINGCODE_MEM_DISTILL: "off",
      WIZARDINGCODE_MEM_UI_AUTO_OPEN: "off",
      HOME: join(base, "home"),
      USERPROFILE: join(base, "home"),
    };
  });
  afterAll(() => {
    rmSync(base, { recursive: true, force: true });
  });

  test("an invalid value exits 64 naming the flag, and starts no server", async () => {
    const result = await runCliWith({ input: "", env }, "mcp", "--agent", "Bad Id");
    expect(result.exitCode).toBe(64);
    expect(result.stderr).toContain("--agent");
    expect(result.stdout).toBe("");
  });

  test("a missing value exits 64 naming the flag, and starts no server", async () => {
    const result = await runCliWith({ input: "", env }, "mcp", "--agent");
    expect(result.exitCode).toBe(64);
    expect(result.stderr).toContain("--agent");
    expect(result.stdout).toBe("");
  });
});
