import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Redacted } from "../../src/core/redact.ts";
import { Breaker } from "../../src/judge/breaker.ts";
import { TypeSafeError } from "../../src/judge/client.ts";
import { withFallback } from "../../src/judge/fallback.ts";
import { heuristicJudge, heuristicJudgeV1 } from "../../src/judge/heuristic.ts";
import { makeJudge, TOOL_JUDGE_TIMEOUT_MS, TOOL_USAGE_KEYS } from "../../src/judge/index.ts";
import {
  consolidateQuestions,
  consolidateState,
  consolidateVerdict,
  ENTRY_WORDING,
  MEMORY_WORDING,
} from "../../src/judge/questions.ts";
import type {
  ConsolidateInput,
  ConsolidateTexts,
  Judge,
  RelateInput,
} from "../../src/judge/types.ts";
import { TypeSafeJudge } from "../../src/judge/typesafe.ts";
import { type Db, openDb } from "../../src/store/db.ts";
import { getMeta } from "../../src/store/meta.ts";

process.env.WIZARDINGCODE_MEM_DISTILL = "off";
process.env.WIZARDINGCODE_MEM_UI_AUTO_OPEN = "off";

const KEY = ["apikey_", "test0000", "_", "x".repeat(40)].join("");
const r = (text: string) => text as Redacted;
type Fetch = typeof fetch;

const memoryInput: ConsolidateInput = {
  draft: {
    title: "The retry limit is five.",
    body: r("It was three."),
    kind: "decision",
    files: ["src/a.ts"],
  },
  neighbours: [
    { id: 7, title: "The retry limit is three.", body: r(""), files: ["src/a.ts"] },
    { id: 9, title: "Hooks exit zero.", body: r("Always."), files: [] },
  ],
};

const texts: ConsolidateTexts = {
  draft: { title: "Agency clients are billed per project", body: "Not monthly.", files: [] },
  neighbours: [
    { id: 0, title: "We bill agency clients monthly", body: "On the first day.", files: [] },
    { id: 1, title: "Invoices go out in euros", body: "", files: [] },
  ],
};

// --- the wording ----------------------------------------------------------------------

describe("consolidateState and consolidateQuestions, the wording", () => {
  test("with MEMORY_WORDING and with no wording, what they give today, byte for byte", () => {
    const today = {
      new_memory: { title: "The retry limit is five.", body: "It was three.", files: ["src/a.ts"] },
      existing: [
        { index: 0, title: "The retry limit is three.", body: "", files: ["src/a.ts"] },
        { index: 1, title: "Hooks exit zero.", body: "Always.", files: [] },
      ],
    };
    expect(JSON.stringify(consolidateState(memoryInput))).toBe(JSON.stringify(today));
    expect(JSON.stringify(consolidateState(memoryInput, MEMORY_WORDING))).toBe(
      JSON.stringify(today),
    );
    const questions = consolidateQuestions(memoryInput);
    expect(JSON.stringify(consolidateQuestions(memoryInput, MEMORY_WORDING))).toBe(
      JSON.stringify(questions),
    );
    expect(questions.rel_1).toEqual({
      type: "score",
      instructions: "How does the information in `new_memory` relate to `existing[1]`?",
      criteria: [
        "They are about different things",
        "Same topic, but each carries information the other lacks",
        "They state the same information",
      ],
    });
    expect(questions.contra_1).toEqual({
      type: "noul",
      instructions:
        "Does `new_memory` state something that makes `existing[1]` no longer true or no longer the current approach?",
      criteria: {
        true: "The new memory reverses, replaces or corrects what the existing one says.",
        false: "Both can be true at the same time.",
      },
    });
  });

  test("with ENTRY_WORDING the draft is new_entry, no files are sent, the questions say entry", () => {
    expect(MEMORY_WORDING).toEqual({ noun: "memory", current: "current approach" });
    expect(ENTRY_WORDING).toEqual({ noun: "entry", current: "current entry" });
    const state = consolidateState(texts, ENTRY_WORDING) as Record<string, unknown>;
    expect(Object.keys(state)).toEqual(["new_entry", "existing"]);
    expect(state.new_entry).toEqual({
      title: "Agency clients are billed per project",
      body: "Not monthly.",
    });
    expect(state.existing).toEqual([
      { index: 0, title: "We bill agency clients monthly", body: "On the first day." },
      { index: 1, title: "Invoices go out in euros", body: "" },
    ]);
    expect(JSON.stringify(state)).not.toContain("files");

    const questions = consolidateQuestions(texts, ENTRY_WORDING);
    expect(Object.keys(questions)).toEqual(["rel_0", "contra_0", "rel_1", "contra_1"]);
    for (const question of Object.values(questions)) {
      expect(question.instructions).toContain("`new_entry`");
      expect(question.instructions).not.toContain("new_memory");
    }
    expect(questions.contra_0?.instructions).toEndWith("no longer the current entry?");
    const criteria = questions.contra_0?.criteria as { true: string; false: string };
    expect(criteria.true).toStartWith("The new entry");
    expect(criteria.true).toBe(
      "The new entry reverses, replaces or corrects what the existing one says.",
    );
    expect(questions.rel_0?.type).toBe("score");
    expect(questions.contra_0?.type).toBe("noul");
  });

  test("consolidateVerdict reads the answers for texts that carry no memory kind", () => {
    const verdict = consolidateVerdict(texts, {
      rel_0: { type: "score", score: 1.2, legend: {}, probabilities: {}, confidence: 0.8 },
      contra_0: { type: "noul", noul: 0.85 },
      rel_1: { type: "score", score: 0.1, legend: {}, probabilities: {}, confidence: 0.9 },
      contra_1: { type: "noul", noul: 0.05 },
    } as never);
    expect(verdict).toEqual({
      source: "typesafe",
      perNeighbour: [
        { id: 0, relation: "related", relationScore: 1.2, contradicts: 0.85 },
        { id: 1, relation: "different", relationScore: 0.1, contradicts: 0.05 },
      ],
    });
  });
});

// --- the heuristic ---------------------------------------------------------------------

// Words of three letters or more, none a stopword: each counts as one token.
const W = [
  "apple",
  "banana",
  "cherry",
  "damson",
  "elder",
  "guava",
  "lemon",
  "mango",
  "olive",
  "peach",
  "quince",
  "raisin",
];
const words = (...indexes: number[]) => indexes.map((i) => W[i]).join(" ");

const relateInput = (draft: string, neighbours: string[]): RelateInput => ({
  draft: { title: r(draft), body: r("") },
  neighbours: neighbours.map((title, i) => ({ index: i + 10, title: r(title), body: r("") })),
});

/** The same comparison asked through memory's `consolidate`, with no files. */
async function viaConsolidate(input: RelateInput) {
  const verdict = await heuristicJudge.consolidate({
    draft: { title: input.draft.title, body: input.draft.body, kind: "decision", files: [] },
    neighbours: input.neighbours.map((n) => ({
      id: n.index,
      title: n.title,
      body: n.body,
      files: [],
    })),
  });
  return {
    source: verdict.source,
    perNeighbour: verdict.perNeighbour.map(({ id, ...rest }) => ({ index: id, ...rest })),
  };
}

describe("the heuristic's relate", () => {
  test("equals consolidate on the same texts with no files, by Jaccard band", async () => {
    const input = relateInput(words(0, 1, 2, 3), [
      words(0, 1, 2, 4), // 3 shared of 5: 0.6
      words(0, 1, 2, 4, 5, 6, 7, 8, 9), // 3 shared of 10: 0.3
      words(0, 9, 10, 11), // 1 shared of 7
    ]);
    const verdict = await heuristicJudge.relate(input);
    expect(verdict).toEqual(await viaConsolidate(input));
    expect(verdict.source).toBe("heuristic");
    expect(verdict.perNeighbour).toEqual([
      { index: 10, relation: "same", relationScore: 2, contradicts: 0.1 },
      { index: 11, relation: "related", relationScore: 1, contradicts: 0.1 },
      { index: 12, relation: "different", relationScore: 0, contradicts: 0.1 },
    ]);
  });

  test("contradicts is 0.8 for a draft with a supersede phrase at an overlap of 0.7, 0.1 without", async () => {
    // "no longer" adds the token "longer": 7 shared of 10, 0.7.
    const replacing = relateInput(`${words(0, 1, 2, 3, 4, 5, 6)} no longer`, [
      words(0, 1, 2, 3, 4, 5, 6, 7, 8),
    ]);
    const verdict = await heuristicJudge.relate(replacing);
    expect(verdict).toEqual(await viaConsolidate(replacing));
    expect(verdict.perNeighbour).toEqual([
      { index: 10, relation: "same", relationScore: 2, contradicts: 0.8 },
    ]);

    const plain = relateInput(`${words(0, 1, 2, 3, 4, 5, 6)} raisin`, [
      words(0, 1, 2, 3, 4, 5, 6, 7, 8),
    ]);
    expect((await heuristicJudge.relate(plain)).perNeighbour[0]?.contradicts).toBe(0.1);
  });

  test("version 1 of the heuristic answers relate the same way", async () => {
    const input = relateInput(words(0, 1, 2, 3), [words(0, 1, 2, 4)]);
    expect(await heuristicJudgeV1.relate(input)).toEqual(await heuristicJudge.relate(input));
  });

  test("with no neighbour, an empty verdict", async () => {
    expect(await heuristicJudge.relate(relateInput("x", []))).toEqual({
      source: "heuristic",
      perNeighbour: [],
    });
  });
});

// --- TypeSafe ---------------------------------------------------------------------------

function recorded(answers: Record<string, unknown>) {
  const calls: { state: Record<string, unknown>; questions: Record<string, { type: string }> }[] =
    [];
  const fetchFn: Fetch = (async (_url: unknown, init?: RequestInit) => {
    calls.push(JSON.parse(String(init?.body)));
    return new Response(
      JSON.stringify({ model: "jev", answers, usage: { input_tokens: 300, output_tokens: 9 } }),
      { status: 200 },
    );
  }) as unknown as Fetch;
  return { fetchFn, calls };
}

const scoreOf = (score: number) => ({
  type: "score",
  score,
  legend: {},
  probabilities: {},
  confidence: 0.9,
});

const entryInput: RelateInput = {
  draft: { title: r("Agency clients are billed every month"), body: r("") },
  neighbours: [
    { index: 4, title: r("We bill agency clients monthly"), body: r("On the first day.") },
    { index: 2, title: r("Agency invoices list the hours"), body: r("") },
    { index: 7, title: r("The office closes in August"), body: r("") },
  ],
};

describe("TypeSafe's relate", () => {
  test("one Score and one Noul per neighbour, in one request, mapped back to each index", async () => {
    const { fetchFn, calls } = recorded({
      rel_0: scoreOf(2),
      contra_0: { type: "noul", noul: 0.1 },
      rel_1: scoreOf(1),
      contra_1: { type: "noul", noul: 0.2 },
      rel_2: scoreOf(0),
      contra_2: { type: "noul", noul: 0.05 },
    });
    const verdict = await new TypeSafeJudge({ apiKey: KEY, fetch: fetchFn }).relate(entryInput);
    expect(calls).toHaveLength(1);
    const request = calls[0];
    expect(Object.keys(request?.questions ?? {})).toEqual([
      "rel_0",
      "contra_0",
      "rel_1",
      "contra_1",
      "rel_2",
      "contra_2",
    ]);
    expect(request?.questions.rel_0?.type).toBe("score");
    expect(request?.questions.contra_0?.type).toBe("noul");
    expect(Object.keys(request?.state ?? {})).toEqual(["new_entry", "existing"]);
    expect(JSON.stringify(request?.state)).not.toContain("files");
    expect(verdict).toEqual({
      source: "typesafe",
      perNeighbour: [
        { index: 4, relation: "same", relationScore: 2, contradicts: 0.1 },
        { index: 2, relation: "related", relationScore: 1, contradicts: 0.2 },
        { index: 7, relation: "different", relationScore: 0, contradicts: 0.05 },
      ],
    });
  });

  test("with no neighbour, no request", async () => {
    const { fetchFn, calls } = recorded({});
    const verdict = await new TypeSafeJudge({ apiKey: KEY, fetch: fetchFn }).relate({
      draft: entryInput.draft,
      neighbours: [],
    });
    expect(calls).toHaveLength(0);
    expect(verdict).toEqual({ source: "typesafe", perNeighbour: [] });
  });

  test("a missing answer is an error, not a guess", async () => {
    const { fetchFn } = recorded({ rel_0: scoreOf(2) });
    await expect(
      new TypeSafeJudge({ apiKey: KEY, fetch: fetchFn }).relate(entryInput),
    ).rejects.toThrow(/answer/);
  });
});

// --- the fallback and the tools' judge ----------------------------------------------------

describe("withFallback and makeJudge, relate", () => {
  let dir: string;
  let db: Db;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "wizardingcode-mem-relate-"));
    db = openDb({ dataDir: dir, busyTimeoutMs: 1000 });
  });
  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const failing = (error: unknown): Judge => ({
    name: "typesafe",
    version: "2",
    versions: { typesafe: "2" },
    distill: async () => {
      throw error;
    },
    consolidate: async () => {
      throw error;
    },
    relate: async () => {
      throw error;
    },
  });

  test("a TypeSafe error is answered by the heuristic, and the verdict says so", async () => {
    const errors: unknown[] = [];
    const breaker = new Breaker(db, { keyFingerprint: "k" });
    const judge = withFallback(
      failing(new TypeSafeError("network", "fetch failed")),
      heuristicJudge,
      breaker,
      { onError: (error) => void errors.push(error), now: () => 1000 },
    );
    const verdict = await judge.relate(entryInput);
    expect(verdict.source).toBe("heuristic");
    expect(verdict).toEqual(await heuristicJudge.relate(entryInput));
    expect(errors).toHaveLength(1);
    expect(breaker.state().failures).toBe(1);
  });

  test("toolPath: a 3,000 ms deadline, and its usage counted apart from distillation's", async () => {
    expect(TOOL_JUDGE_TIMEOUT_MS).toBe(3000);
    expect(TOOL_USAGE_KEYS).toEqual({
      requests: "typesafe.tools.requests",
      inputTokens: "typesafe.tools.input_tokens",
    });
    writeFileSync(join(dir, "env"), `TYPESAFE_API_KEY=${KEY}\n`);
    const { fetchFn, calls } = recorded({
      rel_0: scoreOf(2),
      contra_0: { type: "noul", noul: 0.1 },
      rel_1: scoreOf(1),
      contra_1: { type: "noul", noul: 0.2 },
      rel_2: scoreOf(0),
      contra_2: { type: "noul", noul: 0.05 },
    });
    const delays: number[] = [];
    const original = globalThis.setTimeout;
    globalThis.setTimeout = ((handler: () => void, ms?: number) => {
      delays.push(ms ?? 0);
      return original(handler, ms);
    }) as typeof setTimeout;
    try {
      const judge = makeJudge({ db, dataDir: dir, env: {}, fetch: fetchFn, toolPath: true });
      const verdict = await judge.relate(entryInput);
      expect(verdict.source).toBe("typesafe");
    } finally {
      globalThis.setTimeout = original;
    }
    expect(calls).toHaveLength(1);
    expect(delays).toContain(3000);
    expect(getMeta(db, "typesafe.tools.requests")).toBe("1");
    expect(getMeta(db, "typesafe.tools.input_tokens")).toBe("300");
    expect(getMeta(db, "typesafe.requests")).toBeNull();
    expect(getMeta(db, "typesafe.input_tokens")).toBeNull();
  });

  test("toolPath: no retries, a 429 is one request and the heuristic answers", async () => {
    writeFileSync(join(dir, "env"), `TYPESAFE_API_KEY=${KEY}\n`);
    let requests = 0;
    const busy: Fetch = (async () => {
      requests++;
      return new Response("{}", { status: 429 });
    }) as unknown as Fetch;
    const judge = makeJudge({ db, dataDir: dir, env: {}, fetch: busy, toolPath: true });
    const verdict = await judge.relate(entryInput);
    expect(requests).toBe(1);
    expect(verdict.source).toBe("heuristic");
    expect(getMeta(db, "typesafe.tools.requests")).toBeNull();
  });

  test("without toolPath, the distillation judge still retries a 429", async () => {
    writeFileSync(join(dir, "env"), `TYPESAFE_API_KEY=${KEY}\n`);
    let requests = 0;
    const busy: Fetch = (async () => {
      requests++;
      return new Response("{}", { status: 429 });
    }) as unknown as Fetch;
    const judge = makeJudge({ db, dataDir: dir, env: {}, fetch: busy });
    expect((await judge.relate(entryInput)).source).toBe("heuristic");
    expect(requests).toBe(3);
  });
});
