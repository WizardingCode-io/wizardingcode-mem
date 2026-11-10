import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type Db,
  type Migration,
  openDb,
  openExisting,
  openExistingFile,
  openFile,
  SchemaTooNewError,
} from "../../src/store/db.ts";

const dirs: string[] = [];
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "wcm-team-db-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const ONE: Migration[] = [{ version: 1, name: "one", sql: "CREATE TABLE one (x INTEGER)" }];
const TWO: Migration[] = [...ONE, { version: 2, name: "two", sql: "CREATE TABLE two (y INTEGER)" }];
const userVersion = (db: Db) =>
  db.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version ?? 0;
const tables = (db: Db) =>
  db
    .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((row) => row.name);

describe("openFile: the core runner with a file name, a backups folder and a migration list", () => {
  test("creates the file at the list's version and copies the old one on an upgrade, under the given folder and prefix", () => {
    const dir = tempDir();
    const backups = { folder: join(dir, "copies"), prefix: "team" };
    const first = openFile({ dir, file: "team.db", backups, migrations: ONE, busyTimeoutMs: 1000 });
    expect(userVersion(first)).toBe(1);
    expect(tables(first)).toContain("one");
    first.close();
    expect(existsSync(join(dir, "copies"))).toBe(false);

    const second = openFile({ dir, file: "team.db", backups, migrations: TWO, busyTimeoutMs: 1000 });
    expect(userVersion(second)).toBe(2);
    expect(tables(second)).toContain("two");
    second.close();
    const copies = readdirSync(join(dir, "copies"));
    expect(copies).toHaveLength(1);
    expect(copies[0]).toMatch(/^team-\d+-v1-\d+\.db$/);
  });

  test("runs before ahead of the migration and after inside the guard", () => {
    const dir = tempDir();
    const backups = { folder: join(dir, "backups"), prefix: "team" };
    const order: string[] = [];
    const db = openFile({
      dir,
      file: "team.db",
      backups,
      migrations: ONE,
      busyTimeoutMs: 1000,
      before: (conn) => order.push(`before:${userVersion(conn)}`),
      after: (conn) => order.push(`after:${userVersion(conn)}`),
    });
    db.close();
    expect(order).toEqual(["before:0", "after:1"]);

    expect(() =>
      openFile({
        dir,
        file: "other.db",
        backups,
        migrations: ONE,
        busyTimeoutMs: 1000,
        after: () => {
          throw new Error("after failed");
        },
      }),
    ).toThrow("after failed");
    // The handle was closed: the file opens again and is whole.
    const again = openFile({ dir, file: "other.db", backups, migrations: ONE, busyTimeoutMs: 1000 });
    expect(userVersion(again)).toBe(1);
    again.close();
  });

  test("openExistingFile: null without the file, too new above latest, no check without latest", () => {
    const dir = tempDir();
    expect(openExistingFile(dir, "team.db", { latest: 1 })).toBeNull();
    const backups = { folder: join(dir, "backups"), prefix: "team" };
    openFile({ dir, file: "team.db", backups, migrations: TWO, busyTimeoutMs: 1000 }).close();
    expect(() => openExistingFile(dir, "team.db", { latest: 1 })).toThrow(SchemaTooNewError);
    const open = openExistingFile(dir, "team.db", { latest: 2 });
    expect(open).not.toBeNull();
    expect(userVersion(open as Db)).toBe(2);
    (open as Db).close();
    const unchecked = openExistingFile(dir, "team.db");
    expect(unchecked).not.toBeNull();
    (unchecked as Db).close();
    const seen: number[] = [];
    const before = openExistingFile(dir, "team.db", { before: (conn) => seen.push(userVersion(conn)) });
    (before as Db).close();
    expect(seen).toEqual([2]);
  });

  test("openExisting keeps allowNewer for a newer client store", () => {
    const dir = tempDir();
    const raw = new Database(join(dir, "wizardingcode-mem.db"), { create: true });
    raw.run("PRAGMA user_version = 999");
    raw.run("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    raw.close();
    expect(() => openExisting(dir)).toThrow(SchemaTooNewError);
    const allowed = openExisting(dir, { allowNewer: true });
    expect(allowed).not.toBeNull();
    (allowed as Db).close();
  });

  test("openDb's upgrade copies, a module schema's included, still land under backups/", () => {
    const dir = tempDir();
    const schemaV1 = [
      { module: "probe", migrations: [{ version: 1, name: "p1", sql: "CREATE TABLE probe1 (x)" }] },
    ];
    const schemaV2 = [
      {
        module: "probe",
        migrations: [
          { version: 1, name: "p1", sql: "CREATE TABLE probe1 (x)" },
          { version: 2, name: "p2", sql: "CREATE TABLE probe2 (x)" },
        ],
      },
    ];
    openDb({ dataDir: dir, busyTimeoutMs: 1000, moduleSchemas: schemaV1 }).close();
    expect(existsSync(join(dir, "backups"))).toBe(false);
    openDb({ dataDir: dir, busyTimeoutMs: 1000, moduleSchemas: schemaV2 }).close();
    const copies = readdirSync(join(dir, "backups"));
    expect(copies).toHaveLength(1);
    expect(copies[0]).toMatch(/^wizardingcode-mem-\d+-v7-\d+\.db$/);
    expect(readdirSync(dir).filter((name) => name.endsWith(".db"))).toEqual(["wizardingcode-mem.db"]);
  });
});
