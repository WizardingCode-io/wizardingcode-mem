import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { openTeamExisting, teamPaths } from "../../src/team/db.ts";
import { readHighWater } from "../../src/team/instance.ts";
import { entryByUuid, getMeta, memoryByKey, sequenceHighWater } from "../../src/team/store.ts";
import { runCliWith } from "../helpers/cli.ts";
import {
  ALIAS_A,
  adminOf,
  api,
  cleanTestDirs,
  entryPayload,
  type Joined,
  joinAs,
  memberOf,
  memoryPayload,
  pushOne,
  sendOf,
  startTestServer,
  type TestServer,
} from "../helpers/team.ts";

const open: TestServer[] = [];
afterEach(async () => {
  for (const t of open.splice(0)) await t.close();
});
afterAll(() => cleanTestDirs());

interface Team {
  t: TestServer;
  admin: Joined;
  ana: Joined;
}

/** A server on the real clock, so the lease it holds reads fresh to a subcommand in another process. */
async function team(): Promise<Team> {
  const t = await startTestServer({ now: Date.now });
  open.push(t);
  const admin = await adminOf(t, "Admin");
  const ana = await memberOf(t, admin.token, "Ana");
  return { t, admin, ana };
}

const cli = (t: TestServer, ...args: string[]) =>
  runCliWith(
    { env: { WIZARDINGCODE_MEM_TEAM_DATA: t.dir, WIZARDINGCODE_MEM_MIGRATE: "off" } },
    "serve",
    ...args,
  );

const jsonOut = (stdout: string) => JSON.parse(stdout.trim()) as Record<string, unknown>;
const auditCount = (t: TestServer) =>
  t.server.db.query<{ n: number }, []>("SELECT count(*) AS n FROM audit").get()?.n ?? 0;
const auditActions = (t: TestServer) =>
  t.server.db
    .query<{ action: string; source: string }, []>("SELECT action, source FROM audit ORDER BY id")
    .all()
    .map((row) => `${row.source}:${row.action}`);
const lastAudit = (t: TestServer) =>
  t.server.db
    .query<{ source: string; action: string; target: string | null }, []>(
      "SELECT source, action, target FROM audit ORDER BY id DESC LIMIT 1",
    )
    .get();
const marks = (t: TestServer) => readHighWater(teamPaths(t.dir).feedFile);

/** A writer subcommand: exit 0, one audit row, and the high-water file moved with it. */
async function writer(t: TestServer, ...args: string[]) {
  const before = auditCount(t);
  const result = await cli(t, ...args);
  expect({ args, exitCode: result.exitCode }).toEqual({ args, exitCode: 0 });
  expect(auditCount(t)).toBe(before + 1);
  expect(marks(t).audit).toBe(sequenceHighWater(t.server.db, "audit"));
  return result;
}

describe("invitations and members from the shell", () => {
  test("invite prints a code alone that joins; --for binds a device; bad input exits 64; unknown member exits 1", async () => {
    const { t, ana } = await team();
    const before = auditCount(t);
    const invite = await cli(t, "invite", "--role", "member", "--name", "Rui");
    expect(invite.exitCode).toBe(0);
    expect(invite.stdout.trim()).toMatch(/^wci1_[A-Z2-7]{26}$/);
    expect(invite.stdout.trim().split("\n")).toHaveLength(1);
    const rui = await joinAs(t.server, invite.stdout.trim(), "rui laptop");
    expect(rui.name).toBe("Rui");
    expect(rui.role).toBe("member");
    expect(auditCount(t)).toBe(before + 2);
    expect(marks(t).audit).toBe(sequenceHighWater(t.server.db, "audit"));

    const forAna = await cli(t, "invite", "--for", ana.memberId);
    expect(forAna.exitCode).toBe(0);
    const desk = await joinAs(t.server, forAna.stdout.trim(), "ana desk");
    expect(desk.memberId).toBe(ana.memberId);

    expect((await cli(t, "invite", "--role", "member", "--name", "agent:x")).exitCode).toBe(64);
    expect((await cli(t, "invite", "--role", "owner", "--name", "X")).exitCode).toBe(64);
    expect((await cli(t, "invite")).exitCode).toBe(64);
    expect(
      (await cli(t, "invite", "--role", "member", "--name", "X", "--expires", "0")).exitCode,
    ).toBe(64);
    const unknown = await cli(t, "invite", "--for", "nobody");
    expect(unknown.exitCode).toBe(1);
    expect(unknown.stderr).toContain("unknown");
  });

  test("invitations lists, invitation revoke makes the code 410, members lists members and devices; readers write nothing", async () => {
    const { t, admin, ana } = await team();
    const made = await cli(t, "invite", "--role", "member", "--name", "Eva");
    const code = made.stdout.trim();
    const before = auditCount(t);
    const actionsBefore = auditActions(t);
    const fileBefore = readFileSync(teamPaths(t.dir).feedFile, "utf8");
    const list = await cli(t, "invitations");
    expect(list.exitCode).toBe(0);
    const line = list.stdout.split("\n").find((row) => row.includes("Eva"));
    expect(line).toBeDefined();
    const id = (line as string).trim().split(/\s+/)[0] as string;
    expect(id).toMatch(/^[a-z2-7]{12}$/);
    const members = await cli(t, "members");
    expect(members.exitCode).toBe(0);
    expect(members.stdout).toContain(admin.memberId);
    expect(members.stdout).toContain("Ana");
    expect(members.stdout).toContain(ana.deviceAlias);
    expect(auditActions(t)).toEqual(actionsBefore);
    expect(readFileSync(teamPaths(t.dir).feedFile, "utf8")).toBe(fileBefore);
    expect(members.stderr).not.toContain("wci1_");

    const revoked = await cli(t, "invitation", "revoke", id);
    expect(revoked.exitCode).toBe(0);
    expect(jsonOut(revoked.stdout)).toEqual({ event: "invitation-revoked", id });
    expect(auditCount(t)).toBe(before + 1);
    expect(lastAudit(t)).toMatchObject({ source: "cli", action: "invitation revoked", target: id });
    expect((await api(t.server, null, "POST", "/v1/join", { code, label: "x" })).status).toBe(410);
    expect((await cli(t, "invitation", "revoke", "nope")).exitCode).toBe(1);
  });

  test("revoke, disable --withdraw, enable, role; the last admin stays with the hint on stderr", async () => {
    const { t, admin, ana } = await team();
    const ws = entryPayload({ scope: "workspace", slug: "mine" });
    const m = memoryPayload({ rowId: 1 });
    await pushOne(t.server, ana.token, sendOf(ws));
    await pushOne(t.server, ana.token, sendOf(m));
    const desk = await joinAs(
      t.server,
      (await cli(t, "invite", "--for", ana.memberId)).stdout.trim(),
      "desk",
    );
    const revoked = await writer(t, "revoke", desk.deviceId);
    expect(jsonOut(revoked.stdout)).toEqual({ event: "device-revoked", id: desk.deviceId });
    expect((await api(t.server, desk.token, "GET", "/v1/me")).status).toBe(401);
    const last = await cli(t, "revoke", admin.deviceId);
    expect(last.exitCode).toBe(1);
    expect(last.stderr).toContain("the last admin stays");
    expect(last.stderr).toContain("serve invite --for");

    const disabled = await writer(t, "disable", ana.memberId, "--withdraw");
    expect(disabled.exitCode).toBe(0);
    expect(jsonOut(disabled.stdout)).toEqual({
      event: "member-disabled",
      id: ana.memberId,
      devices: 1,
      withdrawn: 2,
    });
    expect((await api(t.server, ana.token, "GET", "/v1/me")).status).toBe(403);
    expect(entryByUuid(t.server.db, ws.uid.slice(-36))?.withdrawn_at).not.toBeNull();
    expect(memoryByKey(t.server.db, ana.deviceId, m.uid)?.withdrawn_at).not.toBeNull();
    expect(lastAudit(t)).toMatchObject({
      source: "cli",
      action: "member disabled",
      target: ana.memberId,
    });
    const enabled = await writer(t, "enable", ana.memberId);
    expect(jsonOut(enabled.stdout)).toEqual({ event: "member-enabled", id: ana.memberId });
    const back = await joinAs(
      t.server,
      (await cli(t, "invite", "--for", ana.memberId)).stdout.trim(),
      "again",
    );
    expect((await api(t.server, back.token, "GET", "/v1/me")).status).toBe(200);

    const role = await writer(t, "role", ana.memberId, "admin");
    expect(jsonOut(role.stdout)).toEqual({ event: "role-set", id: ana.memberId, role: "admin" });
    expect((await api(t.server, back.token, "GET", "/v1/me")).body.member.role).toBe("admin");
    expect((await cli(t, "role", ana.memberId, "owner")).exitCode).toBe(64);
    expect((await cli(t, "role", "nobody", "member")).exitCode).toBe(1);
    expect((await cli(t, "enable", "nobody")).exitCode).toBe(1);
    expect((await cli(t, "disable", "nobody")).exitCode).toBe(1);
  });
});

describe("items from the shell", () => {
  test("withdraw entry and memory tombstone and lock; reinstate unlocks; unknown exits 1", async () => {
    const { t, ana } = await team();
    const p = entryPayload({ scope: "project", remoteAlias: ALIAS_A, slug: "p" });
    const m = memoryPayload({ rowId: 2 });
    await pushOne(t.server, ana.token, sendOf(p));
    await pushOne(t.server, ana.token, sendOf(m));
    const withdrawn = await writer(t, "withdraw", "entry", p.uid);
    expect(withdrawn.exitCode).toBe(0);
    expect(jsonOut(withdrawn.stdout)).toEqual({ event: "withdrawn", uid: p.uid, revision: 2 });
    expect(entryByUuid(t.server.db, p.uid.slice(-36))).toMatchObject({
      revision: 2,
      locked_by_admin: 1,
    });
    const feedUid = `remote:${ana.deviceAlias}:${m.uid}`;
    expect(jsonOut((await cli(t, "withdraw", "memory", feedUid)).stdout)).toEqual({
      event: "withdrawn",
      uid: feedUid,
      revision: 2,
    });
    expect(memoryByKey(t.server.db, ana.deviceId, m.uid)?.locked_by_admin).toBe(1);
    expect(lastAudit(t)).toMatchObject({
      source: "cli",
      action: "item withdrawn",
      target: feedUid,
    });
    const reinstated = await writer(t, "reinstate", "entry", p.uid);
    expect(jsonOut(reinstated.stdout)).toEqual({ event: "reinstated", uid: p.uid });
    expect(entryByUuid(t.server.db, p.uid.slice(-36))?.locked_by_admin).toBe(0);
    expect(jsonOut((await cli(t, "reinstate", "memory", feedUid)).stdout)).toEqual({
      event: "reinstated",
      uid: feedUid,
    });
    expect(
      (await cli(t, "withdraw", "entry", `shared:${"0".repeat(8)}-0000-0000-0000-000000000000`))
        .exitCode,
    ).toBe(1);
    expect((await cli(t, "withdraw", "other", "x")).exitCode).toBe(64);
  });

  test("mirror and purge run beside the fresh serve lease; purge without --yes exits 64; purge refuses a re-send", async () => {
    const { t, ana } = await team();
    const keep = entryPayload({ scope: "shared", slug: "keep" });
    const gone = entryPayload({ scope: "shared", slug: "gone" });
    await pushOne(t.server, ana.token, sendOf(keep));
    await pushOne(t.server, ana.token, sendOf(gone));
    const mirror = await cli(t, "mirror");
    expect(mirror.exitCode).toBe(0);
    expect(jsonOut(mirror.stdout)).toEqual({ event: "mirror", commits: 2, errors: [] });
    const rebuilt = await cli(t, "mirror", "--rebuild");
    expect(rebuilt.exitCode).toBe(0);
    expect(jsonOut(rebuilt.stdout)).toEqual({ event: "mirror", commits: 2, errors: [] });
    expect(mirror.stderr).not.toContain("wcm1_");

    expect((await cli(t, "purge", "entry", gone.uid)).exitCode).toBe(64);
    expect(entryByUuid(t.server.db, gone.uid.slice(-36))).not.toBeNull();
    const before = auditCount(t);
    const purged = await cli(t, "purge", "entry", gone.uid, "--yes");
    expect(purged.exitCode).toBe(0);
    expect(jsonOut(purged.stdout)).toEqual({
      event: "purged",
      uid: gone.uid,
      rows: 1,
      feedRows: 1,
      errors: [],
      wal: "truncated",
    });
    expect(entryByUuid(t.server.db, gone.uid.slice(-36))).toBeNull();
    expect(auditCount(t)).toBe(before + 1);
    expect(lastAudit(t)).toMatchObject({ source: "cli", action: "purged", target: gone.uid });
    expect(await pushOne(t.server, ana.token, sendOf(gone))).toMatchObject({
      result: "refused",
      reason: "purged",
    });
    expect((await cli(t, "purge", "entry", gone.uid, "--yes")).exitCode).toBe(1);
    const m = memoryPayload({ rowId: 3 });
    await pushOne(t.server, ana.token, sendOf(m));
    const feedUid = `remote:${ana.deviceAlias}:${m.uid}`;
    expect(jsonOut((await cli(t, "purge", "memory", feedUid, "--yes")).stdout)).toEqual({
      event: "purged",
      uid: feedUid,
      rows: 1,
      feedRows: 1,
      errors: [],
      wal: "truncated",
    });
  });
});

describe("status, audit, health, instance renew", () => {
  test("status prints key: value lines and JSON; audit the last rows newest first; health 0 or 1", async () => {
    const { t, ana } = await team();
    await pushOne(t.server, ana.token, sendOf(entryPayload({ scope: "shared", slug: "s" })));
    await cli(t, "mirror");
    const status = await cli(t, "status");
    expect(status.exitCode).toBe(0);
    const lines = status.stdout.trim().split("\n");
    const value = (key: string) =>
      lines.find((line) => line.startsWith(`${key}: `))?.slice(key.length + 2);
    expect(value("serverId")).toBe(t.server.serverId);
    expect(value("instance")).toBe(t.server.instance());
    expect(value("schema")).toBe("1");
    expect(value("members.active")).toBe("2");
    expect(value("devices.active")).toBe("2");
    expect(value("pendingBootstrap")).toBe("false");
    expect(value("lastSeq")).toBe("1");
    expect(value("mirror.pending")).toBe("0");
    expect(value("heads.shared")).toMatch(/^[0-9a-f]{40}$/);
    expect(value("lease.owner")).toMatch(/^serve-/);
    expect(status.stdout).toMatch(/^version: \d+\.\d+\.\d+/m);
    const asJson = await cli(t, "status", "--json");
    expect(asJson.exitCode).toBe(0);
    const parsed = jsonOut(asJson.stdout) as {
      serverId: string;
      instance: string;
      heads: { folder: string; head: string | null }[];
      marks: { changes: number; audit: number };
      mirror: { last: { commits: number } | null; pending: number };
      freeBytes: number | null;
    };
    expect(parsed.serverId).toBe(t.server.serverId);
    expect(parsed.heads).toEqual([{ folder: "shared", head: value("heads.shared") as string }]);
    expect(parsed.marks.changes).toBe(1);
    expect(parsed.mirror.last?.commits).toBe(1);
    expect(typeof parsed.freeBytes).toBe("number");

    const none = await runCliWith(
      {
        env: { WIZARDINGCODE_MEM_TEAM_DATA: `${t.dir}/nowhere`, WIZARDINGCODE_MEM_MIGRATE: "off" },
      },
      "serve",
      "status",
    );
    expect(none.exitCode).toBe(1);
    expect(none.stderr).toContain("no team database");

    await cli(t, "invite", "--role", "member", "--name", "Rui");
    const audit = await cli(t, "audit", "--limit", "5");
    expect(audit.exitCode).toBe(0);
    const rows = audit.stdout.trim().split("\n");
    expect(rows).toHaveLength(5);
    expect(rows[0]).toContain("invitation made");
    const all = await cli(t, "audit", "--limit", "50");
    expect(all.stdout.trim().split("\n").length).toBe(auditCount(t));
    expect(all.stdout.trim().split("\n").at(-1)).toContain("bootstrap");

    const healthy = await cli(t, "health", "--url", t.server.origin);
    expect(healthy.exitCode).toBe(0);
    expect(jsonOut(healthy.stdout)).toEqual({ ok: true });
    const closed = await cli(t, "health", "--url", "http://127.0.0.1:1");
    expect(closed.exitCode).toBe(1);
  });

  test("instance renew refuses while the lease is fresh, with the compose form, and renews after the server stops", async () => {
    const { t, ana } = await team();
    await pushOne(t.server, ana.token, sendOf(entryPayload({ scope: "shared", slug: "s" })));
    const refused = await cli(t, "instance", "renew");
    expect(refused.exitCode).toBe(1);
    expect(refused.stderr).toContain(
      "docker compose stop server && docker compose run --rm server serve instance renew",
    );
    const instance = t.server.instance();
    await t.close();
    const renewed = await cli(t, "instance", "renew");
    expect(renewed.exitCode).toBe(0);
    const out = jsonOut(renewed.stdout) as { event: string; instance: string };
    expect(out.event).toBe("instance-renewed");
    expect(out.instance).toMatch(/^[0-9a-f]{16}$/);
    expect(out.instance).not.toBe(instance);
    const db = openTeamExisting(t.dir);
    expect(getMeta(db as NonNullable<typeof db>, "server.instance")).toBe(out.instance);
    expect(sequenceHighWater(db as NonNullable<typeof db>, "changes")).toBeGreaterThanOrEqual(
      1_000_001,
    );
    db?.close();
    expect(marks(t).changes).toBeGreaterThanOrEqual(1_000_001);
  });

  test("--data names the directory for every subcommand, before or after it, as the server's child passes it", async () => {
    const { t, admin, ana } = await team();
    const bare = (...args: string[]) =>
      runCliWith({ env: { WIZARDINGCODE_MEM_MIGRATE: "off" } }, "serve", ...args);
    const before = await bare("--data", t.dir, "members");
    expect(before.exitCode).toBe(0);
    expect(before.stdout).toContain(admin.memberId);
    const after = await bare("members", "--data", t.dir);
    expect(after.exitCode).toBe(0);
    expect(after.stdout).toContain(admin.memberId);
    await pushOne(t.server, ana.token, sendOf(entryPayload({ scope: "shared", slug: "d" })));
    // The command line the server gives its child.
    const child = await bare("mirror", "--data", t.dir);
    expect(child.exitCode).toBe(0);
    expect(jsonOut(child.stdout)).toEqual({ event: "mirror", commits: 1, errors: [] });
    expect((await bare("--data")).exitCode).toBe(64);
    const status = await bare("--data", t.dir, "status", "--json");
    expect(status.exitCode).toBe(0);
    expect((jsonOut(status.stdout) as { mirror: { pending: number } }).mirror.pending).toBe(0);
  });

  test("an unknown subcommand exits 64 with the usage", async () => {
    const { t } = await team();
    const nonsense = await cli(t, "nonsense");
    expect(nonsense.exitCode).toBe(64);
    expect(nonsense.stderr).toContain("serve");
    expect(nonsense.stderr).toContain("invite");
  });
});
