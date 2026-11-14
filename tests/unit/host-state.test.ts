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

  test("an intent the tool did not write in its own form is refused, since its fields go to Docker", () => {
    const good = {
      digest: `sha256:${"b".repeat(64)}`,
      id: `sha256:${"2".repeat(64)}`,
      version: "0.9.2",
      fromId: `sha256:${"1".repeat(64)}`,
      fromEnvLine: "WIZARDINGCODE_MEM_VERSION=0.9.1",
      fromVersion: "0.9.1",
      schema: 2,
      project: "proj",
      directory: "/srv/team",
      files: ["/srv/team/compose.yml"],
      volume: "proj_data",
      attended: false,
      at: 1,
    };
    const dir = folder();
    writeFileSync(file(dir), JSON.stringify({ format: 1, intent: good }));
    expect(readState(dir).intent).toEqual(good);
    for (const bad of [
      { volume: "-v/etc:/data" },
      { volume: "" },
      { id: "--privileged" },
      { fromId: "latest" },
      { digest: "sha256:abc" },
      { project: "-p" },
      { files: ["../elsewhere.yml"] },
      { files: "compose.yml" },
      { directory: "relative" },
      { schema: "2" },
      { version: "0.9.2; reboot" },
      { attended: "no" },
    ]) {
      const other = folder();
      const text = JSON.stringify({ format: 1, intent: { ...good, ...bad } });
      writeFileSync(file(other), text);
      expect(() => readState(other)).toThrow(StateRefused);
      expect(readFileSync(file(other), "utf8")).toBe(text);
    }
    const none = folder();
    writeFileSync(file(none), JSON.stringify({ format: 1, intent: "soon" }));
    expect(() => readState(none)).toThrow(StateRefused);
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
