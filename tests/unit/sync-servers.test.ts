// The server list and the token file (ADR 0027, D-7): the file's mode and shape, a token never
// inside the database, the lookup of a server by id, name or host, and the state rows.
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { KNOWLEDGE_MIGRATIONS, KNOWLEDGE_MODULE } from "../../src/modules/knowledge/migrations.ts";
import { SHARING_MIGRATIONS, SHARING_MODULE } from "../../src/sharing/migrations.ts";
import { getMeta, restoreHoldKey, SYNC_LEASE, setMeta } from "../../src/store/meta.ts";
import {
  confirmedServers,
  deleteServerRows,
  findServer,
  forgetToken,
  insertPending,
  listServers,
  mutedMembers,
  muteMember,
  readTokens,
  replaceDevice,
  ServerRefAmbiguous,
  serverById,
  serversConfigured,
  setMuted,
  setStopped,
  TokenFileError,
  tokensPath,
  writeToken,
} from "../../src/sync/servers.ts";
import {
  cursorsOf,
  LeaseLost,
  recordAnswer,
  serverRows,
  setCursor,
  statusReport,
  syncState,
  updateState,
} from "../../src/sync/state.ts";
import {
  cleanSyncDirs,
  openSyncStore,
  type SyncTestStore,
  serverFixture,
} from "../helpers/sync.ts";

const TOKEN_A = `wcm1_${"a".repeat(43)}`;
const TOKEN_B = `wcm1_${"b".repeat(43)}`;

const PART_FIVE = [
  { module: KNOWLEDGE_MODULE, migrations: KNOWLEDGE_MIGRATIONS.filter((m) => m.version <= 7) },
  { module: SHARING_MODULE, migrations: SHARING_MIGRATIONS.filter((m) => m.version <= 1) },
];

const stores: SyncTestStore[] = [];
const open = (options = {}) => {
  const store = openSyncStore(options);
  stores.push(store);
  return store;
};
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});
afterAll(() => cleanSyncDirs());

/** Every byte of the store's files, to look for a token in. */
const storeBytes = (dir: string) =>
  readdirSync(dir)
    .filter((name) => name.endsWith(".db") || name.endsWith("-wal"))
    .map((name) => readFileSync(join(dir, name), "latin1"))
    .join("");

const confirm = (store: SyncTestStore, serverId: string, at = store.clock.now) =>
  store.db.run("UPDATE sharing_servers SET confirmed_at = ? WHERE server_id = ?", [at, serverId]);

describe("the token file", () => {
  test("is created at 0600 with its shape, and a token is never inside the database", () => {
    const store = open();
    expect(existsSync(tokensPath(store.dataDir))).toBe(false);
    expect(readTokens(store.dataDir)).toEqual({});
    writeToken(store.ctx, "s1", TOKEN_A);
    const path = tokensPath(store.dataDir);
    expect(path).toBe(join(store.dataDir, "servers.json"));
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ version: 1, tokens: { s1: TOKEN_A } });
    expect(readTokens(store.dataDir)).toEqual({ s1: TOKEN_A });
    expect(storeBytes(store.dataDir)).not.toContain("wcm1_");
    expect(readdirSync(store.dataDir).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  test("two writers in turn keep both tokens, and a forget removes one", () => {
    const store = open();
    writeToken(store.ctx, "s1", TOKEN_A);
    writeToken(store.ctx, "s2", TOKEN_B);
    expect(readTokens(store.dataDir)).toEqual({ s1: TOKEN_A, s2: TOKEN_B });
    writeToken(store.ctx, "s1", TOKEN_B);
    expect(readTokens(store.dataDir)).toEqual({ s1: TOKEN_B, s2: TOKEN_B });
    forgetToken(store.ctx, "s1");
    expect(readTokens(store.dataDir)).toEqual({ s2: TOKEN_B });
    forgetToken(store.ctx, "missing");
    expect(readTokens(store.dataDir)).toEqual({ s2: TOKEN_B });
  });

  test("a malformed file is refused with its path, by the reader and by a writer", () => {
    const store = open();
    const path = tokensPath(store.dataDir);
    writeFileSync(path, "{not json", { mode: 0o600 });
    expect(() => readTokens(store.dataDir)).toThrow(TokenFileError);
    expect(() => readTokens(store.dataDir)).toThrow(path);
    expect(() => writeToken(store.ctx, "s1", TOKEN_A)).toThrow(TokenFileError);
    writeFileSync(path, JSON.stringify({ version: 2, tokens: {} }), { mode: 0o600 });
    expect(() => readTokens(store.dataDir)).toThrow(/version/);
    writeFileSync(path, JSON.stringify({ version: 1, tokens: { s1: 5 } }), { mode: 0o600 });
    expect(() => readTokens(store.dataDir)).toThrow(TokenFileError);
  });
});

describe("the server list", () => {
  test("a pending row is listed and not counted; a confirmed one is", () => {
    const store = open();
    expect(listServers(store.db)).toEqual([]);
    expect(serversConfigured(store.db)).toBe(false);
    insertPending(store.db, serverFixture("s1"));
    const [row] = listServers(store.db);
    expect(row?.serverId).toBe("s1");
    expect(row?.confirmedAt).toBeNull();
    expect(row?.cursors).toEqual({ main: 0, mainAliases: [], extra: {} });
    expect(row?.stopped).toBeNull();
    expect(row?.snapshotDue).toBe(true);
    expect(row?.muted).toBe(false);
    expect(confirmedServers(store.db)).toEqual([]);
    expect(serversConfigured(store.db)).toBe(false);
    confirm(store, "s1");
    expect(confirmedServers(store.db).map((s) => s.serverId)).toEqual(["s1"]);
    expect(serversConfigured(store.db)).toBe(true);
    // A second add of a pending server replaces the row.
    insertPending(store.db, serverFixture("s2", { name: "Second" }));
    insertPending(store.db, serverFixture("s2", { name: "Second again" }));
    expect(serverById(store.db, "s2")?.name).toBe("Second again");
    expect(serverById(store.db, "nope")).toBeNull();
  });

  test("findServer by id, name and host, and an ambiguous reference refused with the ids", () => {
    const store = open();
    insertPending(store.db, serverFixture("s1", { name: "Acme", url: "https://team.acme.test" }));
    insertPending(store.db, serverFixture("s2", { name: "Beta", url: "https://beta.acme.test" }));
    expect(findServer(store.db, "s1")?.serverId).toBe("s1");
    expect(findServer(store.db, "Acme")?.serverId).toBe("s1");
    expect(findServer(store.db, "beta.acme.test")?.serverId).toBe("s2");
    expect(findServer(store.db, "nobody")).toBeNull();
    insertPending(store.db, serverFixture("s3", { name: "Acme", url: "https://other.acme.test" }));
    expect(() => findServer(store.db, "Acme")).toThrow(ServerRefAmbiguous);
    expect(() => findServer(store.db, "Acme")).toThrow(
      "`Acme` names two servers: s1, s3; use the id",
    );
    // A name equal to another server's host is ambiguous too; the id always wins.
    insertPending(store.db, serverFixture("s4", { name: "beta.acme.test" }));
    expect(() => findServer(store.db, "beta.acme.test")).toThrow(ServerRefAmbiguous);
    expect(findServer(store.db, "s4")?.serverId).toBe("s4");
  });

  test("replaceDevice, setStopped, setMuted, muteMember and deleteServerRows", () => {
    const store = open();
    insertPending(store.db, serverFixture("s1"));
    confirm(store, "s1");
    setStopped(store.db, "s1", "unauthorized");
    store.db.run("UPDATE sharing_servers SET snapshot_due = 0 WHERE server_id = 's1'");
    expect(serverById(store.db, "s1")?.stopped).toBe("unauthorized");
    replaceDevice(store.db, "s1", {
      deviceId: "dev-new",
      deviceAlias: "desk",
      memberId: "mem-1",
      memberName: "Ana",
      role: "admin",
      contract: 1,
      instance: "inst-2",
    });
    const row = serverById(store.db, "s1");
    expect(row?.deviceId).toBe("dev-new");
    expect(row?.role).toBe("admin");
    expect(row?.instance).toBe("inst-2");
    expect(row?.stopped).toBeNull();
    expect(row?.snapshotDue).toBe(true);
    expect(row?.confirmedAt).not.toBeNull();
    setMuted(store.db, "s1", true);
    expect(serverById(store.db, "s1")?.muted).toBe(true);
    muteMember(store.db, "s1", "mem-2", true);
    muteMember(store.db, "s1", "mem-3", true);
    muteMember(store.db, "s1", "mem-2", true);
    expect(mutedMembers(store.db, "s1")).toEqual(["mem-2", "mem-3"]);
    muteMember(store.db, "s1", "mem-3", false);
    expect(mutedMembers(store.db, "s1")).toEqual(["mem-2"]);
    deleteServerRows(store.db, "s1");
    expect(listServers(store.db)).toEqual([]);
    expect(mutedMembers(store.db, "s1")).toEqual([]);
  });

  test("a v1 store reads no server row and no report", () => {
    const store = open({ moduleSchemas: PART_FIVE });
    expect(listServers(store.db)).toEqual([]);
    expect(confirmedServers(store.db)).toEqual([]);
    expect(serversConfigured(store.db)).toBe(false);
    expect(findServer(store.db, "x")).toBeNull();
    expect(mutedMembers(store.db, "s1")).toEqual([]);
    expect(serverRows(store.db)).toEqual([]);
    expect(statusReport(store.db, store.dataDir)).toEqual([]);
  });
});

describe("the state rows", () => {
  test("a cursor save keeps the larger value, per cursor", () => {
    const store = open();
    insertPending(store.db, serverFixture("s1"));
    setCursor(store.ctx, "s1", "main", 10);
    setCursor(store.ctx, "s1", "main", 7);
    setCursor(store.ctx, "s1", { extra: "remote:github.com/a/b" }, 3);
    setCursor(store.ctx, "s1", { extra: "remote:github.com/a/b" }, 2);
    setCursor(store.ctx, "s1", { extra: "remote:github.com/a/c" }, 1);
    expect(cursorsOf(store.db, "s1")).toEqual({
      main: 10,
      mainAliases: [],
      extra: { "remote:github.com/a/b": 3, "remote:github.com/a/c": 1 },
    });
  });

  test("a guarded write refuses once the lease is not the context's", () => {
    const store = open();
    insertPending(store.db, serverFixture("s1"));
    const owner = `sync-${store.ctx.pid}-${store.ctx.version}`;
    store.ctx.lease = owner;
    expect(() => setCursor(store.ctx, "s1", "main", 1)).toThrow(LeaseLost);
    setMeta(store.db, SYNC_LEASE, JSON.stringify({ owner, until: store.clock.now + 60_000 }));
    setCursor(store.ctx, "s1", "main", 1);
    expect(cursorsOf(store.db, "s1").main).toBe(1);
    setMeta(
      store.db,
      SYNC_LEASE,
      JSON.stringify({ owner: "sync-1-9.9.9", until: store.clock.now + 60_000 }),
    );
    expect(() => updateState(store.ctx, "s1", { backlog: 3 })).toThrow(LeaseLost);
    expect(serverById(store.db, "s1")?.backlog).toBe(0);
  });

  test("recordAnswer: a success resets the breaker, failures double the interval up to ten minutes", () => {
    const store = open();
    insertPending(store.db, serverFixture("s1"));
    const at = store.clock.now;
    recordAnswer(store.ctx, "s1", { kind: "push", ok: true, at, requestId: "req-1" });
    let row = serverById(store.db, "s1");
    expect(row?.lastPushAt).toBe(at);
    expect(row?.lastPushOkAt).toBe(at);
    expect(row?.failures).toBe(0);
    expect(row?.retryAt).toBeNull();
    expect(row?.lastRequestId).toBe("req-1");
    const intervals: number[] = [];
    for (let i = 1; i <= 12; i++) {
      recordAnswer(store.ctx, "s1", {
        kind: "pull",
        ok: false,
        at,
        error: `boom ${TOKEN_A}`,
      });
      row = serverById(store.db, "s1");
      expect(row?.failures).toBe(i);
      intervals.push((row?.retryAt ?? 0) - at);
    }
    expect(row?.lastPullAt).toBe(at);
    expect(row?.lastPullOkAt).toBeNull();
    expect(row?.lastError).not.toContain(TOKEN_A);
    expect(row?.lastError).toContain("boom");
    expect(row?.lastErrorAt).toBe(at);
    // 2 s doubling, each with jitter of at most a fifth, capped at ten minutes.
    const base = [2, 4, 8, 16, 32, 64, 128, 256, 512, 600, 600, 600].map((s) => s * 1000);
    for (const [i, interval] of intervals.entries()) {
      const expected = base[i] ?? 0;
      expect(interval).toBeGreaterThanOrEqual(expected);
      expect(interval).toBeLessThanOrEqual(expected * 1.2);
    }
    // Retry-After is honoured as given and counts no failure.
    recordAnswer(store.ctx, "s1", {
      kind: "pull",
      ok: false,
      at,
      error: "rate limited",
      retryAfterMs: 7_000,
    });
    row = serverById(store.db, "s1");
    expect(row?.failures).toBe(12);
    expect(row?.retryAt).toBe(at + 7_000);
    recordAnswer(store.ctx, "s1", { kind: "pull", ok: true, at: at + 1 });
    row = serverById(store.db, "s1");
    expect(row?.failures).toBe(0);
    expect(row?.retryAt).toBeNull();
    expect(row?.lastError).toBeNull();
  });

  test("the status report: pending, token missing, ok, stopped with its remedy, held", () => {
    const store = open();
    const now = store.clock.now;
    insertPending(store.db, serverFixture("s1", { url: "https://one.example.com" }));
    insertPending(store.db, serverFixture("s2"));
    insertPending(store.db, serverFixture("s3"));
    insertPending(store.db, serverFixture("s4"));
    confirm(store, "s2");
    confirm(store, "s3");
    confirm(store, "s4");
    writeToken(store.ctx, "s3", TOKEN_A);
    writeToken(store.ctx, "s4", TOKEN_B);
    setStopped(store.db, "s4", "rejoin");
    setMeta(store.db, restoreHoldKey("s3"), JSON.stringify({ reason: "restore", at: now }));
    updateState(store.ctx, "s3", { backlog: 2, lastPullOkAt: now - 5 });
    const report = statusReport(store.db, store.dataDir);
    expect(report.map((s) => [s.serverId, s.state])).toEqual([
      ["s1", "pending"],
      ["s2", "token missing"],
      ["s3", "ok"],
      ["s4", "stopped"],
    ]);
    expect(report[0]).toMatchObject({
      name: "Team s1",
      host: "one.example.com",
      member: "Ana",
      role: "member",
    });
    expect(report[1]?.remedy).toBe("share server rejoin");
    expect(report[2]).toMatchObject({
      backlog: 2,
      lastPullOkAt: now - 5,
      hold: { reason: "restore", at: now },
    });
    expect(report[3]?.remedy).toContain("share server rejoin");
    expect(report[0]?.remedy).toBe("share server add again");
    expect(JSON.stringify(report)).not.toContain("wcm1_");
  });

  test("the sync's own state: not running, running, stopped by, start failed", () => {
    const store = open();
    const now = store.clock.now;
    expect(syncState(store.db, now)).toEqual({ kind: "not-running" });
    setMeta(
      store.db,
      SYNC_LEASE,
      JSON.stringify({ owner: `sync-${process.pid}-0.8.0`, until: now + 60_000 }),
    );
    expect(syncState(store.db, now)).toEqual({
      kind: "running",
      pid: process.pid,
      version: "0.8.0",
    });
    setMeta(store.db, "sync.stop", JSON.stringify({ who: "remove", at: now - 10 }));
    expect(syncState(store.db, now)).toEqual({
      kind: "stopping",
      who: "remove",
      at: now - 10,
      pid: process.pid,
      version: "0.8.0",
    });
    store.db.run("DELETE FROM meta WHERE key IN ('sync.lease')");
    expect(syncState(store.db, now)).toEqual({ kind: "stopped", who: "remove", at: now - 10 });
    store.db.run("DELETE FROM meta WHERE key IN ('sync.stop')");
    setMeta(
      store.db,
      "sync.last_failed_start",
      JSON.stringify({ at: now - 1000, reason: "token missing", failures: 2 }),
    );
    expect(syncState(store.db, now)).toEqual({
      kind: "start-failed",
      at: now - 1000,
      reason: "token missing",
      failures: 2,
      nextTryAt: now - 1000 + 10 * 60_000,
    });
    expect(getMeta(store.db, "sync.last_failed_start")).not.toBeNull();
  });
});
