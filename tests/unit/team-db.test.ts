import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
import {
  openTeamDb,
  openTeamExisting,
  openTeamForWrite,
  TEAM_LATEST,
  TEAM_MIGRATIONS,
  teamBackups,
  teamPaths,
} from "../../src/team/db.ts";
import { NotATeamDatabaseError, SchemaBehindError } from "../../src/team/errors.ts";
import { checkRestore, readHighWater, writeHighWater } from "../../src/team/instance.ts";
import {
  advanceSequence,
  claimLease,
  getMeta,
  listAudit,
  sequenceHighWater,
} from "../../src/team/store.ts";

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
    .query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    )
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

    const second = openFile({
      dir,
      file: "team.db",
      backups,
      migrations: TWO,
      busyTimeoutMs: 1000,
    });
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
    const again = openFile({
      dir,
      file: "other.db",
      backups,
      migrations: ONE,
      busyTimeoutMs: 1000,
    });
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
    const before = openExistingFile(dir, "team.db", {
      before: (conn) => seen.push(userVersion(conn)),
    });
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
    expect(readdirSync(dir).filter((name) => name.endsWith(".db"))).toEqual([
      "wizardingcode-mem.db",
    ]);
  });
});

// --- The team database -----------------------------------------------------------------

const HEX16 = /^[0-9a-f]{16}$/;
const TEAM_TABLES = [
  "audit",
  "changes",
  "devices",
  "entries",
  "entry_revisions",
  "invitations",
  "members",
  "memories",
  "meta",
  "purged",
];
const insertChange = (db: Db) =>
  db.run(
    "INSERT INTO changes (kind, uid, key, op, scope, revision, hash, member_id, device_id, at) VALUES ('entry','shared:x','x','upsert','shared',1,'h','m','d',1)",
  );

describe("the team database", () => {
  test("openTeamDb creates team.db at team schema 1 with its tables and ids, and a second open changes nothing", () => {
    const dir = tempDir();
    const db = openTeamDb(dir);
    expect(userVersion(db)).toBe(TEAM_LATEST);
    for (const table of TEAM_TABLES) expect(tables(db)).toContain(table);
    expect(getMeta(db, "team.schema")).toBe("team");
    const serverId = getMeta(db, "server.id");
    const instance = getMeta(db, "server.instance");
    expect(serverId).toMatch(HEX16);
    expect(instance).toMatch(HEX16);
    expect(Number(getMeta(db, "server.created_at"))).toBeGreaterThan(0);
    db.close();
    const again = openTeamDb(dir);
    expect(getMeta(again, "server.id")).toBe(serverId);
    expect(getMeta(again, "server.instance")).toBe(instance);
    again.close();
    expect(teamPaths(dir)).toEqual({
      db: join(dir, "team.db"),
      repos: join(dir, "repos"),
      feedFile: join(dir, "feed.seq"),
    });
    expect(teamBackups(dir)).toEqual({ folder: join(dir, "backups"), prefix: "team" });
  });

  test("a newer team.db is refused as too new; a stranger's file as not a team database, before any migration", () => {
    const dir = tempDir();
    const newer = new Database(join(dir, "team.db"), { create: true });
    newer.run("PRAGMA user_version = 2");
    newer.run("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    newer.run("INSERT INTO meta VALUES ('team.schema', 'team')");
    newer.close();
    expect(() => openTeamDb(dir)).toThrow(SchemaTooNewError);
    expect(() => openTeamExisting(dir)).toThrow(SchemaTooNewError);

    const client = tempDir();
    openDb({ dataDir: client, busyTimeoutMs: 1000, moduleSchemas: [] }).close();
    const copied = tempDir();
    writeFileSync(join(copied, "team.db"), readFileSync(join(client, "wizardingcode-mem.db")));
    const before = readFileSync(join(copied, "team.db"));
    expect(() => openTeamDb(copied)).toThrow(NotATeamDatabaseError);
    expect(() => openTeamExisting(copied)).toThrow(NotATeamDatabaseError);
    expect(readFileSync(join(copied, "team.db")).equals(before)).toBe(true);

    const noMeta = tempDir();
    const bare = new Database(join(noMeta, "team.db"), { create: true });
    bare.run("PRAGMA user_version = 1");
    bare.run("CREATE TABLE other (x)");
    bare.close();
    expect(() => openTeamDb(noMeta)).toThrow(NotATeamDatabaseError);
    expect(() => openTeamExisting(noMeta)).toThrow(NotATeamDatabaseError);
    expect(openTeamExisting(tempDir())).toBeNull();
  });

  test("a writer of a newer binary refuses to migrate while a fresh serve lease is held", () => {
    const dir = tempDir();
    const db = openTeamDb(dir);
    expect(claimLease(db, "serve.lease", "serve-abc", 1_000, 30_000)).toBe(true);
    db.close();
    expect(() => openTeamForWrite(dir, 2_000, { latest: TEAM_LATEST + 1 })).toThrow(
      SchemaBehindError,
    );
    const open = openTeamForWrite(dir, 2_000);
    expect(userVersion(open)).toBe(TEAM_LATEST);
    open.close();
    // The lease expired: the writer may migrate (here the list is still version 1, so nothing changes).
    const stale = openTeamForWrite(dir, 60_000, { latest: TEAM_LATEST + 1 });
    expect(userVersion(stale)).toBe(TEAM_LATEST);
    stale.close();
  });

  test("the sequence high-water reads 0 on an empty database and advancing it inserts the row and never lowers it", () => {
    const dir = tempDir();
    const db = openTeamDb(dir);
    expect(sequenceHighWater(db, "changes")).toBe(0);
    expect(sequenceHighWater(db, "audit")).toBe(0);
    advanceSequence(db, "changes", 1_000_000);
    expect(sequenceHighWater(db, "changes")).toBe(1_000_000);
    advanceSequence(db, "changes", 5);
    expect(sequenceHighWater(db, "changes")).toBe(1_000_000);
    insertChange(db);
    expect(sequenceHighWater(db, "changes")).toBe(1_000_001);
    db.close();
  });

  test("the way back across a bump: the copy, the refusal, the restore and the renewed instance", () => {
    const dir = tempDir();
    const backups = teamBackups(dir);
    const two = [...TEAM_MIGRATIONS, { version: 2, name: "later", sql: "CREATE TABLE later (x)" }];
    const first = openTeamDb(dir);
    const instance = getMeta(first, "server.instance");
    first.close();
    const bumped = openFile({
      dir,
      file: "team.db",
      backups,
      migrations: two,
      busyTimeoutMs: 1000,
    });
    expect(userVersion(bumped)).toBe(2);
    bumped.close();
    const copies = readdirSync(join(dir, "backups"));
    expect(copies).toHaveLength(1);
    expect(copies[0]).toMatch(/^team-\d+-v1-\d+\.db$/);
    expect(() => openTeamDb(dir)).toThrow(SchemaTooNewError);

    writeFileSync(join(dir, "team.db"), readFileSync(join(dir, "backups", copies[0] as string)));
    rmSync(join(dir, "team.db-wal"), { force: true });
    rmSync(join(dir, "team.db-shm"), { force: true });
    writeHighWater(teamPaths(dir).feedFile, { changes: 40, audit: 9 });
    const restored = openTeamDb(dir);
    expect(userVersion(restored)).toBe(1);
    const outcome = checkRestore(restored, teamPaths(dir).feedFile, 123_456);
    expect(outcome.renewed).toBe(true);
    expect(getMeta(restored, "server.instance")).not.toBe(instance);
    expect(getMeta(restored, "server.instance")).toMatch(HEX16);
    expect(sequenceHighWater(restored, "changes")).toBeGreaterThanOrEqual(1_000_040);
    expect(readHighWater(teamPaths(dir).feedFile)).toEqual({
      changes: sequenceHighWater(restored, "changes"),
      audit: sequenceHighWater(restored, "audit"),
    });
    expect(listAudit(restored, 5).map((row) => row.action)).toContain("restore detected");
    expect(checkRestore(restored, teamPaths(dir).feedFile, 123_457).renewed).toBe(false);
    restored.close();
  });

  test("a lost high-water file is rewritten from the database", () => {
    const dir = tempDir();
    const db = openTeamDb(dir);
    insertChange(db);
    expect(existsSync(teamPaths(dir).feedFile)).toBe(false);
    const outcome = checkRestore(db, teamPaths(dir).feedFile, 1);
    expect(outcome.renewed).toBe(false);
    expect(readHighWater(teamPaths(dir).feedFile)).toEqual({ changes: 1, audit: 0 });
    db.close();
  });
});
