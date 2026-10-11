import { describe, expect, test } from "bun:test";
import { offerHistoryImport } from "../../src/install/history-offer.ts";

const status =
  (
    over: {
      state?: "never" | "running" | "done" | "failed";
      dismissed?: boolean;
      cc?: number;
      codex?: number;
    } = {},
  ) =>
  () => ({
    transcripts: { claudeCode: over.cc ?? 3, codex: over.codex ?? 2 },
    run: { state: over.state ?? ("never" as const) },
    offer: { dismissed: over.dismissed ?? false },
  });

function harness(over: Parameters<typeof status>[0] = {}, answer = true, tty = true) {
  const calls = { asked: [] as string[], spawned: [] as string[][], dismissed: 0 };
  const deps = {
    status: status(over),
    historyDays: 180,
    tty,
    confirm: (q: string) => {
      calls.asked.push(q);
      return answer;
    },
    spawn: (...args: string[]) => calls.spawned.push(args),
    dismiss: () => {
      calls.dismissed += 1;
    },
  };
  return { calls, deps };
}

describe("offerHistoryImport", () => {
  test("yes on a terminal starts the import in the background", () => {
    const { calls, deps } = harness();
    const lines = offerHistoryImport([], deps);
    expect(calls.asked[0]).toContain("Found 5 past sessions from Claude Code and Codex.");
    expect(calls.asked[0]).toContain("last 180 days");
    expect(calls.spawned).toEqual([["history", "import"]]);
    expect(lines.join("\n")).toContain(
      "history: importing in the background — wizardingcode-mem status shows progress",
    );
    expect(calls.dismissed).toBe(0);
  });

  test("no on a terminal dismisses the offer and says how to run it later", () => {
    const { calls, deps } = harness({}, false);
    const lines = offerHistoryImport([], deps);
    expect(calls.spawned).toEqual([]);
    expect(calls.dismissed).toBe(1);
    expect(lines.join("\n")).toContain("wizardingcode-mem history import");
  });

  test("without a terminal: one hint, nothing asked, nothing started, not dismissed", () => {
    const { calls, deps } = harness({}, true, false);
    const lines = offerHistoryImport([], deps);
    expect(calls.asked).toEqual([]);
    expect(calls.spawned).toEqual([]);
    expect(calls.dismissed).toBe(0);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("wizardingcode-mem history import");
  });

  test("--import-history starts without asking", () => {
    const { calls, deps } = harness({}, false, false);
    offerHistoryImport(["--import-history"], deps);
    expect(calls.asked).toEqual([]);
    expect(calls.spawned).toEqual([["history", "import"]]);
  });

  test("--no-import-history says nothing and does nothing", () => {
    const { calls, deps } = harness();
    expect(offerHistoryImport(["--no-import-history"], deps)).toEqual([]);
    expect(calls.asked).toEqual([]);
    expect(calls.spawned).toEqual([]);
  });

  test("no offer when there is nothing to learn from, a run happened, or it was dismissed", () => {
    for (const over of [
      { cc: 0, codex: 0 },
      { state: "done" as const },
      { state: "running" as const },
      { dismissed: true },
    ]) {
      const { calls, deps } = harness(over);
      expect(offerHistoryImport([], deps)).toEqual([]);
      expect(offerHistoryImport(["--import-history"], deps)).toEqual([]);
      expect(calls.asked).toEqual([]);
      expect(calls.spawned).toEqual([]);
    }
  });

  test("a status that cannot be read means no offer", () => {
    const { calls, deps } = harness();
    deps.status = () => {
      throw new Error("db locked");
    };
    expect(offerHistoryImport([], deps)).toEqual([]);
    expect(calls.spawned).toEqual([]);
  });
});
