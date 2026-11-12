// The registry of shared names (ADR 0028): the three routes, the names bucket, the counts
// under a name, and the operator's erasure of a name.
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EXIT_USAGE } from "../../src/cli/exit.ts";
import { RESULT_SHAPES } from "../../src/team/contract.ts";
import { teamPaths } from "../../src/team/db.ts";
import { readHighWater } from "../../src/team/instance.ts";
import { parseNameParam } from "../../src/team/routes.ts";
import { readStatus, renderStatus, type TeamStatus } from "../../src/team/status.ts";
import {
  insertName,
  listAudit,
  setEntryWithdrawn,
  upsertEntry,
  upsertMemory,
} from "../../src/team/store.ts";
import { runCliWith } from "../helpers/cli.ts";
import {
  ALIAS_A,
  adminOf,
  api,
  cleanTestDirs,
  type Joined,
  memberOf,
  newUuid,
  startTestServer,
  type TestServer,
} from "../helpers/team.ts";

const NAME = "name:wizardingcode";
const HEX16 = /^[0-9a-f]{16}$/;
const ITEM_KEYS = ["alias", "createdAt", "createdBy", "entries", "id", "lastChangeAt", "memories"];

const open: TestServer[] = [];
const homes: string[] = [];
const start = async () => {
  const t = await startTestServer({ contract: { current: 2, accepted: [1, 2] } });
  open.push(t);
  return t;
};
afterEach(async () => {
  for (const t of open.splice(0)) await t.close();
});
afterAll(() => {
  cleanTestDirs();
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

const names = (t: TestServer, token: string | null, query = "") =>
  api(t.server, token, "GET", `/v1/names${query}`);
const create = (t: TestServer, token: string | null, body: unknown) =>
  api(t.server, token, "POST", "/v1/names", body);
const one = (t: TestServer, token: string, alias: string) =>
  api(t.server, token, "GET", `/v1/names/${encodeURIComponent(alias)}`);
const auditRows = (t: TestServer) =>
  listAudit(t.server.db, 100).map((row) => [row.action, row.target, row.source]);
const marks = (t: TestServer) => readHighWater(teamPaths(t.dir).feedFile);
const statusText = (t: TestServer) => renderStatus(readStatus(t.dir, t.clock.now) as TeamStatus);

/** Two live entries, one withdrawn entry and one memory under `alias`, by the member given. */
function seedUnder(
  t: TestServer,
  alias: string,
  who: Joined,
): { uuids: string[]; memoryUid: string } {
  const db = t.server.db;
  const uuids = [newUuid(), newUuid(), newUuid()];
  for (const [index, uuid] of uuids.entries()) {
    upsertEntry(db, {
      uuid,
      scope: "project",
      projectAlias: alias,
      slug: `entry-${index}`,
      createdByMember: who.memberId,
      revision: 1,
      hash: `h${index}`,
      size: 10,
      writerMember: who.memberId,
      writerDevice: who.deviceId,
      updatedAt: 2000 + index * 1000,
    });
  }
  setEntryWithdrawn(db, uuids[2] as string, { revision: 2, withdrawnAt: 9000, lock: false });
  const memoryUid = "a1b2c3d4:7";
  upsertMemory(db, {
    deviceId: who.deviceId,
    uid: memoryUid,
    projectAlias: alias,
    payload: "{}",
    hash: "m",
    size: 2,
    revision: 1,
    updatedAt: 2500,
    memberId: who.memberId,
    receivedAt: 2500,
  });
  return { uuids, memoryUid };
}

describe("POST /v1/names", () => {
  test("a member creates a name: 201 with the item, the audit row and the mark moved; again is 409 exists with the item", async () => {
    const t = await start();
    const admin = await adminOf(t, "Admin");
    const ana = await memberOf(t, admin.token, "Ana");
    const before = marks(t).audit;
    const made = await create(t, ana.token, { alias: NAME });
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({
      alias: NAME,
      createdAt: t.clock.now,
      createdBy: { id: ana.memberId, name: "Ana" },
      entries: 0,
      memories: 0,
      lastChangeAt: null,
    });
    expect(made.body.id).toMatch(HEX16);
    expect(Object.keys(made.body).sort()).toEqual(ITEM_KEYS);
    expect(auditRows(t)).toContainEqual(["name created", NAME, "api"]);
    expect(marks(t).audit).toBeGreaterThan(before);
    const again = await create(t, admin.token, { alias: NAME });
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({
      error: "exists",
      name: { alias: NAME, id: made.body.id, createdBy: { name: "Ana" } },
      serverId: t.server.serverId,
    });
    // The body the client reads to re-open the join is the pinned nameConflict shape.
    expect(Object.keys(again.body).sort()).toEqual([
      ...(RESULT_SHAPES.nameConflict as readonly string[]),
    ]);
    expect(auditRows(t).filter(([action]) => action === "name created")).toHaveLength(1);
  });

  test("a given id is kept when unused; a bad id, a bad alias, a remote and a missing alias are 400 alias; no token 401; a disabled member 403", async () => {
    const t = await start();
    const admin = await adminOf(t, "Admin");
    const given = await create(t, admin.token, { alias: "name:given", id: "0011223344556677" });
    expect(given.status).toBe(201);
    expect(given.body.id).toBe("0011223344556677");
    for (const body of [
      { alias: "name:other", id: "001122334455667" },
      { alias: "name:other", id: "00112233445566778899aabbccddeeff" },
      { alias: "name:other", id: "00112233445566AA" },
      { alias: "name:Bad" },
      { alias: "name:x--y" },
      { alias: ALIAS_A },
      {},
      { alias: 7 },
    ]) {
      const refused = await create(t, admin.token, body);
      expect(refused.status).toBe(400);
      expect(refused.body.error).toBe("alias");
    }
    // An id another name holds is not reused: the server mints one.
    const reused = await create(t, admin.token, { alias: "name:second", id: "0011223344556677" });
    expect(reused.status).toBe(201);
    expect(reused.body.id).toMatch(HEX16);
    expect(reused.body.id).not.toBe("0011223344556677");
    expect((await create(t, null, { alias: "name:x" })).status).toBe(401);
    const ana = await memberOf(t, admin.token, "Ana");
    expect(
      (await api(t.server, admin.token, "POST", `/v1/members/${ana.memberId}/disable`, {})).status,
    ).toBe(200);
    expect((await create(t, ana.token, { alias: "name:x" })).status).toBe(403);
    expect(
      (await names(t, admin.token)).body.items.map((item: { alias: string }) => item.alias),
    ).toEqual(["name:given", "name:second"]);
  });

  test("the names bucket: ten creates an hour per member; the eleventh is 429 and writes nothing; after an hour it is 201; other buckets are untouched", async () => {
    const t = await start();
    const admin = await adminOf(t, "Admin");
    for (let i = 0; i < 10; i++) {
      expect((await create(t, admin.token, { alias: `name:n-${i}` })).status).toBe(201);
    }
    const eleventh = await create(t, admin.token, { alias: "name:n-10" });
    expect(eleventh.status).toBe(429);
    expect(eleventh.headers.get("retry-after")).toMatch(/^\d+$/);
    expect((await one(t, admin.token, "name:n-10")).status).toBe(404);
    // Another member's bucket is their own, and the devices bucket still answers the admin.
    const ana = await memberOf(t, admin.token, "Ana");
    expect((await create(t, ana.token, { alias: "name:ana" })).status).toBe(201);
    expect((await names(t, admin.token)).status).toBe(200);
    t.clock.advance(3_600_000);
    expect((await create(t, admin.token, { alias: "name:n-10" })).status).toBe(201);
  });
});

describe("GET /v1/names", () => {
  test("the live names by alias, paged: 50 by default, the clamps, after, and the bad values", async () => {
    const t = await start();
    const admin = await adminOf(t, "Admin");
    const alias = (i: number) => `name:seed-${String(i).padStart(2, "0")}`;
    for (let i = 0; i < 60; i++) {
      insertName(t.server.db, {
        alias: alias(i),
        id: i.toString(16).padStart(16, "0"),
        memberId: admin.memberId,
        deviceId: admin.deviceId,
        at: 1000 + i,
      });
    }
    const first = await names(t, admin.token);
    expect(first.status).toBe(200);
    expect(Object.keys(first.body).sort()).toEqual(["items", "more", "next"]);
    expect(first.body.items).toHaveLength(50);
    expect(first.body.more).toBe(true);
    expect(first.body.next).toBe(alias(49));
    expect(first.body.items.map((item: { alias: string }) => item.alias)).toEqual(
      Array.from({ length: 50 }, (_, i) => alias(i)),
    );
    expect(Object.keys(first.body.items[0]).sort()).toEqual(ITEM_KEYS);
    expect(first.body.items[0]).toMatchObject({
      alias: alias(0),
      id: "0".repeat(16),
      createdAt: 1000,
      createdBy: { id: admin.memberId, name: "Admin" },
      entries: 0,
      memories: 0,
      lastChangeAt: null,
    });
    const rest = await names(t, admin.token, `?after=${encodeURIComponent(first.body.next)}`);
    expect(rest.status).toBe(200);
    expect(rest.body.items.map((item: { alias: string }) => item.alias)).toEqual(
      Array.from({ length: 10 }, (_, i) => alias(50 + i)),
    );
    expect(rest.body).toMatchObject({ more: false, next: null });
    expect((await names(t, admin.token, "?limit=0")).body.items).toHaveLength(1);
    const all = await names(t, admin.token, "?limit=500");
    expect(all.body.items).toHaveLength(60);
    expect(all.body.more).toBe(false);
    // The upper clamp: with more names than a page may hold, 500 is read as 200.
    for (let i = 0; i < 150; i++) {
      insertName(t.server.db, {
        alias: `name:zz-bulk-${String(i).padStart(3, "0")}`,
        id: (1000 + i).toString(16).padStart(16, "0"),
        memberId: admin.memberId,
        deviceId: admin.deviceId,
        at: 5000 + i,
      });
    }
    const clamped = await names(t, admin.token, "?limit=500");
    expect(clamped.body.items).toHaveLength(200);
    expect(clamped.body).toMatchObject({ more: true, next: "name:zz-bulk-139" });
    expect((await names(t, admin.token, "?limit=200")).body.items).toHaveLength(200);
    expect((await names(t, admin.token, "?limit=2")).body).toMatchObject({
      more: true,
      next: alias(1),
    });
    for (const query of ["?limit=abc", "?limit=1.5"]) {
      const bad = await names(t, admin.token, query);
      expect(bad.status).toBe(400);
      expect(bad.body.error).toBe("limit");
    }
    for (const after of ["name:Bad", `name:${"x".repeat(81)}`, ALIAS_A, "name:"]) {
      const bad = await names(t, admin.token, `?after=${encodeURIComponent(after)}`);
      expect(bad.status).toBe(400);
      expect(bad.body.error).toBe("after");
    }
    expect((await names(t, null)).status).toBe(401);
  });

  test("the counts under a name: live entries and memories, the last change; a remote is never listed; a disabled creator still names", async () => {
    const t = await start();
    const admin = await adminOf(t, "Admin");
    const ana = await memberOf(t, admin.token, "Ana");
    expect((await create(t, ana.token, { alias: NAME })).status).toBe(201);
    seedUnder(t, NAME, ana);
    seedUnder(t, ALIAS_A, admin);
    const listed = await names(t, admin.token);
    expect(listed.body.items).toHaveLength(1);
    expect(listed.body.items[0]).toMatchObject({
      alias: NAME,
      entries: 2,
      memories: 1,
      lastChangeAt: 3000,
      createdBy: { id: ana.memberId, name: "Ana" },
    });
    expect((await one(t, admin.token, NAME)).body).toMatchObject({ entries: 2, memories: 1 });
    await api(t.server, admin.token, "POST", `/v1/members/${ana.memberId}/disable`, {});
    expect((await names(t, admin.token)).body.items[0]).toMatchObject({
      createdBy: { id: ana.memberId, name: "Ana" },
    });
  });
});

describe("GET /v1/names/<alias>", () => {
  test("a live name answers its item; unheld, remote, malformed answer one 404 unknown-name; an undecodable segment is not found", async () => {
    const t = await start();
    const admin = await adminOf(t, "Admin");
    const made = await create(t, admin.token, { alias: NAME });
    const found = await one(t, admin.token, NAME);
    expect(found.status).toBe(200);
    expect(found.body).toEqual(made.body);
    for (const path of [
      "/v1/names/name:unheld",
      "/v1/names/remote%3Agithub.com%2Facme%2Fsite",
      "/v1/names/name:Bad",
      "/v1/names/name%3Awizardingcode%2Fx",
    ]) {
      const missing = await api(t.server, admin.token, "GET", path);
      expect(missing.status).toBe(404);
      expect(missing.body.error).toBe("unknown-name");
    }
    const broken = await api(t.server, admin.token, "GET", "/v1/names/%E0%A4%A");
    expect(broken.status).toBe(404);
    expect(broken.body.error).toBe("not found");
    expect((await api(t.server, null, "GET", `/v1/names/${NAME}`)).status).toBe(401);
    expect(parseNameParam("remote:github.com/acme/site")).toBeNull();
    expect(parseNameParam("name:Bad")).toBeNull();
    expect(parseNameParam("")).toBeNull();
    expect(parseNameParam(NAME)).toBe(NAME);
  });
});

describe("serve purge name", () => {
  test("marks the name purged: the audit row, the counts, out of the list and the by-alias route, a create refused; again is already purged; an unheld name is no such name", async () => {
    const t = await start();
    const admin = await adminOf(t, "Admin");
    expect((await create(t, admin.token, { alias: NAME })).status).toBe(201);
    const { uuids, memoryUid } = seedUnder(t, NAME, admin);
    const home = mkdtempSync(join(tmpdir(), "wcm-names-home-"));
    homes.push(home);
    const env = { PATH: process.env.PATH ?? "", HOME: home, WIZARDINGCODE_MEM_MIGRATE: "off" };
    const serve = (...args: string[]) => runCliWith({ env }, "serve", "--data", t.dir, ...args);
    expect(statusText(t)).toContain("names: 1\n");

    const noYes = await serve("purge", "name", NAME);
    expect(noYes.exitCode).toBe(EXIT_USAGE);
    const before = marks(t).audit;
    const purge = await serve("purge", "name", NAME, "--yes");
    expect(purge.stderr).toBe("");
    expect(purge.exitCode).toBe(0);
    expect(JSON.parse(purge.stdout.trim())).toEqual({
      event: "name purged",
      alias: NAME,
      entries: 2,
      memories: 1,
    });
    expect(
      t.server.db
        .query<{ purged_at: number | null }, [string]>(
          "SELECT purged_at FROM names WHERE alias = ?",
        )
        .get(NAME)?.purged_at,
    ).toBeGreaterThan(0);
    expect(auditRows(t)).toContainEqual(["name purged", NAME, "cli"]);
    expect(marks(t).audit).toBeGreaterThan(before);
    expect((await names(t, admin.token)).body.items).toEqual([]);
    const gone = await one(t, admin.token, NAME);
    expect(gone.status).toBe(404);
    expect(gone.body.error).toBe("unknown-name");
    const again = await create(t, admin.token, { alias: NAME });
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ error: "purged", serverId: t.server.serverId });
    expect(statusText(t)).toContain("names: 0\n");

    const twice = await serve("purge", "name", NAME, "--yes");
    expect(twice.exitCode).toBe(0);
    expect(twice.stderr).toContain("already purged");
    const never = await serve("purge", "name", "name:never", "--yes");
    expect(never.exitCode).toBe(1);
    expect(never.stderr).toContain("no such name");
    const malformed = await serve("purge", "name", "name:Bad", "--yes");
    expect(malformed.exitCode).toBe(1);
    expect(malformed.stderr).toContain("no such name");

    // The items under it are purged one by one; the string stays in the server's own records
    // (the documented limit).
    for (const uuid of uuids.slice(0, 2)) {
      const purged = await serve("purge", "entry", `project:${NAME}:${uuid}`, "--yes");
      expect(purged.exitCode).toBe(0);
    }
    const memory = await serve(
      "purge",
      "memory",
      `remote:${admin.deviceAlias}:${memoryUid}`,
      "--yes",
    );
    expect(memory.exitCode).toBe(0);
    const rows = t.server.db
      .query<{ uid: string; project_alias: string | null; op: string }, [string]>(
        "SELECT uid, project_alias, op FROM changes WHERE project_alias = ? ORDER BY seq",
      )
      .all(NAME);
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(rows.every((row) => row.op === "purge")).toBe(true);
    expect(rows.filter((row) => row.uid.startsWith(`project:${NAME}:`))).toHaveLength(2);
    expect(
      auditRows(t).filter(([, target]) => typeof target === "string" && target.includes(NAME))
        .length,
    ).toBeGreaterThanOrEqual(4);
  }, 60_000);
});
