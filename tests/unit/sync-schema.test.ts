// Sharing v2 and knowledge v8: the tables the sync client and the received items need, the
// one-time upgrade and what it must leave alone (ADR 0027).
import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MODULE_SCHEMAS } from "../../src/engine/module-schemas.ts";
import {
  KNOWLEDGE_MIGRATIONS,
  KNOWLEDGE_MODULE,
  KNOWLEDGE_SCHEMA_VERSION,
} from "../../src/modules/knowledge/migrations.ts";
import {
  SHARING_MIGRATIONS,
  SHARING_MODULE,
  SHARING_SCHEMA_VERSION,
} from "../../src/sharing/migrations.ts";
import { LATEST_VERSION, moduleVersion, openDb } from "../../src/store/db.ts";
import {
  anyLeaseActive,
  claimLease,
  clearSyncStop,
  getMeta,
  leaseActive,
  leaseOwned,
  releaseLease,
  restoreHoldKey,
  SYNC_LAST_FAILED_START,
  SYNC_LEASE,
  SYNC_STOP,
  setMeta,
  staleStopFlag,
  stopSync,
  takeOverLease,
} from "../../src/store/meta.ts";
import type { ModuleSchema } from "../../src/store/migration.ts";
import { type Clock, fakeTimers } from "../helpers/clock.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wizardingcode-mem-sync-schema-"));
});
afterEach(() => {
  delete process.env.WIZARDINGCODE_MEM_TEST_FAIL_MIGRATION;
  rmSync(dir, { recursive: true, force: true });
});

const open = (moduleSchemas?: readonly ModuleSchema[], at: string = dir) =>
  openDb({ dataDir: at, busyTimeoutMs: 2000, ...(moduleSchemas ? { moduleSchemas } : {}) });

/** The schemas as a 0.7.0 binary carried them: knowledge to 7, sharing to 1. */
const PART_FIVE: readonly ModuleSchema[] = [
  {
    module: KNOWLEDGE_MODULE,
    migrations: KNOWLEDGE_MIGRATIONS.filter((migration) => migration.version <= 7),
  },
  {
    module: SHARING_MODULE,
    migrations: SHARING_MIGRATIONS.filter((migration) => migration.version <= 1),
  },
];

const columnsOf = (db: Database, table: string) =>
  db
    .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
    .all()
    .map((column) => column.name);

const userVersion = (db: Database) =>
  db.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version;

const coreSchema = (db: Database) =>
  db
    .query<{ name: string; sql: string }, []>(
      `SELECT name, sql FROM sqlite_master
       WHERE type IN ('table', 'index', 'trigger') AND name NOT LIKE 'sharing_%'
         AND name NOT LIKE 'knowledge_%' AND name NOT LIKE 'sqlite_%' AND name != 'module_migrations'
       ORDER BY name`,
    )
    .all();

const backups = () =>
  existsSync(join(dir, "backups"))
    ? readdirSync(join(dir, "backups")).filter((name) => name.endsWith(".db"))
    : [];

const level = (db: Database, projectId: number, destination: string, level: string) =>
  db.run(
    `INSERT INTO sharing_levels (project_id, destination, level, bound_alias, set_at, source)
     VALUES (?, ?, ?, 'remote:github.com/a/b', 1, 'cli')`,
    [projectId, destination, level],
  );

describe("sharing v2 and knowledge v8", () => {
  test("the versions, the names and the one list the engine reads", () => {
    expect(SHARING_SCHEMA_VERSION).toBe(2);
    expect(KNOWLEDGE_SCHEMA_VERSION).toBe(8);
    expect(SHARING_MIGRATIONS.map((m) => [m.version, m.name])).toEqual([
      [1, "sharing_policy"],
      [2, "sharing_servers"],
    ]);
    expect(KNOWLEDGE_MIGRATIONS.map((m) => [m.version, m.name])).toEqual([
      [6, "knowledge_store"],
      [7, "knowledge_agent"],
      [8, "knowledge_received"],
    ]);
    expect(MODULE_SCHEMAS.map((schema) => schema.module)).toEqual(["knowledge", "sharing"]);
  });

  test("a fresh store has the tables, the columns and the versions, and user_version stays", () => {
    const db = open();
    expect(userVersion(db)).toBe(LATEST_VERSION);
    expect(userVersion(db)).toBe(7);
    expect(moduleVersion(db, "sharing")).toBe(2);
    expect(moduleVersion(db, "knowledge")).toBe(8);
    expect(columnsOf(db, "sharing_servers")).toEqual([
      "server_id",
      "url",
      "name",
      "device_id",
      "device_alias",
      "member_id",
      "member_name",
      "role",
      "contract",
      "instance",
      "confirmed_at",
      "cursors",
      "roots",
      "areas",
      "muted",
      "stopped",
      "snapshot_due",
      "last_sweep_at",
      "last_sweep_max_id",
      "last_sweep_epoch",
      "last_sweep_generation",
      "added_at",
      "last_push_at",
      "last_push_ok_at",
      "last_pull_at",
      "last_pull_ok_at",
      "backlog",
      "retry_at",
      "failures",
      "last_error",
      "last_error_at",
      "last_request_id",
    ]);
    expect(columnsOf(db, "sharing_muted_members")).toEqual(["server_id", "member_id"]);
    expect(columnsOf(db, "sharing_pending_rows")).toEqual([
      "server_id",
      "seq",
      "uid",
      "kind",
      "payload",
      "reason",
      "tries",
      "at",
    ]);
    expect(columnsOf(db, "sharing_ledger")).toEqual([
      "destination",
      "item_kind",
      "item_uid",
      "direction",
      "version",
      "hash",
      "policy_epoch",
      "at",
      "withdrawn_at",
      "local_hash",
      "instance",
      "reason",
    ]);
    expect(columnsOf(db, "sharing_sent_hashes")).toEqual([
      "destination",
      "item_kind",
      "item_uid",
      "hash",
      "revision",
      "at",
    ]);
    expect(columnsOf(db, "sharing_refusals")).toEqual([
      "destination",
      "item_kind",
      "item_uid",
      "hash",
      "reason",
      "rule",
      "at",
    ]);
    expect(columnsOf(db, "sharing_unbound")).toEqual(["server_id", "alias", "at"]);
    expect(columnsOf(db, "sharing_conflicts")).toEqual([
      "destination",
      "item_uid",
      "at",
      "local_text",
      "local_version",
      "local_hash",
      "server_revision",
      "server_hash",
      "proposal_id",
      "resolved_at",
    ]);
    expect(columnsOf(db, "sharing_received_memories")).toEqual([
      "memory_id",
      "server_id",
      "remote_uid",
      "member_id",
      "member_name",
      "revision",
      "hash",
      "remote_kind",
      "remote_importance",
      "remote_status",
    ]);
    expect(columnsOf(db, "sharing_levels")).toEqual([
      "project_id",
      "destination",
      "level",
      "bound_alias",
      "set_at",
      "source",
    ]);
    expect(columnsOf(db, "knowledge_received")).toEqual([
      "server_id",
      "uid",
      "scope",
      "remote_alias",
      "project_id",
      "member_id",
      "member_name",
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
      "body",
      "hash",
      "revision",
      "received_at",
      "fts_rowid",
    ]);
    const indexes = db
      .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'index'")
      .all()
      .map((row) => row.name);
    expect(indexes).toEqual(
      expect.arrayContaining([
        "sharing_levels_one_server",
        "sharing_received_memories_uid",
        "sharing_memories_updated",
        "sharing_memories_superseded",
        "sharing_ledger_applied",
        "knowledge_received_project",
        "knowledge_received_entry",
        "knowledge_received_fts",
        "knowledge_entries_id",
      ]),
    );
    db.close();
  });

  test("the migrations are add-only: the core tables are what a store without them has", () => {
    const bare = mkdtempSync(join(tmpdir(), "wizardingcode-mem-sync-schema-bare-"));
    try {
      const without = open([], bare);
      const core = coreSchema(without);
      without.close();
      const db = open();
      expect(coreSchema(db)).toEqual(core);
      expect(userVersion(db)).toBe(7);
      db.close();
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });

  test("the index statement is not in the migration file: run creates it after the resolve", () => {
    const sql = readFileSync(
      join(import.meta.dir, "../../src/sharing/migrations/0002_sharing_servers.sql"),
      "utf8",
    );
    expect(sql).not.toContain("CREATE UNIQUE INDEX sharing_levels_one_server");
    const db = open();
    expect(() => {
      level(db, 1, "s1", "knowledge");
      level(db, 1, "s2", "knowledge");
    }).toThrow(/UNIQUE/);
    db.close();
  });

  test("a part-5 store upgrades: a project with two rows above Nothing keeps team, else the lowest", () => {
    const old = open(PART_FIVE);
    expect(moduleVersion(old, "sharing")).toBe(1);
    level(old, 1, "team", "knowledge");
    level(old, 1, "zzz", "all");
    level(old, 2, "aaa", "knowledge");
    level(old, 2, "bbb", "all");
    level(old, 3, "team", "local");
    level(old, 3, "ccc", "knowledge");
    old.close();

    const db = open();
    expect(moduleVersion(db, "sharing")).toBe(2);
    expect(moduleVersion(db, "knowledge")).toBe(8);
    const rows = db
      .query<{ project_id: number; destination: string; level: string }, []>(
        "SELECT project_id, destination, level FROM sharing_levels ORDER BY project_id, destination",
      )
      .all();
    expect(rows).toEqual([
      { project_id: 1, destination: "team", level: "knowledge" },
      { project_id: 2, destination: "aaa", level: "knowledge" },
      { project_id: 3, destination: "ccc", level: "knowledge" },
      { project_id: 3, destination: "team", level: "local" },
    ]);
    const changes = db
      .query<{ source: string; what: string; old: string; new: string }, []>(
        "SELECT source, what, old, new FROM sharing_changes ORDER BY id",
      )
      .all();
    expect(changes).toEqual([
      { source: "system", what: "project:1@zzz", old: "all", new: "local" },
      { source: "system", what: "project:2@bbb", old: "all", new: "local" },
    ]);
    expect(backups()).toHaveLength(1);
    db.close();
  });

  test("a run made to fail leaves sharing 1 and knowledge 7, and the next open upgrades", () => {
    open(PART_FIVE).close();
    process.env.WIZARDINGCODE_MEM_TEST_FAIL_MIGRATION = "sharing:2";
    expect(() => open()).toThrow(/test: migration refused/);
    const stuck = open(PART_FIVE);
    expect(moduleVersion(stuck, "sharing")).toBe(1);
    expect(moduleVersion(stuck, "knowledge")).toBe(7);
    stuck.close();
    delete process.env.WIZARDINGCODE_MEM_TEST_FAIL_MIGRATION;
    const db = open();
    expect(moduleVersion(db, "sharing")).toBe(2);
    expect(moduleVersion(db, "knowledge")).toBe(8);
    db.close();
  });
});

describe("the sync lease and its stop flag", () => {
  const leaseRow = (db: Database, owner: string, until: number) =>
    db.run("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", [
      SYNC_LEASE,
      JSON.stringify({ owner, until }),
    ]);

  /** A pid no process has: the kernel's limit is well under this. */
  const DEAD_PID = 2_000_000;

  test("the keys", () => {
    expect(SYNC_LEASE).toBe("sync.lease");
    expect(SYNC_STOP).toBe("sync.stop");
    expect(SYNC_LAST_FAILED_START).toBe("sync.last_failed_start");
    expect(restoreHoldKey("srv1")).toBe("sharing.restore_hold:srv1");
  });

  test("a dead sync-<pid>-<version> owner is not alive, a live one is, and anyLeaseActive reports it", () => {
    const db = open();
    const now = 1_000;
    leaseRow(db, `sync-${DEAD_PID}-0.8.0`, now + 60_000);
    expect(leaseActive(db, SYNC_LEASE, now)).toBe(false);
    expect(anyLeaseActive(db, now)).toBe(false);
    leaseRow(db, `sync-${process.pid}-0.8.0`, now + 60_000);
    expect(leaseActive(db, SYNC_LEASE, now)).toBe(true);
    expect(anyLeaseActive(db, now)).toBe(true);
    expect(leaseOwned(db, SYNC_LEASE, `sync-${process.pid}-0.8.0`)).toBe(true);
    expect(leaseOwned(db, SYNC_LEASE, `sync-${process.pid}-0.9.0`)).toBe(false);
    db.close();
  });

  test("takeOverLease takes a live older holder's lease and not a newer one's", () => {
    const db = open();
    const now = 1_000;
    const older = `sync-${process.pid}-0.7.0`;
    const newer = `sync-${process.pid}-0.8.0`;
    leaseRow(db, older, now + 60_000);
    expect(claimLease(db, SYNC_LEASE, newer, now, 20_000)).toBe(false);
    expect(takeOverLease(db, SYNC_LEASE, newer, now)).toBe(true);
    expect(leaseOwned(db, SYNC_LEASE, newer)).toBe(true);
    expect(leaseOwned(db, SYNC_LEASE, older)).toBe(false);
    expect(takeOverLease(db, SYNC_LEASE, older, now)).toBe(false);
    expect(leaseOwned(db, SYNC_LEASE, newer)).toBe(true);
    // The same version takes nothing; a lease nobody holds is claimed.
    expect(takeOverLease(db, SYNC_LEASE, `sync-${process.pid}-0.8.0`, now)).toBe(true);
    releaseLease(db, SYNC_LEASE, newer);
    expect(takeOverLease(db, SYNC_LEASE, older, now)).toBe(true);
    db.close();
  });

  test("stopSync sets the flag and resolves true once the lease is released, false after waitMs", async () => {
    const db = open();
    const clock: Clock = { now: 5_000, advance: () => undefined };
    const timers = fakeTimers(clock);
    const owner = `sync-${process.pid}-0.8.0`;
    leaseRow(db, owner, clock.now + 60_000);
    const stopping = stopSync(db, { who: "remove", clock, timers });
    expect(JSON.parse(getMeta(db, SYNC_STOP) ?? "{}")).toEqual({ who: "remove", at: 5_000 });
    clock.advance(1_000);
    releaseLease(db, SYNC_LEASE, owner);
    clock.advance(250);
    expect(await stopping).toBe(true);

    leaseRow(db, owner, clock.now + 60_000);
    const stuck = stopSync(db, { who: "move", clock, timers });
    clock.advance(30_250);
    expect(await stuck).toBe(false);
    expect(getMeta(db, SYNC_STOP)).not.toBeNull();
    clearSyncStop(db);
    expect(getMeta(db, SYNC_STOP)).toBeNull();
    expect(timers.pending()).toBe(0);
    db.close();
  });

  test("a stop flag older than ten minutes reads stale", () => {
    const db = open();
    expect(staleStopFlag(db, 1_000_000)).toBe(false);
    setMeta(db, SYNC_STOP, JSON.stringify({ who: "remove", at: 1_000_000 }));
    expect(staleStopFlag(db, 1_000_000 + 10 * 60_000)).toBe(false);
    expect(staleStopFlag(db, 1_000_000 + 10 * 60_000 + 1)).toBe(true);
    setMeta(db, SYNC_STOP, "not json");
    expect(staleStopFlag(db, 1_000_000)).toBe(true);
    db.close();
  });
});
