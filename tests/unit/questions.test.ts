import { describe, expect, test } from "bun:test";
import { distillQuestions, distillState, distillVerdict } from "../../src/judge/questions.ts";
import turns from "../golden/turns.json" with { type: "json" };
import { distillInput } from "../helpers/judge-input.ts";

const input = distillInput(
  "the tests hang after the last case",
  "The cause was a pending timer in src/a.ts. Next I will open the PR.",
);

describe("questions, version 2", () => {
  test("the state names the reader once, and candidates are indexed as the questions address them", () => {
    const state = distillState(input);
    expect(state).toMatchObject({
      reader:
        "a developer who joins this repository a month from now and never saw this conversation",
    });
    expect(state.candidates.map((c) => c.id)).toEqual([0, 1, 2]);
  });

  test("one knowledge question per candidate, named by its index, plus worth, kind, importance and title", () => {
    const questions = distillQuestions(input);
    expect(Object.keys(questions).sort()).toEqual([
      "importance",
      "kind",
      "knowledge_0",
      "knowledge_1",
      "knowledge_2",
      "title",
      "worth",
    ]);
    expect(questions.knowledge_1?.instructions).toContain("`candidates[1].text`");
    expect(questions.knowledge_1?.instructions).toContain("`reader`");
    expect(questions.worth?.criteria).toMatchObject({ false: expect.stringContaining("merged") });
    expect(questions.kind?.criteria).toMatchObject({
      change: expect.stringContaining("Not that something was done"),
    });
    expect(questions.title?.criteria).toMatchObject({
      none: "No candidate states knowledge on its own.",
    });
  });

  test("every path a question names exists in the state", () => {
    const state = distillState(input) as Record<string, unknown>;
    for (const question of Object.values(distillQuestions(input))) {
      for (const [, path = ""] of question.instructions.matchAll(
        /`([a-z_]+(?:\[\d+\]\.[a-z_]+)?)`/g,
      )) {
        const [, root = "", index, field = ""] =
          /^([a-z_]+)(?:\[(\d+)\]\.([a-z_]+))?$/.exec(path) ?? [];
        const value = state[root];
        const found =
          index === undefined
            ? value !== undefined
            : field in ((value as Record<string, unknown>[])[Number(index)] ?? {});
        expect([path, found]).toEqual([path, true]);
      }
    }
  });

  test("the verdict reads knowledge_<i> into durable, and a title of none is null", () => {
    const verdict = distillVerdict(input, {
      worth: { type: "noul", noul: 0.8 },
      kind: { type: "choice", choice: "fix", probabilities: { fix: 0.9 }, confidence: 0.9 },
      importance: { type: "score", score: 2.2, legend: {}, probabilities: {}, confidence: 0.8 },
      knowledge_0: { type: "noul", noul: 0.1 },
      knowledge_1: { type: "noul", noul: 0.9 },
      knowledge_2: { type: "noul", noul: 0.05 },
      title: { type: "choice", choice: "none", probabilities: {}, confidence: 0.6 },
    });
    expect(verdict.durable).toEqual([0.1, 0.9, 0.05]);
    expect(verdict.titleIdx).toBeNull();
    expect(verdict.importance).toBe(3);
  });
});

describe("questions, version 1: the import rejudge's wording (D-2)", () => {
  test("with no candidates, as rejudge asks: worth, kind and importance in their version 1 wording, no reader", () => {
    const imported = { ...input, candidates: [], wording: 1 as const };
    expect(distillState(imported)).not.toHaveProperty("reader");
    const questions = distillQuestions(imported);
    expect(Object.keys(questions).sort()).toEqual(["importance", "kind", "worth"]);
    expect(questions.worth?.instructions).toBe(
      "Would a developer starting a new coding session on this repository weeks from now work better by knowing something stated in `user_prompt` or `assistant_final_message`?",
    );
    expect(questions.kind?.instructions).toBe(
      "What kind of lasting knowledge does this turn mainly contain?",
    );
    expect(questions.importance?.instructions).toBe(
      "How costly would it be for a future session not to know this?",
    );
  });

  test("with candidates, still only the three: no sentence is knowledge and there is no title", () => {
    const v1 = { ...input, wording: 1 as const };
    expect(Object.keys(distillQuestions(v1)).sort()).toEqual(["importance", "kind", "worth"]);
    const verdict = distillVerdict(v1, {
      worth: { type: "noul", noul: 0.8 },
      kind: { type: "choice", choice: "fix", probabilities: {}, confidence: 0.9 },
      importance: { type: "score", score: 1, legend: {}, probabilities: {}, confidence: 0.8 },
    });
    expect(verdict.durable).toEqual([0, 0, 0]);
    expect(verdict.titleIdx).toBeNull();
    expect(verdict.importance).toBe(2);
  });
});

describe("the golden input goes through the filter, as the drain does", () => {
  const golden = (id: string) => {
    const turn = turns.find((t) => t.id === id);
    if (turn === undefined) throw new Error(`golden turn ${id} missing`);
    return distillInput(turn.prompt, turn.final, {
      filesChanged: turn.filesChanged,
      hadErrors: turn.hadErrors,
    });
  };

  test("a host block never reaches the judge", () => {
    const state = distillState(golden("en-none-hand-back"));
    const sent = JSON.stringify(state);
    expect(sent).not.toContain("agent-message");
    expect(sent).not.toContain("Subagent hand-back");
    expect(sent).not.toContain("NOT a message from the user");
  });

  test("template labels the filter drops are neither candidates nor in the texts", () => {
    const state = distillState(golden("en-none-template-leak"));
    expect(state.candidates).toEqual([]);
    expect(state.assistant_final_message).not.toContain("Title:");
    expect(state.assistant_final_message).not.toContain("Body:");
  });
});
