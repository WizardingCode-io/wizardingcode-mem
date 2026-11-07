import { describe, expect, test } from "bun:test";
import { SAVE_THRESHOLD } from "../../src/distill/policy.ts";
import { heuristicJudge } from "../../src/judge/heuristic.ts";
import type { DistillVerdict, Judge } from "../../src/judge/types.ts";
import { TypeSafeJudge } from "../../src/judge/typesafe.ts";
import { distillInput } from "../helpers/judge-input.ts";
import turns from "./turns.json" with { type: "json" };
import recorded from "./typesafe-answers.json" with { type: "json" };

// The two judges on the same hand-written turns. TypeSafe's answers were recorded with
// `bun scripts/record-typesafe.ts`, so this runs with no key and no network. The set was
// written alongside the heuristic rules: a baseline for both, a measure of neither.

const answersByTurn = recorded.turns as Record<string, { answers: unknown; inputTokens: number }>;

/** The golden turn being scored: the recording is looked up by its id. */
let replaying = "";

/** A TypeSafe judge whose service is the recording. */
function replayingJudge(): Judge {
  const fetchFn = (async () => {
    const entry = answersByTurn[replaying];
    if (entry === undefined) return new Response("{}", { status: 422 });
    return new Response(
      JSON.stringify({
        model: "jev-latest",
        answers: entry.answers,
        usage: { input_tokens: entry.inputTokens, output_tokens: 0 },
      }),
    );
  }) as unknown as typeof fetch;
  return new TypeSafeJudge({ apiKey: "recorded", fetch: fetchFn });
}

interface Scored {
  name: string;
  precision: number;
  recall: number;
  kindAccuracy: number;
  wrongKeeps: string[];
  missed: string[];
}

async function score(name: string, judge: Judge): Promise<Scored> {
  const verdicts: { id: string; worth: boolean; kind: string; verdict: DistillVerdict }[] = [];
  for (const turn of turns) {
    replaying = turn.id;
    const verdict = await judge.distill(
      distillInput(turn.prompt, turn.final, {
        filesChanged: turn.filesChanged,
        hadErrors: turn.hadErrors,
      }),
    );
    verdicts.push({ id: turn.id, worth: turn.worth, kind: turn.kind, verdict });
  }
  const kept = verdicts.filter((v) => v.verdict.worthSaving >= SAVE_THRESHOLD);
  const worth = verdicts.filter((v) => v.worth);
  const right = kept.filter((v) => v.worth);
  return {
    name,
    precision: right.length / Math.max(1, kept.length),
    recall: right.length / Math.max(1, worth.length),
    kindAccuracy: right.filter((v) => v.verdict.kind === v.kind).length / Math.max(1, right.length),
    wrongKeeps: kept.filter((v) => !v.worth).map((v) => v.id),
    missed: worth.filter((v) => v.verdict.worthSaving < SAVE_THRESHOLD).map((v) => v.id),
  };
}

const heuristic = await score("heuristic", heuristicJudge);
const typesafe = await score("typesafe", replayingJudge());

describe("golden set: the two judges side by side", () => {
  test("the recording covers every golden turn", () => {
    expect(Object.keys(answersByTurn).sort()).toEqual(turns.map((turn) => turn.id).sort());
  });

  for (const scored of [heuristic, typesafe]) {
    test(`${scored.name}: precision, recall and kind accuracy`, () => {
      console.log(
        `${scored.name.padEnd(9)} precision ${(scored.precision * 100).toFixed(0)}%  recall ${(scored.recall * 100).toFixed(0)}%  kind ${(scored.kindAccuracy * 100).toFixed(0)}%` +
          (scored.wrongKeeps.length ? `  wrongly kept: ${scored.wrongKeeps.join(", ")}` : "") +
          (scored.missed.length ? `  missed: ${scored.missed.join(", ")}` : ""),
      );
      // Floors sit under what was measured when set; they catch regressions in either judge
      // and in the questions asked of TypeSafe.
      expect(scored.precision).toBeGreaterThanOrEqual(0.85);
      expect(scored.recall).toBeGreaterThanOrEqual(0.85);
      expect(scored.kindAccuracy).toBeGreaterThanOrEqual(0.75);
    });
  }

  // What TypeSafe says sentence by sentence, on cases where there is no room for doubt.
  test("TypeSafe: questions and offers are not durable; causes and trade-offs are", async () => {
    const judge = replayingJudge();
    const durability = async (id: string, fragment: string) => {
      const turn = turns.find((t) => t.id === id);
      if (turn === undefined) throw new Error(`golden turn ${id} missing`);
      replaying = id;
      const input = distillInput(turn.prompt, turn.final, {
        filesChanged: turn.filesChanged,
        hadErrors: turn.hadErrors,
      });
      const verdict = await judge.distill(input);
      const candidate = input.candidates.find((c) => c.text.includes(fragment));
      if (candidate === undefined) throw new Error(`no candidate with "${fragment}"`);
      return verdict.durable[candidate.idx] as number;
    };
    expect(await durability("pt-decision-typescript", "usamos Go ou TypeScript")).toBeLessThan(0.5);
    expect(await durability("en-none-plan-not-done", "Would you like me")).toBeLessThan(0.5);
    expect(
      await durability("en-fix-pending-timer", "The cause was a pending timer"),
    ).toBeGreaterThanOrEqual(0.5);
    expect(
      await durability("pt-decision-typescript", "O custo é um binário maior"),
    ).toBeGreaterThanOrEqual(0.5);
    expect(
      await durability("en-convention-no-mocks", "We always test against"),
    ).toBeGreaterThanOrEqual(0.5);
  });
});
