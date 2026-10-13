import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveProject } from "../../src/core/project.ts";
import { quantize } from "../../src/embed/embed.ts";
import type { Model } from "../../src/embed/model.ts";
import { semanticCandidates } from "../../src/retrieve/semantic.ts";
import { type Db, openDb, withWrite } from "../../src/store/db.ts";

// Search by meaning scans every vector in scope. At 65,000 memories across projects (the
// store the hook budgets assume), a global search must stay well inside an interactive
// keystroke. The bound is loose on purpose: it catches a return to per-row copies (about
// 90 ms median on the author's machine), not small drifts.

const MEMORIES = 65_000;
const DIMS = 256;
const RUNS = 15;
const MEDIAN_BUDGET_MS = process.platform === "win32" ? 80 : 40;

/** Deterministic unit vectors. */
function vectors(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    return state / 4294967296 - 0.5;
  };
  return () => {
    const v = new Float32Array(DIMS);
    let sum = 0;
    for (let i = 0; i < DIMS; i++) {
      v[i] = next();
      sum += (v[i] as number) ** 2;
    }
    const norm = Math.sqrt(sum);
    for (let i = 0; i < DIMS; i++) v[i] = (v[i] as number) / norm;
    return v;
  };
}

let base: string;
let db: Db;
const random = vectors(7);
const query = random();
const model: Model = { id: "perf@1", pack: null as never, embed: () => query };

beforeAll(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "wcmem-perf-semantic-")));
  db = openDb({ dataDir: join(base, "data"), busyTimeoutMs: 2000 });
  const projects = Array.from({ length: 7 }, (_, i) => {
    mkdirSync(join(base, `p${i}`));
    return resolveProject(db, join(base, `p${i}`), 0).id;
  });
  withWrite(db, () => {
    const memory = db.query<{ id: number }, [number, number, number]>(
      `INSERT INTO memories (project_id, kind, title, body, importance, origin, judge, judge_version, created_at, updated_at)
       VALUES (?, 'decision', 't', 'b', 3, 'manual', 'heuristic', '1', ?, ?) RETURNING id`,
    );
    const vector = db.query<unknown, [number, string, number, Uint8Array]>(
      "INSERT INTO memory_vectors (memory_id, model, scale, vec) VALUES (?, ?, ?, ?)",
    );
    for (let i = 0; i < MEMORIES; i++) {
      const id = memory.get(projects[i % projects.length] as number, i, i)?.id as number;
      const { scale, q } = quantize(random());
      vector.run(id, model.id, scale, new Uint8Array(q.buffer));
    }
  });
});
afterAll(() => {
  db.close();
  rmSync(base, { recursive: true, force: true });
});

test(`a global search by meaning over ${MEMORIES} memories stays interactive`, () => {
  semanticCandidates(db, model, "warm", { projectId: null, limit: 50, floor: -1 });
  const times: number[] = [];
  for (let r = 0; r < RUNS; r++) {
    const start = performance.now();
    const found = semanticCandidates(db, model, "q", { projectId: null, limit: 50, floor: -1 });
    times.push(performance.now() - start);
    expect(found).toHaveLength(50);
  }
  const median = [...times].sort((a, b) => a - b)[Math.floor(RUNS / 2)] as number;
  console.log(`semantic global median: ${median.toFixed(1)} ms`);
  expect(median).toBeLessThan(MEDIAN_BUDGET_MS);
});
