import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MODULE_SCHEMAS } from "../../src/engine/module-schemas.ts";
import {
  KNOWLEDGE_MIGRATIONS,
  KNOWLEDGE_MODULE,
  KNOWLEDGE_SCHEMA_VERSION,
} from "../../src/modules/knowledge/migrations.ts";
import { SHARING_MIGRATIONS, SHARING_MODULE } from "../../src/sharing/migrations.ts";
import {
  DB_FILE,
  LATEST_VERSION,
  moduleSchemaState,
  moduleVersion,
  openDb,
  openExisting,
} from "../../src/store/db.ts";
import type { Migration, ModuleSchema } from "../../src/store/migration.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wizardingcode-mem-module-migrations-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const open = (moduleSchemas?: readonly ModuleSchema[]) =>
  openDb({ dataDir: dir, busyTimeoutMs: 2000, ...(moduleSchemas ? { moduleSchemas } : {}) });

const userVersion = (db: Database) =>
  db.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version;

const tables = (db: Database) =>
  db
    .query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type IN ('table', 'index') ORDER BY name",
    )
    .all()
    .map((row) => row.name);

interface Row {
  module: string;
  version: number;
  name: string;
  applied_at: number;
}
const rows = (db: Database) =>
  db
    .query<Row, []>(
      "SELECT module, version, name, applied_at FROM module_migrations ORDER BY module, version",
    )
    .all();

const backups = () =>
  existsSync(join(dir, "backups"))
    ? readdirSync(join(dir, "backups")).filter((name) => name.endsWith(".db"))
    : [];

const table = (n: number): Migration => ({
  version: n,
  name: `test_${n}`,
  sql: `CREATE TABLE test_${n} (id INTEGER PRIMARY KEY);`,
});

describe("the knowledge module's schema", () => {
  test("the list the engine reads holds the knowledge migrations", () => {
    expect(MODULE_SCHEMAS).toEqual([
      { module: KNOWLEDGE_MODULE, migrations: KNOWLEDGE_MIGRATIONS },
      { module: SHARING_MODULE, migrations: SHARING_MIGRATIONS },
    ]);
    expect(KNOWLEDGE_MODULE).toBe("knowledge");
    expect(KNOWLEDGE_SCHEMA_VERSION).toBe(7);
    expect(KNOWLEDGE_MIGRATIONS.map((m) => [m.version, m.name])).toEqual([
      [6, "knowledge_store"],
      [7, "knowledge_agent"],
    ]);
  });

  test("a fresh database gets migration 6 after the core ones, and the core version stays", () => {
    const db = open();
    expect(userVersion(db)).toBe(LATEST_VERSION);
    const recorded = rows(db);
    expect(recorded).toHaveLength(3);
    expect(recorded[0]).toMatchObject({ module: "knowledge", version: 6, name: "knowledge_store" });
    expect(recorded[0]?.applied_at).toBeGreaterThan(0);
    expect(recorded[1]).toMatchObject({ module: "knowledge", version: 7, name: "knowledge_agent" });
    expect(recorded[1]?.applied_at).toBeGreaterThan(0);
    expect(recorded[2]).toMatchObject({ module: "sharing", version: 1, name: "sharing_policy" });
    expect(recorded[2]?.applied_at).toBeGreaterThan(0);
    const names = tables(db);
    expect(names).toEqual(
      expect.arrayContaining(["knowledge_repos", "knowledge_entries", "knowledge_proposals"]),
    );
    expect(names).toContain("knowledge_fts");
    expect(names).toContain("knowledge_shown");
    expect(moduleVersion(db, "knowledge")).toBe(7);
    db.close();
  });

  test("a second open applies nothing and takes no backup", () => {
    open().close();
    const db = open();
    expect(rows(db)).toHaveLength(3);
    expect(backups()).toEqual([]);
    db.close();
  });

  test("a schema's first migration takes no backup on a store that holds another schema's", () => {
    open([{ module: KNOWLEDGE_MODULE, migrations: KNOWLEDGE_MIGRATIONS }]).close();
    expect(backups()).toEqual([]);
    const db = open();
    expect(rows(db).map((row) => [row.module, row.version, row.name])).toEqual([
      ["knowledge", 6, "knowledge_store"],
      ["knowledge", 7, "knowledge_agent"],
      ["sharing", 1, "sharing_policy"],
    ]);
    expect(backups()).toEqual([]);
    db.close();
  });

  test("moduleSchemaState tells current, behind and too new; a newer row does not stop openDb", () => {
    const db = open();
    expect(moduleSchemaState(db, "knowledge", KNOWLEDGE_SCHEMA_VERSION)).toBe("current");
    expect(moduleSchemaState(db, "knowledge", KNOWLEDGE_SCHEMA_VERSION + 1)).toBe("behind");
    db.run(
      "INSERT INTO module_migrations (module, version, name, applied_at) VALUES ('knowledge', ?, 'x', 0)",
      [KNOWLEDGE_SCHEMA_VERSION + 1],
    );
    expect(moduleSchemaState(db, "knowledge", KNOWLEDGE_SCHEMA_VERSION)).toBe("too-new");
    db.close();
    const again = open();
    expect(moduleSchemaState(again, "knowledge", KNOWLEDGE_SCHEMA_VERSION)).toBe("too-new");
    expect(rows(again).map((row) => [row.module, row.version])).toEqual([
      ["knowledge", 6],
      ["knowledge", 7],
      ["knowledge", 8],
      ["sharing", 1],
    ]);
    again.close();
  });

  test("with no module table at all the state is current", () => {
    const db = open([]);
    expect(tables(db)).not.toContain("module_migrations");
    expect(moduleVersion(db, "knowledge")).toBe(0);
    expect(moduleSchemaState(db, "knowledge", 6)).toBe("current");
    db.close();
  });

  test("a store that ran the withdrawn module is widened, cleaned and migrated, after a backup", () => {
    const old = open([]);
    old.run(`
      CREATE TABLE module_migrations (module TEXT, version INTEGER, PRIMARY KEY (module, version));
      INSERT INTO module_migrations (module, version) VALUES
        ('knowledge', 1), ('knowledge', 2), ('knowledge', 3), ('knowledge', 4), ('knowledge', 5);
      CREATE TABLE knowledge_entries (
        project_id INTEGER, slug TEXT, path TEXT, title TEXT, kind TEXT, essential INTEGER,
        status TEXT, tags TEXT, updated TEXT, source TEXT, body TEXT, problem TEXT, hash TEXT,
        PRIMARY KEY (project_id, slug));
      CREATE VIRTUAL TABLE knowledge_fts USING fts5(title, tags, body, project_id, slug UNINDEXED);
      -- The withdrawn module kept its full-text table in step with three triggers.
      CREATE TRIGGER knowledge_entries_ai AFTER INSERT ON knowledge_entries BEGIN
        INSERT INTO knowledge_fts (rowid, title, tags, body, project_id, slug)
          VALUES (new.rowid, new.title, new.tags, new.body, new.project_id, new.slug);
      END;
      CREATE TRIGGER knowledge_entries_ad AFTER DELETE ON knowledge_entries BEGIN
        DELETE FROM knowledge_fts WHERE rowid = old.rowid;
      END;
      CREATE TRIGGER knowledge_entries_au AFTER UPDATE ON knowledge_entries BEGIN
        DELETE FROM knowledge_fts WHERE rowid = old.rowid;
        INSERT INTO knowledge_fts (rowid, title, tags, body, project_id, slug)
          VALUES (new.rowid, new.title, new.tags, new.body, new.project_id, new.slug);
      END;
      CREATE TABLE knowledge_state (project_id INTEGER, fingerprint TEXT, indexed_at INTEGER);
      CREATE TABLE knowledge_shown (
        session_id TEXT, context_epoch INTEGER, project_id INTEGER, slug TEXT, event TEXT, at INTEGER);
      CREATE TABLE knowledge_proposals (id INTEGER PRIMARY KEY, memory_id INTEGER, project_id INTEGER, status TEXT);
      CREATE INDEX knowledge_proposals_open ON knowledge_proposals(status, project_id);
      CREATE TABLE promoted_memories (memory_id INTEGER, project_id INTEGER, slug TEXT);
      CREATE INDEX promoted_memories_project ON promoted_memories(project_id, slug);
      CREATE INDEX injections_memory_shown ON injections(memory_id, at);
      CREATE INDEX injections_memory_contexts ON injections(memory_id, session_id, context_epoch);
      INSERT INTO knowledge_entries (project_id, slug, title) VALUES (1, 'old', 'An old entry');
      -- What its promotion pass kept in the core table meta, beside a row that is not its own.
      INSERT INTO meta (key, value) VALUES
        ('knowledge.promote.cursor', '{}'), ('knowledge.not-standing', '[]'),
        ('knowledge.promote.lease', '{"owner":"1-x","until":1}'), ('kept.by.the.core', 'yes');
    `);
    // The fixture is the withdrawn shape in use: the trigger filled the full-text table.
    expect(old.query<{ n: number }, []>("SELECT count(*) AS n FROM knowledge_fts").get()?.n).toBe(
      1,
    );
    old.close();

    const db = open();
    expect(userVersion(db)).toBe(LATEST_VERSION);
    expect(rows(db)).toEqual([
      ...[1, 2, 3, 4, 5].map((version) => ({
        module: "knowledge",
        version,
        name: "",
        applied_at: 0,
      })),
      expect.objectContaining({ module: "knowledge", version: 6, name: "knowledge_store" }),
      expect.objectContaining({ module: "knowledge", version: 7, name: "knowledge_agent" }),
      expect.objectContaining({ module: "sharing", version: 1, name: "sharing_policy" }),
    ]);
    const names = tables(db);
    for (const gone of [
      "knowledge_state",
      "promoted_memories",
      "injections_memory_shown",
      "injections_memory_contexts",
      "knowledge_proposals_open",
      "promoted_memories_project",
    ]) {
      expect(names).not.toContain(gone);
    }
    // The three triggers went with their table, and the new one takes rows without them.
    expect(
      db
        .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'trigger'")
        .all()
        .map((row) => row.name)
        .filter((name) => name.startsWith("knowledge_")),
    ).toEqual([]);
    // Its three rows in meta are gone, and no other row with them.
    expect(
      db
        .query<{ key: string }, []>(
          "SELECT key FROM meta WHERE key LIKE 'knowledge.%' OR key = 'kept.by.the.core' ORDER BY key",
        )
        .all()
        .map((row) => row.key),
    ).toEqual(["kept.by.the.core"]);
    db.run(
      "INSERT INTO knowledge_repos (scope, project_id, path, indexed_at) VALUES ('workspace', 0, 'knowledge/workspace', 0)",
    );
    db.run(
      `INSERT INTO knowledge_entries (repo_id, id, slug, path, title, kind, area, status, author, version, body, hash)
       VALUES (1, 'an-id', 'a-slug', 'entries/a-slug.md', 't', 'knowledge', 'code', 'active', 'a', 1, '', '')`,
    );
    db.run("DELETE FROM knowledge_entries");
    expect(names).toEqual(
      expect.arrayContaining(["knowledge_repos", "knowledge_entries", "knowledge_proposals"]),
    );
    // The new shape, not the withdrawn one.
    expect(
      db.query<{ n: number }, []>("SELECT count(*) AS n FROM knowledge_entries").get()?.n,
    ).toBe(0);
    const columns = db
      .query<{ name: string }, []>("PRAGMA table_info(knowledge_entries)")
      .all()
      .map((column) => column.name);
    expect(columns).toContain("repo_id");
    expect(columns).not.toContain("essential");
    // Migration 7 made both names again, in its own shape: the withdrawn rows are gone.
    expect(db.query<{ n: number }, []>("SELECT count(*) AS n FROM knowledge_fts").get()?.n).toBe(0);
    const columnsOf = (name: string) =>
      db
        .query<{ name: string }, []>(`PRAGMA table_info(${name})`)
        .all()
        .map((column) => column.name);
    expect(columnsOf("knowledge_fts")).not.toContain("tags");
    expect(columnsOf("knowledge_shown")).toContain("repo_id");
    expect(columnsOf("knowledge_shown")).not.toContain("slug");
    expect(backups()).toHaveLength(1);
    expect(backups()[0]).toContain(`-v${LATEST_VERSION}-`);
    db.close();
  });

  test("the tables carry the columns the index reads", () => {
    const db = open();
    const columnsOf = (name: string) =>
      db
        .query<{ name: string }, []>(`PRAGMA table_info(${name})`)
        .all()
        .map((column) => column.name);
    expect(columnsOf("knowledge_repos")).toEqual([
      "id",
      "scope",
      "project_id",
      "path",
      "head",
      "fingerprint",
      "over_cap",
      "dirty_checked",
      "indexed_at",
    ]);
    expect(columnsOf("knowledge_entries")).toEqual([
      "repo_id",
      "id",
      "slug",
      "path",
      "title",
      "kind",
      "area",
      "context",
      "subject",
      "status",
      "author",
      "version",
      "created",
      "updated",
      "supersedes",
      "body",
      "problem",
      "hash",
      "pinned",
      "fts_rowid",
    ]);
    expect(columnsOf("knowledge_proposals")).toEqual([
      "repo_id",
      "id",
      "path",
      "state",
      "entry_id",
      "slug",
      "base_version",
      "base_hash",
      "proposed_by",
      "proposed_at",
      "decided_by",
      "decided_at",
      "decided_version",
      "title",
      "kind",
      "area",
      "context",
      "subject",
      "status",
      "body",
      "problem",
      "hash",
      "contradicts",
      "on_behalf_of",
      "judged_by",
      "judge_version",
    ]);
    expect(tables(db)).toEqual(
      expect.arrayContaining(["knowledge_proposals_entry", "knowledge_proposals_slug"]),
    );
    db.close();
  });

  test("a schema given to openDb replaces the default and applies in order, once", () => {
    const first = open([{ module: "test", migrations: [table(2), table(1)] }]);
    expect(rows(first).map((row) => [row.module, row.version, row.name])).toEqual([
      ["test", 1, "test_1"],
      ["test", 2, "test_2"],
    ]);
    expect(tables(first)).not.toContain("knowledge_repos");
    const applied = rows(first).map((row) => row.applied_at);
    first.close();

    const later = open([{ module: "test", migrations: [table(1), table(2), table(3)] }]);
    expect(rows(later).map((row) => row.version)).toEqual([1, 2, 3]);
    expect(
      rows(later)
        .slice(0, 2)
        .map((row) => row.applied_at),
    ).toEqual(applied);
    expect(tables(later)).toContain("test_3");
    expect(moduleSchemaState(later, "test", 3)).toBe("current");
    expect(moduleSchemaState(later, "knowledge", 6)).toBe("behind");
    later.close();
  });

  test("a failing module migration rolls back whole and leaves the database usable", () => {
    const broken: Migration = {
      version: 2,
      name: "broken",
      sql: "CREATE TABLE test_1 (id INTEGER);",
    };
    expect(() => open([{ module: "test", migrations: [table(1), broken] }])).toThrow();
    const db = open([]);
    expect(tables(db)).not.toContain("test_1");
    expect(tables(db)).not.toContain("module_migrations");
    db.close();
  });

  test("openExisting opens the migrated database", () => {
    open().close();
    const db = openExisting(dir);
    expect(db).not.toBeNull();
    expect(moduleSchemaState(db as Database, "knowledge", KNOWLEDGE_SCHEMA_VERSION)).toBe(
      "current",
    );
    db?.close();
  });

  test("several processes opening a fresh database at once record each schema's row once", async () => {
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
    const db = new Database(join(dir, DB_FILE), { readonly: true });
    expect(rows(db).map((row) => [row.module, row.version])).toEqual([
      ["knowledge", 6],
      ["knowledge", 7],
      ["sharing", 1],
    ]);
    db.close();
  }, 30_000);
});
