// Core migration 8 (ADR 0028): one shared name per project, held by a partial unique index
// over `project_aliases`; the upgrade's copy; an older binary's refusal; the sharing
// namespace's third migration, which gives `sharing_levels` the name's id.
import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DB_FILE,
  LATEST_VERSION,
  MIGRATIONS,
  openDb,
  openExistingFile,
  SchemaTooNewError,
} from "../../src/store/db.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wizardingcode-mem-migration-8-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const open = () => openDb({ dataDir: dir, busyTimeoutMs: 2000 });

const userVersion = (db: Database) =>
  db.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version;

const indexes = (db: Database) =>
  db
    .query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name",
    )
    .all()
    .map((row) => row.name);

const columnsOf = (db: Database, table: string) =>
  db
    .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
    .all()
    .map((column) => column.name);

const addProject = (db: Database, key: string) =>
  db.run("INSERT INTO projects (key, name, created_at) VALUES (?, ?, 1)", [key, key]);

const addAlias = (db: Database, projectId: number, alias: string) =>
  db.run("INSERT INTO project_aliases (alias, project_id) VALUES (?, ?)", [alias, projectId]);

describe("migration 8: one shared name per project", () => {
  test("a fresh store is at 8 and has the index", () => {
    const db = open();
    expect(LATEST_VERSION).toBe(8);
    expect(userVersion(db)).toBe(8);
    expect(indexes(db)).toContain("project_aliases_one_name");
    db.close();
  });

  test("a second name for one project is refused; two path aliases are not", () => {
    const db = open();
    addProject(db, "path:/p");
    addAlias(db, 1, "name:a");
    expect(() => addAlias(db, 1, "name:b")).toThrow(/UNIQUE constraint failed/);
    addAlias(db, 1, "path:/one");
    addAlias(db, 1, "path:/two");
    expect(db.query<{ n: number }, []>("SELECT count(*) AS n FROM project_aliases").get()?.n).toBe(
      3,
    );
    db.close();
  });

  test("two projects may each carry one name", () => {
    const db = open();
    addProject(db, "path:/p");
    addProject(db, "path:/q");
    addAlias(db, 1, "name:a");
    addAlias(db, 2, "name:b");
    expect(
      db
        .query<{ alias: string }, []>("SELECT alias FROM project_aliases ORDER BY alias")
        .all()
        .map((row) => row.alias),
    ).toEqual(["name:a", "name:b"]);
    db.close();
  });

  test("a version 7 store is upgraded to 8 behind a copy named after 7", () => {
    const before = openDb({
      dataDir: dir,
      busyTimeoutMs: 2000,
      migrations: MIGRATIONS.slice(0, 7),
    });
    expect(userVersion(before)).toBe(7);
    addProject(before, "path:/p");
    addAlias(before, 1, "remote:github.com/acme/site");
    before.close();

    const db = open();
    expect(userVersion(db)).toBe(8);
    expect(indexes(db)).toContain("project_aliases_one_name");
    expect(
      db
        .query<{ alias: string }, []>("SELECT alias FROM project_aliases")
        .all()
        .map((row) => row.alias),
    ).toEqual(["remote:github.com/acme/site"]);
    db.close();

    const copies = readdirSync(join(dir, "backups")).filter((name) => name.endsWith(".db"));
    expect(copies).toHaveLength(1);
    expect(copies[0]).toMatch(/^wizardingcode-mem-\d+-v7-\d+\.db$/);
    const copy = new Database(join(dir, "backups", copies[0] as string), { readonly: true });
    expect(userVersion(copy)).toBe(7);
    expect(indexes(copy)).not.toContain("project_aliases_one_name");
    copy.close();
  });

  test("a binary that knows 7 refuses a version 8 store", () => {
    open().close();
    expect(() => openExistingFile(dir, DB_FILE, { latest: 7 })).toThrow(SchemaTooNewError);
    const db = openExistingFile(dir, DB_FILE, { latest: 8 });
    expect(db).not.toBeNull();
    db?.close();
  });
});

describe("sharing namespace 3: the name's id on a level", () => {
  test("sharing_levels has the column name_id, nullable, after the ones it had", () => {
    const db = open();
    expect(columnsOf(db, "sharing_levels")).toEqual([
      "project_id",
      "destination",
      "level",
      "bound_alias",
      "set_at",
      "source",
      "name_id",
    ]);
    const info = db
      .query<{ name: string; notnull: number; dflt_value: string | null }, []>(
        "PRAGMA table_info(sharing_levels)",
      )
      .all()
      .find((column) => column.name === "name_id");
    expect(info).toMatchObject({ notnull: 0, dflt_value: null });
    db.close();
  });
});
