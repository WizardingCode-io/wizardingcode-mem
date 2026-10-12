import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveProject } from "../../src/core/project.ts";
import type { Redacted } from "../../src/core/redact.ts";
import type { MemoryKind } from "../../src/core/types.ts";
import { cosine } from "../../src/embed/embed.ts";
import { loadModel, type Model, modelPath } from "../../src/embed/model.ts";
import { memoryVectors } from "../../src/embed/vectors.ts";
import { globalSearch } from "../../src/mcp/global.ts";
import { searchMemories, type ToolContext } from "../../src/mcp/tools.ts";
import { SEMANTIC_FLOOR, semanticCandidates } from "../../src/retrieve/semantic.ts";
import { type Db, openDb } from "../../src/store/db.ts";
import { insertMemory, supersede } from "../../src/store/memories.ts";
import { listMemories, searchAll, setMemoryStatus } from "../../src/ui/api.ts";
import { searchTerms } from "../../src/util/words.ts";
import golden from "../golden/retrieval.json" with { type: "json" };
import semantic from "../golden/semantic.json" with { type: "json" };

// The subset pack holds every piece of the golden texts, so these vectors are the full
// model's for them; a text outside the golden set is mostly unknown pieces to it.
const fixture = join(import.meta.dir, "../fixtures/embed/subset.wcpack");
const NOW = Date.UTC(2026, 9, 12, 12);
/** Shares no word with the memory it means ("A hook must never exit with code 2."). */
const PARAPHRASE = "o agente bloqueia a ação do utilizador quando o nosso script termina mal";

let base: string;
let db: Db;
let model: Model;
let projectId: number;
let otherId: number;
const ids = new Map<string, number>();

function add(key: string, project: number, withModel: Model | null = model): number {
  const memory = golden.memories.find((m) => m.key === key);
  if (memory === undefined) throw new Error(key);
  return insertMemory(
    db,
    {
      projectId: project,
      kind: memory.kind as MemoryKind,
      title: memory.title,
      body: memory.body as Redacted,
      terms: searchTerms(memory.title, memory.body, memory.files),
      importance: 3,
      branch: null,
      commit: null,
      origin: "manual",
      judge: "heuristic",
      judgeVersion: "1",
      sourceTurnId: null,
      files: [],
      now: NOW,
    },
    withModel,
  );
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "wcmem-semsearch-"));
  const dataDir = join(base, "data");
  mkdirSync(join(dataDir, "models"), { recursive: true });
  copyFileSync(fixture, modelPath(dataDir));
  const loaded = loadModel({ dataDir, env: {} });
  if (loaded === null) throw new Error("fixture model did not load");
  model = loaded;
  db = openDb({ dataDir, busyTimeoutMs: 2000 });
  mkdirSync(join(base, "a"));
  mkdirSync(join(base, "b"));
  projectId = resolveProject(db, join(base, "a"), NOW).id;
  otherId = resolveProject(db, join(base, "b"), NOW).id;
  ids.clear();
  for (const m of golden.memories) ids.set(m.key, add(m.key, projectId));
});
afterEach(() => {
  db.close();
  rmSync(base, { recursive: true, force: true });
});

const id = (key: string) => ids.get(key) as number;
const tool = (scope: number | null, withModel: Model | null): ToolContext => ({
  db,
  judge: null as never,
  projectId: scope,
  root: "",
  branch: null,
  now: NOW,
  model: withModel,
});
const shownIds = (output: string) => [...output.matchAll(/#(\d+) \[/g)].map((m) => Number(m[1]));
const failing = (): Model => ({
  ...model,
  embed: () => {
    throw new Error("embed failed");
  },
});

describe("semanticCandidates", () => {
  test("nothing without a model or for a query with no known piece", () => {
    expect(semanticCandidates(db, null, PARAPHRASE, { projectId, limit: 10 })).toEqual([]);
    expect(semanticCandidates(db, model, "∮∯∰", { projectId, limit: 10 })).toEqual([]);
    expect(semanticCandidates(db, model, "   ", { projectId, limit: 10 })).toEqual([]);
  });

  test("best first, above the floor, at most the limit", () => {
    const memory = golden.memories.find((m) => m.key === "busy-timeout");
    const found = semanticCandidates(db, model, `${memory?.title}`, { projectId, limit: 3 });
    expect(found[0]?.id).toBe(id("busy-timeout"));
    expect(found[0]?.score).toBeGreaterThan(0.6);
    expect(found.length).toBeLessThanOrEqual(3);
    for (const hit of found) expect(hit.score).toBeGreaterThanOrEqual(SEMANTIC_FLOOR);
    const scores = found.map((hit) => hit.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  test("the kind and the project filter what is found by meaning", () => {
    const fixes = semanticCandidates(db, model, PARAPHRASE, { projectId, kind: "fix", limit: 50 });
    const kinds = new Set(
      fixes.map((hit) => golden.memories.find((m) => ids.get(m.key) === hit.id)?.kind),
    );
    expect([...kinds].every((kind) => kind === "fix")).toBe(true);
    expect(fixes.map((hit) => hit.id)).not.toContain(id("exit-code"));
    expect(semanticCandidates(db, model, PARAPHRASE, { projectId: otherId, limit: 50 })).toEqual(
      [],
    );
    const elsewhere = add("exit-code", otherId);
    expect(
      semanticCandidates(db, model, PARAPHRASE, { projectId: otherId, limit: 50 }).map(
        (hit) => hit.id,
      ),
    ).toEqual([elsewhere]);
    const everywhere = semanticCandidates(db, model, PARAPHRASE, { projectId: null, limit: 50 });
    expect(everywhere.map((hit) => hit.id)).toContain(elsewhere);
    expect(everywhere.map((hit) => hit.id)).toContain(id("exit-code"));
  });

  test("archived and superseded memories are never found", () => {
    expect(
      semanticCandidates(db, model, PARAPHRASE, { projectId, limit: 50 }).map((hit) => hit.id),
    ).toContain(id("exit-code"));
    expect(setMemoryStatus(db, id("exit-code"), "archived", NOW)).toBe("ok");
    const replacement = add("exit-code", projectId);
    supersede(db, replacement, id("busy-timeout"), NOW);
    const found = semanticCandidates(db, model, PARAPHRASE, { projectId, limit: 50 }).map(
      (hit) => hit.id,
    );
    expect(found).not.toContain(id("exit-code"));
    expect(found).not.toContain(replacement);
    const output = searchMemories(tool(projectId, model), { query: PARAPHRASE });
    expect(shownIds(output)).not.toContain(id("exit-code"));
    expect(shownIds(output)).not.toContain(replacement);
  });

  test("scoring on the stored int8 bytes ranks exactly as dequantising and cosine did", () => {
    const queries = [
      ...golden.relevant.map((item) => item.prompt),
      ...golden.unrelated,
      ...semantic.paraphrases.map((item) => item.prompt),
      ...semantic.unrelated,
    ];
    for (const query of queries) {
      const q = model.embed(query);
      if (q === null) continue;
      const before = memoryVectors(db, model, { projectId: null })
        .map((row) => ({ id: row.id, score: cosine(q, row.vec) }))
        .sort((a, b) => b.score - a.score || b.id - a.id);
      const after = semanticCandidates(db, model, query, {
        projectId: null,
        limit: 1000,
        floor: -1,
      });
      expect(after.map((hit) => hit.id)).toEqual(before.map((hit) => hit.id));
      after.forEach((hit, i) => {
        expect(Math.abs(hit.score - (before[i]?.score ?? 0))).toBeLessThan(1e-5);
      });
    }
  });

  test("the next search sees writes made since, on this connection or another", () => {
    const first = semanticCandidates(db, model, PARAPHRASE, { projectId: otherId, limit: 50 });
    expect(first).toEqual([]);
    const added = add("exit-code", otherId);
    expect(
      semanticCandidates(db, model, PARAPHRASE, { projectId: otherId, limit: 50 }).map(
        (hit) => hit.id,
      ),
    ).toEqual([added]);
    const other = openDb({ dataDir: join(base, "data"), busyTimeoutMs: 2000 });
    try {
      other.run("UPDATE memories SET status = 'archived' WHERE id = ?", [added]);
    } finally {
      other.close();
    }
    expect(semanticCandidates(db, model, PARAPHRASE, { projectId: otherId, limit: 50 })).toEqual(
      [],
    );
  });

  test("an embed that throws finds nothing", () => {
    expect(semanticCandidates(db, failing(), PARAPHRASE, { projectId, limit: 10 })).toEqual([]);
  });
});

describe("explicit search with a model", () => {
  test("memory_search finds by meaning what shares no word with the query", () => {
    expect(shownIds(searchMemories(tool(projectId, null), { query: PARAPHRASE }))).not.toContain(
      id("exit-code"),
    );
    const found = shownIds(searchMemories(tool(projectId, model), { query: PARAPHRASE }));
    expect(found.slice(0, 5)).toContain(id("exit-code"));
    // Across projects too, and the kind filter holds.
    const global = searchMemories(tool(null, model), { query: PARAPHRASE });
    expect(global).toContain(`#${id("exit-code")} [`);
    expect(
      shownIds(searchMemories(tool(projectId, model), { query: PARAPHRASE, kind: "fix" })),
    ).not.toContain(id("exit-code"));
  });

  test("the global tools pass the model through", () => {
    expect(globalSearch(db, NOW, { query: PARAPHRASE, project: "a" })).not.toContain(
      `#${id("exit-code")} [`,
    );
    expect(globalSearch(db, NOW, { query: PARAPHRASE, project: "a" }, model)).toContain(
      `#${id("exit-code")} [`,
    );
    expect(globalSearch(db, NOW, { query: PARAPHRASE }, model)).toContain(`#${id("exit-code")} [`);
  });

  test("an embed failure answers exactly as without a model", () => {
    for (const query of [PARAPHRASE, "busy_timeout", "posso simular a base de dados nos testes?"]) {
      expect(searchMemories(tool(projectId, failing()), { query })).toBe(
        searchMemories(tool(projectId, null), { query }),
      );
    }
  });

  test("the viewer's list and palette find by meaning too", () => {
    expect(listMemories(db, { projectId, q: PARAPHRASE }).items.map((m) => m.id)).not.toContain(
      id("exit-code"),
    );
    const list = listMemories(db, { projectId, q: PARAPHRASE }, model);
    expect(list.items.map((m) => m.id).slice(0, 5)).toContain(id("exit-code"));
    expect(list.total).toBe(list.items.length);
    // Paging walks the same fused order.
    const paged = [0, 1, 2].flatMap(
      (page) =>
        listMemories(db, { projectId, q: PARAPHRASE, limit: 2, offset: page * 2 }, model).items,
    );
    expect(paged.map((m) => m.id)).toEqual(list.items.slice(0, 6).map((m) => m.id));
    // Archived memories have no semantic side: that list stays lexical.
    expect(listMemories(db, { projectId, q: PARAPHRASE, status: "archived" }, model)).toEqual(
      listMemories(db, { projectId, q: PARAPHRASE, status: "archived" }),
    );
    // The importance floor applies to what is found by meaning.
    db.run("UPDATE memories SET importance = 1 WHERE id = ?", [id("exit-code")]);
    expect(
      listMemories(db, { projectId, q: PARAPHRASE, minImportance: 2 }, model).items.map(
        (m) => m.id,
      ),
    ).not.toContain(id("exit-code"));

    expect(searchAll(db, PARAPHRASE, 10).map((hit) => hit.id)).not.toContain(id("exit-code"));
    const palette = searchAll(db, PARAPHRASE, 10, model);
    expect(palette.slice(0, 5).map((hit) => hit.id)).toContain(id("exit-code"));
    expect(palette.find((hit) => hit.id === id("exit-code"))?.projectName).toBe("a");
  });
});
