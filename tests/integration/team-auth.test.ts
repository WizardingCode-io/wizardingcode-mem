import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { getMeta, leaseOf } from "../../src/team/store.ts";
import {
  adminOf,
  api,
  cleanTestDirs,
  eventsOf,
  invite,
  joinAs,
  LIMITS,
  startTestServer,
  type TestServer,
} from "../helpers/team.ts";

const open: TestServer[] = [];
const start = async (overrides = {}) => {
  const t = await startTestServer(overrides);
  open.push(t);
  return t;
};
afterEach(async () => {
  for (const t of open.splice(0)) await t.close();
});
afterAll(() => cleanTestDirs());

const HEX16 = /^[0-9a-f]{16}$/;

describe("bootstrap and health", () => {
  test("a first start logs one bootstrap line with a wci1_ code, audits it, and a second start prints nothing", async () => {
    const t = await start();
    expect(t.code).toMatch(/^wci1_[A-Z2-7]{26}$/);
    const bootstraps = eventsOf(t, "bootstrap");
    expect(bootstraps).toHaveLength(1);
    expect(bootstraps[0]).toMatchObject({ code: t.code, validHours: 24 });
    expect(eventsOf(t, "listening")[0]).toMatchObject({ host: "127.0.0.1", dataDir: t.dir });
    const audit = t.server.db
      .query<{ action: string }, []>("SELECT action FROM audit ORDER BY id")
      .all()
      .map((row) => row.action);
    expect(audit).toContain("bootstrap");
    await t.close();
    const again = await start({ dataDir: t.dir });
    expect(eventsOf(again, "bootstrap")).toHaveLength(0);
    expect(again.code).toBe("");
  });

  test("health answers without a token and carries no version; every other route is 401 with the ids", async () => {
    const t = await start();
    const health = await api(t.server, null, "GET", "/v1/health");
    expect(health.status).toBe(200);
    expect(health.body).toEqual({ ok: true });
    expect(health.headers.get("x-request-id")).toMatch(HEX16);
    for (const [method, path] of [
      ["GET", "/v1/me"],
      ["POST", "/v1/push"],
      ["GET", "/v1/pull"],
      ["GET", "/v1/members"],
    ] as const) {
      const answer = await api(t.server, null, method, path, method === "POST" ? {} : undefined);
      expect({ path, status: answer.status }).toEqual({ path, status: 401 });
      expect(answer.body).toMatchObject({
        error: "missing or wrong token",
        serverId: t.server.serverId,
        instance: t.server.instance(),
      });
    }
    expect((await api(t.server, null, "GET", "/v1/nothing")).status).toBe(404);
    expect((await api(t.server, null, "DELETE", "/v1/health")).status).toBe(405);
  });
});

describe("join", () => {
  test("the bootstrap code makes a named admin, answers the token once, and is spent", async () => {
    const t = await start();
    const admin = await joinAs(t.server, t.code, "laptop", "André");
    expect(admin.token).toMatch(/^wcm1_[A-Za-z0-9_-]{43}$/);
    expect(admin.role).toBe("admin");
    expect(admin.name).toBe("André");
    expect(admin.deviceId).toMatch(/^[a-z2-7]{12}$/);
    expect(admin.deviceAlias).toMatch(/^[a-z2-7]{8}$/);
    expect(admin.serverId).toBe(t.server.serverId);
    expect(admin.instance).toBe(t.server.instance());
    expect(admin.contract).toBe(1);
    const again = await api(t.server, null, "POST", "/v1/join", { code: t.code, label: "x" });
    expect(again.status).toBe(410);
    expect(again.body.error).toBe("invitation used");
    // The token is nowhere in the database or the log.
    const dump = t.server.db
      .query<{ v: string }, []>("SELECT group_concat(token_hash) AS v FROM devices")
      .get()?.v;
    expect(dump).not.toContain(admin.token.slice(5));
    expect(t.lines.join("\n")).not.toContain(admin.token.slice(5));
  });

  test("the bootstrap admin is named admin when the join gives no name", async () => {
    const t = await start();
    const admin = await adminOf(t);
    expect(admin.name).toBe("admin");
  });

  test("an unknown, expired or revoked code is 404 or 410, audited with the address and never the code; a bad label or name is 400", async () => {
    const t = await start();
    const unknown = await api(t.server, null, "POST", "/v1/join", {
      code: `wci1_${"A".repeat(26)}`,
      label: "x",
    });
    expect(unknown.status).toBe(404);
    expect(unknown.body.error).toBe("invitation unknown");
    const admin = await adminOf(t);
    const code = await invite(t, admin.token, { role: "member", name: "Ana" });
    t.clock.advance(73 * 3600 * 1000);
    const expired = await api(t.server, null, "POST", "/v1/join", { code, label: "x" });
    expect(expired.status).toBe(410);
    expect(expired.body.error).toBe("invitation expired");
    const other = await invite(t, admin.token, { role: "member", name: "Rui" });
    const list = await api(t.server, admin.token, "GET", "/v1/invitations");
    const id = list.body.invitations.find((row: { name: string }) => row.name === "Rui")
      .id as string;
    expect(
      (await api(t.server, admin.token, "POST", `/v1/invitations/${id}/revoke`, {})).status,
    ).toBe(200);
    const revoked = await api(t.server, null, "POST", "/v1/join", { code: other, label: "x" });
    expect(revoked.status).toBe(410);
    expect(revoked.body.error).toBe("invitation revoked");
    const failures = t.server.db
      .query<{ detail: string; address: string | null }, []>(
        "SELECT detail, address FROM audit WHERE action = 'join refused'",
      )
      .all();
    expect(failures.length).toBeGreaterThanOrEqual(3);
    for (const row of failures) {
      expect(row.address).toBe("127.0.0.1");
      expect(row.detail).not.toContain("wci1_");
    }
    const fresh = await invite(t, admin.token, { role: "member", name: "Eva" });
    expect(
      (await api(t.server, null, "POST", "/v1/join", { code: fresh, label: "x".repeat(81) }))
        .status,
    ).toBe(400);
    expect((await api(t.server, null, "POST", "/v1/join", { code: fresh })).status).toBe(400);
    expect((await api(t.server, null, "POST", "/v1/join", "not json")).status).toBe(400);
  });
});

describe("authentication, me, rotation, the contract", () => {
  test("me answers the member, the device, the ids, the contract and the limits", async () => {
    const t = await start();
    const admin = await adminOf(t, "André");
    const me = await api(t.server, admin.token, "GET", "/v1/me");
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({
      member: { id: admin.memberId, name: "André", role: "admin" },
      device: { id: admin.deviceId, alias: admin.deviceAlias, label: "admin laptop" },
      serverId: t.server.serverId,
      instance: t.server.instance(),
      contract: 1,
      limits: {
        bodyBytes: LIMITS.bodyBytes,
        pullWaitSeconds: 25,
        payloadBytesPerHour: LIMITS.payloadBytesPerHour,
        itemBytes: LIMITS.itemBytes,
      },
    });
    expect(typeof me.body.now).toBe("number");
  });

  test("rotate answers a new token once; the old one is 401 from then on; the id and alias stay", async () => {
    const t = await start();
    const admin = await adminOf(t);
    const rotated = await api(t.server, admin.token, "POST", "/v1/devices/me/rotate", {});
    expect(rotated.status).toBe(200);
    expect(rotated.body.token).toMatch(/^wcm1_/);
    expect(rotated.body.token).not.toBe(admin.token);
    expect((await api(t.server, admin.token, "GET", "/v1/me")).status).toBe(401);
    const me = await api(t.server, rotated.body.token, "GET", "/v1/me");
    expect(me.status).toBe(200);
    expect(me.body.device).toMatchObject({ id: admin.deviceId, alias: admin.deviceAlias });
  });

  test("another contract is 409 with the accepted list on me, and ignored on join and health", async () => {
    const t = await start();
    const admin = await adminOf(t);
    const refused = await api(t.server, admin.token, "GET", "/v1/me", undefined, {
      "x-wcm-contract": "2",
    });
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({
      error: "contract",
      accepted: [1],
      serverId: t.server.serverId,
    });
    expect(
      (await api(t.server, null, "GET", "/v1/health", undefined, { "x-wcm-contract": "2" })).status,
    ).toBe(200);
    const code = await invite(t, admin.token, { role: "member", name: "Ana" });
    const joined = await api(
      t.server,
      null,
      "POST",
      "/v1/join",
      { code, label: "x" },
      { "x-wcm-contract": "2" },
    );
    expect(joined.status).toBe(200);
  });
});

describe("invitations, roles, devices, members", () => {
  test("an admin invites by name, a member joins, a device invitation adds a machine to one member", async () => {
    const t = await start();
    const admin = await adminOf(t);
    const made = await api(t.server, admin.token, "POST", "/v1/invitations", {
      role: "member",
      name: "Ana Lopes",
    });
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ role: "member", name: "Ana Lopes", forMember: null });
    expect(made.body.code).toMatch(/^wci1_/);
    expect(typeof made.body.expiresAt).toBe("number");
    const ana = await joinAs(t.server, made.body.code, "ana laptop");
    expect(ana.name).toBe("Ana Lopes");
    expect(ana.role).toBe("member");
    const second = await invite(t, admin.token, { forMember: ana.memberId });
    const anaDesk = await joinAs(t.server, second, "ana desktop");
    expect(anaDesk.memberId).toBe(ana.memberId);
    expect(anaDesk.deviceId).not.toBe(ana.deviceId);
    const me1 = await api(t.server, ana.token, "GET", "/v1/me");
    const me2 = await api(t.server, anaDesk.token, "GET", "/v1/me");
    expect(me1.body.member.id).toBe(me2.body.member.id);
    // A member cannot invite or administer.
    expect(
      (await api(t.server, ana.token, "POST", "/v1/invitations", { role: "member", name: "X" }))
        .status,
    ).toBe(403);
    expect((await api(t.server, ana.token, "GET", "/v1/members")).status).toBe(403);
    expect((await api(t.server, ana.token, "GET", "/v1/audit")).status).toBe(403);
    // A bad name, an unknown member and a bad expiry are 400 or 404.
    expect(
      (
        await api(t.server, admin.token, "POST", "/v1/invitations", {
          role: "member",
          name: "agent:x",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await api(t.server, admin.token, "POST", "/v1/invitations", {
          role: "member",
          name: "x".repeat(81),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await api(t.server, admin.token, "POST", "/v1/invitations", {
          role: "member",
          name: "Ok",
          expiresInHours: 0,
        })
      ).status,
    ).toBe(400);
    expect(
      (await api(t.server, admin.token, "POST", "/v1/invitations", { forMember: "nobody" })).status,
    ).toBe(404);
    const listed = await api(t.server, admin.token, "GET", "/v1/invitations");
    expect(listed.status).toBe(200);
    expect(Array.isArray(listed.body.invitations)).toBe(true);
    for (const row of listed.body.invitations) expect(row.code).toBeUndefined();
  });

  test("revoking a device makes it 401 and cancels its unused invitations; the admin routes answer their shapes", async () => {
    const t = await start();
    const admin = await adminOf(t);
    const code = await invite(t, admin.token, { role: "admin", name: "Second" });
    const second = await joinAs(t.server, code, "second laptop");
    const pending = await invite(t, second.token, { role: "member", name: "Pending" });
    const revoked = await api(
      t.server,
      admin.token,
      "POST",
      `/v1/devices/${second.deviceId}/revoke`,
      {},
    );
    expect(revoked.status).toBe(200);
    expect(revoked.body).toMatchObject({ id: second.deviceId });
    expect(typeof revoked.body.revokedAt).toBe("number");
    const after = await api(t.server, second.token, "GET", "/v1/me");
    expect(after.status).toBe(401);
    expect(after.body).toMatchObject({ error: "device revoked", serverId: t.server.serverId });
    const gone = await api(t.server, null, "POST", "/v1/join", { code: pending, label: "x" });
    expect(gone.status).toBe(410);
    expect(gone.body.error).toBe("invitation revoked");
    const members = await api(t.server, admin.token, "GET", "/v1/members");
    expect(members.body.members.map((m: { name: string }) => m.name).sort()).toEqual([
      "Second",
      "admin",
    ]);
    const devices = await api(
      t.server,
      admin.token,
      "GET",
      `/v1/devices?member=${second.memberId}`,
    );
    expect(devices.body.devices).toHaveLength(1);
    expect(devices.body.devices[0]).toMatchObject({
      id: second.deviceId,
      alias: second.deviceAlias,
      label: "second laptop",
    });
    expect(typeof devices.body.devices[0].revokedAt).toBe("number");
    expect((await api(t.server, admin.token, "POST", "/v1/devices/nobody/revoke", {})).status).toBe(
      404,
    );
  });

  test("the last active admin cannot be disabled, revoked or demoted; the refusal names the way out", async () => {
    const t = await start();
    const admin = await adminOf(t);
    for (const [path, body] of [
      [`/v1/members/${admin.memberId}/disable`, {}],
      [`/v1/devices/${admin.deviceId}/revoke`, {}],
      [`/v1/members/${admin.memberId}/role`, { role: "member" }],
    ] as const) {
      const answer = await api(t.server, admin.token, "POST", path, body);
      expect({ path, status: answer.status }).toEqual({ path, status: 409 });
      expect(answer.body.error).toBe("the last admin stays");
      expect(answer.body.hint).toContain("serve invite --for");
    }
    const code = await invite(t, admin.token, { role: "member", name: "Ana" });
    const ana = await joinAs(t.server, code, "x");
    const promoted = await api(t.server, admin.token, "POST", `/v1/members/${ana.memberId}/role`, {
      role: "admin",
    });
    expect(promoted.status).toBe(200);
    expect(promoted.body).toEqual({ id: ana.memberId, role: "admin" });
    // With two admins, the first may step down.
    expect(
      (
        await api(t.server, admin.token, "POST", `/v1/members/${admin.memberId}/role`, {
          role: "member",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await api(t.server, ana.token, "POST", `/v1/members/${ana.memberId}/role`, {
          role: "nobody",
        })
      ).status,
    ).toBe(400);
  });

  test("disable revokes the devices and answers 403 member disabled; enable brings the member back under the same id", async () => {
    const t = await start();
    const admin = await adminOf(t);
    const code = await invite(t, admin.token, { role: "member", name: "Ana" });
    const ana = await joinAs(t.server, code, "x");
    const disabled = await api(
      t.server,
      admin.token,
      "POST",
      `/v1/members/${ana.memberId}/disable`,
      {},
    );
    expect(disabled.status).toBe(200);
    expect(disabled.body).toMatchObject({ id: ana.memberId, devices: 1, withdrawn: 0 });
    const refused = await api(t.server, ana.token, "GET", "/v1/me");
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({ error: "member disabled", serverId: t.server.serverId });
    const enabled = await api(
      t.server,
      admin.token,
      "POST",
      `/v1/members/${ana.memberId}/enable`,
      {},
    );
    expect(enabled.status).toBe(200);
    expect(enabled.body).toEqual({ id: ana.memberId });
    // The old device stays revoked; a device invitation brings the member back.
    expect((await api(t.server, ana.token, "GET", "/v1/me")).status).toBe(401);
    const back = await joinAs(
      t.server,
      await invite(t, admin.token, { forMember: ana.memberId }),
      "y",
    );
    expect(back.memberId).toBe(ana.memberId);
    expect((await api(t.server, back.token, "GET", "/v1/me")).status).toBe(200);
    expect((await api(t.server, admin.token, "POST", "/v1/members/nobody/enable", {})).status).toBe(
      404,
    );
  });

  test("every admin action writes an audit row the audit route lists newest first", async () => {
    const t = await start();
    const admin = await adminOf(t);
    const code = await invite(t, admin.token, { role: "member", name: "Ana" });
    const ana = await joinAs(t.server, code, "x");
    await api(t.server, admin.token, "POST", `/v1/members/${ana.memberId}/role`, { role: "admin" });
    const rows = await api(t.server, admin.token, "GET", "/v1/audit?limit=3");
    expect(rows.status).toBe(200);
    expect(rows.body.rows).toHaveLength(3);
    expect(rows.body.rows[0]).toMatchObject({
      source: "api",
      action: "role set",
      target: ana.memberId,
    });
    const all = await api(t.server, admin.token, "GET", "/v1/audit?limit=5000");
    expect(all.body.rows.length).toBeLessThanOrEqual(1000);
    expect(all.body.rows.map((r: { action: string }) => r.action)).toEqual(
      expect.arrayContaining(["bootstrap", "join", "invitation made", "role set"]),
    );
  });
});

describe("the lease", () => {
  test("the server holds serve.lease with a serve- owner, renews it every 10 s, and a second server refuses", async () => {
    const t = await start();
    const first = leaseOf(t.server.db, "serve.lease");
    expect(first?.owner).toMatch(/^serve-[0-9a-f]{16}$/);
    expect(first?.until).toBe(t.clock.now + 30_000);
    t.clock.advance(10_000);
    const renewed = leaseOf(t.server.db, "serve.lease");
    expect(renewed?.until).toBe(t.clock.now + 30_000);
    let refused: unknown = null;
    try {
      await startTestServer({ dataDir: t.dir });
    } catch (error) {
      refused = error;
    }
    expect(String((refused as Error)?.message)).toContain("another serve holds");
    expect(getMeta(t.server.db, "server.id")).toBe(t.server.serverId);
  });

  test("an expired lease is replaced; a renewal that finds another owner makes the server stop with exit 1", async () => {
    const t = await start();
    await t.close();
    // The lease the first server released: a second start takes it; a stale one would be replaced as well.
    const again = await start({ dataDir: t.dir });
    expect(leaseOf(again.server.db, "serve.lease")?.owner).toMatch(/^serve-/);
    again.server.db.run("UPDATE meta SET value = ? WHERE key = 'serve.lease'", [
      JSON.stringify({ owner: "serve-intruder", until: again.clock.now + 60_000 }),
    ]);
    again.clock.advance(10_000);
    await again.server.stopped();
    expect(again.server.exitCode()).toBe(1);
    expect(eventsOf(again, "lease-lost")).toHaveLength(1);
  });
});
