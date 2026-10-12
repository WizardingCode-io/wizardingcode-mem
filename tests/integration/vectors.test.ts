import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveProject } from "../../src/core/project.ts";
import type { Redacted } from "../../src/core/redact.ts";
import { runEmbedBackfill } from "../../src/embed/backfill.ts";
import { deleteModel } from "../../src/embed/download.ts";
import { cosine } from "../../src/embed/embed.ts";
import { loadModel, type Model, modelPath } from "../../src/embed/model.ts";
import { memoryVectors, vectorIndex, writeMemoryVector } from "../../src/embed/vectors.ts";
import { historyDbPath, openHistoryDb } from "../../src/history/db.ts";
import { type Db, openDb } from "../../src/store/db.ts";
import { insertMemory, supersede } from "../../src/store/memories.ts";
import {
  anyLeaseActive,
  claimLease,
  EMBED_DOWNLOAD_LEASE,
  EMBED_LEASE,
  HISTORY_LEASE,
  handOverLease,
  leaseActive,
  releaseLease,
} from "../../src/store/meta.ts";
import { setMemoryStatus, updateMemory } from "../../src/ui/api.ts";
import { runCliWith } from "../helpers/cli.ts";

const fixture = join(import.meta.dir, "../fixtures/embed/subset.wcpack");
const NOW = Date.UTC(2026, 9, 12, 12);

let base: string;
let dataDir: string;
let db: Db;
let projectId: number;
let model: Model;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "wcmem-vectors-"));
  dataDir = join(base, "data");
  mkdirSync(join(dataDir, "models"), { recursive: true });
  copyFileSync(fixture, modelPath(dataDir));
  const loaded = loadModel({ dataDir, env: {} });
  if (loaded === null) throw new Error("fixture model did not load");
  model = loaded;
  db = openDb({ dataDir, busyTimeoutMs: 2000 });
  mkdirSync(join(base, "project"));
  projectId = resolveProject(db, join(base, "project"), NOW).id;
});
afterEach(() => {
  db.close();
  rmSync(base, { recursive: true, force: true });
});

const TEXTS: [string, string][] = [
  [
    "Never mock the database in these tests.",
    "Always use a real SQLite file in a temporary directory.",
  ],
  [
    "A hook must never exit with code 2.",
    "Claude Code treats exit code 2 as a request to block the user's action.",
  ],
  [
    "Text is redacted before it is cut to size.",
    "Cutting first could leave half a secret unrecognised.",
  ],
];

function memory(
  i: number,
  withModel: Model | null = null,
  extra: { sourceTurnId?: number } = {},
): number {
  const [title, body] = TEXTS[i % TEXTS.length] as [string, string];
  return insertMemory(
    db,
    {
      projectId,
      kind: "decision",
      title,
      body: body as Redacted,
      terms: "",
      importance: 3,
      branch: null,
      commit: null,
      origin: "manual",
      judge: "heuristic",
      judgeVersion: "1",
      sourceTurnId: extra.sourceTurnId ?? null,
      files: [],
      now: NOW,
    },
    withModel,
  );
}

const rows = () =>
  db
    .query<{ memory_id: number; model: string }, []>(
      "SELECT memory_id, model FROM memory_vectors ORDER BY memory_id",
    )
    .all();
const vectorOf = (id: number) =>
  memoryVectors(db, model, { projectId: null }).find((v) => v.id === id)?.vec ?? null;

describe("memory vectors", () => {
  test("insert with a model writes one vector of this model; without one, none", () => {
    const a = memory(0, model);
    memory(1, null);
    expect(rows()).toEqual([{ memory_id: a, model: model.id }]);
    const vec = vectorOf(a);
    const direct = model.embed(`${TEXTS[0]?.[0]}\n${TEXTS[0]?.[1]}`) as Float32Array;
    expect(cosine(vec as Float32Array, direct)).toBeGreaterThan(0.99);
  });

  test("writeMemoryVector is a no-op without a model and replaces the row with one", () => {
    const a = memory(0, null);
    writeMemoryVector(db, null, a, "x", "y");
    expect(rows()).toEqual([]);
    writeMemoryVector(db, model, a, ...(TEXTS[1] as [string, string]));
    writeMemoryVector(db, model, a, ...(TEXTS[0] as [string, string]));
    expect(rows()).toEqual([{ memory_id: a, model: model.id }]);
  });

  test("the viewer's edit rewrites the vector; without a model it drops the stale one", () => {
    const a = memory(0, model);
    const before = vectorOf(a) as Float32Array;
    expect(updateMemory(db, a, { title: TEXTS[1]?.[0], body: TEXTS[1]?.[1] }, NOW, model)).toBe(
      "ok",
    );
    const after = vectorOf(a) as Float32Array;
    expect(cosine(before, after)).toBeLessThan(0.9);
    expect(updateMemory(db, a, { body: TEXTS[2]?.[1] }, NOW, null)).toBe("ok");
    expect(rows()).toEqual([]);
    // A change of kind alone keeps the text, so it keeps the vector.
    const b = memory(2, model);
    expect(updateMemory(db, b, { kind: "fix" }, NOW, null)).toBe("ok");
    expect(rows()).toEqual([{ memory_id: b, model: model.id }]);
  });

  test("a turn distilled again replaces its memory's vector, or drops it without a model", () => {
    db.run(
      "INSERT INTO sessions (agent, agent_session_id, project_id, cwd, started_at, last_seen_at) VALUES ('claude-code', 's', ?, '/p', ?, ?)",
      [projectId, NOW, NOW],
    );
    db.run(
      "INSERT INTO turns (session_id, project_id, seq, state, prompt, started_at) VALUES (1, ?, 1, 'done', 'p', ?)",
      [projectId, NOW],
    );
    const a = memory(0, model, { sourceTurnId: 1 });
    expect(memory(1, null, { sourceTurnId: 1 })).toBe(a);
    expect(rows()).toEqual([]);
  });

  test("writeMemoryVector says whether it wrote; a failed edit refresh drops the stale row", () => {
    const failing: Model = {
      ...model,
      embed: () => {
        throw new Error("embed failed");
      },
    };
    const a = memory(0, model);
    expect(writeMemoryVector(db, null, a, "x", "y")).toBe(false);
    expect(writeMemoryVector(db, failing, a, "x", "y")).toBe(false);
    expect(writeMemoryVector(db, model, a, ...(TEXTS[1] as [string, string]))).toBe(true);
    expect(rows()).toEqual([{ memory_id: a, model: model.id }]);
    // The text changed but its vector could not be made: the old one must not stay under
    // the current model's id, or the backfill would never rewrite it.
    expect(updateMemory(db, a, { title: TEXTS[2]?.[0] }, NOW, failing)).toBe("ok");
    expect(rows()).toEqual([]);
  });

  test("the backfill counts only the vectors it wrote", async () => {
    const failing: Model = {
      ...model,
      embed: () => {
        throw new Error("embed failed");
      },
    };
    [0, 1, 2].map((i) => memory(i, null));
    expect(await runEmbedBackfill(db, failing, { now: () => NOW })).toEqual({
      written: 0,
      remaining: 3,
    });
    expect(await runEmbedBackfill(db, model, { now: () => NOW })).toEqual({
      written: 3,
      remaining: 0,
    });
  });

  test("deleting a memory deletes its vector", () => {
    const a = memory(0, model);
    db.run("DELETE FROM memories WHERE id = ?", [a]);
    expect(rows()).toEqual([]);
  });

  test("archived and superseded memories, other models and other projects are left out", () => {
    const a = memory(0, model);
    const b = memory(1, model);
    const c = memory(2, model);
    const d = memory(0, model);
    expect(setMemoryStatus(db, a, "archived", NOW)).toBe("ok");
    supersede(db, b, c, NOW);
    db.run("UPDATE memory_vectors SET model = 'other@1' WHERE memory_id = ?", [d]);
    expect(memoryVectors(db, model, { projectId }).map((v) => v.id)).toEqual([c]);
    expect(memoryVectors(db, model, { projectId: projectId + 1 })).toEqual([]);
    expect(memoryVectors(db, model, { projectId: null, kinds: ["fix"] })).toEqual([]);
    expect(
      memoryVectors(db, model, { projectId: null, kinds: ["decision"] }).map((v) => v.id),
    ).toEqual([c]);
  });

  test("the backfill fills missing and other-model rows only, and resumes after a limit", async () => {
    const ids = [0, 1, 2, 0, 1].map((i) => memory(i, null));
    const kept = memory(2, model);
    db.run(
      "INSERT INTO memory_vectors (memory_id, model, scale, vec) VALUES (?, 'other@1', 1, x'00')",
      [ids[0] as number],
    );
    const keptVec = db.query("SELECT vec FROM memory_vectors WHERE memory_id = ?").get(kept);

    expect(await runEmbedBackfill(db, model, { limit: 2, now: () => NOW })).toEqual({
      written: 2,
      remaining: 3,
    });
    expect(await runEmbedBackfill(db, model, { now: () => NOW })).toEqual({
      written: 3,
      remaining: 0,
    });
    expect(await runEmbedBackfill(db, model, { now: () => NOW })).toEqual({
      written: 0,
      remaining: 0,
    });
    expect(rows()).toEqual(
      [...ids, kept].sort((x, y) => x - y).map((id) => ({ memory_id: id, model: model.id })),
    );
    expect(db.query("SELECT vec FROM memory_vectors WHERE memory_id = ?").get(kept)).toEqual(
      keptVec,
    );
    expect(anyLeaseActive(db, NOW)).toBe(false);
  });

  test("the backfill skips superseded memories, readies archived ones, and never loops on a text with nothing to embed", async () => {
    const a = memory(0, null);
    setMemoryStatus(db, a, "archived", NOW);
    const old = memory(1, null);
    const successor = memory(2, model);
    supersede(db, old, successor, NOW);
    const empty = insertMemory(db, {
      projectId,
      kind: "decision",
      title: " ",
      body: "" as Redacted,
      terms: "",
      importance: 3,
      branch: null,
      commit: null,
      origin: "manual",
      judge: "heuristic",
      judgeVersion: "1",
      sourceTurnId: null,
      files: [],
      now: NOW,
    });
    expect(await runEmbedBackfill(db, model, { now: () => NOW })).toEqual({
      written: 2,
      remaining: 0,
    });
    // The empty text is marked as done, but never offered as a candidate.
    expect(rows().map((r) => r.memory_id)).toEqual([a, successor, empty]);
    expect(memoryVectors(db, model, { projectId: null }).map((v) => v.id)).toEqual([successor]);
    // Brought back, the archived memory is a candidate at once.
    setMemoryStatus(db, a, "active", NOW);
    expect(memoryVectors(db, model, { projectId: null }).map((v) => v.id)).toEqual([a, successor]);
  });

  test("one backfill at a time: another live holder makes it return null; the lease blocks moves", async () => {
    memory(0, null);
    expect(claimLease(db, EMBED_LEASE, `${process.pid}-other`, NOW, 60_000)).toBe(true);
    expect(anyLeaseActive(db, NOW)).toBe(true);
    expect(await runEmbedBackfill(db, model, { now: () => NOW })).toBeNull();
    expect(rows()).toEqual([]);
    releaseLease(db, EMBED_LEASE, `${process.pid}-other`);
    expect(await runEmbedBackfill(db, model, { now: () => NOW })).toEqual({
      written: 1,
      remaining: 0,
    });
  });

  test("deleting the model drops every vector", () => {
    memory(0, model);
    memory(1, model);
    expect(deleteModel(dataDir, db)).toBe(true);
    expect(rows()).toEqual([]);
    // Nothing there any more: still true, and still no rows.
    expect(deleteModel(dataDir, db)).toBe(true);
  });
});

describe("embed backfill and delete commands", () => {
  const embed = (...args: string[]) =>
    runCliWith(
      {
        env: {
          WIZARDINGCODE_MEM_DATA_DIR: dataDir,
          WIZARDINGCODE_MEM_STORE_DIR: dataDir,
          WIZARDINGCODE_MEM_MIGRATE: "off",
          WIZARDINGCODE_MEM_SEMANTIC: "on",
        },
      },
      "embed",
      ...args,
    );

  test("backfill writes what is missing, resumable with --limit; delete drops the vectors", async () => {
    memory(0, null);
    memory(1, null);
    memory(2, null);
    const first = await embed("backfill", "--limit", "2");
    expect(first.exitCode).toBe(0);
    expect(first.stdout).toContain("2 written, 1 remaining");
    const second = await embed("backfill");
    expect(second.stdout).toContain("1 written, 0 remaining");
    expect(rows()).toHaveLength(3);
    expect((await embed("backfill", "--limit", "x")).exitCode).toBe(64);
    const gone = await embed("delete");
    expect(gone.exitCode).toBe(0);
    expect(rows()).toEqual([]);
    const none = await embed("backfill");
    expect(none.exitCode).toBe(1);
    expect(none.stderr).toContain("embed download");
  });

  test("delete also drops the past turns' vectors, and never creates the history index", async () => {
    const hdb = openHistoryDb(dataDir, { create: true }) as NonNullable<
      ReturnType<typeof openHistoryDb>
    >;
    hdb.run(
      "INSERT INTO files (path, agent, size, mtime, indexed_at) VALUES ('/t', 'codex', 1, 1, 1)",
    );
    hdb.run(
      `INSERT INTO turns (id, path, agent, session_id, turn_id, project_id, project_name, cwd, started_at, ended_at, prompt, final_text)
       VALUES (1, '/t', 'codex', 's', 't', NULL, 'p', '/', 1, 1, 'q', 'a')`,
    );
    hdb.run("INSERT INTO turn_vectors (turn_id, model, scale, vec) VALUES (1, 'm', 1, x'00')");
    hdb.close();
    expect((await embed("delete")).exitCode).toBe(0);
    const after = openHistoryDb(dataDir, { create: false }) as NonNullable<
      ReturnType<typeof openHistoryDb>
    >;
    expect(after.query("SELECT count(*) AS n FROM turn_vectors").get()).toEqual({ n: 0 });
    expect(after.query("SELECT count(*) AS n FROM turns").get()).toEqual({ n: 1 });
    after.close();
    rmSync(historyDbPath(dataDir));
    copyFileSync(fixture, modelPath(dataDir));
    expect((await embed("delete")).exitCode).toBe(0);
    expect(existsSync(historyDbPath(dataDir))).toBe(false);
  });

  test("an index made before turn vectors existed: delete still succeeds", () => {
    const hdb = openHistoryDb(dataDir, { create: true }) as NonNullable<
      ReturnType<typeof openHistoryDb>
    >;
    hdb.run("DROP TABLE turn_vectors");
    hdb.close();
    expect(deleteModel(dataDir, db, dataDir)).toBe(true);
    expect(existsSync(modelPath(dataDir))).toBe(false);
  });

  test("embed delete is refused while a history run holds its lease", async () => {
    claimLease(db, HISTORY_LEASE, `${process.pid}-other`, Date.now(), 60_000);
    const refused = await embed("delete");
    expect(refused.exitCode).toBe(1);
    expect(refused.stderr).toContain("history run");
    expect(existsSync(modelPath(dataDir))).toBe(true);
  });

  test("a second download says so while one holds the download lease", async () => {
    claimLease(db, EMBED_DOWNLOAD_LEASE, `${process.pid}-other`, Date.now(), 60_000);
    const busy = await embed("download");
    expect(busy.exitCode).toBe(0);
    expect(busy.stdout).toContain("already running");
    expect((await embed("download", "--bogus")).exitCode).toBe(64);
  });

  test("backfill says so when another run holds the lease", async () => {
    memory(0, null);
    claimLease(db, EMBED_LEASE, `${process.pid}-other`, Date.now(), 60_000);
    const busy = await embed("backfill");
    expect(busy.exitCode).toBe(0);
    expect(busy.stdout).toContain("already running");
    expect(rows()).toEqual([]);
  });
});

describe("vectorIndex stamp", () => {
  test("a commit by another connection during the build is not stamped as current", () => {
    memory(0, model);
    expect(vectorIndex(db, model).ids.length).toBe(1);
    // Force a rebuild, and let another connection commit while the build's queries run.
    db.run("UPDATE memories SET title = title");
    const other = openDb({ dataDir, busyTimeoutMs: 2000 });
    const original = db.query.bind(db);
    let committed = false;
    (db as { query: unknown }).query = (sql: string) => {
      if (!committed && sql.includes("FROM memories WHERE status")) {
        committed = true;
        const [title, body] = TEXTS[1] as [string, string];
        const id = insertMemory(
          other,
          {
            projectId,
            kind: "decision",
            title,
            body: body as Redacted,
            terms: "",
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
          model,
        );
        void id;
      }
      return original(sql);
    };
    vectorIndex(db, model);
    (db as { query: unknown }).query = original;
    other.close();
    expect(committed).toBe(true);
    // Whatever the first build saw, the next call must see the commit made during it.
    expect(vectorIndex(db, model).ids.length).toBe(2);
  });
});

describe("the download hands its lease to the backfill", () => {
  test("in one write: a reader never sees neither lease held", () => {
    const owner = `${process.pid}-dl`;
    const reader = openDb({ dataDir, busyTimeoutMs: 2000 });
    const seen: boolean[] = [];
    const look = () =>
      seen.push(
        leaseActive(reader, EMBED_DOWNLOAD_LEASE, NOW) || leaseActive(reader, EMBED_LEASE, NOW),
      );
    expect(claimLease(db, EMBED_DOWNLOAD_LEASE, owner, NOW, 60_000)).toBe(true);
    look();
    // Every statement of the hand-over runs in one transaction: look between each of them.
    const original = db.run.bind(db);
    (db as { run: unknown }).run = (...args: Parameters<typeof db.run>) => {
      const out = original(...args);
      look();
      return out;
    };
    try {
      expect(handOverLease(db, EMBED_DOWNLOAD_LEASE, EMBED_LEASE, owner, NOW, 60_000)).toBe(true);
    } finally {
      (db as { run: unknown }).run = original;
    }
    look();
    reader.close();
    expect(seen.every(Boolean)).toBe(true);
    expect(leaseActive(db, EMBED_DOWNLOAD_LEASE, NOW)).toBe(false);
    expect(leaseActive(db, EMBED_LEASE, NOW)).toBe(true);
  });

  test("the backfill runs under the lease it was handed, and releases it", async () => {
    const owner = `${process.pid}-dl`;
    memory(0, null);
    claimLease(db, EMBED_LEASE, owner, NOW, 60_000);
    expect(await runEmbedBackfill(db, model, { now: () => NOW, owner })).toEqual({
      written: 1,
      remaining: 0,
    });
    expect(leaseActive(db, EMBED_LEASE, NOW)).toBe(false);
  });

  test("a backfill already running elsewhere keeps its lease; the download's is released", () => {
    const owner = `${process.pid}-dl`;
    claimLease(db, EMBED_LEASE, `${process.pid}-other`, NOW, 60_000);
    claimLease(db, EMBED_DOWNLOAD_LEASE, owner, NOW, 60_000);
    expect(handOverLease(db, EMBED_DOWNLOAD_LEASE, EMBED_LEASE, owner, NOW, 60_000)).toBe(false);
    expect(leaseActive(db, EMBED_DOWNLOAD_LEASE, NOW)).toBe(false);
    expect(leaseActive(db, EMBED_LEASE, NOW)).toBe(true);
  });
});
