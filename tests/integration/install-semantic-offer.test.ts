import { describe, expect, test } from "bun:test";
import { offerSemanticModel, SEMANTIC_QUESTION } from "../../src/install/semantic-offer.ts";

type State = ReturnType<Parameters<typeof offerSemanticModel>[1]["state"]>;

function harness(over: Partial<State> = {}, answer = true, tty = true) {
  const calls = { asked: [] as string[], spawned: [] as string[][], dismissed: 0 };
  const deps = {
    state: (): State => ({
      present: false,
      enabled: true,
      downloading: false,
      dismissed: false,
      ...over,
    }),
    tty,
    confirm: (q: string) => {
      calls.asked.push(q);
      return answer;
    },
    spawn: (...args: string[]) => void calls.spawned.push(args),
    dismiss: () => {
      calls.dismissed += 1;
    },
  };
  return { calls, deps };
}

describe("offerSemanticModel", () => {
  test("asks in the words agreed, and yes downloads then backfills in the background", () => {
    const { calls, deps } = harness();
    const lines = offerSemanticModel([], deps);
    expect(calls.asked).toEqual([
      "Download the 140 MB search model so searches also find notes by meaning? Nothing you write is sent anywhere.",
    ]);
    expect(SEMANTIC_QUESTION).toBe(calls.asked[0] as string);
    expect(calls.spawned).toEqual([["embed", "download", "--backfill"]]);
    expect(lines.join("\n")).toContain("downloading the search model in the background");
    expect(calls.dismissed).toBe(0);
  });

  test("no on a terminal dismisses the offer and says how to do it later", () => {
    const { calls, deps } = harness({}, false);
    const lines = offerSemanticModel([], deps);
    expect(calls.spawned).toEqual([]);
    expect(calls.dismissed).toBe(1);
    expect(lines.join("\n")).toContain("wizardingcode-mem embed download");
  });

  test("without a terminal: one hint, nothing asked, nothing started, not dismissed", () => {
    const { calls, deps } = harness({}, true, false);
    const lines = offerSemanticModel([], deps);
    expect(calls.asked).toEqual([]);
    expect(calls.spawned).toEqual([]);
    expect(calls.dismissed).toBe(0);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("wizardingcode-mem embed download");
  });

  test("--semantic starts without asking", () => {
    const { calls, deps } = harness({}, false, false);
    offerSemanticModel(["--semantic"], deps);
    expect(calls.asked).toEqual([]);
    expect(calls.spawned).toEqual([["embed", "download", "--backfill"]]);
  });

  test("--no-semantic says nothing and does nothing", () => {
    const { calls, deps } = harness();
    expect(offerSemanticModel(["--no-semantic"], deps)).toEqual([]);
    expect(calls.asked).toEqual([]);
    expect(calls.spawned).toEqual([]);
    expect(calls.dismissed).toBe(0);
  });

  test("no offer when the model is there, a download is going, it was dismissed or turned off", () => {
    for (const over of [
      { present: true },
      { downloading: true },
      { dismissed: true },
      { enabled: false },
    ]) {
      const { calls, deps } = harness(over);
      expect(offerSemanticModel([], deps)).toEqual([]);
      expect(calls.asked).toEqual([]);
      expect(calls.spawned).toEqual([]);
    }
  });

  test("--semantic still starts it when the offer was dismissed", () => {
    const { calls, deps } = harness({ dismissed: true });
    offerSemanticModel(["--semantic"], deps);
    expect(calls.spawned).toEqual([["embed", "download", "--backfill"]]);
  });

  test("--semantic with the setting off downloads nothing and says why", () => {
    const { calls, deps } = harness({ enabled: false });
    const lines = offerSemanticModel(["--semantic"], deps);
    expect(calls.spawned).toEqual([]);
    expect(lines.join("\n")).toContain("WIZARDINGCODE_MEM_SEMANTIC");
  });

  test("a state that cannot be read means no offer", () => {
    const { calls, deps } = harness();
    deps.state = () => {
      throw new Error("db locked");
    };
    expect(offerSemanticModel([], deps)).toEqual([]);
    expect(calls.spawned).toEqual([]);
  });
});
