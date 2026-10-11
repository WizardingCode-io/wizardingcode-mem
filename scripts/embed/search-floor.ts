/**
 * Calibrates SEMANTIC_FLOOR for explicit search (ADR 0017). Dev-only; never shipped.
 *
 *   bun scripts/embed/search-floor.ts <pack> [floor ...]
 *
 * Sets up the golden memories (tests/golden/retrieval.json) as tests/golden/retrieval.test.ts
 * does, with a vector each, then for each floor runs memory_search's ranking (rankMemories) on:
 * - every paraphrase (retrieval.json "relevant" and semantic.json "paraphrases"): the expected
 *   memories' rank in the fused results, counted when in the top 5;
 * - every unrelated query (both files): how many of the first 10 results were found only by
 *   meaning (absent from the same search without the model).
 * The floor to choose maximises paraphrases in the top 5 while semantic-only results for
 * unrelated queries stay at most 1 per query on average; ties go to the higher floor.
 */
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveProject } from "../../src/core/project.ts";
import type { Redacted } from "../../src/core/redact.ts";
import type { MemoryKind } from "../../src/core/types.ts";
import { loadModel, modelPath } from "../../src/embed/model.ts";
import { rankMemories, type ToolContext } from "../../src/mcp/tools.ts";
import { openDb } from "../../src/store/db.ts";
import { insertMemory } from "../../src/store/memories.ts";
import { searchTerms } from "../../src/util/words.ts";
import golden from "../../tests/golden/retrieval.json" with { type: "json" };
import semantic from "../../tests/golden/semantic.json" with { type: "json" };

const [packPath, ...floorArgs] = process.argv.slice(2);
if (packPath === undefined) {
  console.error("usage: bun scripts/embed/search-floor.ts <pack> [floor ...]");
  process.exit(1);
}
const FLOORS =
  floorArgs.length > 0
    ? floorArgs.map(Number)
    : [0.15, 0.2, 0.25, 0.28, 0.3, 0.32, 0.35, 0.38, 0.4, 0.42, 0.45, 0.5, 0.55, 1.01];
const TOP = 5;
const SHOWN = 10;
const NOW = Date.UTC(2026, 9, 5);

const base = mkdtempSync(join(tmpdir(), "wcmem-search-floor-"));
try {
  const dataDir = join(base, "data");
  mkdirSync(join(dataDir, "models"), { recursive: true });
  copyFileSync(packPath, modelPath(dataDir));
  const model = loadModel({ dataDir, env: {} });
  if (model === null) throw new Error("the pack did not load");
  const db = openDb({ dataDir, busyTimeoutMs: 2000 });
  mkdirSync(join(base, "project"));
  const projectId = resolveProject(db, join(base, "project"), NOW).id;
  const ids = new Map<string, number>();
  for (const memory of golden.memories) {
    ids.set(
      memory.key,
      insertMemory(
        db,
        {
          projectId,
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
          files: memory.files.map((path) => ({ path, role: "changed" as const })),
          now: NOW,
        },
        model,
      ),
    );
  }
  const context = (withModel: boolean): ToolContext => ({
    db,
    judge: null as never,
    projectId,
    root: "",
    branch: null,
    now: NOW,
    model: withModel ? model : null,
  });
  const ranked = (query: string, floor: number | null) =>
    rankMemories(context(floor !== null), { query }, floor ?? 1).map((row) => row.id);

  const sets = [
    { name: "retrieval.json", paraphrases: golden.relevant, unrelated: golden.unrelated },
    { name: "semantic.json", paraphrases: semantic.paraphrases, unrelated: semantic.unrelated },
  ];
  const rows: string[] = [];
  const header = `| floor | ${sets.map((s) => `${s.name} top ${TOP}`).join(" | ")} | all top ${TOP} | ${sets.map((s) => `${s.name} sem-only/unrelated`).join(" | ")} | all sem-only/unrelated |`;
  rows.push(
    header,
    `|${header
      .split("|")
      .slice(1, -1)
      .map(() => "---")
      .join("|")}|`,
  );
  const baseline = (query: string) => ranked(query, null);

  for (const floor of [null, ...FLOORS]) {
    const cells: string[] = [];
    let foundAll = 0;
    let expectedAll = 0;
    const noise: string[] = [];
    let noiseAll = 0;
    let unrelatedAll = 0;
    for (const set of sets) {
      let found = 0;
      let expected = 0;
      for (const item of set.paraphrases) {
        const got = ranked(item.prompt, floor).slice(0, TOP);
        for (const key of item.expect) {
          expected++;
          if (got.includes(ids.get(key) as number)) found++;
        }
      }
      cells.push(`${found}/${expected}`);
      foundAll += found;
      expectedAll += expected;
      let semOnly = 0;
      for (const query of set.unrelated) {
        const lexical = new Set(baseline(query));
        semOnly += ranked(query, floor)
          .slice(0, SHOWN)
          .filter((id) => !lexical.has(id)).length;
      }
      noise.push(
        `${semOnly}/${set.unrelated.length} (${(semOnly / set.unrelated.length).toFixed(2)})`,
      );
      noiseAll += semOnly;
      unrelatedAll += set.unrelated.length;
    }
    rows.push(
      `| ${floor === null ? "no model" : floor.toFixed(3)} | ${cells.join(" | ")} | ${foundAll}/${expectedAll} | ${noise.join(" | ")} | ${noiseAll}/${unrelatedAll} (${(noiseAll / unrelatedAll).toFixed(2)}) |`,
    );
  }
  console.log(rows.join("\n"));

  if (process.env.DETAIL) {
    // Per paraphrase: the best cosine of the expected memory and its rank, at the given floor.
    const floor = Number(process.env.DETAIL);
    for (const set of sets) {
      for (const item of set.paraphrases) {
        const got = ranked(item.prompt, floor);
        const lexical = baseline(item.prompt);
        const key = item.expect[0] as string;
        const id = ids.get(key) as number;
        console.log(
          `${set.name}\t${key}\tlexical ${lexical.indexOf(id) + 1}\tfused ${got.indexOf(id) + 1}\t${item.prompt}`,
        );
      }
    }
  }
  db.close();
} finally {
  rmSync(base, { recursive: true, force: true });
}
