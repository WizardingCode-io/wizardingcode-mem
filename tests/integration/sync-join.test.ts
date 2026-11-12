// Joining, re-joining, leaving (ADR 0027): the token to the file first, the pending row, the
// yes that confirms, the re-join that replaces the device, the removal that stops the sync.
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { askSecret } from "../../src/cli/prompt.ts";
import { counterOf, levelRows, recentChanges } from "../../src/sharing/store.ts";
import { nameFlagKey } from "../../src/sharing/types.ts";
import { getMeta, liveLease, SYNC_LEASE, SYNC_STOP } from "../../src/store/meta.ts";
import type { Fetch } from "../../src/sync/context.ts";
import {
  confirmJoin,
  joinServer,
  muteServer,
  rejoinServer,
  removeServer,
} from "../../src/sync/join.ts";
import { runSync } from "../../src/sync/run.ts";
import {
  findServer,
  readTokens,
  ServerRefAmbiguous,
  serverById,
  serversConfigured,
  tokensPath,
} from "../../src/sync/servers.ts";
import { startSync } from "../../src/sync/spawn.ts";
import { flagName, statusReport } from "../../src/sync/state.ts";
import { runCliWith } from "../helpers/cli.ts";
import {
  cleanSyncDirs,
  fakeClock,
  fakeTimers,
  openSyncStore,
  type SyncTestStore,
  settle,
} from "../helpers/sync.ts";
import { api, cleanTestDirs, invite, startTestServer, type TestServer } from "../helpers/team.ts";

const servers: TestServer[] = [];
const stores: SyncTestStore[] = [];
afterEach(async () => {
  for (const store of stores.splice(0)) store.close();
  for (const t of servers.splice(0)) await t.close();
});
afterAll(() => {
  cleanTestDirs();
  cleanSyncDirs();
});

const realFetch: Fetch = (input, init) => fetch(input, init);
const ALIAS = "remote:github.com/acme/site";

async function serverAndStore(fetchOverride?: Fetch) {
  const clock = fakeClock();
  const timers = fakeTimers(clock);
  const t = await startTestServer({}, { clock, timers });
  servers.push(t);
  const store = openSyncStore({ clock, timers, fetch: fetchOverride ?? realFetch });
  stores.push(store);
  return { t, store, clock };
}

function project(store: SyncTestStore, id: number, alias = ALIAS): void {
  store.db.run("INSERT INTO projects (id, key, name, created_at) VALUES (?, ?, ?, 1)", [
    id,
    `${alias}#${id}`,
    `p${id}`,
  ]);
  store.db.run("INSERT INTO project_aliases (alias, project_id) VALUES (?, ?)", [alias, id]);
}

function teamLevel(store: SyncTestStore, projectId: number, level: string): void {
  store.db.run(
    `INSERT INTO sharing_levels (project_id, destination, level, bound_alias, set_at, source)
     VALUES (?, 'team', ?, ?, 1, 'cli')`,
    [projectId, level, ALIAS],
  );
}

describe("joinServer and confirmJoin", () => {
  test("the token goes to the file first, the row is pending, the yes confirms it and moves the team rows", async () => {
    const { t, store } = await serverAndStore();
    project(store, 1);
    teamLevel(store, 1, "knowledge");
    const joined = await joinServer(store.ctx, {
      url: `${t.server.origin}/`,
      code: t.code,
      label: "laptop",
      name: "Ana",
    });
    if (!joined.ok) throw new Error(`join failed: ${JSON.stringify(joined)}`);
    expect(joined).toMatchObject({
      serverId: t.server.serverId,
      name: new URL(t.server.origin).host,
      member: { name: "Ana", role: "admin" },
      first: true,
      rejoined: false,
    });
    expect(joined.limits?.pullItems).toBe(500);
    const path = tokensPath(store.dataDir);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readTokens(store.dataDir)[t.server.serverId]).toMatch(/^wcm1_/);
    const row = serverById(store.db, t.server.serverId);
    expect(row).toMatchObject({
      url: t.server.origin,
      memberName: "Ana",
      role: "admin",
      contract: 2,
      instance: t.server.instance(),
      confirmedAt: null,
      stopped: null,
    });
    expect(serversConfigured(store.db)).toBe(false);
    expect(statusReport(store.db, store.dataDir)[0]?.state).toBe("pending");
    expect(joined.wouldLeave.perProject).toEqual([
      { id: 1, level: "knowledge", entries: 0, memories: 0, imported: 0 },
    ]);
    // The token is in no table.
    const bytes = readFileSync(join(store.dataDir, "wizardingcode-mem.db"), "latin1");
    expect(bytes).not.toContain("wcm1_");

    const before = counterOf(store.db);
    expect(confirmJoin(store.ctx, t.server.serverId)).toEqual({
      first: true,
      moved: { levels: 1, ledger: 0 },
    });
    expect(serverById(store.db, t.server.serverId)?.confirmedAt).toBe(store.clock.now);
    expect(serversConfigured(store.db)).toBe(true);
    expect(levelRows(store.db).map((r) => r.destination)).toEqual([t.server.serverId]);
    expect(recentChanges(store.db, 1)[0]).toMatchObject({
      what: `server:${t.server.serverId}`,
      old: "",
      new: new URL(t.server.origin).host,
    });
    expect(counterOf(store.db)).toBe(before + 1);

    // A second add of a confirmed server is refused; the file keeps the first token.
    const again = await joinServer(store.ctx, { url: t.server.origin, code: "wci1_X", label: "x" });
    expect(again.ok).toBe(false);
    if (again.ok) throw new Error("unreachable");
    expect(again.reason).toBe("already-joined");
    expect(again.message).toContain("share server rejoin");
  });

  test("against a server at contract 1 the row stores 1, and me is read with that header (ADR 0028)", async () => {
    const clock = fakeClock();
    const timers = fakeTimers(clock);
    const t = await startTestServer({ contract: { current: 1, accepted: [1] } }, { clock, timers });
    servers.push(t);
    const store = openSyncStore({ clock, timers, fetch: realFetch });
    stores.push(store);
    const joined = await joinServer(store.ctx, {
      url: t.server.origin,
      code: t.code,
      label: "laptop",
      name: "Ana",
    });
    if (!joined.ok) throw new Error(`join failed: ${JSON.stringify(joined)}`);
    expect(joined.limits?.pullItems).toBe(500);
    expect(serverById(store.db, t.server.serverId)?.contract).toBe(1);
  });

  test("a join whose answer is lost leaves no token and no row; a new code joins", async () => {
    const minted: { current: { token: string; memberId: string } | null } = { current: null };
    const dropping: Fetch = async (input, init) => {
      const response = await fetch(input, init);
      if (minted.current === null && String(input).endsWith("/v1/join")) {
        // The server answered; the answer never reaches the client. The test keeps it, as the
        // orphan device on the server holds it, to mint the new code an admin would give.
        minted.current = (await response.json()) as { token: string; memberId: string };
        throw new TypeError("fetch failed: connection reset");
      }
      return response;
    };
    const { t, store } = await serverAndStore(dropping);
    const lost = await joinServer(store.ctx, {
      url: t.server.origin,
      code: t.code,
      label: "laptop",
    });
    expect(lost.ok).toBe(false);
    if (lost.ok) throw new Error("unreachable");
    expect(lost.reason).toBe("network");
    expect(existsSync(tokensPath(store.dataDir))).toBe(false);
    expect(serverById(store.db, t.server.serverId)).toBeNull();
    // The bootstrap code is used: a second try with it is refused and writes nothing.
    const used = await joinServer(store.ctx, {
      url: t.server.origin,
      code: t.code,
      label: "laptop",
    });
    expect(used.ok).toBe(false);
    if (used.ok) throw new Error("unreachable");
    expect(["refused", "gone"]).toContain(used.reason);
    expect(serverById(store.db, t.server.serverId)).toBeNull();
    if (minted.current === null) throw new Error("the server minted nothing");
    const fresh = await invite(t, minted.current.token, { forMember: minted.current.memberId });
    const joined = await joinServer(store.ctx, {
      url: t.server.origin,
      code: fresh,
      label: "laptop",
    });
    expect(joined.ok).toBe(true);
    expect(serverById(store.db, t.server.serverId)?.confirmedAt).toBeNull();
    expect(readTokens(store.dataDir)[t.server.serverId]).toMatch(/^wcm1_/);
  });

  test("a wrong code is refused with the reason, nothing written", async () => {
    const { t, store } = await serverAndStore();
    const refused = await joinServer(store.ctx, {
      url: t.server.origin,
      code: `wci1_${"A".repeat(26)}`,
      label: "laptop",
    });
    expect(refused.ok).toBe(false);
    if (refused.ok) throw new Error("unreachable");
    expect(["refused", "gone"]).toContain(refused.reason);
    expect(existsSync(tokensPath(store.dataDir))).toBe(false);
    expect(serverById(store.db, t.server.serverId)).toBeNull();
    const bad = await joinServer(store.ctx, {
      url: "http://localhost.example.com",
      code: "x",
      label: "l",
    });
    expect(bad.ok).toBe(false);
    if (bad.ok) throw new Error("unreachable");
    expect(bad.reason).toBe("url");
  });

  test("an answer whose server id the received store could not write a path for is refused, nothing written", async () => {
    const rewriting: Fetch = async (input, init) => {
      const response = await fetch(input, init);
      if (!String(input).endsWith("/v1/join")) return response;
      const body = (await response.json()) as Record<string, unknown>;
      const headers = new Headers(response.headers);
      headers.delete("content-length");
      return new Response(JSON.stringify({ ...body, serverId: "s1" }), {
        status: response.status,
        headers,
      });
    };
    const { t, store } = await serverAndStore(rewriting);
    const refused = await joinServer(store.ctx, {
      url: t.server.origin,
      code: t.code,
      label: "laptop",
    });
    expect(refused).toMatchObject({ ok: false, reason: "server-id" });
    if (refused.ok) throw new Error("unreachable");
    expect(refused.message).toContain('"s1"');
    expect(existsSync(tokensPath(store.dataDir))).toBe(false);
    expect(serversConfigured(store.db)).toBe(false);
  });
});

describe("rejoin, remove, mute", () => {
  async function joinedAndConfirmed() {
    const { t, store, clock } = await serverAndStore();
    const joined = await joinServer(store.ctx, {
      url: t.server.origin,
      code: t.code,
      label: "laptop",
      name: "Ana",
    });
    if (!joined.ok) throw new Error("join failed");
    confirmJoin(store.ctx, t.server.serverId);
    return {
      t,
      store,
      clock,
      serverId: t.server.serverId,
      token: readTokens(store.dataDir)[t.server.serverId] as string,
    };
  }

  test("rejoin after a revoke replaces the token and the device and keeps the ledger; add of a stopped server does the same", async () => {
    const { t, store, serverId, token } = await joinedAndConfirmed();
    store.db.run(
      `INSERT INTO sharing_ledger (destination, item_kind, item_uid, direction, version, hash, policy_epoch, at)
       VALUES (?, 'entry', 'workspace:a', 'sent', 1, 'h', 1, 1)`,
      [serverId],
    );
    const before = serverById(store.db, serverId);
    // A device never revokes itself: a second device of the member revokes the first.
    const otherCode = await invite(t, token, { forMember: before?.memberId as string });
    const other = await api(t.server, null, "POST", "/v1/join", {
      code: otherCode,
      label: "other",
    });
    expect(other.status).toBe(200);
    const otherToken = other.body.token as string;
    const revoked = await api(
      t.server,
      otherToken,
      "POST",
      `/v1/devices/${before?.deviceId}/revoke`,
      {},
    );
    expect(revoked.status).toBe(200);
    store.db.run("UPDATE sharing_servers SET stopped = 'unauthorized' WHERE server_id = ?", [
      serverId,
    ]);
    const code = await invite(t, otherToken, { forMember: before?.memberId as string });
    const rejoined = await rejoinServer(store.ctx, serverId, { code, label: "desk" });
    if (!rejoined.ok) throw new Error(`rejoin failed: ${JSON.stringify(rejoined)}`);
    const after = serverById(store.db, serverId);
    expect(after?.deviceId).not.toBe(before?.deviceId);
    expect(after?.deviceAlias).not.toBe(before?.deviceAlias);
    expect(after?.stopped).toBeNull();
    expect(after?.snapshotDue).toBe(true);
    expect(after?.confirmedAt).toBe(before?.confirmedAt ?? null);
    expect(readTokens(store.dataDir)[serverId]).not.toBe(token);
    expect(
      store.db
        .query<{ n: number }, [string]>(
          "SELECT count(*) AS n FROM sharing_ledger WHERE destination = ?",
        )
        .get(serverId)?.n,
    ).toBe(1);

    store.db.run("UPDATE sharing_servers SET stopped = 'rejoin' WHERE server_id = ?", [serverId]);
    const second = await invite(t, otherToken, { forMember: before?.memberId as string });
    const added = await joinServer(store.ctx, {
      url: t.server.origin,
      code: second,
      label: "third",
    });
    if (!added.ok) throw new Error(`add failed: ${JSON.stringify(added)}`);
    expect(added.rejoined).toBe(true);
    expect(serverById(store.db, serverId)?.stopped).toBeNull();
    expect(serverById(store.db, serverId)?.confirmedAt).not.toBeNull();
  });

  test("remove stops a running sync, deletes the rows, the levels, the token and logs; the next spawn restarts the sync", async () => {
    const { t, store, clock, serverId } = await joinedAndConfirmed();
    project(store, 1);
    store.db.run(
      `INSERT INTO sharing_levels (project_id, destination, level, bound_alias, set_at, source)
       VALUES (1, ?, 'knowledge', ?, 1, 'cli')`,
      [serverId, ALIAS],
    );
    const run = runSync(store.ctx, {
      once: false,
      hooks: { pullOnce: async () => ({ ok: true, held: false }) },
      viewerLive: async () => false,
    });
    await settle();
    expect(liveLease(store.db, SYNC_LEASE, clock.now)?.owner).toBe(`sync-${process.pid}-0.8.0`);
    // A shared name's flag (ADR 0028) goes with the server.
    flagName(store.ctx, serverId, "name:brand", "missing");
    const removing = removeServer(store.ctx, serverId, { withdraw: false, yes: true });
    await settle();
    // The flag is set; the sync leaves within five seconds; the removal then does its work.
    expect(getMeta(store.db, SYNC_STOP)).not.toBeNull();
    clock.advance(5_000);
    await settle();
    expect(await run).toBe(0);
    clock.advance(250);
    await settle();
    const removed = await removing;
    expect(removed).toMatchObject({ ok: true, levels: 1 });
    expect(serverById(store.db, serverId)).toBeNull();
    expect(levelRows(store.db)).toEqual([]);
    expect(readTokens(store.dataDir)[serverId]).toBeUndefined();
    expect(getMeta(store.db, SYNC_STOP)).toBeNull();
    expect(getMeta(store.db, nameFlagKey("missing", serverId, "name:brand"))).toBeNull();
    const changes = recentChanges(store.db, 2).reverse();
    expect(changes.map((c) => [c.what, c.old, c.new])).toEqual([
      [`project:1@${serverId}`, "knowledge", "local"],
      [`server:${serverId}`, new URL(t.server.origin).host, ""],
    ]);
    const spawned: string[][] = [];
    expect(
      startSync(store.db, {}, clock.now, (...args) => {
        spawned.push(args);
      }),
    ).toBe("no-server");

    // Removing nothing: a refusal that names the reference.
    const gone = await removeServer(store.ctx, serverId, { withdraw: false, yes: true });
    expect(gone.ok).toBe(false);
  });

  test("remove refuses while the sync does not stop, and leaves everything in place", async () => {
    const { store, clock, serverId } = await joinedAndConfirmed();
    // A live holder of this process that never reads the flag.
    store.db.run("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", [
      SYNC_LEASE,
      JSON.stringify({ owner: `sync-${process.pid}-0.8.0`, until: clock.now + 600_000 }),
    ]);
    const removing = removeServer(store.ctx, serverId, { withdraw: false, yes: true });
    await settle();
    clock.advance(30_250);
    await settle();
    const refused = await removing;
    expect(refused).toMatchObject({ ok: false });
    if (refused.ok) throw new Error("unreachable");
    expect(refused.message).toContain("sync stop");
    expect(serverById(store.db, serverId)).not.toBeNull();
    expect(readTokens(store.dataDir)[serverId]).toBeDefined();
    expect(getMeta(store.db, SYNC_STOP)).toBeNull();
  });

  test("mute and unmute, a member's too, each logged; an ambiguous reference is refused", async () => {
    const { store, serverId } = await joinedAndConfirmed();
    muteServer(store.ctx, serverId, { muted: true });
    expect(serverById(store.db, serverId)?.muted).toBe(true);
    muteServer(store.ctx, serverId, { muted: true, memberId: "mem-9" });
    muteServer(store.ctx, serverId, { muted: false });
    expect(serverById(store.db, serverId)?.muted).toBe(false);
    expect(
      recentChanges(store.db, 3)
        .reverse()
        .map((c) => [c.what, c.old, c.new]),
    ).toEqual([
      [`server:${serverId}`, "", "mute"],
      [`server:${serverId}`, "", "mute:mem-9"],
      [`server:${serverId}`, "mute", ""],
    ]);
    store.db.run(
      `INSERT INTO sharing_servers (server_id, url, name, device_id, device_alias, member_id,
         member_name, role, contract, instance, added_at)
       VALUES ('other', 'https://other.example.com', ?, 'd', 'a', 'm', 'n', 'member', 1, 'i', 1)`,
      [serverById(store.db, serverId)?.name as string],
    );
    expect(() => findServer(store.db, serverById(store.db, serverId)?.name as string)).toThrow(
      ServerRefAmbiguous,
    );
  });
});

describe("askSecret", () => {
  test("refuses without a terminal and reads one line with a terminal", () => {
    expect(askSecret("Code:", { isTTY: false, readLine: () => "never" })).toBeNull();
    expect(askSecret("Code:", { isTTY: true, readLine: () => "  wci1_X  " })).toBe("wci1_X");
    expect(askSecret("Code:", { isTTY: true, readLine: () => null })).toBeNull();
  });
});

describe("share server through the CLI", () => {
  const env = (store: SyncTestStore) => ({
    PATH: process.env.PATH ?? "",
    HOME: store.dataDir,
    WIZARDINGCODE_HOME: store.dataDir,
    WIZARDINGCODE_MEM_DATA_DIR: store.dataDir,
    WIZARDINGCODE_MEM_MIGRATE: "off",
    WIZARDINGCODE_MEM_DISTILL: "off",
    WIZARDINGCODE_MEM_UI_AUTO_OPEN: "off",
    WIZARDINGCODE_MEM_SYNC: "off",
  });

  test("add without a terminal needs --yes; with it the row is confirmed; list and a second add", async () => {
    const { t, store } = await serverAndStore();
    const cli = (...args: string[]) => runCliWith({ env: env(store) }, "share", "server", ...args);
    const noYes = await cli("add", t.server.origin, "--code", t.code, "--name", "Ana", "--no-sync");
    expect(noYes.exitCode).toBe(1);
    expect(noYes.stderr).toContain("--yes");
    expect(noYes.stdout).toContain("Ana");
    expect(noYes.stdout).not.toContain("wcm1_");
    expect(noYes.stderr).not.toContain("wcm1_");
    const pendingRow = serverById(store.db, t.server.serverId);
    expect(pendingRow?.confirmedAt).toBeNull();
    const listed = await cli("list");
    expect(listed.exitCode).toBe(0);
    expect(listed.stdout).toContain("pending");
    expect(listed.stdout).not.toContain("wcm1_");

    // The pending device's token mints the next code, as an admin would.
    const token = readTokens(store.dataDir)[t.server.serverId] as string;
    const code = await invite(t, token, { forMember: pendingRow?.memberId as string });
    const yes = await cli("add", t.server.origin, "--code", code, "--yes", "--no-sync");
    expect(yes.exitCode).toBe(0);
    expect(yes.stdout).toContain("confirmed");
    expect(yes.stdout).not.toContain("wcm1_");
    expect(serverById(store.db, t.server.serverId)?.confirmedAt).not.toBeNull();
    const ok = await cli("list");
    expect(ok.stdout).toContain("ok");

    const again = await cli("add", t.server.origin, "--code", code, "--yes", "--no-sync");
    expect(again.exitCode).toBe(1);
    expect(again.stderr).toContain("already joined");
    const noCode = await cli("add", t.server.origin, "--yes");
    expect(noCode.exitCode).toBe(1);
    expect(noCode.stderr).toContain("--code");
    const usage = await cli("add");
    expect(usage.exitCode).toBe(64);
  });
});
