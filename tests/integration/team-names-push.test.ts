// The push and the pull under a shared name (ADR 0028): the registry check before a send
// lands, the `nameId` on the feed, the moves between a remote and a name, a purged name.
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { entryUid } from "../../src/sharing/types.ts";
import { purgeName } from "../../src/team/store.ts";
import { NAME_PURGED_RULE, NAME_RULE } from "../../src/team/validate.ts";
import {
  ALIAS_A,
  adminOf,
  api,
  cleanTestDirs,
  entryPayload,
  type Joined,
  memberOf,
  memoryPayload,
  pull,
  pullAll,
  pushOne,
  sendOf,
  startTestServer,
  type TestServer,
} from "../helpers/team.ts";

const NAME = "name:wizardingcode";
const OTHER = "name:other";

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

/** A server at contract 2, an admin and Ana. */
async function team(): Promise<Team> {
  const t = await startTestServer({ contract: { current: 2, accepted: [1, 2] } });
  open.push(t);
  const admin = await adminOf(t, "Admin");
  const ana = await memberOf(t, admin.token, "Ana");
  return { t, admin, ana };
}

const createName = async (t: TestServer, token: string, alias: string): Promise<string> => {
  const made = await api(t.server, token, "POST", "/v1/names", { alias });
  if (made.status !== 201) throw new Error(`create failed: ${made.status}`);
  return made.body.id as string;
};

interface ChangeRow {
  uid: string;
  key: string;
  op: string;
  project_alias: string | null;
  revision: number;
  moved_to: string | null;
  current: number;
}
const feedOf = (t: TestServer): ChangeRow[] =>
  t.server.db
    .query<ChangeRow, []>(
      "SELECT uid, key, op, project_alias, revision, moved_to, current FROM changes ORDER BY seq",
    )
    .all();
const entryRow = (t: TestServer, uuid: string) =>
  t.server.db
    .query<
      { project_alias: string | null; revision: number; withdrawn_at: number | null },
      [string]
    >("SELECT project_alias, revision, withdrawn_at FROM entries WHERE uuid = ?")
    .get(uuid);
const uuidOf = (uid: string) => uid.slice(-36);

describe("a send under a shared name", () => {
  test("is refused name until the registry holds it, then applied and keyed under the alias; the feed carries nameId", async () => {
    const { t, ana } = await team();
    const entry = entryPayload({ scope: "project", remoteAlias: NAME, slug: "brand-voice" });
    const memory = memoryPayload({ remoteAlias: NAME });
    expect(await pushOne(t.server, ana.token, sendOf(entry))).toEqual({
      uid: entry.uid,
      result: "refused",
      reason: "name",
      rule: NAME_RULE,
    });
    expect(await pushOne(t.server, ana.token, sendOf(memory))).toEqual({
      uid: memory.uid,
      result: "refused",
      reason: "name",
      rule: NAME_RULE,
    });
    expect(NAME_RULE).toBe("the name is not on this server; create it or pick one from the list");
    expect(feedOf(t)).toEqual([]);
    expect(entryRow(t, uuidOf(entry.uid))).toBeNull();

    const id = await createName(t, ana.token, NAME);
    expect(await pushOne(t.server, ana.token, sendOf(entry))).toEqual({
      uid: entry.uid,
      result: "applied",
      revision: 1,
      hash: entry.hash,
    });
    expect(await pushOne(t.server, ana.token, sendOf(memory))).toMatchObject({
      result: "applied",
      revision: 1,
    });
    expect(entryRow(t, uuidOf(entry.uid))).toMatchObject({ project_alias: NAME, revision: 1 });
    expect(feedOf(t).map((row) => [row.op, row.project_alias])).toEqual([
      ["upsert", NAME],
      ["upsert", NAME],
    ]);

    // A pull naming the name answers both, each upsert with the registry's id.
    const page = await pullAll(t.server, ana.token, {
      since: 0,
      projects: [NAME],
      scope: "project",
    });
    expect(page.items.map((item) => [item.kind, item.remoteAlias, item.nameId])).toEqual([
      ["entry", NAME, id],
      ["memory", NAME, id],
    ]);
    // An item under a remote carries nameId null; so does a tombstone.
    const inA = entryPayload({ scope: "project", remoteAlias: ALIAS_A, slug: "in-a" });
    await pushOne(t.server, ana.token, sendOf(inA));
    await pushOne(t.server, ana.token, {
      op: "withdraw",
      kind: "memory",
      uid: memory.uid,
      baseRevision: 1,
      baseHash: memory.hash,
    });
    const both = await pullAll(t.server, ana.token, { since: 0, projects: [NAME, ALIAS_A] });
    expect(both.items.map((item) => [item.op, item.remoteAlias, item.nameId])).toEqual([
      ["upsert", NAME, id],
      ["upsert", ALIAS_A, null],
      ["tombstone", NAME, null],
    ]);
    for (const item of both.items) expect("nameId" in item).toBe(true);

    // The name purged on the database: the upsert under it carries nameId null.
    expect(purgeName(t.server.db, NAME, t.clock.now)).toBe("purged");
    const after = await pullAll(t.server, ana.token, { since: 0, projects: [NAME] });
    expect(after.items.map((item) => [item.op, item.nameId])).toEqual([
      ["upsert", null],
      ["tombstone", null],
    ]);
    // A pull naming a name the registry never held answers nothing and is not refused.
    const unheld = await pull(t.server, ana.token, { since: 0, projects: ["name:unheld"] });
    expect(unheld.status).toBe(200);
    expect(unheld.body.items).toEqual([]);
  });

  test("moves: a remote's entry to a live name tombstones the remote; to an unheld or purged name it is refused with the row unchanged; back to the remote needs no registry", async () => {
    const { t, ana } = await team();
    await createName(t, ana.token, NAME);
    await createName(t, ana.token, "name:purged");
    expect(purgeName(t.server.db, "name:purged", t.clock.now)).toBe("purged");
    const inA = entryPayload({ scope: "project", remoteAlias: ALIAS_A, slug: "moving" });
    const uuid = uuidOf(inA.uid);
    await pushOne(t.server, ana.token, sendOf(inA));
    const under = (alias: string) => ({
      ...inA,
      uid: entryUid("project", alias, uuid),
      remoteAlias: alias,
    });

    const toName = await pushOne(
      t.server,
      ana.token,
      sendOf(under(NAME), { baseRevision: 1, baseHash: inA.hash }),
    );
    expect(toName).toEqual({
      uid: under(NAME).uid,
      result: "applied",
      revision: 2,
      hash: inA.hash,
    });
    expect(feedOf(t).slice(1)).toEqual([
      expect.objectContaining({ op: "upsert", project_alias: NAME, revision: 2, current: 1 }),
      expect.objectContaining({
        op: "tombstone",
        project_alias: ALIAS_A,
        revision: 2,
        moved_to: under(NAME).uid,
        key: `${uuid}@2`,
      }),
    ]);
    expect(entryRow(t, uuid)).toMatchObject({ project_alias: NAME, revision: 2 });

    const rowsBefore = feedOf(t).length;
    expect(
      await pushOne(
        t.server,
        ana.token,
        sendOf(under(OTHER), { baseRevision: 2, baseHash: inA.hash }),
      ),
    ).toEqual({ uid: under(OTHER).uid, result: "refused", reason: "name", rule: NAME_RULE });
    expect(
      await pushOne(
        t.server,
        ana.token,
        sendOf(under("name:purged"), { baseRevision: 2, baseHash: inA.hash }),
      ),
    ).toEqual({
      uid: under("name:purged").uid,
      result: "refused",
      reason: "name-purged",
      rule: NAME_PURGED_RULE,
    });
    expect(NAME_PURGED_RULE).toBe("the operator removed the name from this server");
    expect(feedOf(t)).toHaveLength(rowsBefore);
    expect(entryRow(t, uuid)).toMatchObject({ project_alias: NAME, revision: 2 });

    const back = await pushOne(
      t.server,
      ana.token,
      sendOf(under(ALIAS_A), { baseRevision: 2, baseHash: inA.hash }),
    );
    expect(back).toMatchObject({ result: "applied", revision: 3 });
    expect(feedOf(t).at(-1)).toMatchObject({
      op: "tombstone",
      project_alias: NAME,
      moved_to: under(ALIAS_A).uid,
    });
    expect(entryRow(t, uuid)).toMatchObject({ project_alias: ALIAS_A, revision: 3 });
  });

  test("a malformed name is shape; a name purged since refuses the replay and a new send; a withdraw needs no registry; a disabled member is 403", async () => {
    const { t, admin, ana } = await team();
    const bad = entryPayload({ scope: "project", remoteAlias: "name:Bad", slug: "bad" });
    expect(await pushOne(t.server, ana.token, sendOf(bad))).toEqual({
      uid: bad.uid,
      result: "refused",
      reason: "shape",
    });

    await createName(t, ana.token, NAME);
    const entry = entryPayload({ scope: "project", remoteAlias: NAME, slug: "kept" });
    const memory = memoryPayload({ remoteAlias: NAME });
    expect(await pushOne(t.server, ana.token, sendOf(entry))).toMatchObject({ result: "applied" });
    expect(await pushOne(t.server, ana.token, sendOf(memory))).toMatchObject({ result: "applied" });
    expect(purgeName(t.server.db, NAME, t.clock.now)).toBe("purged");
    // The replay of the same bytes, which would be applied unchanged, is refused first.
    expect(await pushOne(t.server, ana.token, sendOf(entry))).toEqual({
      uid: entry.uid,
      result: "refused",
      reason: "name-purged",
      rule: NAME_PURGED_RULE,
    });
    expect(await pushOne(t.server, ana.token, sendOf(memory))).toEqual({
      uid: memory.uid,
      result: "refused",
      reason: "name-purged",
      rule: NAME_PURGED_RULE,
    });
    const another = entryPayload({ scope: "project", remoteAlias: NAME, slug: "late" });
    expect(await pushOne(t.server, ana.token, sendOf(another))).toMatchObject({
      result: "refused",
      reason: "name-purged",
    });
    // A withdraw under the purged name lands: the owner's tombstone needs nothing of the registry.
    expect(
      await pushOne(t.server, ana.token, {
        op: "withdraw",
        kind: "entry",
        uid: entry.uid,
        baseRevision: 1,
        baseHash: entry.hash,
      }),
    ).toEqual({ uid: entry.uid, result: "withdrawn", revision: 2 });
    expect(entryRow(t, uuidOf(entry.uid))?.withdrawn_at).not.toBeNull();

    // A disabled member's device is refused before any item is read.
    const rui = await memberOf(t, admin.token, "Rui");
    await createName(t, admin.token, "name:live");
    await api(t.server, admin.token, "POST", `/v1/members/${rui.memberId}/disable`, {});
    const asRui = await api(t.server, rui.token, "POST", "/v1/push", {
      epoch: 1,
      items: [sendOf(memoryPayload({ remoteAlias: "name:live" }))],
    });
    expect(asRui.status).toBe(403);
  });
});
