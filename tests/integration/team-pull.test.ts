import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { entryUid } from "../../src/sharing/types.ts";
import { openTeamForWrite, teamPaths } from "../../src/team/db.ts";
import { readHighWater } from "../../src/team/instance.ts";
import {
  entryByUuid,
  explainChangesSince,
  explainHasChanges,
  insertChange,
  sequenceHighWater,
} from "../../src/team/store.ts";
import {
  ALIAS_A,
  ALIAS_B,
  adminOf,
  api,
  cleanTestDirs,
  deviceOf,
  entryPayload,
  eventsOf,
  type Joined,
  memberOf,
  memoryPayload,
  pull,
  pullAll,
  pushOne,
  rehashed,
  seedFeed,
  sendOf,
  startTestServer,
  type TestServer,
} from "../helpers/team.ts";

const open: TestServer[] = [];
/** A restart passes `startAt` past the copied lease's expiry, as a real restore outlives it. */
const start = async (dataDir?: string, startAt?: number) => {
  const t = await startTestServer(dataDir === undefined ? {} : { dataDir }, { startAt });
  open.push(t);
  return t;
};
const LATER = 60_000;
afterEach(async () => {
  for (const t of open.splice(0)) await t.close();
});
afterAll(() => cleanTestDirs());

interface Team {
  t: TestServer;
  admin: Joined;
  ana: Joined;
  rui: Joined;
}

async function team(): Promise<Team> {
  const t = await start();
  const admin = await adminOf(t, "Admin");
  const ana = await memberOf(t, admin.token, "Ana");
  const rui = await memberOf(t, admin.token, "Rui");
  return { t, admin, ana, rui };
}

const uuidOf = (uid: string) => uid.slice(-36);
const OTHER = "remote:github.com/other/thing";

describe("the pull: scopes, aliases, one row per key, the pages", () => {
  test("since 0 with one alias answers shared, every workspace and that alias alone, one current row per key, as a snapshot", async () => {
    const { t, ana, rui } = await team();
    const shared = entryPayload({ scope: "shared", slug: "s" });
    const anaWs = entryPayload({ scope: "workspace", slug: "a" });
    const ruiWs = entryPayload({ scope: "workspace", slug: "r" });
    const inA = entryPayload({ scope: "project", remoteAlias: ALIAS_A, slug: "pa" });
    const inB = entryPayload({ scope: "project", remoteAlias: ALIAS_B, slug: "pb" });
    const mA = memoryPayload({ rowId: 1, remoteAlias: ALIAS_A });
    const mB = memoryPayload({ rowId: 2, remoteAlias: ALIAS_B });
    await pushOne(t.server, ana.token, sendOf(shared));
    await pushOne(t.server, ana.token, sendOf(anaWs));
    await pushOne(t.server, rui.token, sendOf(ruiWs));
    await pushOne(t.server, ana.token, sendOf(inA));
    await pushOne(t.server, ana.token, sendOf(inB));
    await pushOne(t.server, ana.token, sendOf(mA));
    await pushOne(t.server, ana.token, sendOf(mB));
    // Three rows of one key: the shared entry revised twice more.
    const v2 = rehashed({ ...shared, body: "v2\n" });
    await pushOne(t.server, ana.token, sendOf(v2, { baseRevision: 1, baseHash: shared.hash }));
    const v3 = rehashed({ ...shared, body: "v3\n" });
    await pushOne(t.server, ana.token, sendOf(v3, { baseRevision: 2, baseHash: v2.hash }));

    const page = await pullAll(t.server, rui.token, { since: 0, projects: [ALIAS_A] });
    expect(page.serverId).toBe(t.server.serverId);
    expect(page.instance).toBe(t.server.instance());
    expect(page.snapshot).toBe(true);
    expect(page.more).toBe(false);
    const uids = page.items.map((item) => item.uid).sort();
    expect(uids).toEqual(
      [shared.uid, anaWs.uid, ruiWs.uid, inA.uid, `remote:${ana.deviceAlias}:${mA.uid}`].sort(),
    );
    expect(page.next).toBe(Math.max(...page.items.map((item) => item.seq)));
    const sharedItem = page.items.find((item) => item.uid === shared.uid);
    expect(sharedItem).toMatchObject({
      kind: "entry",
      op: "upsert",
      scope: "shared",
      remoteAlias: null,
      revision: 3,
      hash: v3.hash,
      member: { id: ana.memberId, name: "Ana" },
      payload: { frontmatter: v3.frontmatter, body: v3.body },
    });
    expect(sharedItem.device).toBeUndefined();
    expect(Object.keys(sharedItem).sort()).toEqual([
      "at",
      "hash",
      "kind",
      "member",
      "op",
      "payload",
      "remoteAlias",
      "revision",
      "scope",
      "seq",
      "uid",
    ]);
    const memoryItem = page.items.find((item) => item.kind === "memory");
    expect(memoryItem).toMatchObject({
      scope: "project",
      remoteAlias: ALIAS_A,
      revision: 1,
      hash: mA.hash,
    });
    expect(memoryItem.payload).toEqual(mA);
    // Nothing new after the last seq.
    const empty = await pullAll(t.server, rui.token, { since: page.next, projects: [ALIAS_A] });
    expect(empty).toEqual({
      serverId: t.server.serverId,
      instance: t.server.instance(),
      next: page.next,
      more: false,
      snapshot: false,
      items: [],
    });
    // Without projects: no project rows at all.
    const none = await pullAll(t.server, rui.token, { since: 0 });
    expect(none.items.map((item) => item.scope).sort()).toEqual([
      "shared",
      "workspace",
      "workspace",
    ]);
    // scope=project with one alias: that alias's items alone.
    const only = await pullAll(t.server, rui.token, {
      since: 0,
      projects: [ALIAS_B],
      scope: "project",
    });
    expect(only.items.map((item) => item.uid).sort()).toEqual(
      [inB.uid, `remote:${ana.deviceAlias}:${mB.uid}`].sort(),
    );
    expect(only.snapshot).toBe(true);
  });

  test("limit and the 2 MiB cut: pages continue with since = next; the clamp; a bad query is 400", async () => {
    const { t, ana } = await team();
    const big = "x".repeat(200 * 1024);
    const payloads = Array.from({ length: 11 }, (_, i) =>
      entryPayload({ scope: "shared", slug: `big-${i}`, body: big }),
    );
    for (const payload of payloads) await pushOne(t.server, ana.token, sendOf(payload));
    const first = await pullAll(t.server, ana.token, { since: 0 });
    expect(first.items).toHaveLength(10);
    expect(first.more).toBe(true);
    const second = await pullAll(t.server, ana.token, { since: first.next });
    expect(second.items).toHaveLength(1);
    expect(second.more).toBe(false);
    expect(second.snapshot).toBe(false);
    expect(second.items[0].uid).toBe(payloads[10]?.uid);
    const two = await pullAll(t.server, ana.token, { since: 0, limit: 2 });
    expect(two.items).toHaveLength(2);
    expect(two.more).toBe(true);
    expect(two.next).toBe(two.items[1].seq);
    expect((await pullAll(t.server, ana.token, { since: 0, limit: 9999 })).items).toHaveLength(10);
    expect((await pullAll(t.server, ana.token, { since: 0, limit: 0 })).items).toHaveLength(1);
    for (const bad of [
      "since=-1",
      "since=x",
      "limit=x",
      "since=0&projects=remote:/Users/me",
      "since=0&scope=project",
      `since=0&scope=project&projects=${encodeURIComponent(ALIAS_A)},${encodeURIComponent(ALIAS_B)}`,
      "since=0&wait=x",
    ]) {
      const answer = await api(t.server, ana.token, "GET", `/v1/pull?${bad}`);
      expect({ bad, status: answer.status }).toEqual({ bad, status: 400 });
    }
  });

  test("tombstones carry no payload; a move's tombstone carries movedTo, for an entry and a memory; the admin's view adds the device; the operator's row", async () => {
    const { t, admin, ana } = await team();
    const gone = entryPayload({ scope: "shared", slug: "gone" });
    await pushOne(t.server, ana.token, sendOf(gone));
    await pushOne(t.server, ana.token, {
      op: "withdraw",
      kind: "entry",
      uid: gone.uid,
      baseRevision: 1,
      baseHash: gone.hash,
    });
    const moved = entryPayload({ scope: "project", remoteAlias: ALIAS_A, slug: "moved" });
    await pushOne(t.server, ana.token, sendOf(moved));
    const movedB = {
      ...moved,
      uid: entryUid("project", ALIAS_B, uuidOf(moved.uid)),
      remoteAlias: ALIAS_B,
    };
    await pushOne(t.server, ana.token, sendOf(movedB, { baseRevision: 1, baseHash: moved.hash }));
    const m = memoryPayload({ rowId: 5, remoteAlias: ALIAS_A });
    await pushOne(t.server, ana.token, sendOf(m));
    await pushOne(t.server, ana.token, sendOf({ ...m, remoteAlias: ALIAS_B }));
    // A CLI write: a row by the operator.
    insertChange(t.server.db, {
      kind: "entry",
      uid: gone.uid,
      key: uuidOf(gone.uid),
      op: "tombstone",
      scope: "shared",
      remoteAlias: null,
      revision: 3,
      hash: gone.hash,
      movedTo: null,
      memberId: "operator",
      deviceId: "cli",
      clientEpoch: null,
      at: 5,
    });

    const member = await pullAll(t.server, ana.token, { since: 0, projects: [ALIAS_A, ALIAS_B] });
    const goneItem = member.items.find((item) => item.uid === gone.uid);
    expect(goneItem).toMatchObject({
      op: "tombstone",
      revision: 3,
      member: { id: "operator", name: "operator" },
    });
    expect(goneItem.payload).toBeUndefined();
    expect(goneItem.device).toBeUndefined();
    const inA = member.items.filter((item) => item.remoteAlias === ALIAS_A);
    expect(inA).toHaveLength(2);
    for (const item of inA) {
      expect(item.op).toBe("tombstone");
      expect(item.payload).toBeUndefined();
    }
    expect(inA.find((item) => item.kind === "entry")).toMatchObject({
      uid: moved.uid,
      movedTo: movedB.uid,
      revision: 2,
    });
    expect(inA.find((item) => item.kind === "memory")).toMatchObject({
      uid: `remote:${ana.deviceAlias}:${m.uid}`,
      movedTo: `remote:${ana.deviceAlias}:${m.uid}`,
      revision: 2,
    });
    const inB = member.items.filter((item) => item.remoteAlias === ALIAS_B);
    expect(inB.map((item) => item.op)).toEqual(["upsert", "upsert"]);
    expect(inB.find((item) => item.kind === "memory").payload).toEqual({
      ...m,
      remoteAlias: ALIAS_B,
    });
    // The admin sees the device.
    const asAdmin = await pullAll(t.server, admin.token, { since: 0, projects: [ALIAS_B] });
    const entry = asAdmin.items.find((item) => item.uid === movedB.uid);
    expect(entry.device).toBe(ana.deviceId);
    expect(asAdmin.items.find((item) => item.uid === gone.uid).device).toBe("cli");
  });

  test("a cursor ahead of the server is 410 fullPull with the ids; AUTOINCREMENT never reuses a number", async () => {
    const { t, ana } = await team();
    const a = entryPayload({ scope: "shared", slug: "a" });
    await pushOne(t.server, ana.token, sendOf(a));
    const high = sequenceHighWater(t.server.db, "changes");
    const ahead = await pull(t.server, ana.token, { since: high + 1 });
    expect(ahead.status).toBe(410);
    expect(ahead.body).toEqual({
      error: "cursor ahead of this server",
      fullPull: true,
      serverId: t.server.serverId,
      instance: t.server.instance(),
    });
    expect((await pull(t.server, ana.token, { since: high })).status).toBe(200);
    t.server.db.run("DELETE FROM changes WHERE seq = (SELECT max(seq) FROM changes)");
    const b = entryPayload({ scope: "shared", slug: "b" });
    await pushOne(t.server, ana.token, sendOf(b));
    const page = await pullAll(t.server, ana.token, { since: 0 });
    expect(page.items).toHaveLength(1);
    expect(page.items[0].seq).toBe(high + 1);
  });
});

describe("the query plan and the large feed", () => {
  test("no SCAN of changes for the pull, the single-alias snapshot and the emptiness check; 100,000 rows answer in under 50 ms", async () => {
    const { t, ana } = await team();
    const plans = [
      explainChangesSince(t.server.db, {
        since: 0,
        limit: 501,
        projects: [ALIAS_A, ALIAS_B],
        scope: "all",
      }),
      explainChangesSince(t.server.db, {
        since: 0,
        limit: 501,
        projects: [ALIAS_A],
        scope: "project",
      }),
      explainHasChanges(t.server.db, { since: 10, limit: 1, projects: [ALIAS_A], scope: "all" }),
    ];
    for (const plan of plans) {
      expect(plan.length).toBeGreaterThan(0);
      for (const line of plan) expect(line).not.toMatch(/SCAN changes/);
      expect(plan.some((line) => /changes_scope/.test(line))).toBe(true);
    }
    seedFeed(t.server.db, 100_000, ALIAS_A, 3);
    const started = performance.now();
    const page = await pullAll(t.server, ana.token, {
      since: 0,
      projects: [ALIAS_A],
      scope: "project",
    });
    const elapsed = performance.now() - started;
    expect(page.items).toHaveLength(3);
    expect(elapsed).toBeLessThan(50);
  });
});

describe("the wait", () => {
  test("wait=5 with nothing new answers within a second of a push made 200 ms later and carries the item; rows present answer at once", async () => {
    const { t, ana, rui } = await team();
    const pending = pull(t.server, rui.token, { since: 0, wait: 5 });
    await Bun.sleep(200);
    const payload = entryPayload({ scope: "shared", slug: "late" });
    const started = performance.now();
    await pushOne(t.server, ana.token, sendOf(payload));
    const answer = await pending;
    expect(performance.now() - started).toBeLessThan(1000);
    expect(answer.status).toBe(200);
    expect(answer.body.items.map((item: { uid: string }) => item.uid)).toEqual([payload.uid]);
    expect(answer.body.snapshot).toBe(true);
    const quick = performance.now();
    const atOnce = await pullAll(t.server, rui.token, { since: 0, wait: 5 });
    expect(performance.now() - quick).toBeLessThan(500);
    expect(atOnce.items).toHaveLength(1);
    const line = eventsOf(t, "request").find(
      (row) => row.route === "GET /v1/pull" && typeof row.held === "number",
    ) as { held: number; pull: Record<string, unknown> };
    expect(line.held).toBeGreaterThanOrEqual(0);
    expect(line.pull).toMatchObject({ since: 0, projects: 0, items: 1, snapshot: true });
  });

  test("a tombstone written by another connection is seen when the clock passes 5 s; wait=1 ends empty when the clock passes a second; wait=30 is clamped", async () => {
    const { t, ana, rui } = await team();
    const payload = entryPayload({ scope: "shared", slug: "cli" });
    await pushOne(t.server, ana.token, sendOf(payload));
    const first = await pullAll(t.server, rui.token, { since: 0 });
    const pending = pull(t.server, rui.token, { since: first.next, wait: 20 });
    await Bun.sleep(50);
    const other = openTeamForWrite(t.dir, t.clock.now);
    const row = entryByUuid(other, uuidOf(payload.uid));
    insertChange(other, {
      kind: "entry",
      uid: payload.uid,
      key: uuidOf(payload.uid),
      op: "tombstone",
      scope: "shared",
      remoteAlias: null,
      revision: (row?.revision ?? 1) + 1,
      hash: payload.hash,
      movedTo: null,
      memberId: "operator",
      deviceId: "cli",
      clientEpoch: null,
      at: t.clock.now,
    });
    other.close();
    await Bun.sleep(50);
    t.clock.advance(5_000);
    const answer = await pending;
    expect(answer.status).toBe(200);
    expect(answer.body.items).toHaveLength(1);
    expect(answer.body.items[0]).toMatchObject({
      op: "tombstone",
      member: { id: "operator", name: "operator" },
    });

    const since = answer.body.next as number;
    const empty = pull(t.server, rui.token, { since, wait: 1 });
    await Bun.sleep(50);
    t.clock.advance(1_000);
    const page = await empty;
    expect(page.body).toEqual({
      serverId: t.server.serverId,
      instance: t.server.instance(),
      next: since,
      more: false,
      snapshot: false,
      items: [],
    });

    const clamped = pull(t.server, rui.token, { since, wait: 30 });
    await Bun.sleep(50);
    t.clock.advance(25_000);
    expect((await clamped).body.items).toEqual([]);
    const me = await api(t.server, rui.token, "GET", "/v1/me");
    expect(me.body.limits.pullWaitSeconds).toBe(25);
  });

  test("stop answers a held pull with the empty page", async () => {
    const { t, rui } = await team();
    const pending = pull(t.server, rui.token, { since: 0, wait: 25 });
    await Bun.sleep(50);
    await t.server.stop();
    const answer = await pending;
    expect(answer.status).toBe(200);
    expect(answer.body.items).toEqual([]);
    expect(answer.body.next).toBe(0);
  });
});

describe("restore detection", () => {
  const copyOf = (t: TestServer): string => {
    const copy = join(t.dir, "copy.db");
    rmSync(copy, { force: true });
    t.server.db.run("VACUUM INTO ?", [copy]);
    return copy;
  };
  const putBack = (dir: string, copy: string) => {
    const paths = teamPaths(dir);
    writeFileSync(paths.db, readFileSync(copy));
    rmSync(`${paths.db}-wal`, { force: true });
    rmSync(`${paths.db}-shm`, { force: true });
  };

  test("a copy from before a push: a new instance, the same server id, the audit row, the sequence margin, a quiet second restart", async () => {
    const { t, ana } = await team();
    await pushOne(t.server, ana.token, sendOf(entryPayload({ scope: "shared", slug: "one" })));
    const copy = copyOf(t);
    await pushOne(t.server, ana.token, sendOf(entryPayload({ scope: "shared", slug: "two" })));
    const serverId = t.server.serverId;
    const instance = t.server.instance();
    const oldSeq = sequenceHighWater(t.server.db, "changes");
    await t.close();
    putBack(t.dir, copy);
    const again = await start(t.dir, t.clock.now + LATER);
    expect(again.server.serverId).toBe(serverId);
    expect(again.server.instance()).not.toBe(instance);
    expect(eventsOf(again, "restore-detected")).toHaveLength(1);
    const audit = again.server.db
      .query<{ action: string; detail: string }, []>(
        "SELECT action, detail FROM audit WHERE action = 'restore detected'",
      )
      .all();
    expect(audit).toHaveLength(1);
    expect(audit[0]?.detail).toMatch(/file changes=2 audit=\d+; database changes=1 audit=\d+/);
    expect(sequenceHighWater(again.server.db, "changes")).toBeGreaterThanOrEqual(
      oldSeq + 1_000_000,
    );
    expect(readHighWater(teamPaths(t.dir).feedFile)).toEqual({
      changes: sequenceHighWater(again.server.db, "changes"),
      audit: sequenceHighWater(again.server.db, "audit"),
    });
    // The next push lands past the margin, and every page carries the new instance.
    const result = await pushOne(
      again.server,
      ana.token,
      sendOf(entryPayload({ scope: "shared", slug: "three" })),
    );
    expect(result.result).toBe("applied");
    const page = await pullAll(again.server, ana.token, { since: 0 });
    expect(page.instance).toBe(again.server.instance());
    expect(Math.max(...page.items.map((item) => item.seq))).toBeGreaterThan(oldSeq + 1_000_000);
    const renewed = again.server.instance();
    await again.close();
    const third = await start(t.dir, again.clock.now + LATER);
    expect(third.server.instance()).toBe(renewed);
    expect(eventsOf(third, "restore-detected")).toHaveLength(0);
  });

  test("a copy from before a revoke with no push between, and a copy that never had a feed row, are detected by the audit mark; a lost feed.seq is rewritten", async () => {
    const { t, admin, ana } = await team();
    await pushOne(t.server, ana.token, sendOf(entryPayload({ scope: "shared", slug: "one" })));
    const copy = copyOf(t);
    const second = await deviceOf(t, admin.token, ana);
    expect(
      (await api(t.server, admin.token, "POST", `/v1/devices/${second.deviceId}/revoke`, {}))
        .status,
    ).toBe(200);
    const instance = t.server.instance();
    await t.close();
    putBack(t.dir, copy);
    const again = await start(t.dir, t.clock.now + LATER);
    expect(again.server.instance()).not.toBe(instance);
    expect(eventsOf(again, "restore-detected")).toHaveLength(1);
    await again.close();

    // No feed row ever: a copy taken right after the bootstrap, then a join.
    const fresh = await start();
    const early = copyOf(fresh);
    await adminOf(fresh, "Admin");
    const freshInstance = fresh.server.instance();
    await fresh.close();
    putBack(fresh.dir, early);
    const restored = await start(fresh.dir, fresh.clock.now + LATER);
    expect(restored.server.instance()).not.toBe(freshInstance);
    expect(sequenceHighWater(restored.server.db, "changes")).toBeGreaterThanOrEqual(1_000_000);
    const quiet = restored.server.instance();
    await restored.close();

    // The file lost: rewritten at start, nothing renewed.
    rmSync(teamPaths(fresh.dir).feedFile);
    const rewritten = await start(fresh.dir, restored.clock.now + LATER);
    expect(rewritten.server.instance()).toBe(quiet);
    expect(existsSync(teamPaths(fresh.dir).feedFile)).toBe(true);
    expect(readHighWater(teamPaths(fresh.dir).feedFile).changes).toBe(
      sequenceHighWater(rewritten.server.db, "changes"),
    );
    expect(eventsOf(rewritten, "restore-detected")).toHaveLength(0);
  });
});

describe("the project alias in the query", () => {
  test("an alias with a slash is URL-encoded like any value; an unknown alias answers nothing but is not refused", async () => {
    const { t, ana } = await team();
    const inA = entryPayload({ scope: "project", remoteAlias: ALIAS_A, slug: "pa" });
    await pushOne(t.server, ana.token, sendOf(inA));
    const page = await pullAll(t.server, ana.token, {
      since: 0,
      projects: [OTHER],
      scope: "project",
    });
    expect(page.items).toEqual([]);
    expect(page.next).toBe(0);
    const both = await pullAll(t.server, ana.token, { since: 0, projects: [OTHER, ALIAS_A] });
    expect(both.items.map((item) => item.uid)).toEqual([inA.uid]);
    // An alias named twice is read once; more aliases than the cap is 400.
    const twice = await pullAll(t.server, ana.token, { since: 0, projects: [ALIAS_A, ALIAS_A] });
    expect(twice.items.map((item) => item.uid)).toEqual([inA.uid]);
    const many = Array.from({ length: 101 }, (_, i) => `remote:github.com/acme/repo-${i}`);
    expect((await pull(t.server, ana.token, { since: 0, projects: many })).status).toBe(400);
    expect(
      (await pull(t.server, ana.token, { since: 0, projects: many.slice(0, 100) })).status,
    ).toBe(200);
  });
});
