import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MODULE_SCHEMAS } from "../../src/engine/module-schemas.ts";
import { BUILT_IN } from "../../src/engine/modules.ts";
import {
  DB_FILE,
  LATEST_VERSION,
  MIGRATIONS,
  type ModuleSchema,
  openDb,
} from "../../src/store/db.ts";

// Ruling K8: a module's tables come from its own migration list, applied after the core
// ones and recorded in module_migrations(module, version). The core schema version does not
// move for them, so an older binary (which refuses a newer core schema) keeps opening the
// database and ignores tables it does not know.

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wizardingcode-mem-module-migrations-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const version = (db: Database) =>
  db.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version;
const recorded = (db: Database) =>
  db
    .query<{ module: string; version: number }, []>(
      "SELECT module, version FROM module_migrations ORDER BY module, version",
    )
    .all();
const tables = (db: Database) =>
  db
    .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((row) => row.name);

const FAKE: ModuleSchema = {
  module: "fake",
  // Not idempotent on purpose: applied twice, the second CREATE fails.
  migrations: [
    { version: 1, name: "one", sql: "CREATE TABLE fake_one (id INTEGER PRIMARY KEY);" },
    { version: 2, name: "two", sql: "CREATE TABLE fake_two (id INTEGER PRIMARY KEY);" },
  ],
};

describe("module migrations", () => {
  test("knowledge's tables exist and are recorded; the core version is unchanged", () => {
    const db = openDb({ dataDir: dir, busyTimeoutMs: 2000 });
    expect(LATEST_VERSION).toBe(MIGRATIONS.length);
    expect(LATEST_VERSION).toBe(7);
    expect(version(db)).toBe(LATEST_VERSION);
    expect(tables(db)).toEqual(
      expect.arrayContaining([
        "knowledge_entries",
        "knowledge_fts",
        "knowledge_state",
        "knowledge_shown",
        "knowledge_proposals",
        "promoted_memories",
      ]),
    );
    expect(recorded(db)).toEqual([
      { module: "knowledge", version: 1 },
      { module: "knowledge", version: 2 },
      { module: "knowledge", version: 3 },
      { module: "knowledge", version: 4 },
      { module: "knowledge", version: 5 },
    ]);
    db.close();
  });

  test("applied once: opening again changes nothing and takes no backup", () => {
    const options = { dataDir: dir, busyTimeoutMs: 2000, moduleMigrations: [FAKE] };
    openDb(options).close();
    const db = openDb(options);
    expect(recorded(db)).toEqual([
      { module: "fake", version: 1 },
      { module: "fake", version: 2 },
    ]);
    expect(tables(db)).toEqual(expect.arrayContaining(["fake_one", "fake_two"]));
    db.close();
    expect(readdirSync(dir)).not.toContain("backups");
  });

  test("a later module migration is applied alone, after a backup", () => {
    const first = { module: "fake", migrations: FAKE.migrations.slice(0, 1) };
    openDb({ dataDir: dir, busyTimeoutMs: 2000, moduleMigrations: [first] }).close();
    const db = openDb({ dataDir: dir, busyTimeoutMs: 2000, moduleMigrations: [FAKE] });
    expect(recorded(db).filter((row) => row.module === "fake")).toEqual([
      { module: "fake", version: 1 },
      { module: "fake", version: 2 },
    ]);
    db.close();
    expect(readdirSync(join(dir, "backups")).filter((name) => name.endsWith(".db"))).toHaveLength(
      1,
    );
  });

  test("a failing module migration leaves nothing half applied", () => {
    const broken: ModuleSchema = {
      module: "broken",
      migrations: [
        { version: 1, name: "ok", sql: "CREATE TABLE broken_ok (id INTEGER);" },
        { version: 2, name: "bad", sql: "CREATE TABLE nonsense (" },
      ],
    };
    expect(() =>
      openDb({ dataDir: dir, busyTimeoutMs: 2000, moduleMigrations: [broken] }),
    ).toThrow();
    const db = openDb({ dataDir: dir, busyTimeoutMs: 2000, moduleMigrations: [] });
    expect(tables(db)).not.toContain("broken_ok");
    db.close();
  });

  test("an older-schema database is upgraded, core first, then modules", () => {
    const before = openDb({
      dataDir: dir,
      busyTimeoutMs: 2000,
      migrations: MIGRATIONS.slice(0, 6),
      moduleMigrations: [],
    });
    before.run("INSERT INTO projects (key, name, created_at) VALUES ('path:/p', 'p', 1)");
    expect(tables(before)).not.toContain("module_migrations");
    before.close();
    const db = openDb({ dataDir: dir, busyTimeoutMs: 2000 });
    expect(version(db)).toBe(LATEST_VERSION);
    expect(recorded(db)).toEqual([
      { module: "knowledge", version: 1 },
      { module: "knowledge", version: 2 },
      { module: "knowledge", version: 3 },
      { module: "knowledge", version: 4 },
      { module: "knowledge", version: 5 },
    ]);
    expect(db.query("SELECT count(*) AS n FROM projects").get()).toEqual({ n: 1 });
    db.close();
  });

  test("a database with module tables still opens where modules are unknown", () => {
    openDb({ dataDir: dir, busyTimeoutMs: 2000, moduleMigrations: [FAKE] }).close();
    // What an older binary sees: the same core version, tables it does not know.
    const raw = new Database(join(dir, DB_FILE));
    expect(version(raw)).toBe(LATEST_VERSION);
    raw.close();
    const db = openDb({ dataDir: dir, busyTimeoutMs: 2000, moduleMigrations: [] });
    expect(version(db)).toBe(LATEST_VERSION);
    db.close();
  });

  test("every built-in module's migrations are the ones openDb applies", () => {
    for (const module of BUILT_IN) {
      if (module.migrations === undefined) continue;
      expect(MODULE_SCHEMAS.find((schema) => schema.module === module.id)?.migrations).toBe(
        module.migrations,
      );
    }
    for (const schema of MODULE_SCHEMAS) {
      const versions = schema.migrations.map((migration) => migration.version);
      expect(versions).toEqual(versions.map((_, i) => i + 1));
    }
  });

  test("several processes opening at once apply each module migration exactly once", async () => {
    const worker = new URL("../helpers/open-db-worker.ts", import.meta.url).pathname;
    const exits = await Promise.all(
      Array.from({ length: 6 }, async () => {
        const proc = Bun.spawn([process.execPath, worker, dir, "--module-migration"], {
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
    expect(exits.map((exit) => exit.stderr)).toEqual(["", "", "", "", "", ""]);
    expect(exits.map((exit) => exit.exitCode)).toEqual([0, 0, 0, 0, 0, 0]);
    const db = openDb({ dataDir: dir, busyTimeoutMs: 2000 });
    expect(recorded(db)).toEqual([
      { module: "fake", version: 1 },
      { module: "knowledge", version: 1 },
      { module: "knowledge", version: 2 },
      { module: "knowledge", version: 3 },
      { module: "knowledge", version: 4 },
      { module: "knowledge", version: 5 },
    ]);
    db.close();
  }, 60_000);
});
