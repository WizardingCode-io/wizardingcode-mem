// What status and doctor say of the sync (ADR 0027, AC-70): the process's state and one line
// per server, the dirty count, the pending rows, the conflicts and a held withdrawal among
// them; doctor's `sync` check, which warns and never asks the network; nothing of either on a
// store at sharing v1; and `share explain --server` with an item's ledger history.
import { afterAll, afterEach, describe, expect, spyOn, test } from "bun:test";
import { chmodSync, statSync } from "node:fs";
import { join } from "node:path";
import { type Check, type DoctorContext, runChecks } from "../../src/doctor/checks.ts";
import { KNOWLEDGE_MIGRATIONS, KNOWLEDGE_MODULE } from "../../src/modules/knowledge/migrations.ts";
import { SHARING_MIGRATIONS, SHARING_MODULE } from "../../src/sharing/migrations.ts";
import { setLevel } from "../../src/sharing/store.ts";
import { formatStatus, statusReport } from "../../src/status/report.ts";
import {
  clearSyncStop,
  dirtyKey,
  restoreHoldKey,
  SYNC_LEASE,
  SYNC_STOP,
  setMeta,
  writeFailedStart,
} from "../../src/store/meta.ts";
import { pullOnce } from "../../src/sync/inbound.ts";
import { writeConflict, writePendingRow } from "../../src/sync/ledger.ts";
import { sweep } from "../../src/sync/outbound.ts";
import {
  forgetToken,
  insertPending,
  setContract,
  setStopped,
  tokensPath,
  writeToken,
} from "../../src/sync/servers.ts";
import { clearName, flagName } from "../../src/sync/state.ts";
import { readStatus, renderStatus, type TeamStatus } from "../../src/team/status.ts";
import { runCliWith } from "../helpers/cli.ts";
import {
  cleanSyncDirs,
  openSyncStore,
  type SyncTestStore,
  serverFixture,
} from "../helpers/sync.ts";
import { cleanWorlds, closeWorlds, memory, NAME, world } from "../helpers/sync-world.ts";
import { entryPayload, memberOf, memoryPayload, push, sendOf } from "../helpers/team.ts";

const stores: SyncTestStore[] = [];
afterEach(async () => {
  for (const store of stores.splice(0)) store.close();
  await closeWorlds();
});
afterAll(() => {
  cleanSyncDirs();
  cleanWorlds();
});

const TOKEN = `wcm1_${"t".repeat(43)}`;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const V1_SCHEMAS = [
  { module: KNOWLEDGE_MODULE, migrations: KNOWLEDGE_MIGRATIONS.filter((m) => m.version <= 7) },
  { module: SHARING_MODULE, migrations: SHARING_MIGRATIONS.filter((m) => m.version <= 1) },
];

function open(options = {}): SyncTestStore {
  const store = openSyncStore(options);
  stores.push(store);
  return store;
}

/** A confirmed server with its token, named and placed as a real one would be. */
function listed(store: SyncTestStore, serverId = "s1", url = "https://team.acme.test"): void {
  insertPending(store.db, serverFixture(serverId, { url, name: "Acme team" }));
  store.db.run("UPDATE sharing_servers SET confirmed_at = ? WHERE server_id = ?", [
    store.clock.now,
    serverId,
  ]);
  writeToken(store.ctx, serverId, TOKEN);
}

const report = (store: SyncTestStore) =>
  statusReport(store.db, null, store.dataDir, { env: store.ctx.env, now: store.clock.now });
const lines = (store: SyncTestStore) => formatStatus(report(store)).split("\n");
const syncLine = (store: SyncTestStore) =>
  lines(store).find((line) => line.startsWith("sync ")) ?? "";
const serverLines = (store: SyncTestStore) =>
  lines(store).filter((line) => line.startsWith("server "));

function doctorContext(store: SyncTestStore): DoctorContext {
  const missing = (name: string) => join(store.dataDir, "nowhere", name);
  return {
    dataDir: store.dataDir,
    storeDir: store.dataDir,
    settingsPath: missing("settings.json"),
    codexHooksPath: missing("codex.json"),
    cursorHooksPath: missing("cursor.json"),
    geminiSettingsPath: missing("gemini.json"),
    opencodePluginPath: missing("opencode.ts"),
    qwenSettingsPath: missing("qwen.json"),
    droidSettingsPath: missing("droid.json"),
    copilotHooksPath: missing("copilot.json"),
    antigravityHooksPath: missing("antigravity.json"),
    claudeDesktopConfigPath: missing("claude_desktop_config.json"),
    which: () => null,
    now: store.clock.now,
    legacyVariables: [],
    env: store.ctx.env,
    gitVersion: () => [2, 40, 0],
  };
}

function syncCheck(store: SyncTestStore): Check {
  const found = runChecks(doctorContext(store)).find((check) => check.name === "sync");
  if (found === undefined) throw new Error("no sync check");
  return found;
}

describe("status", () => {
  test("the sync's state and one line per server, with the dirty count, the pending rows, the conflicts and a held withdrawal; --json carries no token", () => {
    const store = open();
    const { db, ctx } = store;
    listed(store);
    setMeta(db, dirtyKey("s1"), "2");
    writePendingRow(ctx, {
      serverId: "s1",
      seq: 7,
      uid: "shared:11111111-2222-4333-8444-555555555555",
      kind: "entry",
      payload: "{}",
      reason: "locked",
      tries: 10,
      at: store.clock.now,
    });
    writeConflict(ctx, "s1", "project:x", {
      at: store.clock.now,
      localText: "t",
      localVersion: 1,
      localHash: "h",
      serverRevision: 2,
      serverHash: "s",
      proposalId: null,
    });
    setMeta(
      db,
      restoreHoldKey("s1"),
      JSON.stringify({ reason: "bulk", at: store.clock.now, count: 3 }),
    );

    const idle = report(store);
    expect(idle.sync).toMatchObject({
      state: "idle",
      pid: null,
      stoppedBy: null,
      failedStart: null,
    });
    expect(idle.servers).toHaveLength(1);
    expect(idle.servers[0]).toMatchObject({
      id: "s1",
      name: "Acme team",
      host: "team.acme.test",
      state: "ok",
      remedy: null,
      cursor: 0,
      backlog: 0,
      dirty: 2,
      pending: 1,
      conflicts: 1,
      hold: { reason: "bulk", count: 3 },
    });
    expect(JSON.stringify(idle)).not.toContain(TOKEN);
    expect(syncLine(store)).toBe(
      "sync      not running; starts with the next session or sync --once",
    );
    const [line] = serverLines(store);
    expect(line).toContain("Acme team");
    expect(line).toContain("team.acme.test");
    expect(line).toContain(" ok ");
    expect(line).toContain("2 dirty");
    expect(line).toContain("1 pending");
    expect(line).toContain("1 conflict");
    expect(line).toContain("held: bulk (3)");

    // Running, stopping, stopped, failed: from the lease, the flag and the mark.
    setMeta(
      db,
      SYNC_LEASE,
      JSON.stringify({ owner: `sync-${process.pid}-0.8.0`, until: store.clock.now + MINUTE }),
    );
    expect(report(store).sync).toMatchObject({ state: "running", pid: process.pid });
    expect(syncLine(store)).toContain(`running (pid ${process.pid})`);
    setMeta(db, SYNC_STOP, JSON.stringify({ who: "restore", at: store.clock.now }));
    expect(report(store).sync).toMatchObject({
      state: "running",
      pid: process.pid,
      stoppedBy: "restore",
    });
    expect(syncLine(store)).toContain("stopping");
    db.run("DELETE FROM meta WHERE key = ?", [SYNC_LEASE]);
    expect(report(store).sync).toMatchObject({ state: "stopped", pid: null, stoppedBy: "restore" });
    expect(syncLine(store)).toContain("stopped by restore");
    clearSyncStop(db);
    writeFailedStart(db, store.clock.now - MINUTE, "token missing for s1");
    expect(report(store).sync).toMatchObject({
      state: "failed",
      failedStart: { at: store.clock.now - MINUTE, reason: "token missing for s1" },
    });
    expect(syncLine(store)).toContain("start failed: token missing for s1");
    expect(syncLine(store)).toContain("next try");
    // A lease whose process is gone is said as such.
    db.run("DELETE FROM meta WHERE key = ?", ["sync.last_failed_start"]);
    setMeta(
      db,
      SYNC_LEASE,
      JSON.stringify({ owner: "sync-999999-0.8.0", until: store.clock.now + MINUTE }),
    );
    expect(syncLine(store)).toContain("gone");

    // The other server states: pending, token missing, stopped with its remedy.
    insertPending(db, serverFixture("s2", { url: "https://two.acme.test", name: "Two" }));
    forgetToken(ctx, "s1");
    expect(report(store).servers.map((s) => [s.id, s.state])).toEqual([
      ["s1", "token missing"],
      ["s2", "pending"],
    ]);
    expect(serverLines(store)[0]).toContain("token missing");
    expect(serverLines(store)[1]).toContain("pending");
    writeToken(ctx, "s1", TOKEN);
    setStopped(db, "s1", "rejoin");
    expect(report(store).servers[0]).toMatchObject({
      state: "stopped",
      remedy: expect.stringContaining("rejoin"),
    });
    expect(serverLines(store)[0]).toContain("stopped");
    expect(serverLines(store)[0]).toContain("rejoin");
  });

  test("a store at sharing v1 has no sync line and no server line", () => {
    const store = open({ moduleSchemas: V1_SCHEMAS });
    const v1 = report(store);
    expect(v1.sync).toBeNull();
    expect(v1.servers).toEqual([]);
    expect(syncLine(store)).toBe("");
    expect(serverLines(store)).toEqual([]);
    expect(syncCheck(store).status).not.toBe("warn");
    expect(syncCheck(store).status).not.toBe("fail");
  });
});

describe("doctor sync", () => {
  test("warns for each condition the spec names, asks the network nothing, and is ok when all is clear", () => {
    const store = open();
    const { db, ctx } = store;
    const fetchSpy = spyOn(globalThis, "fetch");
    try {
      expect(syncCheck(store)).toMatchObject({ status: "ok", detail: "no team server listed" });
      listed(store);
      expect(syncCheck(store)).toMatchObject({ status: "ok" });
      expect(syncCheck(store).detail).toContain("1 server");

      const warn = (what: string) => {
        const check = syncCheck(store);
        expect({ what, status: check.status }).toEqual({ what, status: "warn" });
        expect(check.detail).toContain(what);
      };
      // The token file's mode.
      chmodSync(tokensPath(store.dataDir), 0o644);
      warn("mode 0644");
      chmodSync(tokensPath(store.dataDir), 0o600);
      expect((statSync(tokensPath(store.dataDir)).mode & 0o777).toString(8)).toBe("600");
      // An orphan token, a confirmed row with no token.
      writeToken(ctx, "gone", TOKEN);
      warn("token for no listed server (gone)");
      forgetToken(ctx, "gone");
      forgetToken(ctx, "s1");
      warn("token missing");
      writeToken(ctx, "s1", TOKEN);
      // A non-https URL.
      db.run("UPDATE sharing_servers SET url = 'http://team.acme.test' WHERE server_id = 's1'");
      warn("is not https");
      db.run("UPDATE sharing_servers SET url = 'https://team.acme.test' WHERE server_id = 's1'");
      // A stopped server, with its remedy.
      setStopped(db, "s1", "disabled");
      warn("stopped (disabled)");
      setStopped(db, "s1", null);
      // A dead lease holder, a stale stop flag, a failed start.
      setMeta(
        db,
        SYNC_LEASE,
        JSON.stringify({ owner: "sync-999999-0.8.0", until: store.clock.now + MINUTE }),
      );
      warn("pid 999999, which is gone");
      db.run("DELETE FROM meta WHERE key = ?", [SYNC_LEASE]);
      setMeta(db, SYNC_STOP, JSON.stringify({ who: "remove", at: store.clock.now - 11 * MINUTE }));
      warn("stop flag older than ten minutes");
      clearSyncStop(db);
      writeFailedStart(db, store.clock.now - MINUTE, "token missing for s1");
      warn("last start failed: token missing for s1");
      db.run("DELETE FROM meta WHERE key = ?", ["sync.last_failed_start"]);
      // No success in 24 h while sessions ran.
      db.run(
        "INSERT INTO hook_runs (at, agent, event, ms, outcome) VALUES (?, 'claude-code', 'prompt', 3, 'ok')",
        [store.clock.now - HOUR],
      );
      warn("no successful push or pull in 24 h");
      db.run("UPDATE sharing_servers SET last_pull_ok_at = ? WHERE server_id = 's1'", [
        store.clock.now - HOUR,
      ]);
      expect(syncCheck(store).status).toBe("ok");
      // Open conflicts, pending rows, a held withdrawal.
      writeConflict(ctx, "s1", "project:x", {
        at: store.clock.now,
        localText: "t",
        localVersion: 1,
        localHash: "h",
        serverRevision: 2,
        serverHash: "s",
        proposalId: null,
      });
      warn("1 open conflict");
      db.run("DELETE FROM sharing_conflicts");
      writePendingRow(ctx, {
        serverId: "s1",
        seq: 7,
        uid: "shared:11111111-2222-4333-8444-555555555555",
        kind: "entry",
        payload: "{}",
        reason: "locked",
        tries: 10,
        at: store.clock.now,
      });
      warn("1 row set aside");
      db.run("DELETE FROM sharing_pending_rows");
      setMeta(
        db,
        restoreHoldKey("s1"),
        JSON.stringify({ reason: "restore", at: store.clock.now, count: 4 }),
      );
      warn("4 withdrawals held (restore)");
      db.run("DELETE FROM meta WHERE key = ?", [restoreHoldKey("s1")]);
      expect(syncCheck(store).status).toBe("ok");
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

describe("share explain --server", () => {
  test("prints the ruling and the item's ledger history", async () => {
    const w = await world("all");
    const id = memory(w, "The ledger remembers");
    expect(await sweep(w.store.ctx, w.server(), { full: true })).toMatchObject({ sent: 1 });
    const out = await runCliWith(
      {
        env: {
          PATH: process.env.PATH ?? "",
          HOME: w.store.dataDir,
          WIZARDINGCODE_HOME: w.store.dataDir,
          WIZARDINGCODE_MEM_DATA_DIR: w.store.dataDir,
          WIZARDINGCODE_MEM_MIGRATE: "off",
          WIZARDINGCODE_MEM_DISTILL: "off",
          WIZARDINGCODE_MEM_UI_AUTO_OPEN: "off",
          WIZARDINGCODE_MEM_UI_BROWSER: "none",
          WIZARDINGCODE_MEM_SYNC: "off",
        },
        cwd: w.store.dataDir,
      },
      "share",
      "explain",
      "memory",
      String(id),
      "--server",
      w.serverId,
    );
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toContain(`memory ${id}: keep · already-sent`);
    expect(out.stdout).toContain("ledger: sent · revision 1");
    expect(out.stdout).not.toContain(w.token);
  });
});

describe("status and doctor with a shared name (ADR 0028)", () => {
  test("one name line per bound name with the received counts, the members and the state; contract 1 and names held; --json; doctor's warnings; serve status", async () => {
    const w = await world("all", { named: true });
    const bob = await memberOf(w.t, w.token, "Bob", "desk");
    const rui = await memberOf(w.t, w.token, "Rui", "phone");
    const entry = entryPayload({
      scope: "project",
      remoteAlias: NAME,
      slug: "brand-voice",
      title: "Brand voice",
      area: "sales",
    });
    const mem = memoryPayload({ remoteAlias: NAME, title: "Rui on the brand" });
    expect((await push(w.t.server, bob.token, [sendOf(entry)])).status).toBe(200);
    expect((await push(w.t.server, rui.token, [sendOf(mem)])).status).toBe(200);
    expect(await pullOnce(w.store.ctx, w.server(), { wait: false })).toMatchObject({ ok: true });

    const full = () =>
      statusReport(w.store.db, null, w.store.dataDir, {
        env: w.store.ctx.env,
        now: w.store.clock.now,
      });
    const lines = () => formatStatus(full()).split("\n");
    const nameLine = () => lines().find((line) => line.startsWith("  name ")) ?? "";
    const serverLine = () => lines().find((line) => line.startsWith("server ")) ?? "";
    const check = () => {
      const found = runChecks(doctorContext(w.store)).find((c) => c.name === "sync");
      if (found === undefined) throw new Error("no sync check");
      return found;
    };
    expect(nameLine()).toBe(
      "  name wizardingcode · 1 entry, 1 memory received · 2 members · last 0 s ago",
    );
    expect(serverLine()).not.toContain("contract");
    expect(serverLine()).not.toContain("names held");
    expect(full().servers[0]).toMatchObject({
      contract: 2,
      namesHeld: false,
      names: [
        {
          alias: NAME,
          slug: "wizardingcode",
          entries: 1,
          memories: 1,
          members: 2,
          lastAt: w.store.clock.now,
          state: "ok",
        },
      ],
    });
    expect(check().status).toBe("ok");

    // The three flags, each read out and warned about once.
    flagName(w.store.ctx, w.serverId, NAME, "missing");
    expect(nameLine()).toContain(" · missing");
    expect(full().servers[0]?.names[0]?.state).toBe("missing");
    expect(check().status).toBe("warn");
    expect(check().detail).toContain("the server does not hold `wizardingcode`");
    clearName(w.store.ctx, w.serverId, NAME);
    flagName(w.store.ctx, w.serverId, NAME, "recreated", {
      id: "0123456789abcdef",
      member: { id: bob.memberId, name: "Bob" },
    });
    expect(nameLine()).toContain(" · re-created on the server by Bob");
    expect(check().detail).toContain("`wizardingcode` re-created on the server by Bob");
    clearName(w.store.ctx, w.serverId, NAME);
    flagName(w.store.ctx, w.serverId, NAME, "purged");
    expect(nameLine()).toContain(" · removed by the operator");
    expect(check().detail).toContain("the operator removed `wizardingcode`");
    expect(check().detail.split("wizardingcode").length).toBe(2);
    clearName(w.store.ctx, w.serverId, NAME);
    expect(check().status).toBe("ok");

    // The server at contract 1: the server line says so, and the names are held.
    setContract(w.store.db, w.serverId, 1);
    expect(serverLine()).toContain("contract 1");
    expect(serverLine()).toContain("names held (server at contract 1)");
    expect(full().servers[0]).toMatchObject({ contract: 1, namesHeld: true });
    expect(check().status).toBe("warn");
    expect(check().detail).toContain("names held: the server ");
    expect(check().detail).toContain("speaks contract 1; upgrade it (the runbook)");
    expect(check().detail.split("names held").length).toBe(2);
    // With no bound name a row at 1 holds nothing.
    expect(
      setLevel(w.store.db, {
        projectId: 2,
        destination: w.serverId,
        level: "local",
        source: "cli",
        now: w.store.clock.now,
        confirm: true,
      }).ok,
    ).toBe(true);
    expect(serverLine()).toContain("contract 1");
    expect(serverLine()).not.toContain("names held");
    expect(lines().some((line) => line.startsWith("  name "))).toBe(false);
    expect(check().status).toBe("ok");
    setContract(w.store.db, w.serverId, 2);
    expect(serverLine()).not.toContain("contract");

    // The team server's own status counts the live registry.
    expect(renderStatus(readStatus(w.t.dir, w.store.clock.now) as TeamStatus)).toContain(
      "names: 1\n",
    );
    expect(JSON.stringify(full())).not.toContain(w.token);
  });
});
