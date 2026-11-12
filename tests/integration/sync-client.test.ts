// The HTTP client of the sync (ADR 0027): one server, every answer mapped, the contract and
// the request id on every request, a 3xx never followed, the deadline on the injected timers.
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { checkServerUrl, ServerUrlError, SyncClient } from "../../src/sync/client.ts";
import type { Fetch } from "../../src/sync/context.ts";
import { CONTRACT, REQUEST_ID_RE } from "../../src/team/contract.ts";
import {
  cleanSyncDirs,
  fakeClock,
  fakeTimers,
  openSyncStore,
  type SyncTestStore,
  settle,
} from "../helpers/sync.ts";
import {
  api,
  cleanTestDirs,
  entryPayload,
  eventsOf,
  invite,
  startTestServer,
  type TestServer,
} from "../helpers/team.ts";

const servers: TestServer[] = [];
const stores: SyncTestStore[] = [];
const extra: { stop(): void }[] = [];
afterEach(async () => {
  for (const store of stores.splice(0)) store.close();
  for (const t of servers.splice(0)) await t.close();
  for (const s of extra.splice(0)) s.stop();
});
afterAll(() => {
  cleanTestDirs();
  cleanSyncDirs();
});

const realFetch: Fetch = (input, init) => fetch(input, init);

/** A server and a client store on one fake clock, so a held pull and a deadline share time. */
async function serverAndStore() {
  const clock = fakeClock();
  const timers = fakeTimers(clock);
  const t = await startTestServer({}, { clock, timers });
  servers.push(t);
  const store = openSyncStore({ clock, timers, fetch: realFetch });
  stores.push(store);
  return { t, store, clock, timers };
}

/** A store whose fetch answers from a script, for the answers the test server cannot give. */
function stubbed(
  answer: (input: string | URL | Request, init?: RequestInit) => Response | Promise<Response>,
) {
  const store = openSyncStore({ fetch: async (input, init) => answer(input, init) });
  stores.push(store);
  return store;
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "x-request-id": "stub-1", ...headers },
  });

describe("checkServerUrl", () => {
  test("accepts an https origin and a loopback http origin, nothing else", () => {
    expect(checkServerUrl("https://team.acme.test")).toBe("https://team.acme.test");
    expect(checkServerUrl("https://team.acme.test:8443/")).toBe("https://team.acme.test:8443");
    expect(checkServerUrl("http://127.0.0.1:8080")).toBe("http://127.0.0.1:8080");
    expect(checkServerUrl("http://localhost:3000")).toBe("http://localhost:3000");
    expect(checkServerUrl("http://[::1]:3000")).toBe("http://[::1]:3000");
    const refused = (url: string, why: RegExp) => {
      expect(() => checkServerUrl(url)).toThrow(ServerUrlError);
      expect(() => checkServerUrl(url)).toThrow(why);
    };
    refused("https://team.acme.test/path", /path/);
    refused("https://team.acme.test/?x=1", /path|query/);
    refused("https://team.acme.test/#x", /path|fragment/);
    refused("https://u:p@team.acme.test", /credentials/);
    refused("http://team.acme.test", /https/);
    refused("http://localhost.example.com", /https/);
    refused("ftp://team.acme.test", /https/);
    refused("not a url", /URL/);
  });
});

describe("the client against the team server", () => {
  test("join, me, push and pull: the answers, the request id on each, the id in the server's log", async () => {
    const { t, store } = await serverAndStore();
    const client = new SyncClient(store.ctx, { url: t.server.origin, token: null });
    const joined = await client.join(t.code, "laptop", "Ana");
    if (!joined.ok) throw new Error(`join failed: ${JSON.stringify(joined)}`);
    expect(joined.status).toBe(200);
    expect(joined.body).toMatchObject({
      serverId: t.server.serverId,
      instance: t.server.instance(),
      contract: CONTRACT,
      name: "Ana",
      role: "admin",
    });
    expect(joined.body.token).toMatch(/^wcm1_/);
    expect(joined.requestId).toMatch(REQUEST_ID_RE);
    const logged = eventsOf(t, "request").map((line) => line.requestId);
    expect(logged).toContain(joined.requestId);

    // A used code is refused; the token never appears in the answer of a refusal.
    const again = await client.join(t.code, "laptop");
    expect(again.ok).toBe(false);
    if (again.ok) throw new Error("unreachable");
    expect(["refused", "gone"]).toContain(again.kind);

    const member = new SyncClient(store.ctx, { url: t.server.origin, token: joined.body.token });
    const me = await member.me();
    if (!me.ok) throw new Error(`me failed: ${JSON.stringify(me)}`);
    expect(me.body.member.id).toBe(joined.body.memberId);
    expect(me.body.limits.pullItems).toBe(500);
    expect(me.body.serverId).toBe(t.server.serverId);

    const payload = entryPayload({ scope: "workspace", slug: "first" });
    const pushed = await member.push(
      [{ op: "send", kind: "entry", uid: payload.uid, baseRevision: 0, baseHash: "", payload }],
      7,
    );
    if (!pushed.ok) throw new Error(`push failed: ${JSON.stringify(pushed)}`);
    expect(pushed.body.results).toHaveLength(1);
    expect(pushed.body.results[0]).toMatchObject({
      uid: payload.uid,
      result: "applied",
      revision: 1,
    });

    const pulled = await member.pull({ since: 0, scope: "all" }, { deadlineMs: 5_000 });
    if (!pulled.ok) throw new Error(`pull failed: ${JSON.stringify(pulled)}`);
    expect(pulled.body.serverId).toBe(t.server.serverId);
    expect(pulled.body.items.map((item) => item.uid)).toEqual([payload.uid]);
    expect(pulled.body.next).toBeGreaterThan(0);
    // Every request carried the contract and its own id.
    const ids = eventsOf(t, "request").map((line) => line.requestId as string);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => REQUEST_ID_RE.test(id))).toBe(true);
  });

  test("the deadline ends a held pull on the fake clock; the caller's signal ends it as aborted", async () => {
    const { t, store, clock } = await serverAndStore();
    const bootstrap = new SyncClient(store.ctx, { url: t.server.origin, token: null });
    const joined = await bootstrap.join(t.code, "laptop", "Ana");
    if (!joined.ok) throw new Error("join failed");
    const client = new SyncClient(store.ctx, { url: t.server.origin, token: joined.body.token });
    const first = await client.pull({ since: 0, scope: "all" }, { deadlineMs: 5_000 });
    if (!first.ok) throw new Error("pull failed");
    // Nothing new: the server holds the pull for 25 s on the shared clock.
    const held = client.pull(
      { since: first.body.next, scope: "all", wait: 25 },
      { deadlineMs: 10_000 },
    );
    await settle();
    clock.advance(10_000);
    await settle();
    const ended = await held;
    expect(ended.ok).toBe(false);
    if (ended.ok) throw new Error("unreachable");
    expect(ended.kind).toBe("deadline");

    const aborter = new AbortController();
    const second = client.pull(
      { since: first.body.next, scope: "all", wait: 25 },
      { deadlineMs: 60_000, signal: aborter.signal },
    );
    await settle();
    aborter.abort();
    const stopped = await second;
    expect(stopped.ok).toBe(false);
    if (stopped.ok) throw new Error("unreachable");
    expect(stopped.kind).toBe("aborted");
    // Let the server's own hold end before the server stops.
    clock.advance(30_000);
    await settle();
  });

  test("401 with the instance, 403 after disable, 409 with the accepted list, 413 as tooLarge", async () => {
    const { t, store } = await serverAndStore();
    const bootstrap = new SyncClient(store.ctx, { url: t.server.origin, token: null });
    const admin = await bootstrap.join(t.code, "laptop", "Ana");
    if (!admin.ok) throw new Error("join failed");

    const wrong = new SyncClient(store.ctx, {
      url: t.server.origin,
      token: `wcm1_${"x".repeat(43)}`,
    });
    const unauthorized = await wrong.me();
    expect(unauthorized.ok).toBe(false);
    if (unauthorized.ok) throw new Error("unreachable");
    expect(unauthorized).toMatchObject({ kind: "unauthorized", instance: t.server.instance() });
    expect(unauthorized.requestId).toMatch(REQUEST_ID_RE);

    const code = await invite(t, admin.body.token, { role: "member", name: "Bob" });
    const bob = await bootstrap.join(code, "desk");
    if (!bob.ok) throw new Error("join failed");
    const disabled = await api(
      t.server,
      admin.body.token,
      "POST",
      `/v1/members/${bob.body.memberId}/disable`,
      {},
    );
    expect(disabled.status).toBe(200);
    const bobClient = new SyncClient(store.ctx, { url: t.server.origin, token: bob.body.token });
    const refused = await bobClient.me();
    expect(refused.ok).toBe(false);
    if (refused.ok) throw new Error("unreachable");
    expect(refused.kind).toBe("disabled");

    const future = new SyncClient(store.ctx, {
      url: t.server.origin,
      token: admin.body.token,
      contract: 99,
    });
    const contract = await future.me();
    expect(contract.ok).toBe(false);
    if (contract.ok) throw new Error("unreachable");
    expect(contract).toMatchObject({ kind: "contract", accepted: [1, 2] });

    const adminClient = new SyncClient(store.ctx, {
      url: t.server.origin,
      token: admin.body.token,
    });
    const huge = entryPayload({ scope: "workspace", slug: "huge", body: "x".repeat(1_100_000) });
    const tooLarge = await adminClient.push(
      [{ op: "send", kind: "entry", uid: huge.uid, baseRevision: 0, baseHash: "", payload: huge }],
      1,
    );
    expect(tooLarge.ok).toBe(false);
    if (tooLarge.ok) throw new Error("unreachable");
    expect(tooLarge.kind).toBe("tooLarge");
  });

  test("a 3xx is never followed", async () => {
    const store = openSyncStore({ fetch: realFetch });
    stores.push(store);
    let followed = 0;
    const target = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: () => {
        followed++;
        return json(200, { ok: true });
      },
    });
    extra.push({ stop: () => target.stop(true) });
    const redirector = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: () =>
        new Response(null, {
          status: 302,
          headers: { location: `http://127.0.0.1:${target.port}/v1/me` },
        }),
    });
    extra.push({ stop: () => redirector.stop(true) });
    const client = new SyncClient(store.ctx, {
      url: `http://127.0.0.1:${redirector.port}`,
      token: `wcm1_${"y".repeat(43)}`,
    });
    const answer = await client.me();
    expect(answer.ok).toBe(false);
    if (answer.ok) throw new Error("unreachable");
    expect(answer.kind).toBe("redirect");
    expect(followed).toBe(0);
  });
});

describe("the answers the test server cannot give, from a stub", () => {
  const client = (store: SyncTestStore) =>
    new SyncClient(store.ctx, { url: "https://team.acme.test", token: `wcm1_${"z".repeat(43)}` });

  test("a 409 without an accepted list is a conflict with its body; a bare 404 on a names route is an old server; unknown-name is refused with the body (ADR 0028)", async () => {
    const store = stubbed((input) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.endsWith("/v1/names"))
        return json(409, { error: "exists", name: { alias: "name:x", id: "0123456789abcdef" } });
      if (url.endsWith("/v1/names/name%3Aold")) return json(404, { error: "not found" });
      if (url.endsWith("/v1/names/name%3Agone")) return json(404, { error: "unknown-name" });
      return json(404, { error: "not found" });
    });
    const c = client(store);
    const conflict = await c.createName("name:x");
    expect(conflict.ok).toBe(false);
    if (conflict.ok) throw new Error("unreachable");
    expect(conflict).toMatchObject({
      kind: "conflict",
      status: 409,
      body: { error: "exists", name: { alias: "name:x" } },
    });
    const old = await c.nameByAlias("name:old");
    expect(old.ok).toBe(false);
    if (old.ok) throw new Error("unreachable");
    expect(old.kind).toBe("oldServer");
    const gone = await c.nameByAlias("name:gone");
    expect(gone.ok).toBe(false);
    if (gone.ok) throw new Error("unreachable");
    expect(gone).toMatchObject({ kind: "refused", status: 404, body: { error: "unknown-name" } });
    // On every other route a 404 stays a refusal, never an old server.
    const me = await c.me();
    expect(me.ok).toBe(false);
    if (me.ok) throw new Error("unreachable");
    expect(me.kind).toBe("refused");
    // The contract spoken can change: the header follows it.
    const seen: string[] = [];
    const speaking = stubbed((_input, init) => {
      seen.push(new Headers(init?.headers).get("x-wcm-contract") ?? "");
      return json(200, { items: [], more: false, next: null });
    });
    const s = client(speaking);
    expect(s.contract).toBe(CONTRACT);
    await s.listNames(null, 10);
    s.speak(1);
    expect(s.contract).toBe(1);
    await s.listNames(null, 10);
    expect(seen).toEqual([String(CONTRACT), "1"]);
  });

  test("429 with Retry-After, 410, 5xx, a network failure, a body that is not JSON", async () => {
    const seen: { url: string; headers: Record<string, string> }[] = [];
    const store = stubbed((input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      const headers = Object.fromEntries(new Headers(init?.headers).entries());
      seen.push({ url, headers });
      if (url.endsWith("/v1/me"))
        return json(429, { error: "rate limited" }, { "retry-after": "7" });
      if (url.includes("/v1/pull"))
        return json(410, { error: "cursor gone", serverId: "s", instance: "i" });
      if (url.endsWith("/v1/push")) return json(503, { error: "storage" });
      return new Response("<html>", { status: 200 });
    });
    const c = client(store);
    const rate = await c.me();
    expect(rate.ok).toBe(false);
    if (rate.ok) throw new Error("unreachable");
    expect(rate).toMatchObject({ kind: "rate", retryAfterMs: 7_000, requestId: "stub-1" });
    const gone = await c.pull({ since: 3, scope: "all" }, { deadlineMs: 1_000 });
    expect(gone.ok).toBe(false);
    if (gone.ok) throw new Error("unreachable");
    expect(gone.kind).toBe("gone");
    const server = await c.push([], 1);
    expect(server.ok).toBe(false);
    if (server.ok) throw new Error("unreachable");
    expect(server).toMatchObject({ kind: "server", status: 503, error: "storage" });
    const html = await c.join("wci1_X", "laptop");
    expect(html.ok).toBe(false);
    if (html.ok) throw new Error("unreachable");
    expect(html.kind).toBe("server");
    // The contract, the token and a fresh request id on each request; the join sends no token.
    expect(seen[0]?.headers["x-wcm-contract"]).toBe(String(CONTRACT));
    expect(seen[0]?.headers.authorization).toBe(`Bearer wcm1_${"z".repeat(43)}`);
    expect(seen[0]?.headers["x-request-id"]).toMatch(REQUEST_ID_RE);
    expect(seen[3]?.headers.authorization).toBeUndefined();
    expect(new Set(seen.map((s) => s.headers["x-request-id"])).size).toBe(4);
    expect(seen[1]?.url).toContain("since=3");
    expect(seen[1]?.url).toContain("scope=all");

    const down = stubbed(() => {
      throw new TypeError("fetch failed: ECONNREFUSED");
    });
    const network = await client(down).me();
    expect(network.ok).toBe(false);
    if (network.ok) throw new Error("unreachable");
    expect(network).toMatchObject({
      kind: "network",
      error: expect.stringContaining("ECONNREFUSED"),
    });
  });
});
