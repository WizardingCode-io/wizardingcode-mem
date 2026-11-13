// The host tool's state (ADR 0033): one JSON file a release's tool writes and the next
// release's reads. A file it cannot read for certain is refused and never replaced.
import { describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { realWriter } from "../../src/host/files.ts";
import {
  appendHistory,
  FORMAT,
  pruneLogs,
  pushRejected,
  readState,
  type State,
  StateRefused,
  stateDir,
  writeState,
} from "../../src/host/state.ts";

function folder(): string {
  const dir = mkdtempSync(join(tmpdir(), "wcm-host-state-"));
  mkdirSync(join(dir, "upgrade-state", "logs"), { recursive: true });
  return dir;
}
const file = (dir: string) => join(stateDir(dir), "state.json");

describe("the state file", () => {
  test("with no file the state is empty, at the tool's format", () => {
    expect(FORMAT).toBe(1);
    expect(readState(folder())).toEqual({ format: 1 });
  });

  test("what is written is read back, at mode 0600, with the keys this tool does not know", () => {
    const dir = folder();
    writeFileSync(file(dir), JSON.stringify({ format: 1, fromALaterTool: { kept: true } }));
    const state = readState(dir);
    state.lastRun = { verb: "follow", outcome: "current", exit: 0, at: 5 };
    writeState(realWriter, dir, state);
    expect(JSON.parse(readFileSync(file(dir), "utf8"))).toEqual({
      format: 1,
      fromALaterTool: { kept: true },
      lastRun: { verb: "follow", outcome: "current", exit: 0, at: 5 },
    });
    expect(statSync(file(dir)).mode & 0o777).toBe(0o600);
    expect(readdirSync(stateDir(dir)).sort()).toEqual(["logs", "state.json"]);
  });

  test("a file that does not parse, is no object, or has a higher format is refused and left as it is", () => {
    for (const text of [
      "{not json",
      "[]",
      '"text"',
      '{"format":2}',
      '{"format":"1"}',
      "{}",
      '{"format":0}',
    ]) {
      const dir = folder();
      writeFileSync(file(dir), text);
      expect(() => readState(dir)).toThrow(StateRefused);
      expect(readFileSync(file(dir), "utf8")).toBe(text);
    }
  });

  test("a state that is a symbolic link is refused", () => {
    const dir = folder();
    writeFileSync(join(dir, "elsewhere.json"), '{"format":1}');
    symlinkSync(join(dir, "elsewhere.json"), file(dir));
    expect(() => readState(dir)).toThrow(StateRefused);
  });
});

describe("what is kept", () => {
  test("the ten newest rejected digests", () => {
    const state: State = { format: 1 };
    for (let n = 1; n <= 11; n++)
      pushRejected(state, { digest: `d${n}`, version: `0.9.${n}`, at: n, reason: "exited 1" });
    expect(state.rejected?.map((r) => r.digest)).toEqual([
      "d2",
      "d3",
      "d4",
      "d5",
      "d6",
      "d7",
      "d8",
      "d9",
      "d10",
      "d11",
    ]);
    pushRejected(state, { digest: "d5", version: "0.9.5", at: 99, reason: "unhealthy" });
    expect(state.rejected).toHaveLength(10);
    expect(state.rejected?.at(-1)).toEqual({
      digest: "d5",
      version: "0.9.5",
      at: 99,
      reason: "unhealthy",
    });
  });

  test("the 200 newest history lines", () => {
    const dir = folder();
    for (let n = 1; n <= 201; n++) appendHistory(realWriter, dir, `line ${n}`);
    const lines = readFileSync(join(stateDir(dir), "history.log"), "utf8")
      .trimEnd()
      .split("\n");
    expect(lines).toHaveLength(200);
    expect(lines[0]).toBe("line 2");
    expect(lines.at(-1)).toBe("line 201");
  });

  test("the ten newest log files", () => {
    const dir = folder();
    const logs = join(stateDir(dir), "logs");
    for (let n = 10; n <= 20; n++) writeFileSync(join(logs, `202611${n}T000000Z-0.9.2.log`), "x");
    pruneLogs(dir);
    const left = readdirSync(logs).sort();
    expect(left).toHaveLength(10);
    expect(left[0]).toBe("20261111T000000Z-0.9.2.log");
  });
});
