// Which commands hand over to a newer staged binary, and when a copy may: two tables.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { COMMAND_NAMES, RECONCILED, reconciles } from "../../src/cli/reconciled.ts";
import { decide, handedEnv } from "../../src/update/reconcile.ts";

describe("reconciles", () => {
  test("only the four commands a person types to look at their install", () => {
    expect([...RECONCILED].sort()).toEqual(["doctor", "status", "ui", "update"]);
    // Over every command the CLI has: a new one is classified here or this fails.
    expect(COMMAND_NAMES.length).toBeGreaterThanOrEqual(21);
    for (const name of COMMAND_NAMES) {
      expect({ name, reconciles: reconciles(name, []) }).toEqual({
        name,
        reconciles: (RECONCILED as readonly string[]).includes(name),
      });
    }
    expect(reconciles("nonsense", [])).toBe(false);
  });

  test("the viewer the session-start hook starts does not", () => {
    expect(reconciles("ui", ["--auto"])).toBe(false);
    expect(reconciles("ui", ["--port", "1", "--auto"])).toBe(false);
    expect(reconciles("ui", ["--port", "1"])).toBe(true);
  });

  test("the CLI's table and its usage text know every name", () => {
    const main = readFileSync(new URL("../../src/cli/main.ts", import.meta.url), "utf8");
    expect(main).toContain("Record<CommandName,");
    expect(main).toMatch(/Commands:[\s\S]*\bupdate\b[\s\S]*Options:/);
  });
});

describe("decide", () => {
  const plain = {
    platform: "darwin",
    compiled: true,
    self: "/opt/homebrew/bin/wizardingcode-mem",
    staged: "/home/me/.wizardingcode/mem/bin/wizardingcode-mem",
    handed: false,
    uid: 501,
    binOwner: 501,
  };
  test.each<[string, Record<string, unknown>, string]>([
    ["a channel copy of the data directory's owner", {}, "compare"],
    ["Linux", { platform: "linux" }, "compare"],
    ["Windows", { platform: "win32" }, "skip"],
    ["a run from source", { compiled: false }, "skip"],
    ["no staged file", { staged: null }, "skip"],
    ["the staged binary itself", { self: plain.staged }, "skip"],
    ["a copy that was handed to", { handed: true }, "skip"],
    ["root", { uid: 0, binOwner: 0 }, "skip"],
    ["a bin folder of another user", { binOwner: 502 }, "skip"],
    ["no user id to compare", { uid: null }, "skip"],
  ])("%s: %s", (_what, over, expected) => {
    expect(decide({ ...plain, ...over } as Parameters<typeof decide>[0])).toBe(
      expected as ReturnType<typeof decide>,
    );
  });

  test("the guard variable is set for the staged binary, and nothing else changes", () => {
    expect(handedEnv({ PATH: "/bin", X: undefined })).toEqual({
      PATH: "/bin",
      X: undefined,
      WIZARDINGCODE_MEM_HANDED: "1",
    });
  });
});
