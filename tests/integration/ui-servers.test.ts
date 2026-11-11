// The viewer's server routes (ADR 0027, AC-24): the list, the add with its counts, its pending
// row and its yes, the rejoin, the removal with its refusals, mute and resume, the sync's
// state and its run, and the server a level or a list is set for when several are listed.
// Every case runs the real viewer over a store, against the in-process team server; no
// answer ever carries a token.
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveProject } from "../../src/core/project.ts";
import { serverLists } from "../../src/sharing/store.ts";
import { getMeta, restoreHoldKey, SYNC_LEASE, setMeta } from "../../src/store/meta.ts";
import { writeConflict, writeSent } from "../../src/sync/ledger.ts";
import { insertPending, readTokens, serverById, writeToken } from "../../src/sync/servers.ts";
import { startUi, type UiServer } from "../../src/ui/server.ts";
import { realGit } from "../helpers/stub-git.ts";
import {
  cleanSyncDirs,
  openSyncStore,
  type SyncTestStore,
  serverFixture,
  settle,
} from "../helpers/sync.ts";
import { cleanTestDirs, invite, startTestServer, type TestServer } from "../helpers/team.ts";

const MINUTE = 60_000;
const TOKEN = `wcm1_${"t".repeat(43)}`;

let store: SyncTestStore | undefined;
let t: TestServer | undefined;
let ui: UiServer | undefined;
let teamClosed = false;
const spawned: string[][] = [];
const bases: string[] = [];

afterEach(async () => {
  await ui?.stop();
  ui = undefined;
  store?.close();
  store = undefined;
  if (t !== undefined && !teamClosed) await t.close();
  t = undefined;
  teamClosed = false;
  spawned.length = 0;
  for (const base of bases.splice(0)) rmSync(base, { recursive: true, force: true });
  cleanSyncDirs();
  cleanTestDirs();
});

/** A store with a fake clock, the team server on the same clock, and the viewer over the store. */
async function world(): Promise<{ store: SyncTestStore; t: TestServer; ui: UiServer }> {
  store = openSyncStore({ fetch: (input, init) => fetch(input, init) });
  t = await startTestServer({}, { clock: store.clock, timers: store.timers });
  ui = await startUi({
    dataDir: store.dataDir,
    homeDir: join(store.dataDir, "brand"),
    port: 0,
    open: false,
    now: () => (store as SyncTestStore).clock.now,
    env: store.ctx.env,
    clock: store.clock,
    timers: store.timers,
    spawn: (...args: string[]) => {
      spawned.push(args);
    },
  });
  return { store, t, ui };
}

const api = (s: UiServer, path: string, init: RequestInit = {}) =>
  fetch(`${s.origin}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${s.token}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
const send = (s: UiServer, method: "POST" | "PUT" | "DELETE", path: string, body: unknown) =>
  api(s, path, { method, body: JSON.stringify(body) });
const bodyOf = async (res: Response) => ({
  status: res.status,
  body: (await res.json()) as Record<string, unknown>,
});

/** A request answered while the fake clock is moved, for the waits the server makes. */
async function whileTicking(s: SyncTestStore, work: Promise<Response>): Promise<Response> {
  let done = false;
  void work.then(
    () => {
      done = true;
    },
    () => {
      done = true;
    },
  );
  for (let i = 0; i < 200 && !done; i++) {
    await settle();
    s.clock.advance(1_000);
  }
  return work;
}

/** Joins and confirms through the routes; returns the server's id and this device's token. */
async function joined(): Promise<{ id: string; token: string }> {
  const {
    t: team,
    ui: viewer,
    store: own,
  } = { t: t as TestServer, ui: ui as UiServer, store: store as SyncTestStore };
  const added = await bodyOf(
    await send(viewer, "POST", "/api/servers", {
      url: team.server.origin,
      code: team.code,
      label: "laptop",
      name: "Ana",
    }),
  );
  expect(added.status).toBe(200);
  const confirmed = await bodyOf(
    await send(viewer, "POST", "/api/servers", { url: team.server.origin, yes: true }),
  );
  expect(confirmed).toEqual({ status: 200, body: { ok: true, confirmed: true } });
  const id = (added.body.server as { id: string }).id;
  return { id, token: readTokens(own.dataDir)[id] as string };
}

describe("GET /api/servers and POST /api/servers", () => {
  test("lists nothing, then adds a server through the counts, the pending row and the yes; the refusals; no token in any answer", async () => {
    const { t: team, ui: viewer, store: own } = await world();
    expect(await bodyOf(await api(viewer, "/api/servers"))).toMatchObject({
      status: 200,
      body: { sync: { state: "idle" }, servers: [] },
    });
    expect(await bodyOf(await api(viewer, "/api/sync"))).toMatchObject({
      status: 200,
      body: { state: "idle", pid: null },
    });

    expect(
      await bodyOf(
        await send(viewer, "POST", "/api/servers", {
          url: "http://localhost.example.com",
          code: "x",
        }),
      ),
    ).toMatchObject({ status: 200, body: { ok: false, error: "url" } });
    expect(
      await bodyOf(
        await send(viewer, "POST", "/api/servers", {
          url: team.server.origin,
          code: `wci1_${"A".repeat(26)}`,
        }),
      ),
    ).toMatchObject({ status: 200, body: { ok: false, error: "code" } });
    expect(
      await bodyOf(
        await send(viewer, "POST", "/api/servers", { url: team.server.origin, yes: true }),
      ),
    ).toMatchObject({ status: 200, body: { ok: false, error: "pending" } });

    const added = await send(viewer, "POST", "/api/servers", {
      url: team.server.origin,
      code: team.code,
      label: "laptop",
      name: "Ana",
    });
    const addedText = await added.text();
    expect(added.status).toBe(200);
    expect(addedText).not.toContain("wcm1_");
    const addedBody = JSON.parse(addedText) as {
      confirm: boolean;
      server: { id: string; name: string; member: string; role: string };
      counts: { entries: number; memories: number; byProject: unknown[] };
    };
    expect(addedBody.confirm).toBe(true);
    expect(addedBody.server).toMatchObject({
      id: team.server.serverId,
      member: "Ana",
      role: "admin",
    });
    expect(addedBody.counts).toMatchObject({ entries: 0, memories: 0, byProject: [] });
    const pending = await bodyOf(await api(viewer, "/api/servers"));
    expect((pending.body.servers as { state: string }[]).map((s) => s.state)).toEqual(["pending"]);
    expect(JSON.stringify(pending.body)).not.toContain("wcm1_");
    expect(spawned).toEqual([]);

    expect(
      await bodyOf(
        await send(viewer, "POST", "/api/servers", { url: team.server.origin, yes: true }),
      ),
    ).toEqual({ status: 200, body: { ok: true, confirmed: true } });
    const listed = await bodyOf(await api(viewer, "/api/servers"));
    expect(
      (
        listed.body.servers as {
          id: string;
          state: string;
          host: string;
          member: string;
          role: string;
        }[]
      )[0],
    ).toMatchObject({ id: team.server.serverId, state: "ok", member: "Ana", role: "admin" });
    expect(serverById(own.db, team.server.serverId)?.confirmedAt).not.toBeNull();
    expect(spawned).toEqual([["sync", "--auto"]]);
    // Once confirmed, another add of the same server is refused as joined.
    const adminToken = readTokens(own.dataDir)[team.server.serverId] as string;
    const fresh = await invite(team, adminToken, { role: "member", name: "Bob" });
    expect(
      await bodyOf(
        await send(viewer, "POST", "/api/servers", { url: team.server.origin, code: fresh }),
      ),
    ).toMatchObject({ status: 200, body: { ok: false, error: "joined" } });
  }, 60_000);
});

describe("rejoin, mute, resume", () => {
  test("rejoin takes a code; mute and unmute answer the state, a member's too; resume previews per project and releases on the yes", async () => {
    const { t: team, ui: viewer, store: own } = await world();
    const { id, token } = await joined();
    const member = serverById(own.db, id)?.memberId as string;
    const code = await invite(team, token, { forMember: member });
    expect(await bodyOf(await send(viewer, "POST", `/api/servers/${id}/rejoin`, { code }))).toEqual(
      { status: 200, body: { rejoined: true } },
    );
    expect(
      await bodyOf(await send(viewer, "POST", `/api/servers/${id}/rejoin`, { code })),
    ).toMatchObject({ status: 403, body: { error: "code" } });
    expect(
      await bodyOf(await send(viewer, "POST", "/api/servers/nope/rejoin", { code })),
    ).toMatchObject({ status: 404 });

    expect(await bodyOf(await send(viewer, "POST", `/api/servers/${id}/mute`, {}))).toEqual({
      status: 200,
      body: { muted: true },
    });
    expect(serverById(own.db, id)?.muted).toBe(true);
    expect(await bodyOf(await send(viewer, "POST", `/api/servers/${id}/unmute`, {}))).toEqual({
      status: 200,
      body: { muted: false },
    });
    expect(
      await bodyOf(
        await send(viewer, "POST", `/api/servers/${id}/mute`, { member: "r27ju6vmw3ly" }),
      ),
    ).toEqual({ status: 200, body: { muted: true } });

    expect(
      (await bodyOf(await send(viewer, "POST", `/api/servers/${id}/resume`, {}))).body.preview,
    ).toEqual([expect.objectContaining({ serverId: id, hold: null, total: 0 })]);
    setMeta(
      own.db,
      restoreHoldKey(id),
      JSON.stringify({ reason: "restore", at: own.clock.now, count: 0 }),
    );
    const preview = await bodyOf(await send(viewer, "POST", `/api/servers/${id}/resume`, {}));
    expect(preview.status).toBe(200);
    expect(preview.body.preview).toEqual([
      expect.objectContaining({
        serverId: id,
        hold: expect.objectContaining({ reason: "restore" }),
        perProject: [],
        total: 0,
      }),
    ]);
    expect(getMeta(own.db, restoreHoldKey(id))).not.toBeNull();
    expect(
      await bodyOf(await send(viewer, "POST", `/api/servers/${id}/resume`, { yes: true })),
    ).toMatchObject({ status: 200, body: { resumed: true } });
    expect(getMeta(own.db, restoreHoldKey(id))).toBeNull();
  }, 60_000);
});

describe("DELETE /api/servers/<id>", () => {
  test("open conflicts refuse without the yes; a sync that does not stop is 503; a failed withdrawal is 409; with the yes the server is removed", async () => {
    const { t: team, ui: viewer, store: own } = await world();
    const { id } = await joined();
    writeConflict(own.ctx, id, "project:x", {
      at: own.clock.now,
      localText: "t",
      localVersion: 1,
      localHash: "h",
      serverRevision: 2,
      serverHash: "s",
      proposalId: null,
    });
    expect(await bodyOf(await send(viewer, "DELETE", `/api/servers/${id}`, {}))).toMatchObject({
      status: 409,
      body: { error: "conflicts", open: 1 },
    });

    // A lease this process holds and never releases: the stop waits 30 s, then 503.
    setMeta(
      own.db,
      SYNC_LEASE,
      JSON.stringify({ owner: `sync-${process.pid}-9.9.9`, until: own.clock.now + 3_600_000 }),
    );
    const stuck = await bodyOf(
      await whileTicking(own, send(viewer, "DELETE", `/api/servers/${id}`, { yes: true })),
    );
    expect(stuck).toMatchObject({ status: 503, body: { error: "sync" } });
    own.db.run("DELETE FROM meta WHERE key = ?", [SYNC_LEASE]);
    expect(serverById(own.db, id)).not.toBeNull();

    // A sent row the server can no longer be asked to withdraw: the removal is refused with the count.
    writeSent(own.ctx, id, "entry", "shared:11111111-2222-4333-8444-555555555555", {
      revision: 1,
      hash: "h",
      localHash: "h",
      instance: "i",
      epoch: 1,
      at: own.clock.now,
    });
    await team.close();
    teamClosed = true;
    const left = await bodyOf(
      await whileTicking(
        own,
        send(viewer, "DELETE", `/api/servers/${id}`, { yes: true, withdraw: true }),
      ),
    );
    expect(left).toMatchObject({ status: 409, body: { error: "withdraw", left: 1 } });
    expect(serverById(own.db, id)).not.toBeNull();

    expect(
      await bodyOf(
        await whileTicking(own, send(viewer, "DELETE", `/api/servers/${id}`, { yes: true })),
      ),
    ).toEqual({ status: 200, body: { removed: true } });
    expect(serverById(own.db, id)).toBeNull();
    expect(readTokens(own.dataDir)[id]).toBeUndefined();
    expect(await bodyOf(await send(viewer, "DELETE", `/api/servers/${id}`, {}))).toMatchObject({
      status: 404,
    });
  }, 90_000);
});

describe("GET /api/sync and POST /api/sync/run", () => {
  test("the run starts sync --once when nothing runs, and the viewer's start spawns sync --auto once a server is listed", async () => {
    const { ui: viewer, store: own } = await world();
    expect(await bodyOf(await send(viewer, "POST", "/api/sync/run", {}))).toEqual({
      status: 200,
      body: { started: false },
    });
    await joined();
    spawned.length = 0;
    expect(await bodyOf(await send(viewer, "POST", "/api/sync/run", {}))).toEqual({
      status: 200,
      body: { started: true },
    });
    expect(spawned).toEqual([["sync", "--once"]]);
    setMeta(
      own.db,
      SYNC_LEASE,
      JSON.stringify({ owner: `sync-${process.pid}-0.8.0`, until: own.clock.now + MINUTE }),
    );
    expect(await bodyOf(await send(viewer, "POST", "/api/sync/run", {}))).toEqual({
      status: 200,
      body: { started: false },
    });
    expect(await bodyOf(await api(viewer, "/api/sync"))).toMatchObject({
      status: 200,
      body: { state: "running", pid: process.pid },
    });
    own.db.run("DELETE FROM meta WHERE key = ?", [SYNC_LEASE]);
    // The viewer's start: the same function, once a confirmed server is listed.
    await (ui as UiServer).stop();
    spawned.length = 0;
    ui = await startUi({
      dataDir: own.dataDir,
      homeDir: join(own.dataDir, "brand"),
      port: 0,
      open: false,
      now: () => own.clock.now,
      env: own.ctx.env,
      clock: own.clock,
      timers: own.timers,
      spawn: (...args: string[]) => {
        spawned.push(args);
      },
    });
    expect(spawned).toEqual([["sync", "--auto"]]);
  }, 60_000);
});

describe("the server a level or a list is set for", () => {
  test("with several servers listed the level and the sharing lists need `server`; the lists then edit that server's, not the file's", async () => {
    const { ui: viewer, store: own } = await world();
    const { id } = await joined();
    const base = realpathSync(mkdtempSync(join(tmpdir(), "wcm-ui-servers-project-")));
    bases.push(base);
    const folder = join(base, "site");
    mkdirSync(folder);
    realGit(folder, "init", "-q");
    realGit(folder, "remote", "add", "origin", "https://github.com/acme/site.git");
    const projectId = resolveProject(own.db, folder, own.clock.now).id;
    // A second confirmed server: the choice must be made.
    insertPending(
      own.db,
      serverFixture("22222222aaaaaaaa", { url: "https://two.acme.test", name: "Two" }),
    );
    own.db.run("UPDATE sharing_servers SET confirmed_at = ? WHERE server_id = ?", [
      own.clock.now,
      "22222222aaaaaaaa",
    ]);
    writeToken(own.ctx, "22222222aaaaaaaa", TOKEN);
    expect(
      await bodyOf(
        await send(viewer, "PUT", `/api/projects/${projectId}/sharing`, {
          level: "knowledge",
          confirm: true,
        }),
      ),
    ).toMatchObject({ status: 400, body: { error: "server" } });
    expect(
      await bodyOf(
        await send(viewer, "PUT", `/api/projects/${projectId}/sharing`, {
          level: "knowledge",
          confirm: true,
          server: id,
        }),
      ),
    ).toMatchObject({ status: 200, body: { level: "knowledge" } });
    expect(
      await bodyOf(
        await send(viewer, "PUT", "/api/settings", {
          WIZARDINGCODE_MEM_SHARE_ROOTS: "workspace",
          confirm: true,
        }),
      ),
    ).toMatchObject({ status: 400, body: { error: "server" } });
    expect(
      (
        await send(viewer, "PUT", "/api/settings", {
          WIZARDINGCODE_MEM_SHARE_ROOTS: "workspace",
          confirm: true,
          server: id,
        })
      ).status,
    ).toBe(200);
    expect(serverLists(own.db, id).roots).toEqual(["workspace"]);
    const envFile = join(own.dataDir, "env");
    expect(existsSync(envFile) ? readFileSync(envFile, "utf8") : "").not.toContain("SHARE_ROOTS");
    // A key that is not a sharing one needs no server.
    expect(
      (await send(viewer, "PUT", "/api/settings", { WIZARDINGCODE_MEM_RETENTION_DAYS: "120" }))
        .status,
    ).toBe(200);
  }, 60_000);
});

describe("the level the dock shows", () => {
  test("a project at Receive only reads receive in the project list, bound to its server, and can be set back to Nothing", async () => {
    const { ui: viewer, store: own } = await world();
    const { id } = await joined();
    const base = realpathSync(mkdtempSync(join(tmpdir(), "wcm-ui-servers-receive-")));
    bases.push(base);
    const folder = join(base, "site");
    mkdirSync(folder);
    realGit(folder, "init", "-q");
    realGit(folder, "remote", "add", "origin", "https://github.com/acme/site.git");
    const projectId = resolveProject(own.db, folder, own.clock.now).id;
    expect(
      await bodyOf(
        await send(viewer, "PUT", `/api/projects/${projectId}/sharing`, { level: "receive" }),
      ),
    ).toMatchObject({ status: 200, body: { level: "receive" } });
    const listed = async () => {
      const overview = await bodyOf(await api(viewer, "/api/overview"));
      return (
        overview.body.projects as {
          id: number;
          sharing: string;
          sharingReason: string;
          server: { id: string } | null;
        }[]
      ).find((p) => p.id === projectId);
    };
    expect(await listed()).toMatchObject({
      sharing: "receive",
      sharingReason: "level-receive",
      server: { id },
    });
    expect(
      await bodyOf(
        await send(viewer, "PUT", `/api/projects/${projectId}/sharing`, { level: "local" }),
      ),
    ).toMatchObject({ status: 200, body: { level: "local" } });
    expect(await listed()).toMatchObject({ sharing: "local", server: null });
  }, 60_000);
});
