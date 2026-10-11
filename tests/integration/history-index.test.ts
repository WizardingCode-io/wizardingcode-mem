import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { Database } from "bun:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HISTORY_DB_FILE, openHistoryDb } from "../../src/history/db.ts";
import { indexAll } from "../../src/history/index-pass.ts";
import { searchHistory } from "../../src/history/search.ts";
import { DB_FILE, type Db, openDb } from "../../src/store/db.ts";

let dir: string;
let main: Db;
let hdb: NonNullable<ReturnType<typeof openHistoryDb>>;
let claude: string;
let codex: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wizardingcode-mem-history-index-"));
  claude = join(dir, "claude");
  codex = join(dir, "codex");
  mkdirSync(join(claude, "-shop"), { recursive: true });
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

const base = { sessionId: "s1", cwd: "/work/shop", gitBranch: "main", isSidechain: false };
const prompt = (promptId: string, content: string, timestamp: string) => ({
  ...base,
  type: "user",
  promptId,
  timestamp,
  message: { role: "user", content },
});
const assistant = (text: string, timestamp: string) => ({
  ...base,
  type: "assistant",
  timestamp,
  message: { role: "assistant", content: [{ type: "text", text }] },
});
const lines = (items: unknown[]) => `${items.map((l) => JSON.stringify(l)).join("\n")}\n`;

function transcript(name: string, items: unknown[]): string {
  const path = join(claude, "-shop", name);
  writeFileSync(path, lines(items));
  return path;
}

const key = `sk-ant-api03-${"a".repeat(90)}`;
const files = () => {
  const a = transcript("a.jsonl", [
    prompt("p1", `use this key ${key} please`, "2026-09-01T10:00:00.000Z"),
    assistant("Done, the pragma ran too late.", "2026-09-01T10:00:09.000Z"),
    prompt("p2", "thanks", "2026-09-01T10:01:00.000Z"),
    assistant("You're welcome.", "2026-09-01T10:01:02.000Z"),
  ]);
  const b = transcript("b.jsonl", [
    prompt("q1", "rename the module", "2026-09-02T10:00:00.000Z"),
    assistant("Renamed.", "2026-09-02T10:00:03.000Z"),
  ]);
  return { a, b };
};
const run = (maxMs = 60_000) =>
  indexAll(
    hdb,
    main,
    { claudeCode: claude, codex },
    {
      now: Date.now(),
      maxMs,
      agents: ["claude-code", "codex"],
    },
  );
const count = () => hdb.query<{ n: number }, []>("SELECT count(*) AS n FROM turns").get()?.n ?? -1;

describe("the history index", () => {
  test("a pass stores every turn of every transcript, redacted, and finds them by words", () => {
    files();
    expect(run()).toEqual({
      files: 2,
      indexed: 2,
      unchanged: 0,
      removed: 0,
      turns: 3,
      failed: 0,
    });
    const prompts = hdb.query<{ prompt: string }, []>("SELECT prompt FROM turns").all();
    expect(prompts).toHaveLength(3);
    expect(prompts.some((row) => row.prompt.includes(key))).toBe(false);
    const hits = hdb
      .query<{ turn_id: string }, []>(
        `SELECT t.turn_id FROM turns_fts f JOIN turns t ON t.id = f.rowid WHERE turns_fts MATCH '"pragma"'`,
      )
      .all();
    expect(hits.map((h) => h.turn_id)).toEqual(["p1"]);
    const row = hdb
      .query<{ project_id: number; project_name: string }, []>(
        "SELECT project_id, project_name FROM turns LIMIT 1",
      )
      .get();
    expect(row?.project_id).toBeGreaterThan(0);
    expect(row?.project_name).not.toBe("");
  });

  test("an unchanged transcript is skipped; one that grew is re-indexed without duplicates", () => {
    const { a } = files();
    run();
    expect(run()).toMatchObject({ indexed: 0, unchanged: 2 });
    appendFileSync(
      a,
      lines([
        prompt("p3", "one more thing", "2026-09-01T11:00:00.000Z"),
        assistant("Sure.", "2026-09-01T11:00:01.000Z"),
      ]),
    );
    const later = new Date(Date.now() + 5000);
    utimesSync(a, later, later);
    expect(run()).toMatchObject({ indexed: 1, unchanged: 1 });
    expect(count()).toBe(4);
    // The full-text index holds the new rows only: no stale entry for a replaced row.
    hdb.run("INSERT INTO turns_fts(turns_fts) VALUES('integrity-check')");
    const matches = (word: string) =>
      hdb
        .query<{ n: number }, [string]>(
          "SELECT count(*) AS n FROM turns_fts WHERE turns_fts MATCH ?",
        )
        .get(`"${word}"`)?.n;
    expect(matches("pragma")).toBe(1);

    writeFileSync(
      a,
      lines([
        prompt("p1", "a different question", "2026-09-01T10:00:00.000Z"),
        assistant("A different answer.", "2026-09-01T10:00:09.000Z"),
      ]),
    );
    const later2 = new Date(Date.now() + 10_000);
    utimesSync(a, later2, later2);
    expect(run()).toMatchObject({ indexed: 1 });
    hdb.run("INSERT INTO turns_fts(turns_fts) VALUES('integrity-check')");
    expect(matches("pragma")).toBe(0);
    expect(matches("different")).toBe(1);
  });

  test("a transcript that disappeared leaves the index", () => {
    const { a, b } = files();
    run();
    rmSync(a);
    expect(run()).toMatchObject({ removed: 1, files: 1, unchanged: 1 });
    expect(
      hdb.query<{ n: number }, [string]>("SELECT count(*) AS n FROM turns WHERE path = ?").get(a)
        ?.n,
    ).toBe(0);
    expect(
      hdb.query<{ n: number }, [string]>("SELECT count(*) AS n FROM turns WHERE path = ?").get(b)
        ?.n,
    ).toBe(1);
  });

  test("host notifications and turns of disabled projects are not stored", () => {
    transcript("h.jsonl", [
      prompt("h1", "<task-notification>build done</task-notification>", "2026-09-01T09:00:00.000Z"),
      assistant("ok", "2026-09-01T09:00:01.000Z"),
      prompt("h2", "a real question", "2026-09-01T09:01:00.000Z"),
      assistant("a real answer", "2026-09-01T09:01:01.000Z"),
    ]);
    expect(run().turns).toBe(1);
    expect(hdb.query<{ turn_id: string }, []>("SELECT turn_id FROM turns").all()).toEqual([
      { turn_id: "h2" },
    ]);

    main.run("UPDATE projects SET disabled = 1");
    const off = join(claude, "-shop", "d.jsonl");
    writeFileSync(
      off,
      lines([
        prompt("d1", "secret plans", "2026-09-03T09:00:00.000Z"),
        assistant("x", "2026-09-03T09:00:01.000Z"),
      ]),
    );
    const later = new Date(Date.now() + 5000);
    utimesSync(join(claude, "-shop", "h.jsonl"), later, later);
    run();
    expect(count()).toBe(0);
  });

  test("a file whose project cannot be resolved is not recorded, so the next pass retries it", () => {
    files();
    // A read-only main database: the project lookup cannot insert the new project.
    const readOnly = new Database(join(dir, "main", DB_FILE), { readonly: true });
    try {
      const report = indexAll(
        hdb,
        readOnly,
        { claudeCode: claude, codex },
        { now: Date.now(), maxMs: 60_000, agents: ["claude-code"] },
      );
      expect(report).toMatchObject({ files: 2, indexed: 0, failed: 2, turns: 0 });
    } finally {
      readOnly.close();
    }
    expect(hdb.query<{ n: number }, []>("SELECT count(*) AS n FROM files").get()?.n).toBe(0);
    expect(run()).toMatchObject({ indexed: 2, failed: 0, turns: 3 });
  });

  test("a project turned off after indexing loses its turns at the next pass", () => {
    files();
    run();
    expect(count()).toBe(3);
    main.run("UPDATE projects SET disabled = 1");
    expect(run()).toMatchObject({ indexed: 0, unchanged: 2 });
    expect(count()).toBe(0);
  });

  test("two passes at once leave one copy of each turn", async () => {
    files();
    const worker = new URL("../helpers/history-index-worker.ts", import.meta.url).pathname;
    const exits = await Promise.all(
      Array.from({ length: 2 }, async () => {
        const proc = Bun.spawn([process.execPath, worker, dir, claude, codex], {
          stdin: "ignore",
          stdout: "ignore",
          stderr: "pipe",
        });
        const [stderr, exitCode] = await Promise.all([
          new Response(proc.stderr).text(),
          proc.exited,
        ]);
        return { stderr, exitCode };
      }),
    );
    expect(exits.map((exit) => exit.exitCode)).toEqual([0, 0]);
    expect(count()).toBe(3);
    expect(
      hdb.query<{ n: number }, []>("SELECT count(DISTINCT turn_id) AS n FROM turns").get()?.n,
    ).toBe(3);
  });

  test.skipIf(process.platform === "win32")(
    "history.db is created with owner-only permissions",
    () => {
      expect(statSync(join(dir, HISTORY_DB_FILE)).mode & 0o777).toBe(0o600);
    },
  );

  test("it is not created unless asked", () => {
    const other = mkdtempSync(join(tmpdir(), "wizardingcode-mem-history-none-"));
    try {
      expect(openHistoryDb(other, { create: false })).toBeNull();
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });
});

describe("opening without create", () => {
  test("writes nothing and takes no write lock, so a search answers during an index pass", () => {
    const path = join(dir, HISTORY_DB_FILE);
    hdb.run(
      "INSERT INTO files(path, agent, size, mtime, indexed_at) VALUES ('/t', 'codex', 1, 1, 1)",
    );
    hdb.run(
      `INSERT INTO turns(path, agent, session_id, turn_id, project_id, project_name, cwd, started_at, ended_at, prompt, final_text)
       VALUES ('/t', 'codex', 's', 't', 1, 'shop', '/x', 1, 1, 'the zebra cache', NULL)`,
    );
    hdb.run("BEGIN IMMEDIATE"); // an index pass holds the write lock
    const before = statSync(path);
    const reader = openHistoryDb(dir, { create: false, busyTimeoutMs: 50 });
    if (reader === null) throw new Error("expected the index");
    try {
      expect(reader.query("SELECT count(*) AS n FROM turns").get()).toEqual({ n: 1 });
    } finally {
      reader.close();
    }
    hdb.run("ROLLBACK");
    const after = statSync(path);
    expect([after.size, after.mtimeMs]).toEqual([before.size, before.mtimeMs]);
  });

  test("answers when the WAL and shared-memory files are gone (closed, copied, checkpointed)", () => {
    const path = join(dir, HISTORY_DB_FILE);
    hdb.run(
      "INSERT INTO files(path, agent, size, mtime, indexed_at) VALUES ('/t', 'codex', 1, 1, 1)",
    );
    hdb.run(
      `INSERT INTO turns(path, agent, session_id, turn_id, project_id, project_name, cwd, started_at, ended_at, prompt, final_text)
       VALUES ('/t', 'codex', 's', 't', 1, 'shop', '/x', 1, 1, 'the zebra cache', NULL)`,
    );
    hdb.close(); // every connection closed: the WAL is checkpointed into the file
    for (const suffix of ["-wal", "-shm"]) rmSync(path + suffix, { force: true });
    const reader = openHistoryDb(dir, { create: false, busyTimeoutMs: 50 });
    if (reader === null) throw new Error("expected the index");
    try {
      expect(searchHistory(reader, { query: "zebra" }).map((h) => h.prompt)).toEqual([
        "the zebra cache",
      ]);
    } finally {
      reader.close();
    }
    const reopened = openHistoryDb(dir, { create: true });
    if (reopened === null) throw new Error("expected the index");
    hdb = reopened; // afterEach closes it
  });
});
