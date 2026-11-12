// A person's command typed from a copy older than the staged binary runs the staged binary;
// typed from a newer copy it says so and stages nothing. Run on the compiled binary, since a
// run from source never hands over.
import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pkg from "../../package.json" with { type: "json" };
import { hostBinary, runBinary } from "../helpers/binary.ts";

let binary: string;
beforeAll(() => {
  binary = hostBinary();
}, 120_000);

let home: string;
let staged: string;
let env: Record<string, string>;

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), "wizardingcode-mem-reconcile-")));
  staged = join(home, "data", "bin", "wizardingcode-mem");
  env = {
    HOME: home,
    WIZARDINGCODE_HOME: join(home, ".wizardingcode"),
    WIZARDINGCODE_MEM_DATA_DIR: join(home, "data"),
    WIZARDINGCODE_MEM_UI_AUTO_OPEN: "off",
    WIZARDINGCODE_MEM_DISTILL: "off",
    WIZARDINGCODE_MEM_MIGRATE: "off",
    WIZARDINGCODE_MEM_UPDATE: "off",
    WIZARDINGCODE_MEM_HANDED: "",
    PATH: "/usr/bin:/bin",
  };
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

/** A staged "binary": answers a version, and otherwise records how it was called and exits 7. */
function stage(version: string | null): string {
  mkdirSync(join(home, "data", "bin"), { recursive: true });
  const answer = version === null ? "exit 1" : `echo ${version}; exit 0`;
  const script = `#!/bin/sh\nif [ "$1" = "--version" ]; then ${answer}; fi\necho "$* handed=$WIZARDINGCODE_MEM_HANDED" >> "${home}/called.txt"\nexit 7\n`;
  writeFileSync(staged, script);
  chmodSync(staged, 0o755);
  return script;
}
const called = () =>
  existsSync(join(home, "called.txt")) ? readFileSync(join(home, "called.txt"), "utf8") : null;

// As root nothing is handed over, so these cases would not hold there.
const skipped = process.platform === "win32" || process.getuid?.() === 0;

describe.skipIf(skipped)("a copy older than the staged binary", () => {
  test("hands a person's command over, with its arguments and the guard set", async () => {
    stage("99.0.0");
    const result = await runBinary(binary, ["doctor", "--x"], { env });
    expect(result.stderr).toBe(
      `wizardingcode-mem: running 99.0.0 from ${staged}; this copy is ${pkg.version}\n`,
    );
    expect(called()).toBe("doctor --x handed=1\n");
    expect(result.exitCode).toBe(7);
    // Nothing of doctor ran in the older copy.
    expect(result.stdout).toBe("");
  });

  test("does not hand over when it was itself handed the command", async () => {
    stage("99.0.0");
    const result = await runBinary(binary, ["status"], {
      env: { ...env, WIZARDINGCODE_MEM_HANDED: "1" },
    });
    expect(called()).toBeNull();
    expect(result.stderr).not.toContain("running 99.0.0");
    expect(result.stdout).toStartWith(`wizardingcode-mem ${pkg.version}\n`);
  });

  test.each([
    ["--version", ["--version"]],
    ["--help", ["--help"]],
    ["no command", []],
    ["an unknown command", ["nonsense"]],
    ["a hook", ["hook", "claude-code", "session-start"]],
  ])("%s never reaches the staged binary", async (_what, args) => {
    stage("99.0.0");
    const result = await runBinary(binary, args, { env, input: "{}" });
    expect(called()).toBeNull();
    expect(result.stderr).not.toContain("running 99.0.0");
    if (args[0] === "--version") expect(result.stdout).toBe(`${pkg.version}\n`);
  });
});

describe.skipIf(skipped)("a copy newer than the staged binary", () => {
  test("stages nothing and says how to move the agents", async () => {
    const script = stage("0.0.1");
    const result = await runBinary(binary, ["status"], { env });
    expect(readFileSync(staged, "utf8")).toBe(script);
    expect(called()).toBeNull();
    expect(result.stdout).toContain(
      `agents run 0.0.1 from ${staged}; this copy is ${pkg.version}: wizardingcode-mem install moves them to it\n`,
    );
    expect(result.exitCode).toBe(0);
  });

  test("a staged file that answers no version is left alone and named", async () => {
    const script = stage(null);
    const result = await runBinary(binary, ["status"], { env });
    expect(readFileSync(staged, "utf8")).toBe(script);
    expect(result.stdout).toContain(
      `agents run an unreadable binary from ${staged}; this copy is ${pkg.version}: wizardingcode-mem install replaces it\n`,
    );
  });

  test("with no staged binary, none is made", async () => {
    const result = await runBinary(binary, ["status"], { env });
    expect(existsSync(join(home, "data", "bin"))).toBe(false);
    expect(result.stdout).not.toContain("agents run");
    expect(result.exitCode).toBe(0);
  });
});
