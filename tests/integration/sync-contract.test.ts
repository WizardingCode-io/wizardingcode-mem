// The contract spoken to a server (ADR 0028): the live path down on a 409 with an accepted
// list, the names held while it is 1, the active read of /v1/me at the start and at the full
// sweep, and what the join stores.
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { clearSyncStop, SYNC_STOP, setMeta } from "../../src/store/meta.ts";
import type { Fetch } from "../../src/sync/context.ts";
import { pullOnce, resetInbound } from "../../src/sync/inbound.ts";
import { sweep } from "../../src/sync/outbound.ts";
import { refreshContracts, runSync } from "../../src/sync/run.ts";
import { insertPending, serverById, setContract, writeToken } from "../../src/sync/servers.ts";
import { statusReport } from "../../src/sync/state.ts";
import { CONTRACT } from "../../src/team/contract.ts";
import {
  cleanSyncDirs,
  openSyncStore,
  type SyncTestStore,
  serverFixture,
  settle,
} from "../helpers/sync.ts";
import {
  ALIAS,
  cleanWorlds,
  closeWorlds,
  feedOf,
  memory,
  NAME,
  type World,
  world,
} from "../helpers/sync-world.ts";

const stores: SyncTestStore[] = [];
afterEach(async () => {
  resetInbound();
  for (const store of stores.splice(0)) store.close();
  await closeWorlds();
});
afterAll(() => {
  cleanSyncDirs();
  cleanWorlds();
});

const AT_ONE = { contract: { current: 1, accepted: [1] } };
const TOKEN = `wcm1_${"t".repeat(43)}`;

interface Seen {
  url: string;
  contract: string | null;
}

/** Every request the client made, with the contract header it carried. */
function spy(w: World): Seen[] {
  const seen: Seen[] = [];
  const real = w.store.ctx.fetch;
  w.store.ctx.fetch = (input, init) => {
    seen.push({
      url: String(input instanceof Request ? input.url : input),
      contract: new Headers(init?.headers).get("x-wcm-contract"),
    });
    return real(input, init);
  };
  return seen;
}
const pulls = (seen: Seen[]) => seen.filter((r) => r.url.includes("/v1/pull"));
const pushes = (seen: Seen[]) => seen.filter((r) => r.url.endsWith("/v1/push"));
const mes = (seen: Seen[]) => seen.filter((r) => r.url.endsWith("/v1/me"));
const projectsOf = (url: string) => new URL(url).searchParams.get("projects") ?? "";
const refusals = (w: World) =>
  w.store.db.query<{ n: number }, []>("SELECT count(*) AS n FROM sharing_refusals").get()?.n ?? 0;

/** A fetch that never answers, and rejects when the request's signal aborts (as the real one does). */
const never: Fetch = (_input, init) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () =>
      reject(new DOMException("aborted", "AbortError")),
    );
  });

describe("the live path down: a 409 with an accepted list", () => {
  test("a pull: the row goes to 1, the request is repeated once with header 1 naming no shared name, nothing is stopped", async () => {
    const w = await world("knowledge", { named: true, server: AT_ONE });
    setContract(w.store.db, w.serverId, 2);
    const seen = spy(w);
    const pulled = await pullOnce(w.store.ctx, w.server(), { wait: false });
    expect(pulled.ok).toBe(true);
    expect(w.server().contract).toBe(1);
    expect(w.server().stopped).toBeNull();
    const requests = pulls(seen);
    expect(requests.length).toBeGreaterThanOrEqual(2);
    expect(requests[0]?.contract).toBe("2");
    for (const request of requests.slice(1)) {
      expect(request.contract).toBe("1");
      expect(projectsOf(request.url)).not.toContain("name:");
    }
    expect(requests.some((request) => projectsOf(request.url) === ALIAS)).toBe(true);
    // Only one 409: the repeat was answered.
    expect(w.server().failures).toBe(0);
  });

  test("a push: the batch is rebuilt without the items under the name, repeated once, and no refusal is written", async () => {
    const w = await world("all", { named: true, server: AT_ONE });
    setContract(w.store.db, w.serverId, 2);
    memory(w, "Site memory");
    memory(w, "Brand memory", { projectId: 2 });
    const seen = spy(w);
    const result = await sweep(w.store.ctx, w.server(), { full: true });
    expect(result).toMatchObject({ sent: 1, stopped: null });
    expect(w.server().contract).toBe(1);
    expect(pushes(seen).map((r) => r.contract)).toEqual(["2", "1"]);
    expect(refusals(w)).toBe(0);
    expect((await feedOf(w, [ALIAS, NAME])).items.map((i) => i.remoteAlias)).toEqual([ALIAS]);
    // The next sweep speaks 1 from the start and sends nothing under the name.
    const again = await sweep(w.store.ctx, w.server(), { full: true });
    expect(again).toMatchObject({ sent: 0, stopped: null });
    expect(pushes(seen)).toHaveLength(2);
  });

  test("a 409 to every request: one repeat with header 1, then stopped contract, never a third request", async () => {
    const seen: string[] = [];
    const store = openSyncStore({
      fetch: async (_input, init) => {
        seen.push(new Headers(init?.headers).get("x-wcm-contract") ?? "");
        return new Response(JSON.stringify({ error: "contract", accepted: [1] }), {
          status: 409,
          headers: { "content-type": "application/json" },
        });
      },
    });
    stores.push(store);
    insertPending(store.db, serverFixture("s1", { contract: 2 }));
    store.db.run("UPDATE sharing_servers SET confirmed_at = ? WHERE server_id = 's1'", [
      store.clock.now,
    ]);
    writeToken(store.ctx, "s1", TOKEN);
    const row = serverById(store.db, "s1");
    if (row === null) throw new Error("no row");
    const pulled = await pullOnce(store.ctx, row, { wait: false });
    expect(pulled.ok).toBe(false);
    expect(seen).toEqual(["2", "1"]);
    expect(serverById(store.db, "s1")).toMatchObject({ contract: 1, stopped: "contract" });
  });

  test("a server that accepts nothing stops contract at once, with the remedy", async () => {
    const w = await world("knowledge", { server: { contract: { current: 1, accepted: [] } } });
    const pulled = await pullOnce(w.store.ctx, w.server(), { wait: false });
    expect(pulled.ok).toBe(false);
    expect(w.server().stopped).toBe("contract");
    expect(statusReport(w.store.db, w.store.dataDir)[0]).toMatchObject({
      state: "stopped",
      remedy: "upgrade wizardingcode-mem",
    });
  });
});

describe("the active read of /v1/me", () => {
  test("refreshContracts reads every confirmed server in parallel under a 5 s deadline; a server that never answers keeps its value; so does a rejected read", async () => {
    const w = await world("knowledge");
    setContract(w.store.db, w.serverId, 1);
    insertPending(
      w.store.db,
      serverFixture("s9", { url: "https://never.example.com", contract: 1 }),
    );
    w.store.db.run("UPDATE sharing_servers SET confirmed_at = ? WHERE server_id = 's9'", [
      w.store.clock.now,
    ]);
    writeToken(w.store.ctx, "s9", TOKEN);
    const real = w.store.ctx.fetch;
    w.store.ctx.fetch = (input, init) =>
      String(input instanceof Request ? input.url : input).startsWith("https://never.example.com")
        ? never(input, init)
        : real(input, init);
    const refreshing = refreshContracts(w.store.ctx);
    await settle(20);
    w.store.clock.advance(5_000);
    await settle(20);
    await refreshing;
    expect(serverById(w.store.db, w.serverId)?.contract).toBe(CONTRACT);
    expect(serverById(w.store.db, "s9")?.contract).toBe(1);

    setContract(w.store.db, w.serverId, 1);
    w.store.ctx.fetch = () => Promise.reject(new TypeError("fetch failed"));
    await refreshContracts(w.store.ctx);
    expect(serverById(w.store.db, w.serverId)?.contract).toBe(1);
  });

  test("the read for the rows below the binary's contract alone: a row at 1 is read, a row at 2 is not", async () => {
    const w = await world("knowledge");
    insertPending(w.store.db, serverFixture("s9", { url: w.t.server.origin, contract: 1 }));
    w.store.db.run("UPDATE sharing_servers SET confirmed_at = ? WHERE server_id = 's9'", [
      w.store.clock.now,
    ]);
    writeToken(w.store.ctx, "s9", w.token);
    const seen = spy(w);
    await refreshContracts(w.store.ctx, { onlyBelow: true });
    expect(mes(seen)).toHaveLength(1);
    expect(mes(seen)[0]?.contract).toBe("1");
    expect(serverById(w.store.db, "s9")?.contract).toBe(CONTRACT);
  });

  test("sync --once reads the contracts first: a row at 2 against a server at 1 sweeps and pulls at 1, naming no shared name, with no 409", async () => {
    const w = await world("all", { named: true, server: AT_ONE });
    setContract(w.store.db, w.serverId, 2);
    memory(w, "Brand memory", { projectId: 2 });
    const seen = spy(w);
    const code = await runSync(w.store.ctx, { once: true });
    expect(code).toBe(0);
    expect(w.server().contract).toBe(1);
    expect(seen.length).toBeGreaterThan(0);
    for (const request of seen.filter((r) => !r.url.endsWith("/v1/me"))) {
      expect(request.contract).toBe("1");
    }
    for (const request of pulls(seen)) expect(projectsOf(request.url)).not.toContain("name:");
    expect(pushes(seen)).toHaveLength(0);
    expect(refusals(w)).toBe(0);
    expect((await feedOf(w, [ALIAS, NAME])).items).toEqual([]);
  });

  test("the run loop's full sweep reads /v1/me again for a row below the binary's contract: within a minute the row speaks 2 again", async () => {
    const w = await world("knowledge");
    const seen = spy(w);
    const run = runSync(w.store.ctx, {
      once: false,
      hooks: { pullOnce: async () => ({ ok: true, held: false }) },
      viewerLive: async () => false,
    });
    await settle(20);
    const atStart = mes(seen).length;
    expect(atStart).toBe(1);
    // The row fell to 1 since the start (a 409 from a rolled-back server); the server is at 2 again.
    setContract(w.store.db, w.serverId, 1);
    w.store.clock.advance(60_000);
    await settle(30);
    expect(mes(seen)).toHaveLength(atStart + 1);
    expect(mes(seen)[1]?.contract).toBe("1");
    expect(serverById(w.store.db, w.serverId)?.contract).toBe(CONTRACT);
    setMeta(w.store.db, SYNC_STOP, JSON.stringify({ who: "test", at: w.store.clock.now }));
    w.store.clock.advance(5_000);
    await settle(20);
    expect(await run).toBe(0);
    clearSyncStop(w.store.db);
  });

  test("the join and the /v1/me read store the lower of the binary's contract and the server's", async () => {
    const one = await world("knowledge", { server: AT_ONE });
    expect(one.server().contract).toBe(1);
    const two = await world("knowledge");
    expect(two.server().contract).toBe(CONTRACT);
    // A server ahead of this binary: the row never speaks above what the binary knows.
    const three = await world("knowledge", {
      server: { contract: { current: 3, accepted: [1, 2, 3] } },
    });
    expect(three.server().contract).toBe(CONTRACT);
    setContract(three.store.db, three.serverId, 1);
    await refreshContracts(three.store.ctx);
    expect(three.server().contract).toBe(CONTRACT);
  });
});
