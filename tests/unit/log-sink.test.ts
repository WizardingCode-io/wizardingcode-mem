import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { logError, setLogSink } from "../../src/util/log.ts";

const dirs: string[] = [];
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "wcm-log-sink-"));
  dirs.push(dir);
  return dir;
};

afterEach(() => {
  setLogSink(null);
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("the log sink", () => {
  test("with a sink set, logError calls it with the redacted, clipped message and writes no file", () => {
    const dir = tempDir();
    const seen: { at: string; scope: string; name: string; message: string }[] = [];
    setLogSink((entry) => seen.push(entry));
    const secret = `sk-ant-api03-${"a".repeat(40)}`;
    logError("team.test", new Error(`boom ${secret} ${"x".repeat(400)}`), dir);
    expect(seen).toHaveLength(1);
    const entry = seen[0] as (typeof seen)[number];
    expect(entry.scope).toBe("team.test");
    expect(entry.name).toBe("Error");
    expect(entry.message).not.toContain(secret);
    expect(entry.message).toContain("[REDACTED:");
    expect(entry.message.length).toBeLessThanOrEqual(300);
    expect(Number.isNaN(Date.parse(entry.at))).toBe(false);
    expect(existsSync(join(dir, "logs", "wizardingcode-mem.log"))).toBe(false);
  });

  test("unset, logError writes the file as before", () => {
    const dir = tempDir();
    setLogSink(null);
    logError("team.test", new Error("to the file"), dir);
    const file = join(dir, "logs", "wizardingcode-mem.log");
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, "utf8")).toContain("team.test Error: to the file");
  });

  test("a sink that throws never reaches the caller", () => {
    const dir = tempDir();
    setLogSink(() => {
      throw new Error("sink down");
    });
    expect(() => logError("team.test", new Error("x"), dir)).not.toThrow();
  });
});
