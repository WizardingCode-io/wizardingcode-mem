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
import npmPkg from "../../npm/package.json" with { type: "json" };
import rootPkg from "../../package.json" with { type: "json" };

// The npm package: a Node shim that fetches the binary of its own version on first use.
// Run with node, the way npx runs it, against a stand-in release.

const SHIM = new URL("../../npm/bin/wizardingcode-mem.js", import.meta.url).pathname;
const os = process.platform === "darwin" ? "darwin" : "linux";
const arch = process.arch === "arm64" ? "arm64" : "x64";
const FILE = `wizardingcode-mem-${os}-${arch}`;
const fake = (version: string) =>
  `#!/bin/sh\nif [ "$1" = "--version" ]; then echo ${version}; exit 0; fi\necho "ran: $*"\nexit 3\n`;

let home: string;
let server: ReturnType<typeof Bun.serve> | undefined;
let downloads = 0;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "wizardingcode-mem-npm-"));
  downloads = 0;
});
afterEach(async () => {
  // Awaited: a port still closing can be handed to the next test's server.
  await server?.stop(true);
  server = undefined;
  rmSync(home, { recursive: true, force: true });
});

function release(options: { version?: string; checksum?: string } = {}): string {
  const body = fake(options.version ?? npmPkg.version);
  const sha = options.checksum ?? new Bun.CryptoHasher("sha256").update(body).digest("hex");
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
  return `http://127.0.0.1:${server.port}/download/v${npmPkg.version}`;
}

async function shim(base: string, ...args: string[]) {
  const node = Bun.which("node");
  if (node === null) throw new Error("node is needed to run the npm shim");
  const proc = Bun.spawn([node, SHIM, ...args], {
    env: {
      ...process.env,
      HOME: home,
      WIZARDINGCODE_HOME: join(home, ".wizardingcode"),
      WIZARDINGCODE_MEM_RELEASE_BASE: base,
    },
    stdin: "ignore",
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

describe("the npm package", () => {
  test("carries the same version as the binary it fetches, and nothing runs at install time", () => {
    expect(npmPkg.version).toBe(rootPkg.version);
    expect(npmPkg.name).toBe("wizardingcode-mem");
    expect(npmPkg.bin).toEqual({ "wizardingcode-mem": "bin/wizardingcode-mem.js" });
    const loose = npmPkg as {
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
    };
    expect(loose.scripts?.postinstall).toBeUndefined();
    expect(loose.dependencies ?? {}).toEqual({});
  });

  test("on first use fetches the binary, checks it and runs it with the arguments and exit code passed through", async () => {
    const result = await shim(release(), "install", "--yes");
    expect(result.stderr).toContain("downloading");
    expect(result.stdout).toBe("ran: install --yes\n");
    expect(result.exitCode).toBe(3);
    expect(downloads).toBe(1);
    const binary = join(home, ".wizardingcode", "mem", "bin", "wizardingcode-mem");
    expect(existsSync(binary)).toBe(true);
    const again = await shim(release(), "status");
    expect(again.stdout).toBe("ran: status\n");
    expect(downloads).toBe(1);
  });

  test("an older binary in place is replaced by the package's", async () => {
    mkdirSync(join(home, ".wizardingcode", "mem", "bin"), { recursive: true });
    writeFileSync(join(home, ".wizardingcode", "mem", "bin", "wizardingcode-mem"), fake("0.0.1"));
    chmodSync(join(home, ".wizardingcode", "mem", "bin", "wizardingcode-mem"), 0o755);
    await shim(release(), "status");
    expect(downloads).toBe(1);
    expect(
      readFileSync(join(home, ".wizardingcode", "mem", "bin", "wizardingcode-mem"), "utf8"),
    ).toContain(npmPkg.version);
  });

  test("a newer binary in place is run, and nothing is downloaded", async () => {
    const binary = join(home, ".wizardingcode", "mem", "bin", "wizardingcode-mem");
    mkdirSync(join(home, ".wizardingcode", "mem", "bin"), { recursive: true });
    writeFileSync(binary, fake("99.0.0"));
    chmodSync(binary, 0o755);
    const result = await shim(release(), "status", "--x");
    expect(downloads).toBe(0);
    expect(result.stdout).toBe("ran: status --x\n");
    expect(result.exitCode).toBe(3);
    expect(result.stderr).toBe(
      `wizardingcode-mem: running 99.0.0 already in ${binary}; this package is ${npmPkg.version}\n`,
    );
  });

  test("a checksum that does not match stops everything", async () => {
    const result = await shim(release({ checksum: "f".repeat(64) }), "status");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("checksum");
    expect(existsSync(join(home, ".wizardingcode", "mem", "bin", "wizardingcode-mem"))).toBe(false);
  });
});
