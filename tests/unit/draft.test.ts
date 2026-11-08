import { describe, expect, test } from "bun:test";
import type { TurnDetail } from "../../src/adapters/types.ts";
import type { Redacted } from "../../src/core/redact.ts";
import type { Draft } from "../../src/distill/consolidate.ts";
import { buildDraft } from "../../src/distill/pipeline.ts";
import type { DistillCandidate, DistillVerdict } from "../../src/judge/types.ts";

const detail: TurnDetail = {
  filesRead: [],
  filesChanged: [],
  commands: [],
  errors: [],
  savedMemory: false,
};
const cand = (
  idx: number,
  text: string,
  source: "prompt" | "final" = "final",
): DistillCandidate => ({ idx, source, text: text as Redacted });
/** The body as text, for comparison with a literal. */
const bodyOf = (draft: Draft | null) => draft?.body as string | undefined;
const verdict = (over: Partial<DistillVerdict>): DistillVerdict => ({
  worthSaving: 0.9,
  kind: "fix",
  kindConfidence: 0.8,
  importance: 3,
  durable: [],
  titleIdx: null,
  source: "typesafe",
  ...over,
});

describe("buildDraft: the title must be knowledge", () => {
  const cands = [
    cand(0, "Bottom line: the wave closed in 909ce45cf and the gate is next."),
    cand(1, "The e2e never fires the real POST: sending is paid, everything is intercepted."),
    cand(2, "Next I will open the PR."),
  ];

  test("the judge's title stands when that sentence is knowledge", () => {
    const draft = buildDraft(
      "força W4 com tudo o que falta",
      cands,
      verdict({ durable: [0.2, 0.9, 0.1], titleIdx: 1 }),
      detail,
    );
    expect(draft?.title).toBe(
      "The e2e never fires the real POST: sending is paid, everything is intercepted.",
    );
    expect(bodyOf(draft)).toBe("Context: força W4 com tudo o que falta");
  });

  test("a title the judge chose but did not rate as knowledge gives way to the surest knowledge sentence", () => {
    const draft = buildDraft("", cands, verdict({ durable: [0.3, 0.8, 0.1], titleIdx: 0 }), detail);
    expect(draft?.title).toBe(cands[1]?.text);
  });

  test("with no knowledge sentence there is no memory, however worth the turn", () => {
    expect(
      buildDraft(
        "",
        cands,
        verdict({ worthSaving: 0.95, durable: [0.4, 0.44, 0.1], titleIdx: 0 }),
        detail,
      ),
    ).toBeNull();
  });

  test("a sentence rated exactly at the calibrated threshold, 0.45, is knowledge; just under it is not", () => {
    const at = buildDraft("", cands, verdict({ durable: [0.1, 0.45, 0.1], titleIdx: 1 }), detail);
    expect(at?.title).toBe(cands[1]?.text);
    expect(
      buildDraft("", cands, verdict({ durable: [0.1, 0.449, 0.1], titleIdx: 1 }), detail),
    ).toBeNull();
  });

  test("facts are the knowledge sentences, at most five, in writing order, without the title", () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      cand(i, `Fact number ${i} about src/f${i}.ts.`),
    );
    const draft = buildDraft(
      "",
      many,
      verdict({ durable: [0.9, 0.6, 0.7, 0.2, 0.95, 0.55, 0.8, 0.65], titleIdx: 4 }),
      detail,
    );
    expect(draft?.title).toBe("Fact number 4 about src/f4.ts.");
    expect(draft?.body.split("\n")).toEqual([
      "Fact number 0 about src/f0.ts.",
      "Fact number 2 about src/f2.ts.",
      "Fact number 6 about src/f6.ts.",
      "Fact number 7 about src/f7.ts.",
    ]);
  });
});

describe("buildDraft: the Context line", () => {
  const cands = [cand(0, "The cause was a pending timer in src/a.ts.")];
  const v = verdict({ durable: [0.9], titleIdx: 0 });

  test("needs at least five words in the prompt", () => {
    expect(bodyOf(buildDraft("ok força segue", cands, v, detail))).toBe("");
    expect(bodyOf(buildDraft("ok, força, segue já!", cands, v, detail))).toBe("");
    expect(bodyOf(buildDraft("the tests hang at exit", cands, v, detail))).toBe(
      "Context: the tests hang at exit",
    );
  });

  test("a title taken from the prompt gets none", () => {
    const rule = [cand(0, "Never mock the database in these tests.", "prompt")];
    expect(bodyOf(buildDraft("Never mock the database in these tests.", rule, v, detail))).toBe("");
  });
});
