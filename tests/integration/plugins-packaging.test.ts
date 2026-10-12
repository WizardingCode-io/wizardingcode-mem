import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pkg from "../../package.json" with { type: "json" };
import { TARGETS } from "../../scripts/build.ts";

const ROOT = new URL("../../", import.meta.url).pathname;
const os = process.platform === "darwin" ? "darwin" : "linux";
const arch = process.arch === "arm64" ? "arm64" : "x64";
const FILE = `wizardingcode-mem-${os}-${arch}`;

let base: string;
let server: ReturnType<typeof Bun.serve> | undefined;
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "wizardingcode-mem-packaging-"));
});
afterEach(async () => {
  await server?.stop(true);
  server = undefined;
  rmSync(base, { recursive: true, force: true });
});

const sh = (...command: string[]) =>
  Bun.spawnSync(command, { stdout: "pipe", stderr: "pipe", env: { ...process.env } });

describe("the OpenCode npm plugin", () => {
  const fake = (version: string) =>
    `#!/bin/sh\nif [ "$1" = "--version" ]; then echo ${version}; exit 0; fi\ncat > /dev/null\necho "notes for $3"\n`;

  function release(): string {
    const body = fake(pkg.version);
    const sha = new Bun.CryptoHasher("sha256").update(body).digest("hex");
    server = Bun.serve({
      // Loopback by name: on every interface, the port handed out may already be
      // another process's on 127.0.0.1, and the request would go to it.
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request) => {
        const path = new URL(request.url).pathname;
        if (path.endsWith(`/${FILE}`)) return new Response(body);
        if (path.endsWith("/checksums.txt")) return new Response(`${sha}  ${FILE}\n`);
        return new Response("", { status: 404 });
      },
    });
    return `http://127.0.0.1:${server.port}/dl`;
  }

  /** Loads the package the way OpenCode does, in a process whose HOME is the test's. */
  async function load(extraEnv: Record<string, string> = {}) {
    const script = `
      const mod = await import(${JSON.stringify(join(ROOT, "plugins/opencode/index.js"))});
      const exported = Object.keys(mod);
      const hooks = await mod.WizardingCodeMem({ directory: "/Users/dev/project", client: {} });
      let system = [];
      if (hooks["chat.message"]) {
        await hooks["chat.message"]({ sessionID: "s1" }, { message: { id: "m1", role: "user" }, parts: [{ type: "text", text: "why?" }] });
        const output = { system: [] };
        await hooks["experimental.chat.system.transform"]({ sessionID: "s1" }, output);
        system = output.system;
      }
      console.log(JSON.stringify({ exported, hooks: Object.keys(hooks).sort(), system }));
    `;
    const proc = Bun.spawn([process.execPath, "-e", script], {
      env: {
        ...process.env,
        HOME: base,
        WIZARDINGCODE_HOME: join(base, ".wizardingcode"),
        WIZARDINGCODE_MEM_DATA_DIR: "",
        XDG_CONFIG_HOME: join(base, ".config"),
        WIZARDINGCODE_MEM_RELEASE_BASE: release(),
        ...extraEnv,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (stdout.trim() === "") throw new Error(stderr);
    return JSON.parse(stdout) as { exported: string[]; hooks: string[]; system: string[] };
  }

  test("exports one plugin and nothing else, fetches the binary on first load, and speaks through it", async () => {
    const loaded = await load();
    // OpenCode calls every export as a plugin: there must be exactly one.
    expect(loaded.exported).toEqual(["WizardingCodeMem"]);
    expect(existsSync(join(base, ".wizardingcode", "mem", "bin", "wizardingcode-mem"))).toBe(true);
    expect(loaded.hooks).toContain("chat.message");
    expect(loaded.hooks).toContain("event");
    expect(loaded.system).toEqual(["notes for prompt\n"]);
  });

  test("stands down when the plugin file of the direct install is there", async () => {
    mkdirSync(join(base, ".config", "opencode", "plugins"), { recursive: true });
    writeFileSync(
      join(base, ".config", "opencode", "plugins", "wizardingcode-mem.ts"),
      "// @wizardingcode-mem-plugin\nexport const WizardingCodeMem = async () => ({});\n",
    );
    expect((await load()).hooks).toEqual([]);
  });

  test("the package declares what OpenCode needs to load it", () => {
    const manifest = JSON.parse(
      readFileSync(join(ROOT, "plugins/opencode/package.json"), "utf8"),
    ) as {
      name: string;
      main: string;
      type: string;
      files: string[];
      dependencies: Record<string, string>;
    };
    expect(manifest).toMatchObject({
      name: "wizardingcode-mem-opencode",
      main: "./index.js",
      type: "module",
    });
    expect(Object.keys(manifest.dependencies)).toEqual(["@opencode-ai/plugin"]);
    for (const file of manifest.files)
      expect(existsSync(join(ROOT, "plugins/opencode", file))).toBe(true);
  });
});

describe("generated Claude Code hooks", () => {
  test("hooks.json scopes the file-read event to Read, with the short timeout, and holds tool-failed back", () => {
    const { hooks } = JSON.parse(readFileSync(join(ROOT, "hooks", "hooks.json"), "utf8"));
    expect(hooks.PostToolUse).toHaveLength(1);
    expect(hooks.PostToolUse[0].matcher).toBe("Read");
    expect(hooks.PostToolUse[0].hooks[0].args.slice(-1)).toEqual(["file-read"]);
    expect(hooks.PostToolUse[0].hooks[0].timeout).toBe(5);
    // Held: too noisy on real history (ADR 0015).
    expect(hooks.PostToolUseFailure).toBeUndefined();
    expect(hooks.Stop[0].matcher).toBeUndefined();
  });
});
