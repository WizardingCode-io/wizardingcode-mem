// The sync process (ADR 0027): the lease and its renewals, the take-over, the tick, the idle
// exit, the stop flag, the spawn from the hooks and the exit codes.
import { Database } from "bun:sqlite";
import { afterAll, afterEach, describe, expect, spyOn, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ADAPTERS } from "../../src/adapters/index.ts";
import type { AgentAdapter, HookInput } from "../../src/adapters/types.ts";
import type { AgentId, HookEvent } from "../../src/core/types.ts";
import { handleHook } from "../../src/hooks/handle.ts";
import { personAuthor } from "../../src/modules/knowledge/author.ts";
import { openRepo } from "../../src/modules/knowledge/repo.ts";
import { withWrite } from "../../src/store/db.ts";
import {
  claimLease,
  clearSyncStop,
  getMeta,
  leaseActive,
  liveLease,
  readFailedStart,
  SYNC_LAST_FAILED_START,
  SYNC_LEASE,
  SYNC_STOP,
  setMeta,
  writeFailedStart,
} from "../../src/store/meta.ts";
import { leaseOwnerOf, type SyncContext } from "../../src/sync/context.ts";
import { logError } from "../../src/sync/log.ts";
import { sweep } from "../../src/sync/outbound.ts";
import { type RunHooks, runSync } from "../../src/sync/run.ts";
import { insertPending, serverById, writeToken } from "../../src/sync/servers.ts";
import { startSync } from "../../src/sync/spawn.ts";
import { cursorsOf, setCursor } from "../../src/sync/state.ts";
import { commitEntryFiles } from "../helpers/knowledge.ts";
import {
  cleanSyncDirs,
  openSyncStore,
  type SyncTestStore,
  serverFixture,
  settle,
  spawnCli,
} from "../helpers/sync.ts";
import { cleanWorlds, closeWorlds, memory, taxonomy, world } from "../helpers/sync-world.ts";

const TOKEN = `wcm1_${"t".repeat(43)}`;
const MINUTE = 60_000;

const stores: SyncTestStore[] = [];
const open = (options = {}) => {
  const store = openSyncStore(options);
  stores.push(store);
  return store;
};
const children: ReturnType<typeof spawnCli>[] = [];
afterEach(async () => {
  for (const child of children.splice(0)) {
    child.kill("SIGKILL");
    await child.exited.catch(() => undefined);
  }
  for (const store of stores.splice(0)) store.close();
  await closeWorlds();
});
afterAll(() => {
  cleanSyncDirs();
  cleanWorlds();
});

/** A confirmed server with its token: what a loop needs to run. */
function confirmedServer(store: SyncTestStore, serverId = "s1"): void {
  insertPending(store.db, serverFixture(serverId));
  store.db.run("UPDATE sharing_servers SET confirmed_at = ? WHERE server_id = ?", [
    store.clock.now,
    serverId,
  ]);
  writeToken(store.ctx, serverId, TOKEN);
}

/** The hooks a test counts; every one is a quick no-op unless the test gives its own. */
function counting(overrides: Partial<RunHooks> = {}) {
  const calls = { sweeps: [] as string[], pulls: 0, starts: 0 };
  const hooks: RunHooks = {
    startSteps: async () => {
      calls.starts++;
    },
    sweep: async (_ctx, server, mode) => {
      calls.sweeps.push(`${server.serverId}:${mode}`);
    },
    pullOnce: async () => {
      calls.pulls++;
      return { ok: true, held: false };
    },
    ...overrides,
  };
  return { calls, hooks };
}

/** A pull the server holds for `ms`, ended early by the stop's signal, as a fetch would be. */
function held(ctx: SyncContext, ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    // As a fetch with an aborted signal: over at once, whatever the clock does later.
    if (signal.aborted) return resolve();
    const timer = ctx.timers.setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      ctx.timers.clearTimeout(timer);
      resolve();
    });
  });
}

/** Moves the fake clock and lets every promise the timers woke run. */
async function advance(store: SyncTestStore, ms: number): Promise<void> {
  store.clock.advance(ms);
  await settle();
}

const until = (store: SyncTestStore) => liveLease(store.db, SYNC_LEASE, store.clock.now)?.until;

describe("the lease", () => {
  test("is claimed with the versioned owner, renewed within 20 s, also across a 25 s held pull", async () => {
    const store = open({ version: "0.8.0" });
    confirmedServer(store);
    const { hooks } = counting({
      pullOnce: async (ctx, _server, { signal }) => {
        // A pull the server holds for 25 s: the renewal fires meanwhile.
        await held(ctx, 25_000, signal);
        return { ok: true, held: true };
      },
    });
    const run = runSync(store.ctx, { once: false, hooks, viewerLive: async () => false });
    await settle();
    const owner = leaseOwnerOf(store.ctx);
    expect(owner).toBe(`sync-${process.pid}-0.8.0`);
    expect(liveLease(store.db, SYNC_LEASE, store.clock.now)?.owner).toBe(owner);
    const first = until(store);
    await advance(store, 20_000);
    expect(until(store)).toBe((first ?? 0) + 20_000);
    await advance(store, 20_000);
    expect(until(store)).toBe((first ?? 0) + 40_000);
    expect(leaseActive(store.db, SYNC_LEASE, store.clock.now)).toBe(true);
    setMeta(store.db, SYNC_STOP, JSON.stringify({ who: "test", at: store.clock.now }));
    await advance(store, 5_000);
    expect(await run).toBe(0);
    expect(liveLease(store.db, SYNC_LEASE, store.clock.now)).toBeNull();
    clearSyncStop(store.db);
  });

  test("a newer version takes over an older holder's lease, which writes nothing more and exits 1", async () => {
    const older = open({ version: "0.7.0" });
    confirmedServer(older);
    // A second context over the same store, as a newer binary.
    const newer = open({ version: "0.8.0", clock: older.clock, timers: older.timers });
    newer.db.close();
    newer.ctx.db = older.db;
    newer.ctx.dataDir = older.dataDir;
    const written: number[] = [];
    const olderHooks = counting({
      pullOnce: async (ctx, server, { signal }) => {
        await held(ctx, 25_000, signal);
        // The page's cursor: refused once the lease is gone.
        setCursor(ctx, server.serverId, "main", 5);
        written.push(5);
        return { ok: true, held: true };
      },
    });
    const olderRun = runSync(older.ctx, {
      once: false,
      hooks: olderHooks.hooks,
      viewerLive: async () => false,
    });
    await settle();
    expect(liveLease(older.db, SYNC_LEASE, older.clock.now)?.owner).toBe(
      `sync-${process.pid}-0.7.0`,
    );
    await advance(older, 10_000);
    const newerRun = runSync(newer.ctx, {
      once: false,
      hooks: counting().hooks,
      viewerLive: async () => false,
    });
    await settle();
    expect(liveLease(older.db, SYNC_LEASE, older.clock.now)?.owner).toBe(
      `sync-${process.pid}-0.8.0`,
    );
    // The older holder's page ends at 25 s: its write is refused, it exits 1, the cursor stays.
    await advance(older, 20_000);
    expect(await olderRun).toBe(1);
    expect(written).toEqual([]);
    expect(cursorsOf(older.db, "s1").main).toBe(0);
    expect(liveLease(older.db, SYNC_LEASE, older.clock.now)?.owner).toBe(
      `sync-${process.pid}-0.8.0`,
    );
    setMeta(older.db, SYNC_STOP, JSON.stringify({ who: "test", at: older.clock.now }));
    await advance(older, 5_000);
    expect(await newerRun).toBe(0);
    clearSyncStop(older.db);
  });

  test("a lease expired across a sleep is taken by the wake's start; the old holder exits without a write", async () => {
    const store = open({ version: "0.8.0" });
    confirmedServer(store);
    const written: number[] = [];
    const { hooks } = counting({
      pullOnce: async (ctx, server, { signal }) => {
        await held(ctx, 25_000, signal);
        setCursor(ctx, server.serverId, "main", 7);
        written.push(7);
        return { ok: true, held: true };
      },
    });
    const run = runSync(store.ctx, { once: false, hooks, viewerLive: async () => false });
    await settle();
    // The laptop sleeps 90 s: no timer fires, the lease expires with the pid alive.
    store.clock.now += 90_000;
    expect(leaseActive(store.db, SYNC_LEASE, store.clock.now)).toBe(false);
    // A live process the wake could be: a lease counts only while its owner is alive.
    const wake = `sync-${process.ppid}-0.8.0`;
    expect(claimLease(store.db, SYNC_LEASE, wake, store.clock.now, 60_000)).toBe(true);
    await advance(store, 1);
    expect(await run).toBe(1);
    expect(written).toEqual([]);
    expect(liveLease(store.db, SYNC_LEASE, store.clock.now)?.owner).toBe(wake);
  });

  test("a second --auto while the lease is live exits 0 at once; --once is refused with 2", async () => {
    const store = open({ version: "0.8.0" });
    confirmedServer(store);
    const owner = `sync-${process.pid}-0.8.0`;
    setMeta(store.db, SYNC_LEASE, JSON.stringify({ owner, until: store.clock.now + 60_000 }));
    const second = open({
      version: "0.8.0",
      pid: process.pid,
      clock: store.clock,
      timers: store.timers,
    });
    second.db.close();
    second.ctx.db = store.db;
    second.ctx.dataDir = store.dataDir;
    second.ctx.pid = process.pid + 2;
    expect(await runSync(second.ctx, { once: false, hooks: counting().hooks })).toBe(0);
    expect(liveLease(store.db, SYNC_LEASE, store.clock.now)?.owner).toBe(owner);
    expect(await runSync(second.ctx, { once: true, hooks: counting().hooks })).toBe(2);
    expect(second.lines.join("\n")).toContain("sync is running");
  });
});

describe("the loop", () => {
  test("an idle sync makes no sweep between the sixty-second marks; a change is swept at the next tick; a burst is one sweep per five seconds", async () => {
    const store = open();
    confirmedServer(store, "s1");
    confirmedServer(store, "s2");
    const { calls, hooks } = counting();
    const run = runSync(store.ctx, { once: false, hooks, viewerLive: async () => false });
    await settle();
    expect(calls.starts).toBe(1);
    await advance(store, 59_000);
    expect(calls.sweeps).toEqual([]);
    await advance(store, 1_000);
    expect(calls.sweeps).toEqual(["s1:full", "s2:full"]);
    calls.sweeps.length = 0;
    // Another connection commits: the next tick sweeps the change.
    const other = new Database(join(store.dataDir, "wizardingcode-mem.db"));
    const commit = () =>
      other.run(
        "INSERT INTO hook_runs (at, agent, event, ms, outcome) VALUES (?, 'a', 'e', 1, 'ok')",
        [store.clock.now],
      );
    commit();
    await advance(store, 2_000);
    expect(calls.sweeps).toEqual(["s1:tick", "s2:tick"]);
    calls.sweeps.length = 0;
    // A burst over eight seconds: one sweep at the first tick five seconds after the last ended.
    commit();
    await advance(store, 2_000);
    commit();
    await advance(store, 2_000);
    commit();
    await advance(store, 2_000);
    commit();
    await advance(store, 2_000);
    expect(calls.sweeps).toEqual(["s1:tick", "s2:tick"]);
    calls.sweeps.length = 0;
    await advance(store, 6_000);
    expect(calls.sweeps).toEqual(["s1:tick", "s2:tick"]);
    other.close();
    setMeta(store.db, SYNC_STOP, JSON.stringify({ who: "test", at: store.clock.now }));
    await advance(store, 5_000);
    expect(await run).toBe(0);
  });

  test("exits within a minute once fifteen minutes pass with no hook run, no viewer and no backlog; not with a viewer or a backlog", async () => {
    const quiet = open();
    confirmedServer(quiet);
    const run = runSync(quiet.ctx, {
      once: false,
      hooks: counting().hooks,
      viewerLive: async () => false,
    });
    await settle();
    await advance(quiet, 14 * MINUTE);
    expect(liveLease(quiet.db, SYNC_LEASE, quiet.clock.now)).not.toBeNull();
    await advance(quiet, 2 * MINUTE);
    expect(await run).toBe(0);
    expect(liveLease(quiet.db, SYNC_LEASE, quiet.clock.now)).toBeNull();

    const viewed = open();
    confirmedServer(viewed);
    let live = true;
    const viewedRun = runSync(viewed.ctx, {
      once: false,
      hooks: counting().hooks,
      viewerLive: async () => live,
    });
    await settle();
    await advance(viewed, 17 * MINUTE);
    expect(liveLease(viewed.db, SYNC_LEASE, viewed.clock.now)).not.toBeNull();
    live = false;
    await advance(viewed, 2 * MINUTE);
    expect(await viewedRun).toBe(0);

    const busy = open();
    confirmedServer(busy);
    busy.db.run("UPDATE sharing_servers SET backlog = 3 WHERE server_id = 's1'");
    const busyRun = runSync(busy.ctx, {
      once: false,
      hooks: counting().hooks,
      viewerLive: async () => false,
    });
    await settle();
    await advance(busy, 17 * MINUTE);
    expect(liveLease(busy.db, SYNC_LEASE, busy.clock.now)).not.toBeNull();
    // A hook run keeps it alive too.
    busy.db.run("UPDATE sharing_servers SET backlog = 0 WHERE server_id = 's1'");
    busy.db.run(
      "INSERT INTO hook_runs (at, agent, event, ms, outcome) VALUES (?, 'a', 'e', 1, 'ok')",
      [busy.clock.now],
    );
    await advance(busy, 10 * MINUTE);
    expect(liveLease(busy.db, SYNC_LEASE, busy.clock.now)).not.toBeNull();
    await advance(busy, 7 * MINUTE);
    expect(await busyRun).toBe(0);
  });

  test("a server confirmed while the sync runs gets its pull loop at the next tick that sees the change; one held pull per server", async () => {
    const store = open();
    confirmedServer(store, "s1");
    const inFlight = new Map<string, number>();
    let mostInFlight = 0;
    const pulled: string[] = [];
    const { hooks } = counting({
      pullOnce: async (ctx, server, options) => {
        pulled.push(server.serverId);
        const n = (inFlight.get(server.serverId) ?? 0) + 1;
        inFlight.set(server.serverId, n);
        mostInFlight = Math.max(mostInFlight, n);
        await held(ctx, 25_000, options.signal);
        inFlight.set(server.serverId, n - 1);
        return { ok: true, held: true };
      },
    });
    const run = runSync(store.ctx, { once: false, hooks, viewerLive: async () => false });
    await settle();
    await advance(store, 30_000);
    expect(new Set(pulled)).toEqual(new Set(["s1"]));
    // `share server add` confirms a second server from another process: its row and token,
    // and a commit the tick sees as a change.
    confirmedServer(store, "s2");
    const other = new Database(join(store.dataDir, "wizardingcode-mem.db"));
    other.run(
      "INSERT INTO hook_runs (at, agent, event, ms, outcome) VALUES (?, 'a', 'e', 1, 'ok')",
      [store.clock.now],
    );
    other.close();
    await advance(store, 2_000);
    await advance(store, 2_000);
    expect(pulled).toContain("s2");
    await advance(store, 60_000);
    expect(mostInFlight).toBe(1);
    expect(pulled.filter((id) => id === "s2").length).toBeGreaterThanOrEqual(2);
    setMeta(store.db, SYNC_STOP, JSON.stringify({ who: "test", at: store.clock.now }));
    await advance(store, 5_000);
    expect(await run).toBe(0);
  });

  test("a failed start writes the mark and exits 3; a start that reaches the loop clears it", async () => {
    const store = open();
    insertPending(store.db, serverFixture("s1"));
    store.db.run("UPDATE sharing_servers SET confirmed_at = 1 WHERE server_id = 's1'");
    // A confirmed row with no token.
    expect(await runSync(store.ctx, { once: false, hooks: counting().hooks })).toBe(3);
    const mark = readFailedStart(store.db);
    expect(mark?.reason).toContain("token missing");
    expect(mark?.failures).toBe(1);
    expect(liveLease(store.db, SYNC_LEASE, store.clock.now)).toBeNull();
    expect(await runSync(store.ctx, { once: false, hooks: counting().hooks })).toBe(3);
    expect(readFailedStart(store.db)?.failures).toBe(2);
    writeToken(store.ctx, "s1", TOKEN);
    const run = runSync(store.ctx, {
      once: false,
      hooks: counting().hooks,
      viewerLive: async () => false,
    });
    await settle();
    expect(getMeta(store.db, SYNC_LAST_FAILED_START)).toBeNull();
    setMeta(store.db, SYNC_STOP, JSON.stringify({ who: "test", at: store.clock.now }));
    await advance(store, 5_000);
    expect(await run).toBe(0);
  });

  test("--once runs the start's steps, one full sweep and one pull per server, and exits 1 with a stopped server or a failed batch", async () => {
    const store = open();
    expect(await runSync(store.ctx, { once: true, hooks: counting().hooks })).toBe(0);
    confirmedServer(store, "s1");
    confirmedServer(store, "s2");
    const { calls, hooks } = counting();
    expect(await runSync(store.ctx, { once: true, hooks })).toBe(0);
    expect(calls.starts).toBe(1);
    expect(calls.sweeps).toEqual(["s1:full", "s2:full"]);
    expect(calls.pulls).toBe(2);
    expect(liveLease(store.db, SYNC_LEASE, store.clock.now)).toBeNull();
    store.db.run("UPDATE sharing_servers SET stopped = 'rejoin' WHERE server_id = 's2'");
    expect(await runSync(store.ctx, { once: true, hooks: counting().hooks })).toBe(1);
    store.db.run("UPDATE sharing_servers SET stopped = NULL WHERE server_id = 's2'");
    let pulls = 0;
    const failing = counting({
      pullOnce: async (_ctx, server) => {
        pulls++;
        return { ok: server.serverId !== "s2", held: false };
      },
    });
    expect(await runSync(store.ctx, { once: true, hooks: failing.hooks })).toBe(1);
    // A failure in one server never stops another.
    expect(pulls).toBe(2);
  });
});

describe("the log", () => {
  test("one line per distinct message per server and operation, with no token, code or payload", () => {
    const store = open();
    const code = `wci1_${"A".repeat(26)}`;
    const boom = (text: string) => new Error(text);
    logError(store.ctx, "s1", "pull", boom(`refused ${TOKEN} with ${code}`));
    logError(store.ctx, "s1", "pull", boom(`refused ${TOKEN} with ${code}`));
    logError(store.ctx, "s1", "pull", boom(`refused ${TOKEN} with ${code}`));
    logError(store.ctx, "s1", "push", boom("other"));
    logError(store.ctx, "s2", "pull", boom(`refused ${TOKEN} with ${code}`));
    expect(store.lines).toHaveLength(3);
    expect(store.lines[0]).toContain("sync.s1.pull");
    expect(store.lines[1]).toContain("sync.s1.push");
    expect(store.lines[2]).toContain("sync.s2.pull");
    logError(store.ctx, "s1", "pull", boom("changed"));
    expect(store.lines).toHaveLength(4);
    expect(store.lines[3]).toContain("after 3 of the previous");
    const all = store.lines.join("\n");
    expect(all).not.toContain(TOKEN);
    expect(all).not.toContain(code);
    const file = readFileSync(join(store.dataDir, "logs", "wizardingcode-mem.log"), "utf8");
    expect(file.split("\n").filter((line) => line.includes("sync.")).length).toBe(4);
    expect(file).not.toContain(TOKEN);
    expect(file).not.toContain(code);
  });
});

describe("the spawn from the hooks", () => {
  test("spawns when a confirmed server is listed, no lease is live, no flag is set and no young mark exists; not otherwise", () => {
    const store = open();
    const spawned: string[][] = [];
    const spawn = (...args: string[]) => {
      spawned.push(args);
    };
    const start = (env = {}) => startSync(store.db, env, store.clock.now, spawn);
    expect(start()).toBe("no-server");
    insertPending(store.db, serverFixture("s1"));
    expect(start()).toBe("no-server");
    store.db.run("UPDATE sharing_servers SET confirmed_at = 1 WHERE server_id = 's1'");
    expect(start()).toBe("spawned");
    expect(spawned).toEqual([["sync", "--auto"]]);
    expect(start({ WIZARDINGCODE_MEM_SYNC: "off" })).toBe("off");
    // A live lease of this process.
    setMeta(
      store.db,
      SYNC_LEASE,
      JSON.stringify({ owner: `sync-${process.pid}-0.8.0`, until: store.clock.now + 60_000 }),
    );
    expect(start()).toBe("running");
    // A dead holder's lease is no lease.
    setMeta(
      store.db,
      SYNC_LEASE,
      JSON.stringify({ owner: "sync-2000000-0.8.0", until: store.clock.now + 60_000 }),
    );
    expect(start()).toBe("spawned");
    store.db.run("DELETE FROM meta WHERE key = ?", [SYNC_LEASE]);
    setMeta(store.db, SYNC_STOP, JSON.stringify({ who: "remove", at: store.clock.now }));
    expect(start()).toBe("stopped");
    // A stale flag is cleared and the sync spawned.
    setMeta(
      store.db,
      SYNC_STOP,
      JSON.stringify({ who: "remove", at: store.clock.now - 11 * MINUTE }),
    );
    expect(start()).toBe("spawned");
    expect(getMeta(store.db, SYNC_STOP)).toBeNull();
    writeFailedStart(store.db, store.clock.now - MINUTE, "token missing");
    expect(start()).toBe("backoff");
    store.clock.now += 5 * MINUTE;
    expect(start()).toBe("spawned");
    writeFailedStart(store.db, store.clock.now, "again");
    expect(readFailedStart(store.db)?.failures).toBe(2);
    store.clock.now += 6 * MINUTE;
    expect(start()).toBe("backoff");
    store.clock.now += 5 * MINUTE;
    expect(start()).toBe("spawned");
    // A stopped server is no server.
    store.db.run("UPDATE sharing_servers SET stopped = 'disabled' WHERE server_id = 's1'");
    expect(start()).toBe("no-server");
    expect(spawned).toHaveLength(5);
  });

  test("nothing on a store without the sharing schema, and any error fails open", () => {
    const bare = open({ moduleSchemas: [] });
    const spawned: string[][] = [];
    const spawn = (...args: string[]) => {
      spawned.push(args);
    };
    expect(startSync(bare.db, {}, bare.clock.now, spawn)).toBe("no-schema");
    bare.db.close();
    // The schema's absence is remembered per connection: a closed one still answers no-schema.
    expect(startSync(bare.db, {}, bare.clock.now, spawn)).toBe("no-schema");
    // A connection that knew the schema and then fails (closed here) fails open as `error`.
    const store = open();
    expect(startSync(store.db, {}, store.clock.now, spawn)).toBe("no-server");
    store.db.close();
    expect(startSync(store.db, {}, store.clock.now, spawn)).toBe("error");
    expect(spawned).toEqual([]);
  });
});

describe("the exit codes through the CLI", () => {
  const env = (store: SyncTestStore, extra: Record<string, string> = {}) => ({
    PATH: process.env.PATH ?? "",
    HOME: store.dataDir,
    WIZARDINGCODE_HOME: store.dataDir,
    WIZARDINGCODE_MEM_DATA_DIR: store.dataDir,
    WIZARDINGCODE_MEM_MIGRATE: "off",
    WIZARDINGCODE_MEM_DISTILL: "off",
    WIZARDINGCODE_MEM_UI_AUTO_OPEN: "off",
    WIZARDINGCODE_MEM_UI_BROWSER: "none",
    ...extra,
  });
  const exitOf = async (store: SyncTestStore, extra: Record<string, string>, ...args: string[]) => {
    const child = spawnCli({ env: env(store, extra) }, ...args);
    children.push(child);
    const lines: string[] = [];
    for await (const line of child.stderr) lines.push(line);
    return { code: await child.exited, stderr: lines.join("\n") };
  };

  test("SYNC=off exits 0 without claiming; a second --auto exits 0; --once is 2 while --auto holds the lease; 1 with a stopped server", async () => {
    const store = open();
    confirmedServer(store);
    const off = await exitOf(store, { WIZARDINGCODE_MEM_SYNC: "off" }, "sync", "--auto");
    expect(off.code).toBe(0);
    expect(getMeta(store.db, SYNC_LEASE)).toBeNull();
    // This test's pid holds the lease, as a running --auto would.
    setMeta(
      store.db,
      SYNC_LEASE,
      JSON.stringify({ owner: `sync-${process.pid}-0.8.0`, until: Date.now() + 60_000 }),
    );
    const second = await exitOf(store, {}, "sync", "--auto");
    expect(second.code).toBe(0);
    const once = await exitOf(store, {}, "sync", "--once");
    expect(once.code).toBe(2);
    expect(once.stderr).toContain("sync is running");
    store.db.run("DELETE FROM meta WHERE key = ?", [SYNC_LEASE]);
    store.db.run("UPDATE sharing_servers SET stopped = 'rejoin' WHERE server_id = 's1'");
    const stopped = await exitOf(store, {}, "sync", "--once");
    expect(stopped.code).toBe(1);
    expect(stopped.stderr).toContain("rejoin");
    expect(serverById(store.db, "s1")?.stopped).toBe("rejoin");
    const usage = await exitOf(store, {}, "sync");
    expect(usage.code).toBe(64);
  });
});

// --- The hooks' side and the cost of a quiet tick ----------------------------------------------------

/** The statements a connection prepares, each with the rows it then read. */
interface Counted {
  sql: string;
  params: unknown[];
  rows: number;
}

/** The store's connection behind a proxy that counts `query`/`prepare` and the rows they read. */
function countingDb(db: Database, statements: Counted[]): Database {
  return new Proxy(db, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target);
      if (prop !== "query" && prop !== "prepare")
        return typeof value === "function" ? value.bind(target) : value;
      return (sql: string, ...rest: unknown[]) => {
        const statement = (value as (...a: unknown[]) => object).call(target, sql, ...rest);
        const record: Counted = { sql, params: [], rows: 0 };
        statements.push(record);
        return new Proxy(statement, {
          get(inner, name) {
            const method = Reflect.get(inner, name, inner);
            if (name === "all" || name === "get" || name === "values") {
              return (...params: unknown[]) => {
                record.params = params;
                const out = (method as (...a: unknown[]) => unknown).call(inner, ...params);
                if (Array.isArray(out)) record.rows += out.length;
                else if (out !== null && out !== undefined) record.rows += 1;
                return out;
              };
            }
            return typeof method === "function" ? method.bind(inner) : method;
          },
        });
      };
    },
  });
}

const hookInput = (
  store: SyncTestStore,
  event: HookEvent,
  extra: Partial<HookInput> = {},
): HookInput => ({
  agent: "claude-code" as AgentId,
  event,
  sessionId: "spawn-1",
  cwd: store.dataDir,
  turnId: null,
  transcriptPath: null,
  prompt: null,
  finalText: null,
  source: null,
  toolError: null,
  toolFile: null,
  subagent: false,
  ...extra,
});

describe("the spawn through the hooks", () => {
  test("session-start of any source and prompt call it, the other events never; a throwing dep is contained", () => {
    const store = open();
    const adapter = ADAPTERS["claude-code"] as AgentAdapter;
    let calls = 0;
    const errors: unknown[] = [];
    const deps = {
      db: store.db,
      now: () => store.clock.now,
      spawnDistill: () => {},
      spawnSync: () => {
        calls++;
      },
      onError: (error: unknown) => {
        errors.push(error);
      },
    };
    const steps: [HookEvent, Partial<HookInput>][] = [
      ["session-start", {}],
      ["session-start", { source: "resume" }],
      ["session-start", { source: "clear" }],
      ["prompt", { prompt: "hello", turnId: "t1" }],
      ["file-read", { toolFile: join(store.dataDir, "x.ts") }],
      ["tool-failed", { toolError: "boom" }],
      ["turn-end", { finalText: "done", turnId: "t1" }],
      ["session-end", {}],
    ];
    const counts = steps.map(([event, extra]) => {
      const before = calls;
      handleHook(deps, adapter, hookInput(store, event, extra));
      return calls - before;
    });
    expect(counts).toEqual([1, 1, 1, 1, 0, 0, 0, 0]);
    expect(errors).toEqual([]);
    const quiet = handleHook(
      { ...deps, spawnSync: undefined },
      adapter,
      hookInput(store, "prompt", { prompt: "again", turnId: "t2" }),
    );
    const loud = handleHook(
      {
        ...deps,
        spawnSync: () => {
          throw new Error("spawn failed");
        },
      },
      adapter,
      hookInput(store, "prompt", { prompt: "again", turnId: "t3" }),
    );
    expect(loud).toBe(quiet);
    expect(errors.map((error) => (error as Error).message)).toEqual(["spawn failed"]);
  });

  test("a start costs one statement and one process.kill once the schema is known", () => {
    const store = open();
    confirmedServer(store);
    const statements: Counted[] = [];
    const db = countingDb(store.db, statements);
    const kill = spyOn(process, "kill");
    try {
      // A live lease of this process: the one `process.kill(pid, 0)`.
      setMeta(
        store.db,
        SYNC_LEASE,
        JSON.stringify({ owner: `sync-${process.pid}-0.8.0`, until: store.clock.now + 60_000 }),
      );
      expect(startSync(db, {}, store.clock.now, () => undefined)).toBe("running");
      // `sqlite_master` once, then the one statement.
      expect(statements.map((s) => s.sql.includes("sqlite_master"))).toEqual([true, false]);
      statements.length = 0;
      kill.mockClear();
      expect(startSync(db, {}, store.clock.now, () => undefined)).toBe("running");
      expect(statements).toHaveLength(1);
      expect(statements[0]?.sql).toContain("sharing_servers");
      expect(statements[0]?.sql).toContain("meta");
      expect(kill).toHaveBeenCalledTimes(1);
      expect(kill).toHaveBeenCalledWith(process.pid, 0);
    } finally {
      kill.mockRestore();
    }
  });
});

describe("a quiet tick on a large store", () => {
  test("issues one indexed query over the memories, none over the entries or the ledger, and reads no row", async () => {
    const w = await world("all");
    taxonomy(w);
    const repo = openRepo(
      w.knowledge,
      { scope: "project", projectId: w.projectId },
      { create: personAuthor(w.knowledge) },
    );
    if (repo === null) throw new Error("no project repository");
    commitEntryFiles(
      repo.path,
      Array.from({ length: 1_000 }, (_, i) => ({
        slug: `entry-${i}`,
        title: `Entry ${i}`,
        body: `Body ${i}.`,
        area: "sales",
      })),
    );
    withWrite(w.store.db, () => {
      for (let i = 0; i < 10_000; i++) memory(w, `Memory ${i}`);
    });
    const first = await sweep(w.store.ctx, w.server(), { full: true });
    expect(first).toMatchObject({ sent: 11_000, refused: 0 });

    const statements: Counted[] = [];
    const ctx = { ...w.store.ctx, db: countingDb(w.store.db, statements) };
    // The first tick on this connection fills its per-connection caches; the second is counted.
    w.store.clock.advance(5_000);
    expect(await sweep(ctx, w.server(), { full: false })).toMatchObject({ sent: 0 });
    statements.length = 0;
    w.store.clock.advance(5_000);
    expect(await sweep(ctx, w.server(), { full: false })).toMatchObject({ sent: 0, withdrawn: 0 });

    const over = (table: string) =>
      statements.filter((s) => new RegExp(`\\b${table}\\b`).test(s.sql));
    expect(over("knowledge_entries")).toEqual([]);
    expect(over("sharing_ledger")).toEqual([]);
    const memories = over("memories");
    expect(memories).toHaveLength(1);
    const only = memories[0] as Counted;
    expect(only.rows).toBe(0);
    const plan = w.store.db
      .query<{ detail: string }, (string | number)[]>(`EXPLAIN QUERY PLAN ${only.sql}`)
      .all(...(only.params as (string | number)[]))
      .map((row) => row.detail);
    expect(plan.filter((line) => /SCAN (m|memories)\b/.test(line))).toEqual([]);
    expect(plan.some((line) => line.includes("sharing_memories_updated"))).toBe(true);
    expect(plan.some((line) => line.includes("rowid>"))).toBe(true);
  }, 120_000);
});
