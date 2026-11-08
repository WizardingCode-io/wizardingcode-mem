import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeJudge } from "../../src/judge/index.ts";
import { type Db, openDb } from "../../src/store/db.ts";
import { getMeta } from "../../src/store/meta.ts";

let dir: string;
let db: Db;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wizardingcode-mem-judge-"));
  db = openDb({ dataDir: dir, busyTimeoutMs: 1000 });
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const KEY = ["apikey_", "x".repeat(60)].join("");
const okResponse = {
  model: "jev",
  answers: {
    worth: { type: "noul", noul: 0.9 },
    kind: { type: "choice", choice: "fix", probabilities: {}, confidence: 1 },
    importance: { type: "score", score: 3, legend: {}, probabilities: {}, confidence: 1 },
    knowledge_0: { type: "noul", noul: 0.8 },
    title: { type: "choice", choice: "c0", probabilities: {}, confidence: 1 },
  },
  usage: { input_tokens: 500, output_tokens: 20 },
};
const input = {
  prompt: "p" as never,
  finalText: "Fixed: the root cause was X in src/a.ts." as never,
  candidates: [{ idx: 0, source: "final" as const, text: "Fixed: the root cause was X." as never }],
  filesChanged: ["src/a.ts"],
  commands: [],
  hadErrors: true,
};

describe("makeJudge", () => {
  test("without a key, the heuristic judge alone, and nothing on the network", async () => {
    let fetched = 0;
    const judge = makeJudge({
      db,
      dataDir: dir,
      env: {},
      fetch: (async () => {
        fetched++;
        return new Response("{}");
      }) as unknown as typeof fetch,
    });
    expect(judge.name).toBe("heuristic");
    await judge.distill(input);
    expect(fetched).toBe(0);
  });

  test("with a key but WIZARDINGCODE_MEM_TYPESAFE=off, the heuristic judge alone", async () => {
    writeFileSync(join(dir, "env"), `TYPESAFE_API_KEY=${KEY}\nWIZARDINGCODE_MEM_TYPESAFE=off\n`);
    let fetched = 0;
    const judge = makeJudge({
      db,
      dataDir: dir,
      env: {},
      fetch: (async () => {
        fetched++;
        return new Response(JSON.stringify(okResponse));
      }) as unknown as typeof fetch,
    });
    expect(judge.name).toBe("heuristic");
    await judge.distill(input);
    expect(fetched).toBe(0);
  });

  test("with a key, TypeSafe answers and its cost is counted in the database", async () => {
    writeFileSync(join(dir, "env"), `TYPESAFE_API_KEY=${KEY}\n`);
    const judge = makeJudge({
      db,
      dataDir: dir,
      env: {},
      fetch: (async () => new Response(JSON.stringify(okResponse))) as unknown as typeof fetch,
    });
    expect(judge.name).toBe("fallback");
    const verdict = await judge.distill(input);
    expect(verdict.source).toBe("typesafe");
    expect(verdict.importance).toBe(4);
    await judge.distill(input);
    expect(getMeta(db, "typesafe.requests")).toBe("2");
    expect(getMeta(db, "typesafe.input_tokens")).toBe("1000");
  });

  test("WIZARDINGCODE_MEM_TYPESAFE_URL sends the requests somewhere else", async () => {
    writeFileSync(join(dir, "env"), `TYPESAFE_API_KEY=${KEY}\n`);
    const urls: string[] = [];
    const judge = makeJudge({
      db,
      dataDir: dir,
      env: { WIZARDINGCODE_MEM_TYPESAFE_URL: "http://127.0.0.1:1/systemone" },
      fetch: (async (url: string | URL | Request) => {
        urls.push(String(url));
        return new Response(JSON.stringify(okResponse));
      }) as unknown as typeof fetch,
    });
    await judge.distill(input);
    expect(urls).toEqual(["http://127.0.0.1:1/systemone"]);
  });

  test("with a key the service rejects, the heuristic judge answers and the key is not tried again", async () => {
    writeFileSync(join(dir, "env"), `TYPESAFE_API_KEY=${KEY}\n`);
    let fetched = 0;
    const make = () =>
      makeJudge({
        db,
        dataDir: dir,
        env: {},
        fetch: (async () => {
          fetched++;
          return new Response("{}", { status: 401 });
        }) as unknown as typeof fetch,
      });
    expect((await make().distill(input)).source).toBe("heuristic");
    expect((await make().distill(input)).source).toBe("heuristic");
    expect(fetched).toBe(1);
    expect(getMeta(db, "breaker.typesafe")).toContain('"auth"');
  });
});
