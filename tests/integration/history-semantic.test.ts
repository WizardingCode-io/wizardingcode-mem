import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadModel, type Model, modelPath } from "../../src/embed/model.ts";
import { openHistoryDb } from "../../src/history/db.ts";
import { indexAll, indexTranscript } from "../../src/history/index-pass.ts";
import { historyDbPath } from "../../src/history/path.ts";
import { forgetHistoryIndex } from "../../src/history/run-state.ts";
import { searchHistory } from "../../src/history/search.ts";
import { fillTurnVectors } from "../../src/history/vectors.ts";
import { type Db, openDb } from "../../src/store/db.ts";

const fixture = join(import.meta.dir, "../fixtures/embed/subset.wcpack");
/** Shares no word with the turn it means ("A hook must never exit with code 2."). */
const PARAPHRASE = "o agente bloqueia a ação do utilizador quando o nosso script termina mal";

let dir: string;
let main: Db;
let hdb: NonNullable<ReturnType<typeof openHistoryDb>>;
let claude: string;
let codex: string;
let model: Model;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wcmem-history-semantic-"));
  const dataDir = join(dir, "data");
  mkdirSync(join(dataDir, "models"), { recursive: true });
  copyFileSync(fixture, modelPath(dataDir));
  const loaded = loadModel({ dataDir, env: {} });
  if (loaded === null) throw new Error("fixture model did not load");
  model = loaded;
  claude = join(dir, "claude");
  codex = join(dir, "codex");
  mkdirSync(join(claude, "-shop"), { recursive: true });
  mkdirSync(join(claude, "-blog"), { recursive: true });
  mkdirSync(codex, { recursive: true });
  main = openDb({ dataDir: join(dir, "main"), busyTimeoutMs: 2000 });
  const opened = openHistoryDb(dir, { create: true });
  if (opened === null) throw new Error("history db was not created");
  hdb = opened;
});
afterEach(() => {
  hdb.close();
  main.close();
  rmSync(dir, { recursive: true, force: true });
});

const line = (cwd: string, o: object) =>
  JSON.stringify({ sessionId: "s1", cwd, gitBranch: "main", isSidechain: false, ...o });
function transcript(folder: string, cwd: string, name: string, pairs: [string, string][]): string {
  const path = join(claude, folder, name);
  const items: string[] = [];
  pairs.forEach(([ask, answer], i) => {
    const at = `2026-09-01T10:0${i}:00.000Z`;
    items.push(
      line(cwd, {
        type: "user",
        promptId: `p${i}`,
        timestamp: at,
        message: { role: "user", content: ask },
      }),
      line(cwd, {
        type: "assistant",
        timestamp: `2026-09-01T10:0${i}:05.000Z`,
        message: { role: "assistant", content: [{ type: "text", text: answer }] },
      }),
    );
  });
  writeFileSync(path, `${items.join("\n")}\n`);
  return path;
}
const HOOK: [string, string] = [
  "A hook must never exit with code 2.",
  "Claude Code treats exit code 2 as a request to block the user's action.",
];
const MOCK: [string, string] = [
  "Never mock the database in these tests.",
  "Always use a real SQLite file in a temporary directory.",
];
const REDACT: [string, string] = [
  "Text is redacted before it is cut to size.",
  "Cutting first could leave half a secret unrecognised.",
];

function shop() {
  mkdirSync(join(dir, "work", "shop"), { recursive: true });
  mkdirSync(join(dir, "work", "blog"), { recursive: true });
  const a = transcript("-shop", join(dir, "work", "shop"), "a.jsonl", [HOOK, MOCK]);
  const b = transcript("-blog", join(dir, "work", "blog"), "b.jsonl", [REDACT]);
  return { a, b };
}
const pass = (withModel: Model | null, maxMs = 60_000) =>
  indexAll(
    hdb,
    main,
    { claudeCode: claude, codex },
    {
      now: Date.now(),
      maxMs,
      agents: ["claude-code", "codex"],
      model: withModel,
    },
  );
const vectors = () =>
  hdb.query<{ n: number }, []>("SELECT count(*) AS n FROM turn_vectors").get()?.n ?? -1;
const turns = () => hdb.query<{ n: number }, []>("SELECT count(*) AS n FROM turns").get()?.n ?? -1;

describe("history by meaning", () => {
  test("a pass with the model writes a vector per turn; without it none, and search is unchanged", () => {
    shop();
    pass(null);
    expect(turns()).toBe(3);
    expect(vectors()).toBe(0);
    // Pinned: without the model, history search ranks exactly as it did before vectors existed
    // (bm25, then the newest), whether the model is left out or passed as null.
    const SNAPSHOT: [string, string[]][] = [
      ["never", [MOCK[0], HOOK[0]]],
      ["never code", [HOOK[0], MOCK[0]]],
      ["exit code tests", [HOOK[0], MOCK[0]]],
      ["a real file", [MOCK[0]]],
      ["cut", [REDACT[0]]],
      ["mock database", [MOCK[0]]],
    ];
    for (const [query, prompts] of SNAPSHOT) {
      for (const args of [{ query }, { query, model: null }]) {
        expect(searchHistory(hdb, args).map((h) => h.prompt)).toEqual(prompts);
      }
    }
    expect(searchHistory(hdb, { query: "never", limit: 1 }).map((h) => h.prompt)).toEqual([
      MOCK[0],
    ]);
    expect(
      searchHistory(hdb, { query: "never cut", projectName: "blog" }).map((h) => h.project),
    ).toEqual(["blog"]);
    expect(searchHistory(hdb, { query: PARAPHRASE })).toEqual([]);
    expect(searchHistory(hdb, { query: PARAPHRASE, model: null })).toEqual([]);
    // The next pass with a model fills the turns already there, without touching the files.
    pass(model);
    expect(vectors()).toBe(3);
    expect(
      hdb.query<{ m: string }, []>("SELECT DISTINCT model AS m FROM turn_vectors").all(),
    ).toEqual([{ m: model.id }]);
  });

  test("a paraphrase finds the turn; the words' ranking is kept when the model adds nothing", () => {
    shop();
    pass(model);
    const hits = searchHistory(hdb, { query: PARAPHRASE, model });
    expect(hits[0]?.prompt).toBe(HOOK[0]);
    const lexical = searchHistory(hdb, { query: "database", model: null });
    expect(searchHistory(hdb, { query: "database", model }).map((h) => h.id)).toContain(
      lexical[0]?.id as number,
    );
    expect(searchHistory(hdb, { query: "∮∯∰", model })).toEqual([]);
  });

  test("the project filter applies to what is found by meaning", () => {
    shop();
    pass(model);
    const all = searchHistory(hdb, { query: PARAPHRASE, model });
    const project = all[0]?.project as string;
    const id = hdb
      .query<{ project_id: number }, [string]>(
        "SELECT project_id FROM turns WHERE project_name = ? LIMIT 1",
      )
      .get(project)?.project_id as number;
    expect(searchHistory(hdb, { query: PARAPHRASE, model, projectId: id })[0]?.prompt).toBe(
      HOOK[0],
    );
    expect(searchHistory(hdb, { query: PARAPHRASE, model, projectName: project })[0]?.prompt).toBe(
      HOOK[0],
    );
    expect(searchHistory(hdb, { query: PARAPHRASE, model, projectId: id + 100 })).toEqual([]);
    expect(searchHistory(hdb, { query: PARAPHRASE, model, projectName: "nowhere" })).toEqual([]);
  });

  test("a transcript removed from disk, or a project turned off, takes its vectors with its turns", () => {
    const { a, b } = shop();
    pass(model);
    expect(vectors()).toBe(3);
    unlinkSync(b);
    pass(model);
    expect(vectors()).toBe(2);
    expect(searchHistory(hdb, { query: REDACT[0], model }).map((h) => h.prompt)).not.toContain(
      REDACT[0],
    );
    main.run("UPDATE projects SET disabled = 1");
    pass(model);
    expect(turns()).toBe(0);
    expect(vectors()).toBe(0);
    expect(existsSync(a)).toBe(true);
  });

  test("history forget removes the index with its vectors", () => {
    shop();
    pass(model);
    hdb.close();
    forgetHistoryIndex(dir);
    expect(existsSync(historyDbPath(dir))).toBe(false);
    hdb = openHistoryDb(dir, { create: true }) as typeof hdb;
    expect(vectors()).toBe(0);
  });

  test("the session-end path embeds its own transcript's turns only; the pass fills the rest", () => {
    const { a, b } = shop();
    pass(null);
    // A re-index of one transcript (what session end does) with the model.
    indexTranscript(hdb, main, "claude-code", a, { now: Date.now(), projects: new Map(), model });
    expect(vectors()).toBe(2);
    expect(turns()).toBe(3);
    expect(existsSync(b)).toBe(true);
    pass(model);
    expect(vectors()).toBe(3);
  });

  test("filling is bounded and newest first; a vector of another model is rewritten", () => {
    shop();
    pass(null);
    expect(fillTurnVectors(hdb, model, { max: 2, deadline: Date.now() + 60_000 })).toBe(2);
    expect(vectors()).toBe(2);
    expect(fillTurnVectors(hdb, model, { max: 5, deadline: Date.now() - 1 })).toBe(0);
    expect(fillTurnVectors(hdb, null, { deadline: Date.now() + 60_000 })).toBe(0);
    expect(vectors()).toBe(2);
    hdb.run("UPDATE turn_vectors SET model = 'old@model'");
    expect(searchHistory(hdb, { query: PARAPHRASE, model })).toEqual([]);
    expect(fillTurnVectors(hdb, model, { deadline: Date.now() + 60_000 })).toBe(3);
    expect(vectors()).toBe(3);
    expect(searchHistory(hdb, { query: PARAPHRASE, model })[0]?.prompt).toBe(HOOK[0]);
  });

  test("an index made before the table existed still searches, and gets the table from a writer", () => {
    shop();
    pass(null);
    hdb.run("DROP TABLE turn_vectors");
    expect(searchHistory(hdb, { query: "mock database", model }).length).toBe(1);
    expect(searchHistory(hdb, { query: PARAPHRASE, model })).toEqual([]);
    pass(model);
    expect(vectors()).toBe(3);
  });
});
