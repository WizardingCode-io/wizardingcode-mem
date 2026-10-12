import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runBackfill } from "../../src/backfill/run.ts";
import { resolveProject } from "../../src/core/project.ts";
import type { Redacted } from "../../src/core/redact.ts";
import { HEAL_LIMIT, healVectors } from "../../src/embed/backfill.ts";
import { loadModel, type Model, modelPath } from "../../src/embed/model.ts";
import { heuristicJudge } from "../../src/judge/heuristic.ts";
import { DB_FILE, type Db, openDb } from "../../src/store/db.ts";
import { insertMemory } from "../../src/store/memories.ts";
import {
  claimLease,
  EMBED_DOWNLOAD_LEASE,
  EMBED_LEASE,
  leaseActive,
  releaseLease,
} from "../../src/store/meta.ts";
import { runCliWith } from "../helpers/cli.ts";

const fixture = join(import.meta.dir, "../fixtures/embed/subset.wcpack");

let base: string;
let dataDir: string;
let db: Db;
let model: Model;
let projectId: number;

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "wcmem-vector-heal-")));
  dataDir = join(base, "home", "mem");
  mkdirSync(join(dataDir, "models"), { recursive: true });
  copyFileSync(fixture, modelPath(dataDir));
  const loaded = loadModel({ dataDir, env: {} });
  if (loaded === null) throw new Error("fixture model did not load");
  model = loaded;
  db = openDb({ dataDir, busyTimeoutMs: 2000 });
  mkdirSync(join(base, "shop"));
  projectId = resolveProject(db, join(base, "shop"), Date.now()).id;
});
afterEach(() => {
  db.close();
  rmSync(base, { recursive: true, force: true });
});

/** A memory written without the model, as an import or an edit while semantic was off leaves it. */
function bare(i: number): number {
  return insertMemory(db, {
    projectId,
    kind: "decision",
    title: `Use pool ${i} for the workers`,
    body: `Worker pool ${i} releases its connection in a finally block.` as Redacted,
    terms: "",
    importance: 3,
    branch: null,
    commit: null,
    origin: "imported",
    judge: "heuristic",
    judgeVersion: "1",
    sourceTurnId: null,
    files: [],
    now: Date.now(),
  });
}

const missing = (on: Database | Db = db) =>
  on
    .query<{ n: number }, [string]>(
      `SELECT count(*) AS n FROM memories m LEFT JOIN memory_vectors v ON v.memory_id = m.id
       WHERE m.status = 'active' AND (v.memory_id IS NULL OR v.model <> ?)`,
    )
    .get(model.id)?.n ?? -1;
const active = () =>
  db.query<{ n: number }, []>("SELECT count(*) AS n FROM memories WHERE status = 'active'").get()
    ?.n ?? -1;

describe("healVectors", () => {
  test("gives a vector to what lacks one, bounded, and releases the lease", async () => {
    bare(1);
    bare(2);
    expect(missing()).toBe(2);
    expect(await healVectors(db, model, { now: Date.now })).toEqual({ written: 2, remaining: 0 });
    expect(missing()).toBe(0);
    expect(leaseActive(db, EMBED_LEASE, Date.now())).toBe(false);
    expect(HEAL_LIMIT).toBeGreaterThan(0);
    bare(3);
    bare(4);
    bare(5);
    expect(await healVectors(db, model, { now: Date.now, limit: 2 })).toEqual({
      written: 2,
      remaining: 1,
    });
  });

  test("does nothing without a model, with nothing missing, or while a backfill or download runs", async () => {
    expect(await healVectors(db, null, { now: Date.now })).toBeNull();
    // Nothing missing: no lease is even taken (no write at all).
    const before = db.query<{ n: number }, []>("SELECT total_changes() AS n").get()?.n;
    expect(await healVectors(db, model, { now: Date.now })).toBeNull();
    expect(db.query<{ n: number }, []>("SELECT total_changes() AS n").get()?.n).toBe(before);
    bare(1);
    for (const key of [EMBED_LEASE, EMBED_DOWNLOAD_LEASE]) {
      claimLease(db, key, `${process.pid}-other`, Date.now(), 60_000);
      expect(await healVectors(db, model, { now: Date.now })).toBeNull();
      expect(missing()).toBe(1);
      releaseLease(db, key, `${process.pid}-other`);
    }
  });
});

const line = (cwd: string, o: object) =>
  JSON.stringify({ sessionId: "s1", cwd, gitBranch: "main", isSidechain: false, ...o });
/** A transcript of `n` finished turns, each a distinct fix the heuristic judge keeps. */
function transcript(n: number): string {
  const root = join(base, "claude");
  mkdirSync(join(root, "-shop"), { recursive: true });
  const cwd = join(base, "shop");
  const items: string[] = [];
  const start = Date.now() - 3 * 86_400_000;
  for (let i = 0; i < n; i++) {
    const at = new Date(start + i * 60_000).toISOString();
    items.push(
      line(cwd, {
        type: "user",
        promptId: `p${i}`,
        timestamp: at,
        message: { role: "user", content: `why does module${i} fail under load?` },
      }),
      line(cwd, {
        type: "assistant",
        timestamp: at,
        message: {
          role: "assistant",
          content: [
            {
              type: "text",
              text: `Fixed: the root cause was that \`worker${i}Pool\` never released connection ${i}. The pool in src/pool${i}.ts now releases it in a finally block.`,
            },
          ],
        },
      }),
    );
  }
  writeFileSync(join(root, "-shop", "s1.jsonl"), `${items.join("\n")}\n`);
  return root;
}

describe("a model that arrives during a history import", () => {
  test("later batches get vectors as they are written; the heal covers the earlier ones", async () => {
    const root = transcript(60);
    let calls = 0;
    // The download finishes after the first batch: the first look finds no model.
    const report = await runBackfill(
      {
        db,
        // Every turn its own memory: the near-identical fixes must not be merged.
        judge: {
          ...heuristicJudge,
          consolidate: async () => ({ perNeighbour: [], source: "heuristic" as const }),
        },
        now: Date.now,
        roots: { claudeCode: root, codex: join(base, "codex") },
        model: () => (calls++ === 0 ? null : model),
      },
      { days: 30, maxMs: 60_000, agents: ["claude-code"] },
    );
    expect(report.remaining).toBe(0);
    expect(calls).toBeGreaterThan(1);
    const written = active();
    expect(written).toBeGreaterThan(50);
    // The second batch was written with the model; the first was not.
    expect(missing()).toBeGreaterThan(0);
    expect(missing()).toBeLessThan(written);
    await healVectors(db, model, { now: Date.now });
    expect(missing()).toBe(0);
  });
});

describe("background work heals the gap", () => {
  const env = () => ({
    WIZARDINGCODE_HOME: join(base, "home"),
    CLAUDE_CONFIG_DIR: join(base, "claude-config"),
    CODEX_HOME: join(base, "codex"),
    WIZARDINGCODE_MEM_TYPESAFE: "off",
    WIZARDINGCODE_MEM_DISTILL: "off",
    WIZARDINGCODE_MEM_UI_AUTO_OPEN: "off",
    WIZARDINGCODE_MEM_MIGRATE: "off",
    WIZARDINGCODE_MEM_SEMANTIC: "on",
  });
  const fresh = () => {
    const reader = new Database(join(dataDir, DB_FILE), { readonly: true });
    reader.run("PRAGMA busy_timeout = 5000");
    try {
      return missing(reader);
    } finally {
      reader.close();
    }
  };

  test("a drain ends by giving vectors to memories written without the model", async () => {
    bare(1);
    bare(2);
    const out = await runCliWith({ env: env() }, "distill");
    expect(out.exitCode).toBe(0);
    expect(fresh()).toBe(0);
  });

  test("a history import ends the same way", async () => {
    bare(1);
    const out = await runCliWith({ env: env() }, "history", "import", "--days", "30");
    expect(out.exitCode).toBe(0);
    expect(fresh()).toBe(0);
  });

  test("without the model the drain says nothing more than before", async () => {
    bare(1);
    rmSync(modelPath(dataDir));
    const out = await runCliWith({ env: env() }, "distill");
    expect(out.stdout).toBe("distill: 0 claimed, 0 done, 0 skipped, 0 failed\n");
    expect(fresh()).toBe(1);
  });
});
