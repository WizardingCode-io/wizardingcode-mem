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
import { codexContext } from "../../src/install/codex.ts";
import { hostBinary, runBinary } from "../helpers/binary.ts";

// `wizardingcode-mem install` from a binary older than the one already staged: the staged
// binary only moves forward, so the older one says so once and hands the install over.

let binary: string;
beforeAll(() => {
  binary = hostBinary();
}, 120_000);

let home: string;
let staged: string;
let env: Record<string, string>;

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), "wizardingcode-mem-forward-")));
  // Two agents, found by their folders.
  mkdirSync(join(home, ".claude"));
  mkdirSync(join(home, ".codex"));
  mkdirSync(join(home, "data", "bin"), { recursive: true });
  staged = join(home, "data", "bin", "wizardingcode-mem");
  // A "newer binary": answers its version, and records how it was called.
  writeFileSync(
    staged,
    `#!/bin/sh\nif [ "$1" = "--version" ]; then echo 99.0.0; exit 0; fi\necho "$*" >> "${home}/called.txt"\necho "$WIZARDINGCODE_MEM_HANDED" > "${home}/handed.txt"\nexit 7\n`,
  );
  chmodSync(staged, 0o755);
  env = {
    HOME: home,
    CLAUDE_CONFIG_DIR: join(home, ".claude"),
    CODEX_HOME: join(home, ".codex"),
    XDG_CONFIG_HOME: join(home, ".config"),
    WIZARDINGCODE_HOME: join(home, ".wizardingcode"),
    WIZARDINGCODE_MEM_DATA_DIR: join(home, "data"),
    WIZARDINGCODE_MEM_UI_AUTO_OPEN: "off",
    WIZARDINGCODE_MEM_DISTILL: "off",
    WIZARDINGCODE_MEM_MIGRATE: "off",
    PATH: "/nonexistent",
  };
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

const ARGS = ["install", "--yes", "--no-import-history", "--no-semantic"];
const notices = (stdout: string) =>
  stdout
    .split("\n")
    .filter((line) => line.startsWith("A newer wizardingcode-mem (99.0.0) is already in "));

describe.skipIf(process.platform === "win32")("install, with a newer binary staged", () => {
  test("says so once and hands the install over to the staged binary", async () => {
    const result = await runBinary(binary, ARGS, { env });
    expect(notices(result.stdout)).toHaveLength(1);
    expect(notices(result.stdout)[0]).toEndWith("wizardingcode-mem install --force replaces it.");
    expect(notices(result.stdout)[0]).toContain(staged);
    // The staged binary did the install, once, with the same arguments, and its exit code came back.
    expect(readFileSync(join(home, "called.txt"), "utf8")).toBe(`${ARGS.join(" ")}\n`);
    expect(result.exitCode).toBe(7);
    // Through the one hand-over function: the staged binary is told it was handed the command.
    expect(readFileSync(join(home, "handed.txt"), "utf8")).toBe("1\n");
    // Nothing of the install ran in the older binary.
    expect(existsSync(join(home, ".claude", "settings.json"))).toBe(false);
    expect(existsSync(codexContext("", env).settingsPath)).toBe(false);
    expect(readFileSync(staged, "utf8")).toContain("echo 99.0.0");
  });

  test("with --force puts itself in place and installs for both agents", async () => {
    const result = await runBinary(binary, [...ARGS, "--force"], { env });
    expect(notices(result.stdout)).toHaveLength(0);
    expect(existsSync(join(home, "called.txt"))).toBe(false);
    expect(readFileSync(staged).equals(readFileSync(binary))).toBe(true);
    expect(readFileSync(join(home, ".claude", "settings.json"), "utf8")).toContain(staged);
    expect(readFileSync(codexContext("", env).settingsPath, "utf8")).toContain(staged);
  });
});
