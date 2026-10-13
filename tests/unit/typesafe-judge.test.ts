import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Redacted } from "../../src/core/redact.ts";
import { Breaker } from "../../src/judge/breaker.ts";
import { systemOne, TypeSafeError } from "../../src/judge/client.ts";
import { withFallback } from "../../src/judge/fallback.ts";
import { heuristicJudge } from "../../src/judge/heuristic.ts";
import { readTypeSafeKey } from "../../src/judge/key.ts";
import type { ConsolidateInput, DistillInput, Judge } from "../../src/judge/types.ts";
import { TypeSafeJudge } from "../../src/judge/typesafe.ts";
import { type Db, openDb } from "../../src/store/db.ts";
import { getMeta } from "../../src/store/meta.ts";

const KEY = ["apikey_", "test0000", "_", "x".repeat(40)].join("");

// --- key -----------------------------------------------------------------------------

describe("readTypeSafeKey", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "wizardingcode-mem-key-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("the environment wins", () => {
    writeFileSync(join(dir, "env"), `TYPESAFE_API_KEY=${KEY}file\n`);
    expect(readTypeSafeKey({ TYPESAFE_API_KEY: KEY }, dir)).toBe(KEY);
  });

  test("then the env file in the data directory, with or without quotes", () => {
    writeFileSync(join(dir, "env"), `# comment\nOTHER=1\nTYPESAFE_API_KEY="${KEY}"  \n`);
    expect(readTypeSafeKey({}, dir)).toBe(KEY);
    writeFileSync(join(dir, "env"), `export TYPESAFE_API_KEY='${KEY}'\n`);
    expect(readTypeSafeKey({}, dir)).toBe(KEY);
  });

  test("nothing configured is null, never an error", () => {
    expect(readTypeSafeKey({}, dir)).toBeNull();
    expect(readTypeSafeKey({ TYPESAFE_API_KEY: "" }, join(dir, "missing"))).toBeNull();
    writeFileSync(join(dir, "env"), "TYPESAFE_API_KEY=\n");
    expect(readTypeSafeKey({}, dir)).toBeNull();
  });
});

// --- client --------------------------------------------------------------------------

type Fetch = typeof fetch;
const reply = (status: number, body: unknown): Fetch =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as Fetch;

const OK_BODY = {
  model: "jev-1.13.0",
  answers: { a: { type: "noul", noul: 0.9 } },
  usage: { input_tokens: 100, output_tokens: 10 },
};

describe("systemOne", () => {
  test("sends the key as a bearer token and returns answers and usage", async () => {
    let seen: { url: string; headers: Record<string, string>; body: unknown } | undefined;
    const fetchFn: Fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      seen = {
        url: String(url),
        headers: init?.headers as Record<string, string>,
        body: JSON.parse(String(init?.body)),
      };
      return new Response(JSON.stringify(OK_BODY), { status: 200 });
    }) as unknown as Fetch;
    const result = await systemOne(
      { state: { x: 1 }, questions: { a: { type: "noul", instructions: "q" } } },
      { apiKey: KEY, fetch: fetchFn, timeoutMs: 1000 },
    );
    expect(seen?.url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(seen?.headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(seen?.body).toEqual({
      model: "jev-latest",
      state: { x: 1 },
      questions: { a: { type: "noul", instructions: "q" } },
    });
    expect(result.answers.a).toEqual({ type: "noul", noul: 0.9 });
    expect(result.usage).toEqual({ input_tokens: 100, output_tokens: 10 });
  });

  test.each([
    [401, "auth"],
    [403, "auth"],
    [422, "invalid"],
    [429, "rate"],
    [529, "overloaded"],
    [500, "server"],
  ])("status %d is a %s error", async (status, kind) => {
    const run = systemOne(
      { state: {}, questions: {} },
      { apiKey: KEY, fetch: reply(status, { detail: "nope" }), timeoutMs: 1000 },
    );
    await expect(run).rejects.toBeInstanceOf(TypeSafeError);
    await expect(run).rejects.toMatchObject({ kind, status });
  });

  test("a network failure and a timeout are their own kinds", async () => {
    const failing: Fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as Fetch;
    await expect(
      systemOne({ state: {}, questions: {} }, { apiKey: KEY, fetch: failing, timeoutMs: 1000 }),
    ).rejects.toMatchObject({ kind: "network" });

    const slow: Fetch = ((_url: unknown, init?: RequestInit) =>
      new Promise((_, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      })) as unknown as Fetch;
    const started = performance.now();
    await expect(
      systemOne({ state: {}, questions: {} }, { apiKey: KEY, fetch: slow, timeoutMs: 50 }),
    ).rejects.toMatchObject({ kind: "timeout" });
    expect(performance.now() - started).toBeLessThan(1000);
  });

  test("no error ever carries the key", async () => {
    const leaky = reply(401, { detail: `bad key ${KEY}` });
    try {
      await systemOne({ state: {}, questions: {} }, { apiKey: KEY, fetch: leaky, timeoutMs: 1000 });
    } catch (error) {
      expect(String(error)).not.toContain(KEY);
      expect(JSON.stringify(error)).not.toContain(KEY);
    }
  });
});

// --- judge ---------------------------------------------------------------------------

const r = (text: string) => text as Redacted;
const distillInput: DistillInput = {
  prompt: r("the tests fail with a timeout"),
  finalText: r(
    "Fixed: the root cause was the busy timeout. Moved the pragma to the top of `openDb`.",
  ),
  candidates: [
    { idx: 0, source: "prompt", text: r("the tests fail with a timeout") },
    { idx: 1, source: "final", text: r("Fixed: the root cause was the busy timeout.") },
    { idx: 2, source: "final", text: r("Moved the pragma to the top of `openDb`.") },
  ],
  filesChanged: ["src/store/db.ts"],
  commands: [],
  hadErrors: true,
};

const distillAnswers = {
  worth: { type: "noul", noul: 0.88 },
  kind: {
    type: "choice",
    choice: "fix",
    probabilities: { fix: 0.97, change: 0.03 },
    confidence: 0.96,
  },
  importance: { type: "score", score: 2.79, legend: {}, probabilities: {}, confidence: 0.8 },
  durable_0: { type: "noul", noul: 0.13 },
  durable_1: { type: "noul", noul: 0.79 },
  durable_2: { type: "noul", noul: 0.81 },
  title: { type: "choice", choice: "c1", probabilities: {}, confidence: 0.7 },
};

function recorded(
  answers: Record<string, unknown>,
  usage = { input_tokens: 1443, output_tokens: 230 },
) {
  const calls: unknown[] = [];
  const fetchFn: Fetch = (async (_url: unknown, init?: RequestInit) => {
    calls.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ model: "jev-1.13.0", answers, usage }), { status: 200 });
  }) as unknown as Fetch;
  return { fetchFn, calls };
}

describe("TypeSafeJudge", () => {
  test("asks one request per turn and maps the answers to a verdict", async () => {
    const { fetchFn, calls } = recorded(distillAnswers);
    const usage: number[] = [];
    const judge = new TypeSafeJudge({
      apiKey: KEY,
      fetch: fetchFn,
      onUsage: (tokens) => void usage.push(tokens),
    });
    const verdict = await judge.distill(distillInput);
    expect(calls).toHaveLength(1);
    const request = calls[0] as {
      state: Record<string, unknown>;
      questions: Record<string, unknown>;
    };
    expect(Object.keys(request.questions).sort()).toEqual(
      ["durable_0", "durable_1", "durable_2", "importance", "kind", "title", "worth"].sort(),
    );
    expect(request.state).toMatchObject({
      user_prompt: "the tests fail with a timeout",
      files_changed: ["src/store/db.ts"],
      had_errors: true,
    });
    expect(verdict).toEqual({
      worthSaving: 0.88,
      kind: "fix",
      kindConfidence: 0.96,
      importance: 4,
      durable: [0.13, 0.79, 0.81],
      titleIdx: 1,
      source: "typesafe",
    });
    expect(usage).toEqual([1443]);
    expect(judge.name).toBe("typesafe");
  });

  test("a title of 'none' and a kind of 'none' are passed through as such", async () => {
    const { fetchFn } = recorded({
      ...distillAnswers,
      kind: { type: "choice", choice: "none", probabilities: {}, confidence: 0.9 },
      title: { type: "choice", choice: "none", probabilities: {}, confidence: 0.9 },
    });
    const verdict = await new TypeSafeJudge({ apiKey: KEY, fetch: fetchFn }).distill(distillInput);
    expect(verdict.kind).toBe("none");
    expect(verdict.titleIdx).toBeNull();
  });

  test("a missing or malformed answer is an error, not a guess", async () => {
    const { fetchFn } = recorded({ worth: { type: "noul", noul: 0.5 } });
    await expect(
      new TypeSafeJudge({ apiKey: KEY, fetch: fetchFn }).distill(distillInput),
    ).rejects.toThrow(/answer/);
  });

  test("consolidation asks about every neighbour and maps relation and contradiction", async () => {
    const { fetchFn, calls } = recorded({
      rel_0: { type: "score", score: 1.9, legend: {}, probabilities: {}, confidence: 0.9 },
      contra_0: { type: "noul", noul: 0.1 },
      rel_1: { type: "score", score: 0.2, legend: {}, probabilities: {}, confidence: 0.9 },
      contra_1: { type: "noul", noul: 0.8 },
    });
    const input: ConsolidateInput = {
      draft: {
        title: "The retry limit is five.",
        body: r("It was three."),
        kind: "decision",
        files: [],
      },
      neighbours: [
        { id: 7, title: "The retry limit is five.", body: r(""), files: [] },
        { id: 9, title: "Hooks exit zero.", body: r(""), files: [] },
      ],
    };
    const verdict = await new TypeSafeJudge({ apiKey: KEY, fetch: fetchFn }).consolidate(input);
    expect(calls).toHaveLength(1);
    expect(verdict).toEqual({
      source: "typesafe",
      perNeighbour: [
        { id: 7, relation: "same", relationScore: 1.9, contradicts: 0.1 },
        { id: 9, relation: "different", relationScore: 0.2, contradicts: 0.8 },
      ],
    });
  });

  test("with no neighbours, no request is made", async () => {
    const { fetchFn, calls } = recorded({});
    const verdict = await new TypeSafeJudge({ apiKey: KEY, fetch: fetchFn }).consolidate({
      draft: { title: "x", body: r(""), kind: "decision", files: [] },
      neighbours: [],
    });
    expect(calls).toHaveLength(0);
    expect(verdict.perNeighbour).toEqual([]);
  });

  test("retries rate limits and overload, but not an invalid request", async () => {
    let attempts = 0;
    const flaky: Fetch = (async () => {
      attempts++;
      if (attempts < 3) return new Response("{}", { status: 529 });
      return new Response(
        JSON.stringify({
          model: "jev",
          answers: distillAnswers,
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
        { status: 200 },
      );
    }) as unknown as Fetch;
    const judge = new TypeSafeJudge({ apiKey: KEY, fetch: flaky, retryDelaysMs: [1, 1] });
    expect((await judge.distill(distillInput)).kind).toBe("fix");
    expect(attempts).toBe(3);

    let invalid = 0;
    const bad: Fetch = (async () => {
      invalid++;
      return new Response("{}", { status: 422 });
    }) as unknown as Fetch;
    await expect(
      new TypeSafeJudge({ apiKey: KEY, fetch: bad, retryDelaysMs: [1, 1] }).distill(distillInput),
    ).rejects.toMatchObject({ kind: "invalid" });
    expect(invalid).toBe(1);
  });
});

// --- breaker -------------------------------------------------------------------------

describe("Breaker", () => {
  let dir: string;
  let db: Db;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "wizardingcode-mem-breaker-"));
    db = openDb({ dataDir: dir, busyTimeoutMs: 1000 });
  });
  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("closed by default; three failures in a row open it for a minute, doubling each time", () => {
    const breaker = new Breaker(db, { keyFingerprint: "k1" });
    expect(breaker.allow(1000)).toBe(true);
    breaker.failure("network", 1000);
    breaker.failure("network", 1000);
    expect(breaker.allow(1000)).toBe(true);
    breaker.failure("timeout", 1000);
    expect(breaker.allow(1000)).toBe(false);
    expect(breaker.allow(1000 + 59_000)).toBe(false);
    expect(breaker.allow(1000 + 61_000)).toBe(true);
    // Still broken: the next failure opens it for two minutes.
    breaker.failure("network", 70_000);
    expect(breaker.allow(70_000 + 100_000)).toBe(false);
    expect(breaker.allow(70_000 + 121_000)).toBe(true);
  });

  test("a success closes it again", () => {
    const breaker = new Breaker(db, { keyFingerprint: "k1" });
    for (let i = 0; i < 3; i++) breaker.failure("network", 1000);
    breaker.success(1000);
    expect(breaker.allow(1000)).toBe(true);
    for (let i = 0; i < 2; i++) breaker.failure("network", 2000);
    expect(breaker.allow(2000)).toBe(true);
  });

  test("a rejected key opens it until the key changes", () => {
    const breaker = new Breaker(db, { keyFingerprint: "k1" });
    breaker.failure("auth", 1000);
    expect(breaker.allow(1000)).toBe(false);
    expect(breaker.allow(1000 + 365 * 86_400_000)).toBe(false);
    expect(breaker.state().reason).toBe("auth");
    // A new key is a new situation.
    expect(new Breaker(db, { keyFingerprint: "k2" }).allow(1000)).toBe(true);
  });

  test("the state survives the process: it lives in the database", () => {
    new Breaker(db, { keyFingerprint: "k1" }).failure("auth", 1000);
    expect(getMeta(db, "breaker.typesafe")).toContain('"auth"');
    expect(new Breaker(db, { keyFingerprint: "k1" }).allow(5000)).toBe(false);
  });

  test("the backoff caps at fifteen minutes", () => {
    const breaker = new Breaker(db, { keyFingerprint: "k1" });
    let now = 0;
    for (let round = 0; round < 8; round++) {
      for (let i = 0; i < 3; i++) breaker.failure("network", now);
      now += 20 * 60_000;
    }
    expect(breaker.state().backoffMs).toBe(15 * 60_000);
  });
});

// --- fallback ------------------------------------------------------------------------

describe("withFallback", () => {
  let dir: string;
  let db: Db;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "wizardingcode-mem-fallback-"));
    db = openDb({ dataDir: dir, busyTimeoutMs: 1000 });
  });
  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const failing = (error: unknown): Judge => ({
    name: "typesafe",
    version: "1",
    versions: { typesafe: "1" },
    distill: async () => {
      throw error;
    },
    consolidate: async () => {
      throw error;
    },
  });
  const working: Judge = {
    ...heuristicJudge,
    name: "typesafe",
    versions: { typesafe: "1" },
    distill: async (input) => ({ ...(await heuristicJudge.distill(input)), source: "typesafe" }),
  };

  test("uses the primary when it works, and says so", async () => {
    const judge = withFallback(
      working,
      heuristicJudge,
      new Breaker(db, { keyFingerprint: "k" }),
      {},
    );
    expect((await judge.distill(distillInput)).source).toBe("typesafe");
    expect(judge.name).toBe("fallback");
    // Each memory records the version of the judge that actually produced it.
    expect(judge.versions).toEqual({ typesafe: "1", heuristic: "1" });
  });

  test("falls back when the primary fails, reports the failure, and remembers it", async () => {
    const errors: unknown[] = [];
    const breaker = new Breaker(db, { keyFingerprint: "k" });
    const judge = withFallback(
      failing(new TypeSafeError("network", "fetch failed")),
      heuristicJudge,
      breaker,
      { onError: (error) => void errors.push(error), now: () => 1000 },
    );
    expect((await judge.distill(distillInput)).source).toBe("heuristic");
    expect(errors).toHaveLength(1);
    expect(breaker.state().failures).toBe(1);
  });

  test("while the breaker is open, the primary is not even tried", async () => {
    let tried = 0;
    const counting: Judge = {
      ...working,
      distill: async (input) => {
        tried++;
        return working.distill(input);
      },
    };
    const breaker = new Breaker(db, { keyFingerprint: "k" });
    breaker.failure("auth", 1000);
    const judge = withFallback(counting, heuristicJudge, breaker, { now: () => 2000 });
    expect((await judge.distill(distillInput)).source).toBe("heuristic");
    expect(tried).toBe(0);
  });

  test("an invalid request is our fault: fallback, but the breaker stays closed", async () => {
    const breaker = new Breaker(db, { keyFingerprint: "k" });
    const judge = withFallback(
      failing(new TypeSafeError("invalid", "422", 422)),
      heuristicJudge,
      breaker,
      { now: () => 1000 },
    );
    for (let i = 0; i < 4; i++) await judge.distill(distillInput);
    expect(breaker.allow(1000)).toBe(true);
  });
});

// --- personal rules --------------------------------------------------------------------

const ruleInput = {
  title: "Run the tests with the pinned bun",
  body: "The global one diverges.",
  projects: ["alpha", "bravo"],
};

describe("TypeSafeJudge.personal", () => {
  test("asks one yes/no question about the rule and its projects", async () => {
    const { fetchFn, calls } = recorded({ personal: { type: "noul", noul: 0.2 } });
    const verdict = await new TypeSafeJudge({ apiKey: KEY, fetch: fetchFn }).personal(ruleInput);
    expect(calls).toHaveLength(1);
    const request = calls[0] as { state: unknown; questions: Record<string, { type: string }> };
    expect(Object.keys(request.questions)).toEqual(["personal"]);
    expect(request.questions.personal?.type).toBe("noul");
    expect(request.state).toEqual({
      rule: { title: ruleInput.title, body: ruleInput.body },
      projects: ["alpha", "bravo"],
    });
    expect(verdict.personal).toBe(false);
    expect(verdict.confidence).toBeCloseTo(0.8);
  });

  test("a likely yes is personal", async () => {
    const { fetchFn } = recorded({ personal: { type: "noul", noul: 0.9 } });
    const verdict = await new TypeSafeJudge({ apiKey: KEY, fetch: fetchFn }).personal(ruleInput);
    expect(verdict).toEqual({ personal: true, confidence: 0.9 });
  });

  test("a missing answer is an error", async () => {
    const { fetchFn } = recorded({});
    await expect(
      new TypeSafeJudge({ apiKey: KEY, fetch: fetchFn }).personal(ruleInput),
    ).rejects.toThrow(/answer/);
  });
});

describe("withFallback and personal", () => {
  let dir: string;
  let db: Db;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "wizardingcode-mem-fallback-personal-"));
    db = openDb({ dataDir: dir, busyTimeoutMs: 1000 });
  });
  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("passes the primary's answer through", async () => {
    const primary: Judge = {
      ...heuristicJudge,
      personal: async () => ({ personal: false, confidence: 0.9 }),
    };
    const judge = withFallback(
      primary,
      heuristicJudge,
      new Breaker(db, { keyFingerprint: "k" }),
      {},
    );
    expect(await judge.personal?.(ruleInput)).toEqual({ personal: false, confidence: 0.9 });
  });

  test("absent when the primary cannot answer it", () => {
    const judge = withFallback(
      heuristicJudge,
      heuristicJudge,
      new Breaker(db, { keyFingerprint: "k" }),
      {},
    );
    expect(judge.personal).toBeUndefined();
  });

  test("a failed primary leaves the decision to the author: personal, with no confidence", async () => {
    const errors: unknown[] = [];
    const primary: Judge = {
      ...heuristicJudge,
      personal: async () => {
        throw new TypeSafeError("network", "fetch failed");
      },
    };
    const judge = withFallback(primary, heuristicJudge, new Breaker(db, { keyFingerprint: "k" }), {
      onError: (error) => void errors.push(error),
    });
    expect(await judge.personal?.(ruleInput)).toEqual({ personal: true, confidence: 0 });
    expect(errors).toHaveLength(1);
  });
});
