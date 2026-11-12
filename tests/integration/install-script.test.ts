import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
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

// scripts/install.sh against a stand-in release: a tiny shell script in place of the
// binary, served with its checksums the way GitHub serves a release's assets.

const SCRIPT = new URL("../../scripts/install.sh", import.meta.url).pathname;
const os = process.platform === "darwin" ? "darwin" : "linux";
const arch = process.arch === "arm64" ? "arm64" : "x64";
const FILE = `wizardingcode-mem-${os}-${arch}`;
// The "binary": prints a version, and records how `install` was called.
const FAKE = `#!/bin/sh\nif [ "$1" = "--version" ]; then echo 9.9.9; exit 0; fi\necho "called: $*" > "$(dirname "$0")/called.txt"\n`;

let home: string;
let server: ReturnType<typeof Bun.serve> | undefined;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "wizardingcode-mem-install-sh-"));
});
afterEach(async () => {
  // Awaited: a port still closing can be handed to the next test's server.
  await server?.stop(true);
  server = undefined;
  rmSync(home, { recursive: true, force: true });
});

function release(options: { checksum?: string } = {}): string {
  const sha = new Bun.CryptoHasher("sha256").update(FAKE).digest("hex");
  const checksums = `${options.checksum ?? sha}  ${FILE}\n${"0".repeat(64)}  wizardingcode-mem-other\n`;
  server = Bun.serve({
    // Loopback by name: on every interface, the port handed out may already be
    // another process's on 127.0.0.1, and the request would go to it.
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) => {
      const path = new URL(request.url).pathname;
      if (path.endsWith(`/${FILE}`)) return new Response(FAKE);
      if (path.endsWith("/checksums.txt")) return new Response(checksums);
      return new Response("not found", { status: 404 });
    },
  });
  return `http://127.0.0.1:${server.port}/download/v9.9.9`;
}

async function run(base: string, ...args: string[]) {
  const proc = Bun.spawn(["sh", SCRIPT, ...args], {
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

const BIN = () => join(home, ".wizardingcode", "mem", "bin", "wizardingcode-mem");
/** A binary already in place that answers this for --version. */
function stage(answer: string): void {
  mkdirSync(join(home, ".wizardingcode", "mem", "bin"), { recursive: true });
  writeFileSync(BIN(), `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "${answer}"; exit 0; fi\n`);
  chmodSync(BIN(), 0o755);
}
const answers = () =>
  Bun.spawnSync([BIN(), "--version"], { stdout: "pipe" }).stdout.toString().trim();

describe("scripts/install.sh", () => {
  test("downloads this platform's binary, checks it, puts it in place and runs install with the arguments given", async () => {
    const result = await run(release(), "claude-code", "--yes");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    const binary = join(home, ".wizardingcode", "mem", "bin", "wizardingcode-mem");
    expect(existsSync(binary)).toBe(true);
    expect(statSync(binary).mode & 0o111).not.toBe(0);
    expect(result.stdout).toContain("installed 9.9.9");
    expect(readFileSync(join(home, ".wizardingcode", "mem", "bin", "called.txt"), "utf8")).toBe(
      "called: install claude-code --yes\n",
    );
  });

  test("a binary whose checksum does not match is thrown away", async () => {
    const result = await run(release({ checksum: "f".repeat(64) }));
    expect(result.stderr).toContain("checksum mismatch");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("checksum mismatch");
    expect(existsSync(join(home, ".wizardingcode", "mem", "bin", "wizardingcode-mem"))).toBe(false);
  });

  test("a release that does not list the binary is refused", async () => {
    const base = release();
    await server?.stop(true);
    server = Bun.serve({
      // Loopback by name: on every interface, the port handed out may already be
      // another process's on 127.0.0.1, and the request would go to it.
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request) =>
        new URL(request.url).pathname.endsWith("/checksums.txt")
          ? new Response("")
          : new Response(FAKE),
    });
    const result = await run(base.replace(/:\d+\//, `:${server.port}/`));
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("not in the release's checksums");
  });
  test("a newer binary already in place stays", async () => {
    stage("10.0.0");
    const result = await run(release(), "--download-only");
    expect(result.exitCode).toBe(0);
    expect(answers()).toBe("10.0.0");
    expect(result.stdout).toContain(`wizardingcode-mem: 10.0.0 is already in ${BIN()}`);
    expect(result.stdout).toContain(
      "the older 9.9.9 was not put in its place (--force replaces it)",
    );
    expect(result.stdout).not.toContain("installed 9.9.9");
  });

  test("--force replaces a newer binary, and reaches install", async () => {
    stage("10.0.0");
    const result = await run(release(), "claude-code", "--force");
    expect(result.exitCode).toBe(0);
    expect(answers()).toBe("9.9.9");
    expect(readFileSync(join(home, ".wizardingcode", "mem", "bin", "called.txt"), "utf8")).toBe(
      "called: install claude-code --force\n",
    );
  });

  test("--force after --download-only replaces a newer binary", async () => {
    stage("10.0.0");
    await run(release(), "--download-only", "--force");
    expect(answers()).toBe("9.9.9");
  });

  test("an older binary in place is replaced", async () => {
    stage("1.0.0");
    await run(release(), "--download-only");
    expect(answers()).toBe("9.9.9");
  });

  test("a staged file that does not answer a version is replaced", async () => {
    stage("hello");
    await run(release(), "--download-only");
    expect(answers()).toBe("9.9.9");
  });
});
