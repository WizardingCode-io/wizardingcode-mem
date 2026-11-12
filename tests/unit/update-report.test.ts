// The sentences a person reads about releases and about the copy their agents run: one
// function writes them, and this table is all of them.
import { describe, expect, test } from "bun:test";
import { CHANNEL_COMMANDS } from "../../src/update/channels.ts";
import { agentsLine, commandLines, type StagedFacts, updateLine } from "../../src/update/report.ts";
import type { UpdateState } from "../../src/update/state.ts";

const NOW = 1_800_000_000_000;
const HOUR = 3_600_000;
const state = (over: Partial<UpdateState> = {}): UpdateState => ({
  latest: null,
  checkedAt: null,
  attemptAt: null,
  failedAt: null,
  reason: null,
  ...over,
});
const line = (over: Partial<Parameters<typeof updateLine>[0]> = {}) =>
  updateLine({
    mode: "check",
    source: "default",
    asked: false,
    state: null,
    current: "0.9.0",
    currentIsStaged: true,
    dataDir: "/data",
    now: NOW,
    ...over,
  });
const found = state({ latest: "0.10.0", checkedAt: NOW - 2 * HOUR });

describe("updateLine", () => {
  test("off says where the value was set", () => {
    expect(line({ mode: "off", source: "file", state: found })).toEqual({
      line: "update: off (WIZARDINGCODE_MEM_UPDATE in /data/env)",
      out: false,
    });
    expect(line({ mode: "off", source: "env" }).line).toBe(
      "update: off (WIZARDINGCODE_MEM_UPDATE in this command's environment; other processes may not see it)",
    );
    expect(line({ mode: "off-unknown", source: "file" }).line).toBe(
      "update: off (WIZARDINGCODE_MEM_UPDATE is neither check nor off)",
    );
  });

  test("a newer release is out, in the words of what runs it", () => {
    expect(line({ state: found })).toEqual({
      line: "update: 0.10.0 is out (checked 2 h ago); the agents run 0.9.0",
      out: true,
    });
    expect(line({ state: found, currentIsStaged: false }).line).toBe(
      "update: 0.10.0 is out (checked 2 h ago); this copy is 0.9.0",
    );
  });

  test("a release already found stays announced when a later check fails", () => {
    const failing = state({
      latest: "0.10.0",
      checkedAt: NOW - 72 * HOUR,
      failedAt: NOW - HOUR,
      reason: "HTTP 429",
    });
    expect(line({ state: failing })).toEqual({
      line: "update: 0.10.0 is out (checked 3 d ago; last check failed: HTTP 429, 1 h ago); the agents run 0.9.0",
      out: true,
    });
    // Also in CI, where nothing new is asked.
    expect(line({ state: failing, mode: "ci" }).out).toBe(true);
  });

  test("in CI with nothing asked, and when this call did ask", () => {
    expect(line({ mode: "ci" }).line).toBe("update: not checked in CI");
    const same = state({ latest: "0.9.0", checkedAt: NOW });
    expect(line({ mode: "ci", state: same }).line).toBe("update: not checked in CI");
    expect(line({ mode: "ci", asked: true, state: same }).line).toBe(
      "update: 0.9.0 is the latest (checked 0 s ago)",
    );
  });

  test("never checked", () => {
    expect(line()).toEqual({ line: "update: not checked yet", out: false });
    expect(line({ state: state({ attemptAt: NOW }) }).line).toBe("update: not checked yet");
  });

  test("a failed check, with and without a release known", () => {
    const failed = state({ failedAt: NOW - 3 * HOUR, reason: "offline" });
    expect(line({ state: failed }).line).toBe(
      "update: could not check (offline, 3 h ago); no release known yet",
    );
    expect(line({ state: { ...failed, latest: "0.9.0", checkedAt: NOW - 30 * HOUR } }).line).toBe(
      "update: could not check (offline, 3 h ago); last known 0.9.0",
    );
  });

  test("the latest, and a copy ahead of it", () => {
    expect(line({ state: state({ latest: "0.9.0", checkedAt: NOW - HOUR }) })).toEqual({
      line: "update: 0.9.0 is the latest (checked 1 h ago)",
      out: false,
    });
    expect(line({ state: state({ latest: "0.8.0", checkedAt: NOW - HOUR }) })).toEqual({
      line: "update: 0.9.0 is ahead of the latest release 0.8.0 (checked 1 h ago)",
      out: false,
    });
  });
});

describe("agentsLine", () => {
  const facts = (over: Partial<StagedFacts> = {}): StagedFacts => ({
    path: "/data/bin/wizardingcode-mem",
    exists: true,
    version: "0.9.0",
    isSelf: false,
    ...over,
  });

  test("nothing for the staged binary itself, for no staged file, and for equal versions", () => {
    expect(agentsLine("0.9.0", facts({ isSelf: true }))).toBeNull();
    expect(agentsLine("0.9.0", facts({ exists: false, version: null }))).toBeNull();
    expect(agentsLine("0.9.0", facts())).toBeNull();
  });

  test("a newer staged binary is only named", () => {
    expect(agentsLine("0.8.0", facts())).toBe(
      "agents run 0.9.0 from /data/bin/wizardingcode-mem; this copy is 0.8.0",
    );
  });

  test("an older one, and one that does not answer, name install", () => {
    expect(agentsLine("0.10.0", facts())).toBe(
      "agents run 0.9.0 from /data/bin/wizardingcode-mem; this copy is 0.10.0: wizardingcode-mem install moves them to it",
    );
    expect(agentsLine("0.10.0", facts({ version: null }))).toBe(
      "agents run an unreadable binary from /data/bin/wizardingcode-mem; this copy is 0.10.0: wizardingcode-mem install replaces it",
    );
  });
});

describe("the commands", () => {
  test("one per channel, in the order a person meets them", () => {
    expect(CHANNEL_COMMANDS.map((entry) => entry.channel)).toEqual([
      "plugin",
      "Homebrew",
      "npm (and Windows)",
      "script",
    ]);
    expect(commandLines()).toEqual(
      CHANNEL_COMMANDS.map((entry) => `  ${entry.channel}: ${entry.command}`),
    );
    expect(commandLines()[1]).toBe(
      "  Homebrew: brew upgrade wizardingcode-mem && wizardingcode-mem install",
    );
  });
});
