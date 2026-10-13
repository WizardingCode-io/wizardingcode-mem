import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pkg from "../../package.json" with { type: "json" };
import { generated } from "../../scripts/plugins.ts";

// What every agent's plugin runs: plugin/wizardingcode-mem.sh and its copies. Driven the way an
// agent drives it, with a stand-in binary and a stand-in release to fetch it from.

const ROOT = new URL("../../", import.meta.url).pathname;
const SCRIPT = join(ROOT, "plugin", "wizardingcode-mem.sh");
const os = process.platform === "darwin" ? "darwin" : "linux";
const arch = process.arch === "arm64" ? "arm64" : "x64";
const FILE = `wizardingcode-mem-${os}-${arch}`;
const fake = (version: string) =>
  `#!/bin/sh\necho "$*" >> "$(dirname "$0")/calls.txt"\nif [ "$1" = "--version" ]; then echo ${version}; exit 0; fi\ncat > "$(dirname "$0")/stdin.txt"\necho "ran: $*"\n`;
const calls = () =>
  readFileSync(join(home, ".wizardingcode", "mem", "bin", "calls.txt"), "utf8")
    .trim()
    .split("\n");

let home: string;
let server: ReturnType<typeof Bun.serve> | undefined;
let downloads = 0;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "wizardingcode-mem-plugin-"));
  downloads = 0;
});
afterEach(async () => {
  await server?.stop(true);
  server = undefined;
  rmSync(home, { recursive: true, force: true });
});

const binary = () => join(home, ".wizardingcode", "mem", "bin", "wizardingcode-mem");

function release(version = pkg.version, checksum?: string): string {
  const body = fake(version);
  const sha = checksum ?? new Bun.CryptoHasher("sha256").update(body).digest("hex");
  server = Bun.serve({
    // Loopback by name: on every interface, the port handed out may already be
    // another process's on 127.0.0.1, and the request would go to it.
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) => {
      const path = new URL(request.url).pathname;
      if (path.endsWith(`/${FILE}`)) {
        downloads++;
        return new Response(body);
      }
      if (path.endsWith("/checksums.txt")) return new Response(`${sha}  ${FILE}\n`);
      return new Response("", { status: 404 });
    },
  });
  return `http://127.0.0.1:${server.port}/download/v${version}`;
}

function place(version: string): void {
  mkdirSync(join(home, ".wizardingcode", "mem", "bin"), { recursive: true });
  writeFileSync(binary(), fake(version));
  chmodSync(binary(), 0o755);
}

async function run(args: string[], base = "http://127.0.0.1:9/none") {
  const proc = Bun.spawn(["sh", SCRIPT, ...args], {
    env: {
      ...process.env,
      HOME: home,
      WIZARDINGCODE_HOME: join(home, ".wizardingcode"),
      WIZARDINGCODE_MEM_DATA_DIR: "",
      WIZARDINGCODE_MEM_RELEASE_BASE: base,
    },
    stdin: new TextEncoder().encode('{"session_id":"s","cwd":"/p"}'),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}
const hook = (agent: string, event: string, base?: string) => run(["hook", agent, event], base);

describe("what the agents install", () => {
  test("every generated file is the one scripts/plugins.ts would write now", () => {
    for (const [path, content] of Object.entries(generated())) {
      expect({ path, content: readFileSync(join(ROOT, path), "utf8") }).toEqual({ path, content });
    }
  });

  test("one version everywhere: the binary's, each plugin's and both npm packages'", () => {
    const version = (path: string) =>
      (JSON.parse(readFileSync(join(ROOT, path), "utf8")) as { version: string }).version;
    for (const path of [
      ".claude-plugin/plugin.json",
      "plugins/codex/.codex-plugin/plugin.json",
      "plugins/cursor/.cursor-plugin/plugin.json",
      "plugins/opencode/package.json",
      "npm/package.json",
    ]) {
      expect({ path, version: version(path) }).toEqual({ path, version: pkg.version });
    }
    expect(readFileSync(SCRIPT, "utf8")).toContain(`VERSION="${pkg.version}"`);
  });

  test("each agent's hooks name its own events and call the script as that agent", () => {
    const events = (path: string) =>
      Object.keys((JSON.parse(readFileSync(join(ROOT, path), "utf8")) as { hooks: object }).hooks);
    expect(events("hooks/hooks.json")).toEqual([
      "SessionStart",
      "UserPromptSubmit",
      "Stop",
      "SessionEnd",
      "PostToolUse",
    ]);
    expect(events("plugins/codex/hooks/hooks.json")).toEqual([
      "SessionStart",
      "UserPromptSubmit",
      "Stop",
      "SessionEnd",
    ]);
    expect(events("plugins/cursor/hooks/hooks.json")).toEqual([
      "sessionStart",
      "beforeSubmitPrompt",
      "afterAgentResponse",
      "sessionEnd",
    ]);
    expect(readFileSync(join(ROOT, "plugins/codex/hooks/hooks.json"), "utf8")).toContain(
      "hook codex turn-end",
    );
    expect(readFileSync(join(ROOT, "plugins/cursor/hooks/hooks.json"), "utf8")).toContain(
      "hook cursor prompt",
    );
    // A root .mcp.json would also make the server a project-scope one for whoever opens this repository.
    expect(existsSync(join(ROOT, ".mcp.json"))).toBe(false);
  });
});

describe("Gemini CLI, no longer supported", () => {
  test("no generated file and no release step mentions it", () => {
    for (const [path, content] of Object.entries(generated())) {
      expect({ path, gemini: /gemini/i.test(content) }).toEqual({ path, gemini: false });
    }
    expect(existsSync(join(ROOT, "plugins/gemini"))).toBe(false);
    expect(readFileSync(join(ROOT, ".github/workflows/release.yml"), "utf8")).not.toMatch(
      /gemini/i,
    );
  });
});

describe("plugin/wizardingcode-mem.sh", () => {
  test("with the binary in place, runs it for the agent and event, saying it came through a plugin", async () => {
    place(pkg.version);
    expect(await hook("codex", "prompt")).toEqual({
      stdout: "ran: hook codex prompt --via-plugin\n",
      stderr: "",
      exitCode: 0,
    });
    expect(readFileSync(join(home, ".wizardingcode", "mem", "bin", "stdin.txt"), "utf8")).toBe(
      '{"session_id":"s","cwd":"/p"}',
    );
  });

  test("a prompt, stop or file hook hands over at once: the binary's version is asked at the session start only", async () => {
    place(pkg.version);
    for (const event of ["prompt", "turn-end", "session-end", "file-read"]) {
      expect((await hook("claude-code", event)).stdout).toBe(
        `ran: hook claude-code ${event} --via-plugin\n`,
      );
    }
    expect(calls().filter((call) => call === "--version")).toEqual([]);
    await hook("claude-code", "session-start");
    expect(calls().filter((call) => call === "--version")).toEqual(["--version"]);
  });

  test("without the binary, a prompt or stop hook does nothing and never waits on a download", async () => {
    for (const event of ["prompt", "turn-end", "session-end"]) {
      expect(await hook("claude-code", event, release())).toEqual({
        stdout: "",
        stderr: "",
        exitCode: 0,
      });
      await server?.stop(true);
    }
    expect(downloads).toBe(0);
    expect(existsSync(binary())).toBe(false);
  });

  test("the first session start fetches the plugin's version into the shared place, then runs it", async () => {
    const result = await hook("claude-code", "session-start", release());
    expect(result).toEqual({
      stdout: "ran: hook claude-code session-start --via-plugin\n",
      stderr: "",
      exitCode: 0,
    });
    expect(downloads).toBe(1);
    expect((await hook("cursor", "prompt")).stdout).toBe("ran: hook cursor prompt --via-plugin\n");
    expect(downloads).toBe(1);
  });

  test("an older binary keeps working, and is replaced at the next session start", async () => {
    place("0.0.1");
    expect((await hook("codex", "prompt")).stdout).toBe("ran: hook codex prompt --via-plugin\n");
    await hook("codex", "session-start", release());
    expect(downloads).toBe(1);
    expect(readFileSync(binary(), "utf8")).toContain(`echo ${pkg.version};`);
  });

  test("a newer binary, from another agent's newer plugin, is never replaced by an older one", async () => {
    place("99.0.0");
    await hook("codex", "session-start", release());
    expect(downloads).toBe(0);
    expect(readFileSync(binary(), "utf8")).toContain("echo 99.0.0;");
  });

  // The plugin's own version may itself be a pre-release; both cases are covered from it.
  const [base, pre] = pkg.version.split("-");

  test("an earlier pre-release of the same version gives way to the plugin's version", async () => {
    // "-aaa" sorts before any "-rc.N"; with a final plugin version, any pre-release is older.
    place(pre === undefined ? `${base}-rc.1` : `${base}-aaa`);
    await hook("codex", "session-start", release());
    expect(downloads).toBe(1);
  });

  test.skipIf(pre === undefined)(
    "the final release is never replaced by its pre-release",
    async () => {
      place(base as string);
      await hook("codex", "session-start", release());
      expect(downloads).toBe(0);
    },
  );

  test("when the download fails, or its checksum is wrong, the session starts anyway, silently", async () => {
    expect(await hook("codex", "session-start")).toEqual({ stdout: "", stderr: "", exitCode: 0 });
    const base = release(pkg.version, "f".repeat(64));
    expect(await hook("codex", "session-start", base)).toEqual({
      stdout: "",
      stderr: "",
      exitCode: 0,
    });
    expect(downloads).toBe(1);
    expect(existsSync(binary())).toBe(false);
  });

  test("as an MCP server, hands over to the binary", async () => {
    place(pkg.version);
    expect(await run(["mcp"])).toEqual({ stdout: "ran: mcp\n", stderr: "", exitCode: 0 });
  });

  test("anything else does nothing", async () => {
    place(pkg.version);
    expect(await run(["doctor"])).toEqual({ stdout: "", stderr: "", exitCode: 0 });
  });
});
