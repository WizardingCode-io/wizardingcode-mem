import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DB_FILE,
  LATEST_VERSION,
  MIGRATIONS,
  type Migration,
  openDb,
  SchemaTooNewError,
  withWrite,
} from "../../src/store/db.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wizardingcode-mem-db-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const open = (migrations?: readonly Migration[]) =>
  openDb({ dataDir: dir, busyTimeoutMs: 2000, ...(migrations ? { migrations } : {}) });

const version = (db: Database) =>
  db.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version;

const FAKE: Migration[] = [1, 2, 3]
  .map((i) => LATEST_VERSION + i)
  .map((n) => ({
    version: n,
    name: `fake_${n}`,
    sql: `CREATE TABLE fake_${n} (id INTEGER PRIMARY KEY);`,
  }));

function seed(db: Database): { projectId: number; memoryId: number } {
  const now = Date.now();
  db.run("INSERT INTO projects (key, name, created_at) VALUES ('path:/p', 'p', ?)", [now]);
  const projectId = db.query<{ id: number }, []>("SELECT id FROM projects").get()?.id as number;
  db.run(
    `INSERT INTO memories (project_id, kind, title, body, terms, importance, origin, judge, judge_version, created_at, updated_at)
     VALUES (?, 'decision', 'Migração para SQLite', 'Escolhemos WAL por causa dos hooks.', 'store db', 3, 'manual', 'heuristic', '1', ?, ?)`,
    [projectId, now, now],
  );
  const memoryId = db.query<{ id: number }, []>("SELECT id FROM memories").get()?.id as number;
  return { projectId, memoryId };
}

const search = (db: Database, term: string) =>
  db
    .query<{ rowid: number }, [string]>("SELECT rowid FROM memories_fts WHERE memories_fts MATCH ?")
    .all(term)
    .map((row) => row.rowid);

describe("store/db", () => {
  test("a new database ends at the latest schema version, in WAL mode", () => {
    const db = open();
    expect(version(db)).toBe(LATEST_VERSION);
    expect(LATEST_VERSION).toBe(MIGRATIONS.length);
    expect(db.query<{ journal_mode: string }, []>("PRAGMA journal_mode").get()?.journal_mode).toBe(
      "wal",
    );
    const tables = db
      .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => row.name);
    for (const table of [
      "meta",
      "projects",
      "project_aliases",
      "sessions",
      "turns",
      "memories",
      "memory_files",
      "memory_sources",
      "memories_fts",
      "injections",
      "hook_runs",
    ]) {
      expect(tables).toContain(table);
    }
    db.close();
  });

  test("opening an up-to-date database changes nothing", () => {
    open().close();
    const db = open();
    expect(version(db)).toBe(LATEST_VERSION);
    expect(readdirSync(dir)).not.toContain("backups");
    db.close();
  });

  test.skipIf(process.platform === "win32")("data is readable only by its owner", () => {
    open().close();
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(statSync(join(dir, DB_FILE)).mode & 0o777).toBe(0o600);
  });

  test("refuses a database written by a newer version, without touching it", () => {
    const db = open();
    db.run("PRAGMA user_version = 99");
    db.close();
    expect(() => open()).toThrow(SchemaTooNewError);
    const raw = new Database(join(dir, DB_FILE));
    expect(version(raw)).toBe(99);
    raw.close();
  });

  test("several processes opening a new database at once all succeed", async () => {
    const worker = new URL("../helpers/open-db-worker.ts", import.meta.url).pathname;
    const exits = await Promise.all(
      Array.from({ length: 4 }, async () => {
        const proc = Bun.spawn([process.execPath, worker, dir], {
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
    expect(exits.map((exit) => exit.stderr)).toEqual(["", "", "", ""]);
    expect(exits.map((exit) => exit.exitCode)).toEqual([0, 0, 0, 0]);
    const db = open();
    expect(version(db)).toBe(LATEST_VERSION);
    expect(
      db.query<{ integrity_check: string }, []>("PRAGMA integrity_check").get()?.integrity_check,
    ).toBe("ok");
    db.close();
  }, 30_000);

  // An upgrade lands while several sessions are open: every hook that runs next opens
  // the database and finds a migration to apply. All of them must come out fine.
  test("several processes upgrading a database with data at once all succeed", async () => {
    const first = open();
    seed(first);
    first.close();

    const worker = new URL("../helpers/open-db-worker.ts", import.meta.url).pathname;
    const exits = await Promise.all(
      Array.from({ length: 6 }, async () => {
        const proc = Bun.spawn([process.execPath, worker, dir, "--extra-migration"], {
          stdin: "ignore",
          stdout: "ignore",
          stderr: "pipe",
        });
        const [stderr, exitCode] = await Promise.all([
          new Response(proc.stderr).text(),
          proc.exited,
        ]);
        return { stderr: stderr.trim().split("\n")[0] ?? "", exitCode };
      }),
    );
    expect(exits.map((exit) => exit.exitCode)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(exits.map((exit) => exit.stderr)).toEqual(["", "", "", "", "", ""]);

    const db = open([...MIGRATIONS, FAKE[0] as Migration]);
    expect(version(db)).toBe(LATEST_VERSION + 1);
    expect(
      db.query<{ integrity_check: string }, []>("PRAGMA integrity_check").get()?.integrity_check,
    ).toBe("ok");
    expect(db.query<{ n: number }, []>("SELECT count(*) AS n FROM memories").get()?.n).toBe(1);
    db.close();
    // One upgrade, one backup, however many processes took part.
    const backups = readdirSync(join(dir, "backups")).filter((name) => name.endsWith(".db"));
    expect(backups).toHaveLength(1);
  }, 60_000);

  test("memories are found through full-text search, ignoring diacritics", () => {
    const db = open();
    const { memoryId } = seed(db);
    expect(search(db, "migracao")).toEqual([memoryId]);
    expect(search(db, "hooks")).toEqual([memoryId]);
    db.close();
  });

  test("the search index follows updates and deletes", () => {
    const db = open();
    const { memoryId } = seed(db);
    db.run("UPDATE memories SET title = 'Outra coisa' WHERE id = ?", [memoryId]);
    expect(search(db, "migracao")).toEqual([]);
    expect(search(db, "outra")).toEqual([memoryId]);
    // Bookkeeping updates must leave the index alone and intact.
    db.run("UPDATE memories SET use_count = use_count + 1 WHERE id = ?", [memoryId]);
    expect(search(db, "outra")).toEqual([memoryId]);
    db.run("DELETE FROM memories WHERE id = ?", [memoryId]);
    expect(search(db, "outra")).toEqual([]);
    db.close();
  });

  test("foreign keys are enforced", () => {
    const db = open();
    expect(() =>
      db.run(
        "INSERT INTO sessions (agent, agent_session_id, project_id, cwd, started_at, last_seen_at) VALUES ('claude-code', 's', 999, '/p', 1, 1)",
      ),
    ).toThrow();
    db.close();
  });

  test("withWrite commits on success and rolls back when the callback throws", () => {
    const db = open();
    withWrite(db, () => db.run("INSERT INTO meta (key, value) VALUES ('kept', '1')"));
    expect(() =>
      withWrite(db, () => {
        db.run("INSERT INTO meta (key, value) VALUES ('lost', '1')");
        throw new Error("boom");
      }),
    ).toThrow("boom");
    const keys = db
      .query<{ key: string }, []>("SELECT key FROM meta WHERE key IN ('kept', 'lost')")
      .all()
      .map((row) => row.key);
    expect(keys).toEqual(["kept"]);
    db.close();
  });

  test("upgrading drops the context lines that a host notification left in memories", () => {
    const before = open(MIGRATIONS.slice(0, 2));
    const { projectId } = seed(before);
    const now = Date.now();
    const insert = (title: string, body: string, terms: string) => {
      before.run(
        `INSERT INTO memories (project_id, kind, title, body, terms, importance, origin, judge, judge_version, created_at, updated_at)
         VALUES (?, 'change', ?, ?, ?, 2, 'distilled', 'heuristic', '1', ?, ?)`,
        [projectId, title, body, terms, now, now],
      );
      return before.query<{ id: number }, []>("SELECT max(id) AS id FROM memories").get()
        ?.id as number;
    };
    const noisy = insert(
      "Release published.",
      "The checksums match.\nContext: <task-notification> <task-id>bq7x</task-id> <output-file>/tmp/claude/bq7x.output…",
      "bq7x task notification output",
    );
    before.run(
      "INSERT INTO memory_files (memory_id, path, role) VALUES (?, 'src/release.ts', 'changed')",
      [noisy],
    );
    const report = insert(
      "Review done.",
      'Context: <agent-message from="a33"> [Subagent hand-back] The text below…',
      "a33 subagent",
    );
    const kept = insert(
      "Moved the pragma.",
      "It runs first now.\nContext: why does <task-notification> show up?",
      "pragma",
    );
    before.close();

    const db = open();
    const row = (id: number) =>
      db
        .query<{ body: string; terms: string }, [number]>(
          "SELECT body, terms FROM memories WHERE id = ?",
        )
        .get(id);
    expect(row(noisy)?.body).toBe("The checksums match.");
    expect(row(noisy)?.terms).toContain("src/release.ts");
    expect(row(report)?.body).toBe("");
    expect(row(kept)?.body).toBe(
      "It runs first now.\nContext: why does <task-notification> show up?",
    );
    expect(search(db, "bq7x")).toEqual([]);
    expect(search(db, "a33")).toEqual([]);
    expect(search(db, "checksums")).toEqual([noisy]);
    db.close();
  });

  test("a database with data is backed up before it is migrated, keeping the two newest", () => {
    const first = open();
    seed(first);
    first.close();

    const backups = () => readdirSync(join(dir, "backups")).sort();
    for (let upTo = 1; upTo <= FAKE.length; upTo++) {
      const db = open([...MIGRATIONS, ...FAKE.slice(0, upTo)]);
      expect(version(db)).toBe(LATEST_VERSION + upTo);
      db.close();
    }
    expect(backups()).toHaveLength(2);
    expect(backups().every((name) => name.endsWith(".db"))).toBe(true);

    // The newest backup holds the data as it was before the last migration.
    const newest = new Database(join(dir, "backups", backups().at(-1) as string), {
      readonly: true,
    });
    expect(version(newest)).toBe(LATEST_VERSION + FAKE.length - 1);
    expect(newest.query<{ n: number }, []>("SELECT count(*) AS n FROM memories").get()?.n).toBe(1);
    newest.close();
  });
});
