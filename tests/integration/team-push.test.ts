import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { entryUid } from "../../src/sharing/types.ts";
import { teamPaths } from "../../src/team/db.ts";
import { readHighWater } from "../../src/team/instance.ts";
import { insertPurged, setEntryLock } from "../../src/team/store.ts";
import {
  ALIAS_A,
  ALIAS_B,
  adminOf,
  api,
  cleanTestDirs,
  deviceOf,
  drainBucket,
  entryPayload,
  eventsOf,
  type Joined,
  LIMITS,
  memberOf,
  memoryPayload,
  newUuid,
  push,
  pushOne,
  rehashed,
  rehashedMemory,
  sendOf,
  startTestServer,
  type TestServer,
} from "../helpers/team.ts";

const open: TestServer[] = [];
const start = async () => {
  const t = await startTestServer();
  open.push(t);
  return t;
};
afterEach(async () => {
  for (const t of open.splice(0)) await t.close();
});
afterAll(() => cleanTestDirs());

interface Team {
  t: TestServer;
  admin: Joined;
  ana: Joined;
  anaDesk: Joined;
  rui: Joined;
}

/** An admin, Ana with two devices, Rui with one. */
async function team(): Promise<Team> {
  const t = await start();
  const admin = await adminOf(t, "Admin");
  const ana = await memberOf(t, admin.token, "Ana");
  const anaDesk = await deviceOf(t, admin.token, ana);
  const rui = await memberOf(t, admin.token, "Rui");
  return { t, admin, ana, anaDesk, rui };
}

interface ChangeRow {
  seq: number;
  kind: string;
  uid: string;
  key: string;
  op: string;
  scope: string;
  project_alias: string | null;
  revision: number;
  hash: string;
  moved_to: string | null;
  member_id: string;
  device_id: string;
  client_epoch: number | null;
  current: number;
}

const feedOf = (t: TestServer, key?: string): ChangeRow[] =>
  key === undefined
    ? t.server.db.query<ChangeRow, []>("SELECT * FROM changes ORDER BY seq").all()
    : t.server.db
        .query<ChangeRow, [string]>("SELECT * FROM changes WHERE key = ? ORDER BY seq")
        .all(key);

const entryRow = (t: TestServer, uuid: string) =>
  t.server.db
    .query<
      {
        scope: string;
        project_alias: string | null;
        slug: string;
        revision: number;
        hash: string;
        withdrawn_at: number | null;
        locked_by_admin: number;
        created_by_member: string;
      },
      [string]
    >(
      "SELECT scope, project_alias, slug, revision, hash, withdrawn_at, locked_by_admin, created_by_member FROM entries WHERE uuid = ?",
    )
    .get(uuid);

const revisionsOf = (t: TestServer, uuid: string) =>
  t.server.db
    .query<
      { revision: number; op: string; hash: string; writer_device: string; seq: number },
      [string]
    >(
      "SELECT revision, op, hash, writer_device, seq FROM entry_revisions WHERE uuid = ? ORDER BY revision",
    )
    .all(uuid);

const memoryRow = (t: TestServer, deviceId: string, uid: string) =>
  t.server.db
    .query<
      {
        project_alias: string;
        revision: number;
        hash: string;
        updated_at: number;
        withdrawn_at: number | null;
        locked_by_admin: number;
      },
      [string, string]
    >(
      "SELECT project_alias, revision, hash, updated_at, withdrawn_at, locked_by_admin FROM memories WHERE device_id = ? AND uid = ?",
    )
    .get(deviceId, uid);

const uuidOf = (uid: string) => uid.slice(-36);

describe("the envelope", () => {
  test("201 items is 400 items, a malformed item is 400 naming its index, a bad epoch is 400, a 1.1 MiB body is 413 with a request id", async () => {
    const { t, ana } = await team();
    const payload = entryPayload({ scope: "shared", slug: "x" });
    const many = Array.from({ length: 201 }, () => sendOf(payload));
    const tooMany = await push(t.server, ana.token, many);
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.error).toBe("items");
    expect((await push(t.server, ana.token, [])).body.error).toBe("items");
    const malformed = await push(t.server, ana.token, [
      { op: "sent", kind: "entry", uid: payload.uid, payload },
    ]);
    expect(malformed.status).toBe(400);
    expect(malformed.body.error).toBe("item 0");
    const second = await push(t.server, ana.token, [
      sendOf(payload),
      { op: "send", kind: "entry", uid: "", payload },
    ]);
    expect(second.body.error).toBe("item 1");
    expect(
      (await push(t.server, ana.token, [{ ...sendOf(payload), baseRevision: -1 }])).body.error,
    ).toBe("item 0");
    expect(
      (await push(t.server, ana.token, [{ ...sendOf(payload), baseRevision: 1.5 }])).body.error,
    ).toBe("item 0");
    expect(
      (await push(t.server, ana.token, [{ ...sendOf(payload), baseHash: 7 }])).body.error,
    ).toBe("item 0");
    expect(
      (await api(t.server, ana.token, "POST", "/v1/push", { epoch: "x", items: [sendOf(payload)] }))
        .body.error,
    ).toBe("epoch");
    expect(
      (await api(t.server, ana.token, "POST", "/v1/push", { items: [sendOf(payload)] })).status,
    ).toBe(200);
    const big = await api(
      t.server,
      ana.token,
      "POST",
      "/v1/push",
      JSON.stringify({ epoch: 1, items: [], pad: "x".repeat(1_153_434) }),
    );
    expect(big.status).toBe(413);
    expect(big.headers.get("x-request-id")).toMatch(/^[0-9a-f]{16}$/);
    // A send without a payload is kept and refused by shape, never 400.
    const noPayload = await push(t.server, ana.token, [
      { op: "send", kind: "entry", uid: payload.uid },
    ]);
    expect(noPayload.status).toBe(200);
    expect(noPayload.body.results[0]).toEqual({
      uid: payload.uid,
      result: "refused",
      reason: "shape",
    });
  });
});

describe("entry sends: revisions, idempotency, stale, appliedAs", () => {
  test("base 0 applies as revision 1; the retry is applied with nothing changed whatever its base, lock, bucket or disk", async () => {
    const { t, ana, admin } = await team();
    const payload = entryPayload({ scope: "shared", slug: "a-rule" });
    const first = await pushOne(t.server, ana.token, sendOf(payload));
    expect(first).toEqual({ uid: payload.uid, result: "applied", revision: 1, hash: payload.hash });
    expect(feedOf(t)).toHaveLength(1);
    expect(feedOf(t)[0]).toMatchObject({
      kind: "entry",
      uid: payload.uid,
      key: uuidOf(payload.uid),
      op: "upsert",
      scope: "shared",
      revision: 1,
      hash: payload.hash,
      member_id: ana.memberId,
      device_id: ana.deviceId,
      client_epoch: 1,
      current: 1,
    });
    const seqBefore = feedOf(t)[0]?.seq;
    expect(
      await pushOne(t.server, ana.token, sendOf(payload, { baseRevision: 7, baseHash: "zzz" })),
    ).toEqual(first);
    // Locked by an admin while live (the lock set directly, as no route locks a live row):
    // the retry still applies, since idempotency is read before the lock.
    setEntryLock(t.server.db, uuidOf(payload.uid), true);
    expect(await pushOne(t.server, ana.token, sendOf(payload))).toEqual(first);
    const edited = rehashed({ ...payload, body: "while locked\n" });
    expect(
      await pushOne(
        t.server,
        ana.token,
        sendOf(edited, { baseRevision: 1, baseHash: payload.hash }),
      ),
    ).toEqual({ uid: payload.uid, result: "refused", reason: "withdrawn-by-admin" });
    setEntryLock(t.server.db, uuidOf(payload.uid), false);
    // Withdrawn and locked by an admin, then reinstated: a re-send on the tombstone's base applies.
    const locked = await api(
      t.server,
      admin.token,
      "POST",
      `/v1/items/entry/${encodeURIComponent(payload.uid)}/withdraw`,
      {},
    );
    expect(locked.status).toBe(200);
    const reinstate = await api(
      t.server,
      admin.token,
      "POST",
      `/v1/items/entry/${encodeURIComponent(payload.uid)}/reinstate`,
      {},
    );
    expect(reinstate.status).toBe(200);
    // The entry is now withdrawn (revision 2): a re-send on the tombstone's base reinstates it.
    const back = await pushOne(
      t.server,
      ana.token,
      sendOf(payload, { baseRevision: 2, baseHash: payload.hash }),
    );
    expect(back).toMatchObject({ result: "applied", revision: 3 });
    // The bucket drained and the disk low: the retry of an applied item is still applied.
    drainBucket(t.server.buckets.bytes, ana.deviceId);
    t.freeBytes.value = 1024;
    expect(await pushOne(t.server, ana.token, sendOf(payload))).toEqual({
      uid: payload.uid,
      result: "applied",
      revision: 3,
      hash: payload.hash,
    });
    expect(feedOf(t).filter((row) => row.seq === seqBefore)).toHaveLength(1);
    // Not charged: after a second's refill, more retries than that refill could pay for still
    // leave the room for one fresh item.
    t.freeBytes.value = 10 * 1024 * 1024 * 1024;
    t.clock.advance(1000);
    const perItem = Buffer.byteLength(payload.frontmatter + payload.body);
    const retries = Math.ceil((2 * LIMITS.payloadBytesPerHour) / 3600 / perItem) + 1;
    for (let i = 0; i < retries; i++) {
      expect((await pushOne(t.server, ana.token, sendOf(payload))).result).toBe("applied");
    }
    const fresh = entryPayload({ scope: "shared", slug: "fresh-after-retries" });
    expect(await pushOne(t.server, ana.token, sendOf(fresh))).toMatchObject({
      result: "applied",
      revision: 1,
    });
  });

  test("a second device's send on the current base is revision 2; an old base is stale; appliedAs names the device's own earlier revision", async () => {
    const { t, ana, anaDesk, rui } = await team();
    const v1 = entryPayload({ scope: "shared", slug: "a-rule", body: "v1" });
    const uuid = uuidOf(v1.uid);
    await pushOne(t.server, ana.token, sendOf(v1));
    const v2 = rehashed({ ...v1, body: "v2\n" });
    const second = await pushOne(
      t.server,
      anaDesk.token,
      sendOf(v2, { baseRevision: 1, baseHash: v1.hash }),
    );
    expect(second).toEqual({ uid: v1.uid, result: "applied", revision: 2, hash: v2.hash });
    const v3 = rehashed({ ...v1, body: "v3\n" });
    const stale = await pushOne(
      t.server,
      rui.token,
      sendOf(v3, { baseRevision: 1, baseHash: v1.hash }),
    );
    expect(stale).toEqual({
      uid: v1.uid,
      result: "stale",
      current: { revision: 2, hash: v2.hash },
    });
    // Ana retries her revision-1 payload: stale, and told it applied as 1.
    const retry = await pushOne(t.server, ana.token, sendOf(v1, { baseRevision: 0, baseHash: "" }));
    expect(retry).toEqual({
      uid: v1.uid,
      result: "stale",
      current: { revision: 2, hash: v2.hash },
      appliedAs: 1,
    });
    // Rui pushes the same bytes on an old base: stale, no appliedAs (a revert, not a retry).
    const revert = await pushOne(
      t.server,
      rui.token,
      sendOf(v1, { baseRevision: 1, baseHash: v1.hash }),
    );
    expect(revert).toEqual({
      uid: v1.uid,
      result: "stale",
      current: { revision: 2, hash: v2.hash },
    });
    // A new entry with a non-zero base is stale against revision 0.
    const fresh = entryPayload({ scope: "shared", slug: "fresh" });
    expect(
      await pushOne(t.server, rui.token, sendOf(fresh, { baseRevision: 1, baseHash: "x" })),
    ).toEqual({ uid: fresh.uid, result: "stale", current: { revision: 0, hash: "" } });
    expect(revisionsOf(t, uuid).map((row) => [row.revision, row.op, row.writer_device])).toEqual([
      [1, "send", ana.deviceId],
      [2, "send", anaDesk.deviceId],
    ]);
    expect(revisionsOf(t, uuid).map((row) => row.seq)).toEqual(
      feedOf(t, uuid).map((row) => row.seq),
    );
    expect(feedOf(t, uuid).map((row) => row.current)).toEqual([0, 1]);
  });

  test("the same bytes under another alias, and under the same alias with another slug, are new revisions with their feed rows", async () => {
    const { t, ana } = await team();
    const inA = entryPayload({ scope: "project", remoteAlias: ALIAS_A, slug: "note" });
    const uuid = uuidOf(inA.uid);
    await pushOne(t.server, ana.token, sendOf(inA));
    const inB = { ...inA, uid: entryUid("project", ALIAS_B, uuid), remoteAlias: ALIAS_B };
    const moved = await pushOne(
      t.server,
      ana.token,
      sendOf(inB, { baseRevision: 1, baseHash: inA.hash }),
    );
    expect(moved).toEqual({ uid: inB.uid, result: "applied", revision: 2, hash: inA.hash });
    const rows = feedOf(t);
    expect(rows).toHaveLength(3);
    expect(rows[1]).toMatchObject({
      key: uuid,
      op: "upsert",
      uid: inB.uid,
      scope: "project",
      project_alias: ALIAS_B,
      revision: 2,
      current: 1,
    });
    expect(rows[2]).toMatchObject({
      key: `${uuid}@2`,
      op: "tombstone",
      uid: inA.uid,
      scope: "project",
      project_alias: ALIAS_A,
      revision: 2,
      moved_to: inB.uid,
      current: 1,
    });
    expect(rows[0]).toMatchObject({ key: uuid, current: 0 });
    expect(entryRow(t, uuid)).toMatchObject({
      scope: "project",
      project_alias: ALIAS_B,
      revision: 2,
    });
    const renamed = { ...inB, slug: "renamed" };
    const rename = await pushOne(
      t.server,
      ana.token,
      sendOf(renamed, { baseRevision: 2, baseHash: inA.hash }),
    );
    expect(rename).toMatchObject({ result: "applied", revision: 3 });
    expect(entryRow(t, uuid)?.slug).toBe("renamed");
    expect(feedOf(t)).toHaveLength(4);
    // A retry of the move is idempotent.
    expect(await pushOne(t.server, ana.token, sendOf(renamed))).toMatchObject({
      result: "applied",
      revision: 3,
    });
  });
});

describe("entry sends: refusals", () => {
  test("shape, slug, size, hash, secret, purged: refused with the reason, never 500", async () => {
    const { t, ana } = await team();
    const payload = entryPayload({ scope: "shared", slug: "a-rule" });
    const shapes: unknown[] = [
      { ...payload, frontmatter: 1 },
      { ...payload, version: "1" },
      { ...payload, extra: true },
      { ...payload, scope: "workspace" },
      entryPayload({ scope: "shared", slug: "a-rule", id: newUuid() }),
      entryPayload({ scope: "shared", slug: "a-rule", area: "Bad_Area" }),
    ];
    for (const candidate of shapes) {
      const uid = (candidate as { uid: string }).uid;
      expect(
        await pushOne(t.server, ana.token, { op: "send", kind: "entry", uid, payload: candidate }),
      ).toEqual({ uid, result: "refused", reason: "shape" });
    }
    const badUuid = { ...payload, uid: "shared:not-a-uuid" };
    expect(await pushOne(t.server, ana.token, sendOf(badUuid))).toMatchObject({
      result: "refused",
      reason: "shape",
    });
    const badAlias = entryPayload({
      scope: "project",
      remoteAlias: "remote:/Users/me/site",
      slug: "x",
    });
    expect(await pushOne(t.server, ana.token, sendOf(badAlias))).toMatchObject({
      result: "refused",
      reason: "shape",
    });
    expect(await pushOne(t.server, ana.token, sendOf({ ...payload, slug: "../x" }))).toMatchObject({
      result: "refused",
      reason: "slug",
    });
    const big = rehashed({ ...payload, body: "x".repeat(257 * 1024) });
    expect(await pushOne(t.server, ana.token, sendOf(big))).toMatchObject({
      result: "refused",
      reason: "size",
    });
    expect(
      await pushOne(t.server, ana.token, sendOf({ ...payload, hash: "0".repeat(16) })),
    ).toMatchObject({ result: "refused", reason: "hash" });
    const secret = entryPayload({
      scope: "shared",
      slug: "a-rule",
      body: `sk-ant-api03-${"a".repeat(40)}`,
    });
    expect(await pushOne(t.server, ana.token, sendOf(secret))).toEqual({
      uid: secret.uid,
      result: "refused",
      reason: "secret",
      rule: "anthropic-key",
    });
    const purgedUuid = newUuid();
    insertPurged(t.server.db, purgedUuid, t.clock.now);
    const purged = entryPayload({ scope: "shared", uuid: purgedUuid, slug: "gone" });
    expect(await pushOne(t.server, ana.token, sendOf(purged))).toEqual({
      uid: purged.uid,
      result: "refused",
      reason: "purged",
    });
    expect(feedOf(t)).toHaveLength(0);
    const line = eventsOf(t, "request")
      .filter((row) => row.route === "POST /v1/push")
      .at(-1) as { push: { refused: number; refusals: { uid: string; reason: string }[] } };
    expect(line.push.refused).toBe(1);
    expect(line.push.refusals).toEqual([{ uid: purged.uid, reason: "purged" }]);
  });

  test("a project entry under remote:github.com/acme/site applies and is keyed under that alias", async () => {
    const { t, ana } = await team();
    const payload = entryPayload({ scope: "project", remoteAlias: ALIAS_A, slug: "deploy" });
    expect(await pushOne(t.server, ana.token, sendOf(payload))).toMatchObject({
      result: "applied",
      revision: 1,
    });
    expect(feedOf(t)[0]).toMatchObject({
      scope: "project",
      project_alias: ALIAS_A,
      uid: payload.uid,
    });
  });
});

describe("ownership against the stored row", () => {
  test("a workspace entry is its creator's; shared and project entries are the team's; moves follow the rule", async () => {
    const { t, ana, rui } = await team();
    const mine = entryPayload({ scope: "workspace", slug: "mine" });
    const uuid = uuidOf(mine.uid);
    await pushOne(t.server, ana.token, sendOf(mine));
    const ruiEdit = rehashed({ ...mine, body: "rui\n" });
    expect(
      await pushOne(t.server, rui.token, sendOf(ruiEdit, { baseRevision: 1, baseHash: mine.hash })),
    ).toEqual({ uid: mine.uid, result: "refused", reason: "not-owner" });
    // Rui tries to take it into shared under the current base: the stored row is workspace, Ana's.
    const ruiShared = { ...mine, uid: `shared:${uuid}`, scope: "shared" as const };
    expect(
      await pushOne(
        t.server,
        rui.token,
        sendOf(ruiShared, { baseRevision: 1, baseHash: mine.hash }),
      ),
    ).toMatchObject({ result: "refused", reason: "not-owner" });
    // Ana moves her own workspace entry to shared: applied.
    const anaShared = { ...mine, uid: `shared:${uuid}`, scope: "shared" as const };
    expect(
      await pushOne(
        t.server,
        ana.token,
        sendOf(anaShared, { baseRevision: 1, baseHash: mine.hash }),
      ),
    ).toMatchObject({ result: "applied", revision: 2 });
    expect(feedOf(t, `${uuid}@2`)[0]).toMatchObject({
      op: "tombstone",
      scope: "workspace",
      moved_to: anaShared.uid,
    });
    // Now shared: Rui may edit it on the current base.
    expect(
      await pushOne(
        t.server,
        rui.token,
        sendOf(rehashed({ ...anaShared, body: "rui\n" }), { baseRevision: 2, baseHash: mine.hash }),
      ),
    ).toMatchObject({ result: "applied", revision: 3 });
    // Rui may not move it into his workspace; Ana (the creator) may move it back into hers.
    const current = entryRow(t, uuid);
    const ruiWorkspace = rehashed({
      ...anaShared,
      uid: `workspace:${uuid}`,
      scope: "workspace" as const,
      body: "rui\n",
    });
    expect(
      await pushOne(
        t.server,
        rui.token,
        sendOf(ruiWorkspace, { baseRevision: 3, baseHash: current?.hash as string }),
      ),
    ).toMatchObject({ result: "refused", reason: "not-owner" });
    expect(
      await pushOne(
        t.server,
        ana.token,
        sendOf(ruiWorkspace, { baseRevision: 3, baseHash: current?.hash as string }),
      ),
    ).toMatchObject({ result: "applied", revision: 4 });
    expect(entryRow(t, uuid)).toMatchObject({
      scope: "workspace",
      created_by_member: ana.memberId,
    });
    // A shared entry pushed by another member on the current base: applied; a move to a project alias too.
    const shared = entryPayload({ scope: "shared", slug: "ours" });
    await pushOne(t.server, ana.token, sendOf(shared));
    const toProject = {
      ...shared,
      uid: entryUid("project", ALIAS_A, uuidOf(shared.uid)),
      scope: "project" as const,
      remoteAlias: ALIAS_A,
    };
    expect(
      await pushOne(
        t.server,
        rui.token,
        sendOf(toProject, { baseRevision: 1, baseHash: shared.hash }),
      ),
    ).toMatchObject({ result: "applied", revision: 2 });
  });
});

describe("the lock, withdraws, reinstates", () => {
  test("an admin withdraw tombstones and locks; a send is refused until reinstated; a re-send on the tombstone's base reinstates", async () => {
    const { t, ana, admin } = await team();
    const payload = entryPayload({ scope: "project", remoteAlias: ALIAS_A, slug: "p" });
    const uuid = uuidOf(payload.uid);
    await pushOne(t.server, ana.token, sendOf(payload));
    const withdrawn = await api(
      t.server,
      admin.token,
      "POST",
      `/v1/items/entry/${encodeURIComponent(payload.uid)}/withdraw`,
      {},
    );
    expect(withdrawn.status).toBe(200);
    expect(withdrawn.body).toEqual({ uid: payload.uid, revision: 2 });
    expect(entryRow(t, uuid)).toMatchObject({
      revision: 2,
      locked_by_admin: 1,
      hash: payload.hash,
    });
    expect(entryRow(t, uuid)?.withdrawn_at).not.toBeNull();
    expect(feedOf(t, uuid).at(-1)).toMatchObject({
      op: "tombstone",
      revision: 2,
      member_id: admin.memberId,
      device_id: admin.deviceId,
      current: 1,
    });
    expect(revisionsOf(t, uuid).at(-1)).toMatchObject({
      revision: 2,
      op: "withdraw",
      hash: payload.hash,
      writer_device: admin.deviceId,
    });
    const v2 = rehashed({ ...payload, body: "again\n" });
    expect(
      await pushOne(t.server, ana.token, sendOf(v2, { baseRevision: 2, baseHash: payload.hash })),
    ).toEqual({ uid: payload.uid, result: "refused", reason: "withdrawn-by-admin" });
    // Withdrawing again locks alone: the revision stays.
    const again = await api(
      t.server,
      admin.token,
      "POST",
      `/v1/items/entry/${encodeURIComponent(payload.uid)}/withdraw`,
      {},
    );
    expect(again.body).toEqual({ uid: payload.uid, revision: 2 });
    expect(feedOf(t, uuid)).toHaveLength(2);
    expect(
      (
        await api(
          t.server,
          admin.token,
          "POST",
          `/v1/items/entry/${encodeURIComponent(payload.uid)}/reinstate`,
          {},
        )
      ).body,
    ).toEqual({ uid: payload.uid });
    expect(entryRow(t, uuid)?.locked_by_admin).toBe(0);
    expect(
      await pushOne(t.server, ana.token, sendOf(v2, { baseRevision: 2, baseHash: payload.hash })),
    ).toEqual({ uid: payload.uid, result: "applied", revision: 3, hash: v2.hash });
    expect(entryRow(t, uuid)?.withdrawn_at).toBeNull();
    expect(
      (
        await api(
          t.server,
          admin.token,
          "POST",
          `/v1/items/entry/${encodeURIComponent(`shared:${newUuid()}`)}/withdraw`,
          {},
        )
      ).status,
    ).toBe(404);
    expect(
      (await api(t.server, admin.token, "POST", "/v1/items/other/x/withdraw", {})).status,
    ).toBe(404);
    expect(
      (
        await api(
          t.server,
          ana.token,
          "POST",
          `/v1/items/entry/${encodeURIComponent(payload.uid)}/withdraw`,
          {},
        )
      ).status,
    ).toBe(403);
    const audit = t.server.db
      .query<{ action: string }, []>("SELECT action FROM audit ORDER BY id")
      .all()
      .map((r) => r.action);
    expect(audit).toEqual(expect.arrayContaining(["item withdrawn", "item reinstated"]));
  });

  test("a member's withdraw: the stale base, the creator, another member, an admin, the one retry rule", async () => {
    const { t, ana, anaDesk, rui, admin } = await team();
    const payload = entryPayload({ scope: "shared", slug: "w" });
    const uuid = uuidOf(payload.uid);
    await pushOne(t.server, ana.token, sendOf(payload));
    const withdraw = (base: { baseRevision: number; baseHash: string }) => ({
      op: "withdraw" as const,
      kind: "entry" as const,
      uid: payload.uid,
      ...base,
    });
    expect(await pushOne(t.server, ana.token, withdraw({ baseRevision: 0, baseHash: "" }))).toEqual(
      { uid: payload.uid, result: "stale", current: { revision: 1, hash: payload.hash } },
    );
    expect(
      await pushOne(t.server, rui.token, withdraw({ baseRevision: 1, baseHash: payload.hash })),
    ).toEqual({ uid: payload.uid, result: "refused", reason: "not-owner" });
    expect(entryRow(t, uuid)?.withdrawn_at).toBeNull();
    expect(
      await pushOne(t.server, ana.token, withdraw({ baseRevision: 1, baseHash: payload.hash })),
    ).toEqual({ uid: payload.uid, result: "withdrawn", revision: 2 });
    expect(entryRow(t, uuid)).toMatchObject({
      revision: 2,
      locked_by_admin: 0,
      hash: payload.hash,
    });
    const rows = feedOf(t, uuid);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ op: "tombstone", revision: 2, hash: payload.hash, current: 1 });
    // The retry by the writer's device and by the writer's other device: withdrawn, nothing changed.
    expect(
      await pushOne(t.server, ana.token, withdraw({ baseRevision: 1, baseHash: payload.hash })),
    ).toEqual({ uid: payload.uid, result: "withdrawn", revision: 2 });
    expect(
      await pushOne(t.server, anaDesk.token, withdraw({ baseRevision: 1, baseHash: payload.hash })),
    ).toEqual({ uid: payload.uid, result: "withdrawn", revision: 2 });
    expect(feedOf(t, uuid)).toHaveLength(2);
    // The same retry by another member, and by the admin: stale.
    expect(
      await pushOne(t.server, rui.token, withdraw({ baseRevision: 1, baseHash: payload.hash })),
    ).toEqual({ uid: payload.uid, result: "stale", current: { revision: 2, hash: payload.hash } });
    expect(
      await pushOne(t.server, admin.token, withdraw({ baseRevision: 1, baseHash: payload.hash })),
    ).toMatchObject({ result: "stale" });
    // An unknown uid.
    expect(
      await pushOne(t.server, ana.token, {
        op: "withdraw",
        kind: "entry",
        uid: `shared:${newUuid()}`,
        baseRevision: 1,
        baseHash: "x",
      }),
    ).toMatchObject({ result: "refused", reason: "unknown" });
    // A re-send on the tombstone's base reinstates as revision 3; an admin may withdraw it on the current base.
    expect(
      await pushOne(
        t.server,
        ana.token,
        sendOf(payload, { baseRevision: 2, baseHash: payload.hash }),
      ),
    ).toEqual({ uid: payload.uid, result: "applied", revision: 3, hash: payload.hash });
    expect(entryRow(t, uuid)?.withdrawn_at).toBeNull();
    expect(
      await pushOne(t.server, admin.token, withdraw({ baseRevision: 3, baseHash: payload.hash })),
    ).toEqual({ uid: payload.uid, result: "withdrawn", revision: 4 });
    expect(entryRow(t, uuid)?.locked_by_admin).toBe(0);
  });
});

describe("rate, storage, transactions, the signal, the marks", () => {
  test("each item is its own transaction; refused storage and refused rate spare an idempotent retry; one signal per push; the marks", async () => {
    const { t, ana } = await team();
    const a = entryPayload({ scope: "shared", slug: "a" });
    const bad = { ...entryPayload({ scope: "shared", slug: "b" }), hash: "0".repeat(16) };
    const c = entryPayload({ scope: "shared", slug: "c" });
    const fired = t.server.signalFired();
    const answer = await push(t.server, ana.token, [sendOf(a), sendOf(bad), sendOf(c)]);
    expect(answer.status).toBe(200);
    expect(answer.body.results.map((r: { result: string }) => r.result)).toEqual([
      "applied",
      "refused",
      "applied",
    ]);
    expect(feedOf(t)).toHaveLength(2);
    expect(t.server.signalFired()).toBe(fired + 1);
    expect(readHighWater(teamPaths(t.dir).feedFile)).toEqual({
      changes: 2,
      audit: t.server.db.query<{ n: number }, []>("SELECT max(id) AS n FROM audit").get()?.n ?? 0,
    });
    // A push that applies nothing fires no signal.
    await push(t.server, ana.token, [sendOf(a)]);
    expect(t.server.signalFired()).toBe(fired + 1);

    // The storage floor is 200 MiB: just under it refuses, just over it applies.
    t.freeBytes.value = 199 * 1024 * 1024;
    const d = entryPayload({ scope: "shared", slug: "d" });
    const low = await push(t.server, ana.token, [sendOf(d), sendOf(a)]);
    expect(low.body.results).toEqual([
      { uid: d.uid, result: "refused", reason: "storage" },
      { uid: a.uid, result: "applied", revision: 1, hash: a.hash },
    ]);
    t.freeBytes.value = 201 * 1024 * 1024;
    expect(await pushOne(t.server, ana.token, sendOf(d))).toMatchObject({
      result: "applied",
      revision: 1,
    });
    t.freeBytes.value = 10 * 1024 * 1024 * 1024;

    const e = entryPayload({ scope: "shared", slug: "e" });
    drainBucket(t.server.buckets.bytes, ana.deviceId);
    const rate = await push(t.server, ana.token, [sendOf(e), sendOf(a)]);
    expect(rate.body.results).toEqual([
      { uid: e.uid, result: "refused", reason: "rate" },
      { uid: a.uid, result: "applied", revision: 1, hash: a.hash },
    ]);
    const line = eventsOf(t, "request")
      .filter((row) => row.route === "POST /v1/push")
      .at(-1) as { push: Record<string, unknown> };
    expect(line.push).toEqual({
      applied: 1,
      stale: 0,
      refused: 1,
      withdrawn: 0,
      refusals: [{ uid: e.uid, reason: "rate" }],
    });
  });
});

describe("memories", () => {
  test("apply, idempotency, updatedAt order, the alias change with its tombstone, the lock, a second device's row", async () => {
    const { t, ana, anaDesk, admin } = await team();
    const m = memoryPayload({ rowId: 1 });
    const first = await pushOne(t.server, ana.token, sendOf(m));
    expect(first).toEqual({ uid: m.uid, result: "applied", revision: 1, hash: m.hash });
    const key = `${ana.deviceId}:${m.uid}`;
    const feedUid = `remote:${ana.deviceAlias}:${m.uid}`;
    expect(feedOf(t, key)[0]).toMatchObject({
      kind: "memory",
      uid: feedUid,
      op: "upsert",
      scope: "project",
      project_alias: ALIAS_A,
      revision: 1,
      hash: m.hash,
      member_id: ana.memberId,
      device_id: ana.deviceId,
    });
    expect(await pushOne(t.server, ana.token, sendOf(m))).toEqual(first);
    expect(feedOf(t)).toHaveLength(1);
    const later = rehashedMemory({ ...m, body: "edited", updatedAt: m.updatedAt + 1000 });
    expect(await pushOne(t.server, ana.token, sendOf(later))).toEqual({
      uid: m.uid,
      result: "applied",
      revision: 2,
      hash: later.hash,
    });
    const older = rehashedMemory({ ...m, body: "old", updatedAt: m.updatedAt - 1000 });
    expect(await pushOne(t.server, ana.token, sendOf(older))).toEqual({
      uid: m.uid,
      result: "stale",
      current: { revision: 2, hash: later.hash, updatedAt: later.updatedAt },
    });
    const movedAlias = { ...later, remoteAlias: ALIAS_B };
    expect(await pushOne(t.server, ana.token, sendOf(movedAlias))).toEqual({
      uid: m.uid,
      result: "applied",
      revision: 3,
      hash: later.hash,
    });
    expect(feedOf(t, `${key}@3`)[0]).toMatchObject({
      op: "tombstone",
      scope: "project",
      project_alias: ALIAS_A,
      moved_to: feedUid,
      revision: 3,
    });
    expect(feedOf(t, key).at(-1)).toMatchObject({
      op: "upsert",
      project_alias: ALIAS_B,
      revision: 3,
      current: 1,
    });
    expect(memoryRow(t, ana.deviceId, m.uid)).toMatchObject({
      project_alias: ALIAS_B,
      revision: 3,
    });
    // The admin locks it through the feed form; a send is refused until reinstated.
    const lock = await api(
      t.server,
      admin.token,
      "POST",
      `/v1/items/memory/${encodeURIComponent(feedUid)}/withdraw`,
      {},
    );
    expect(lock.status).toBe(200);
    expect(lock.body).toEqual({ uid: feedUid, revision: 4 });
    const edited = rehashedMemory({
      ...movedAlias,
      body: "after lock",
      updatedAt: later.updatedAt + 2000,
    });
    expect(await pushOne(t.server, ana.token, sendOf(edited))).toEqual({
      uid: m.uid,
      result: "refused",
      reason: "withdrawn-by-admin",
    });
    expect(
      (
        await api(
          t.server,
          admin.token,
          "POST",
          `/v1/items/memory/${encodeURIComponent(feedUid)}/reinstate`,
          {},
        )
      ).body,
    ).toEqual({ uid: feedUid });
    expect(await pushOne(t.server, ana.token, sendOf(edited))).toEqual({
      uid: m.uid,
      result: "applied",
      revision: 5,
      hash: edited.hash,
    });
    // Another device's send of the same uid is its own row.
    const second = await pushOne(t.server, anaDesk.token, sendOf(m));
    expect(second).toEqual({ uid: m.uid, result: "applied", revision: 1, hash: m.hash });
    expect(
      feedOf(t)
        .filter((row) => row.kind === "memory" && row.op === "upsert" && row.current === 1)
        .map((row) => row.uid)
        .sort(),
    ).toEqual([feedUid, `remote:${anaDesk.deviceAlias}:${m.uid}`].sort());
  });

  test("the refusals: hash, shape, size, purged, secret; never 500", async () => {
    const { t, ana } = await team();
    const m = memoryPayload();
    expect(await pushOne(t.server, ana.token, sendOf({ ...m, hash: "0".repeat(16) }))).toEqual({
      uid: m.uid,
      result: "refused",
      reason: "hash",
    });
    for (const candidate of [
      { ...m, importance: "3" },
      { ...m, updatedAt: "now" },
      rehashedMemory({ ...m, memoryKind: "Bad Kind" }),
      { ...m, extra: 1 },
    ]) {
      expect(
        await pushOne(t.server, ana.token, {
          op: "send",
          kind: "memory",
          uid: m.uid,
          payload: candidate,
        }),
      ).toEqual({ uid: m.uid, result: "refused", reason: "shape" });
    }
    const big = rehashedMemory({ ...m, body: "x".repeat(257 * 1024) });
    expect(await pushOne(t.server, ana.token, sendOf(big))).toMatchObject({
      result: "refused",
      reason: "size",
    });
    insertPurged(t.server.db, `${ana.deviceId}:${m.uid}`, t.clock.now);
    expect(await pushOne(t.server, ana.token, sendOf(m))).toEqual({
      uid: m.uid,
      result: "refused",
      reason: "purged",
    });
    const secret = memoryPayload({ rowId: 2, body: `ghp_${"A".repeat(36)}` });
    expect(await pushOne(t.server, ana.token, sendOf(secret))).toEqual({
      uid: secret.uid,
      result: "refused",
      reason: "secret",
      rule: "github-token",
    });
    expect(feedOf(t)).toHaveLength(0);
  });

  test("withdraw by the owning device, by another device of the member, by an admin through the feed form; the base rule; another member refused", async () => {
    const { t, ana, anaDesk, rui, admin } = await team();
    const m = memoryPayload({ rowId: 3 });
    await pushOne(t.server, ana.token, sendOf(m));
    const key = `${ana.deviceId}:${m.uid}`;
    const feedUid = `remote:${ana.deviceAlias}:${m.uid}`;
    expect(
      await pushOne(t.server, ana.token, {
        op: "withdraw",
        kind: "memory",
        uid: m.uid,
        baseRevision: 2,
      }),
    ).toEqual({
      uid: m.uid,
      result: "stale",
      current: { revision: 1, hash: m.hash, updatedAt: m.updatedAt },
    });
    expect(
      await pushOne(t.server, rui.token, {
        op: "withdraw",
        kind: "memory",
        uid: feedUid,
        baseRevision: 1,
      }),
    ).toEqual({ uid: feedUid, result: "refused", reason: "not-owner" });
    expect(
      await pushOne(t.server, ana.token, {
        op: "withdraw",
        kind: "memory",
        uid: "nope:9",
        baseRevision: 1,
      }),
    ).toEqual({ uid: "nope:9", result: "refused", reason: "unknown" });
    expect(
      await pushOne(t.server, ana.token, {
        op: "withdraw",
        kind: "memory",
        uid: m.uid,
        baseRevision: 1,
      }),
    ).toEqual({ uid: m.uid, result: "withdrawn", revision: 2 });
    expect(feedOf(t, key).at(-1)).toMatchObject({
      op: "tombstone",
      revision: 2,
      uid: feedUid,
      current: 1,
    });
    expect(memoryRow(t, ana.deviceId, m.uid)).toMatchObject({ revision: 2, locked_by_admin: 0 });
    // The retry: withdrawn with nothing changed; by another member: stale.
    expect(
      await pushOne(t.server, ana.token, {
        op: "withdraw",
        kind: "memory",
        uid: m.uid,
        baseRevision: 1,
      }),
    ).toEqual({ uid: m.uid, result: "withdrawn", revision: 2 });
    expect(
      await pushOne(t.server, rui.token, {
        op: "withdraw",
        kind: "memory",
        uid: feedUid,
        baseRevision: 1,
      }),
    ).toMatchObject({ result: "stale" });
    expect(feedOf(t, key)).toHaveLength(2);
    // A second memory: withdrawn by the member's other device through the feed form; a third by the admin.
    const m2 = memoryPayload({ rowId: 4 });
    await pushOne(t.server, ana.token, sendOf(m2));
    expect(
      await pushOne(t.server, anaDesk.token, {
        op: "withdraw",
        kind: "memory",
        uid: `remote:${ana.deviceAlias}:${m2.uid}`,
        baseRevision: 1,
      }),
    ).toMatchObject({ result: "withdrawn", revision: 2 });
    const m3 = memoryPayload({ rowId: 5 });
    await pushOne(t.server, ana.token, sendOf(m3));
    expect(
      await pushOne(t.server, admin.token, {
        op: "withdraw",
        kind: "memory",
        uid: `remote:${ana.deviceAlias}:${m3.uid}`,
        baseRevision: 1,
      }),
    ).toMatchObject({ result: "withdrawn", revision: 2 });
    // A re-send with a later updatedAt reinstates.
    const back = rehashedMemory({ ...m3, updatedAt: m3.updatedAt + 1 });
    expect(await pushOne(t.server, ana.token, sendOf(back))).toMatchObject({
      result: "applied",
      revision: 3,
    });
    expect(memoryRow(t, ana.deviceId, m3.uid)?.withdrawn_at).toBeNull();
  });
});

describe("disable with withdraw", () => {
  test("tombstones the member's workspace entries and memories once each without a lock, leaves their shared entry, and the re-enabled member's re-send applies", async () => {
    const { t, ana, anaDesk, rui, admin } = await team();
    const ws = entryPayload({ scope: "workspace", slug: "ws" });
    const shared = entryPayload({ scope: "shared", slug: "sh" });
    const m = memoryPayload({ rowId: 7 });
    const m2 = memoryPayload({ rowId: 8 });
    await push(t.server, ana.token, [sendOf(ws), sendOf(shared), sendOf(m)]);
    await pushOne(t.server, anaDesk.token, sendOf(m2));
    const before = feedOf(t).length;
    const disabled = await api(
      t.server,
      admin.token,
      "POST",
      `/v1/members/${ana.memberId}/disable`,
      { withdraw: true },
    );
    expect(disabled.status).toBe(200);
    expect(disabled.body).toMatchObject({ id: ana.memberId, devices: 2, withdrawn: 3 });
    const rows = feedOf(t).slice(before);
    expect(rows).toHaveLength(3);
    for (const row of rows)
      expect(row).toMatchObject({
        op: "tombstone",
        member_id: admin.memberId,
        device_id: admin.deviceId,
        current: 1,
      });
    expect(rows.map((row) => row.key).sort()).toEqual(
      [uuidOf(ws.uid), `${ana.deviceId}:${m.uid}`, `${anaDesk.deviceId}:${m2.uid}`].sort(),
    );
    expect(entryRow(t, uuidOf(ws.uid))).toMatchObject({ revision: 2, locked_by_admin: 0 });
    expect(entryRow(t, uuidOf(shared.uid))).toMatchObject({ revision: 1, withdrawn_at: null });
    expect(memoryRow(t, ana.deviceId, m.uid)).toMatchObject({ revision: 2, locked_by_admin: 0 });
    expect((await api(t.server, ana.token, "GET", "/v1/me")).status).toBe(403);
    // Rui still edits the shared entry.
    expect(
      await pushOne(
        t.server,
        rui.token,
        sendOf(rehashed({ ...shared, body: "rui\n" }), { baseRevision: 1, baseHash: shared.hash }),
      ),
    ).toMatchObject({ result: "applied", revision: 2 });
    // Enabled again, with a new device, Ana re-sends her workspace entry on the tombstone's base.
    expect(
      (await api(t.server, admin.token, "POST", `/v1/members/${ana.memberId}/enable`, {})).status,
    ).toBe(200);
    const back = await deviceOf(t, admin.token, ana, "new laptop");
    expect(
      await pushOne(t.server, back.token, sendOf(ws, { baseRevision: 2, baseHash: ws.hash })),
    ).toEqual({ uid: ws.uid, result: "applied", revision: 3, hash: ws.hash });
    // Without withdraw, nothing is tombstoned.
    const other = await memberOf(t, admin.token, "Eva");
    const evaWs = entryPayload({ scope: "workspace", slug: "eva" });
    await pushOne(t.server, other.token, sendOf(evaWs));
    const plain = await api(
      t.server,
      admin.token,
      "POST",
      `/v1/members/${other.memberId}/disable`,
      {},
    );
    expect(plain.body).toMatchObject({ devices: 1, withdrawn: 0 });
    expect(entryRow(t, uuidOf(evaWs.uid))?.withdrawn_at).toBeNull();
  });
});
