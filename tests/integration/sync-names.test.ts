// The sync with a project bound under a shared name (ADR 0028): the pull names it, a
// teammate's items land in the name's folder and the project, the sweep sends under the name,
// Nothing withdraws, the names held while the server speaks 1, the three flags a name can carry
// (missing, purged, re-created) and what they stop, and a name forgotten for a remote.
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { personAuthor } from "../../src/modules/knowledge/author.ts";
import { receivedRow } from "../../src/modules/knowledge/index-store.ts";
import { projectFolderName } from "../../src/modules/knowledge/repo.ts";
import { writeEntry } from "../../src/modules/knowledge/store.ts";
import { forgetName, setLevel } from "../../src/sharing/store.ts";
import { getMeta } from "../../src/store/meta.ts";
import { pullOnce, rejoinName, resetInbound } from "../../src/sync/inbound.ts";
import { liveSentRows, receivedMemoryRow, sentRow, unboundAliases } from "../../src/sync/ledger.ts";
import { sweep } from "../../src/sync/outbound.ts";
import { receivedRoot } from "../../src/sync/received.ts";
import { setContract } from "../../src/sync/servers.ts";
import {
  cursorsOf,
  nameFlag,
  nameFlagKey,
  nameStateOf,
  readHold,
  updateState,
} from "../../src/sync/state.ts";
import { fileNameFor } from "../../src/team/contract.ts";
import { insertName, purgeName } from "../../src/team/store.ts";
import {
  ALIAS,
  change,
  cleanWorlds,
  closeWorlds,
  feedOf,
  memory,
  NAME,
  taxonomy,
  type World,
  world,
} from "../helpers/sync-world.ts";
import { api, entryPayload, type Joined, memberOf, memoryPayload, push } from "../helpers/team.ts";

afterEach(async () => {
  resetInbound();
  await closeWorlds();
});
afterAll(() => cleanWorlds());

const NAMED = 2;
const FOLDER = `projects/wizardingcode-${projectFolderName(NAME).slice(0, 8)}`;

/** The URLs the client asked for. */
function spyFetch(w: World): string[] {
  const urls: string[] = [];
  const real = w.store.ctx.fetch;
  w.store.ctx.fetch = (input, init) => {
    urls.push(String(input instanceof Request ? input.url : input));
    return real(input, init);
  };
  return urls;
}
const lastPullProjects = (urls: string[]) =>
  decodeURIComponent(
    new URL(urls.filter((url) => url.includes("/v1/pull")).at(-1) ?? "http://x/").searchParams.get(
      "projects",
    ) ?? "",
  );
const refusals = (w: World) =>
  w.store.db.query<{ n: number }, []>("SELECT count(*) AS n FROM sharing_refusals").get()?.n ?? 0;

/** Bob joins and pushes an entry and a memory under the shared name. */
async function bobShares(
  w: World,
  slug = "brand-voice",
): Promise<{ bob: Joined; entryUid: string; memoryUid: string; uuid: string }> {
  const bob = await memberOf(w.t, w.token, "Bob", "desk");
  return { bob, ...(await bobPushes(w, bob, slug)) };
}

async function bobPushes(
  w: World,
  bob: Joined,
  slug: string,
): Promise<{ entryUid: string; memoryUid: string; uuid: string }> {
  const entry = entryPayload({
    scope: "project",
    remoteAlias: NAME,
    slug,
    title: `Title of ${slug}`,
    area: "sales",
    body: `Bob's body for ${slug}.`,
  });
  const mem = memoryPayload({
    remoteAlias: NAME,
    uid: `b0b0b0b0:${slug.length}`,
    title: `Bob on ${slug}`,
    body: "One file.",
  });
  const answer = await push(w.t.server, bob.token, [
    { op: "send", kind: "entry", uid: entry.uid, baseRevision: 0, baseHash: "", payload: entry },
    { op: "send", kind: "memory", uid: mem.uid, baseRevision: 0, baseHash: "", payload: mem },
  ]);
  expect(answer.body.results.map((r: { result: string }) => r.result)).toEqual([
    "applied",
    "applied",
  ]);
  return {
    entryUid: entry.uid,
    memoryUid: `remote:${bob.deviceAlias}:${mem.uid}`,
    uuid: entry.uid.slice(-36),
  };
}

/** The named project's own entry, committed by the person. */
function ownEntry(w: World, title = "Brand voice"): string {
  const written = writeEntry(
    w.knowledge,
    { scope: "project", projectId: NAMED },
    change({ title }),
    personAuthor(w.knowledge),
  );
  if (written.kind !== "written") throw new Error(`not written: ${written.kind}`);
  return `project:${NAME}:${written.entry.id}`;
}

const level = (w: World, projectId: number, wanted: "local" | "receive" | "knowledge" | "all") =>
  setLevel(w.store.db, {
    projectId,
    destination: w.serverId,
    level: wanted,
    source: "cli",
    now: w.store.clock.now,
    confirm: true,
  });

describe("a project bound under a shared name", () => {
  test("the pull names the name; a teammate's entry lands in the name's folder with its rows, a memory becomes an imported memory of the project", async () => {
    const w = await world("all", { named: true });
    taxonomy(w);
    const urls = spyFetch(w);
    const { entryUid, memoryUid, uuid } = await bobShares(w);
    expect(await pullOnce(w.store.ctx, w.server(), { wait: false })).toMatchObject({
      ok: true,
      applied: 2,
    });
    expect(lastPullProjects(urls).split(",")).toEqual([NAME, ALIAS]);
    const row = receivedRow(w.store.db, w.serverId, entryUid);
    expect(row).toMatchObject({
      scope: "project",
      remoteAlias: NAME,
      projectId: NAMED,
      memberName: "Bob",
      slug: "title-of-brand-voice",
    });
    expect(row?.path).toBe(`${w.serverId}/${FOLDER}/${fileNameFor(uuid, "title-of-brand-voice")}`);
    expect(existsSync(join(receivedRoot(w.store.dataDir), ...(row?.path ?? "").split("/")))).toBe(
      true,
    );
    expect(
      w.store.db
        .query<{ n: number }, [string]>(
          "SELECT count(*) AS n FROM sharing_ledger WHERE item_uid = ? AND direction = 'received'",
        )
        .get(entryUid)?.n,
    ).toBe(1);
    const known = receivedMemoryRow(w.store.db, w.serverId, memoryUid);
    expect(known?.memoryId).not.toBeNull();
    expect(
      w.store.db
        .query<{ project_id: number; origin: string; judge: string }, [number]>(
          "SELECT project_id, origin, judge FROM memories WHERE id = ?",
        )
        .get(known?.memoryId as number),
    ).toEqual({ project_id: NAMED, origin: "imported", judge: `team:${w.serverId}` });
  });

  test("the sweep sends the project's entry under the name's uid and its memory with the name; Nothing withdraws both, notes the name unbound, and the next pull removes the received copies", async () => {
    const w = await world("all", { named: true });
    taxonomy(w);
    const ownUid = ownEntry(w);
    memory(w, "Brand memory", { projectId: NAMED });
    expect(await sweep(w.store.ctx, w.server(), { full: true })).toMatchObject({
      sent: 2,
      refused: 0,
    });
    const page = await feedOf(w, [NAME]);
    expect(page.items.map((item) => [item.kind, item.uid === ownUid, item.remoteAlias])).toEqual([
      ["entry", true, NAME],
      ["memory", false, NAME],
    ]);
    expect(page.items[1]?.payload).toMatchObject({ remoteAlias: NAME, title: "Brand memory" });
    const { entryUid, memoryUid } = await bobShares(w);
    expect(await pullOnce(w.store.ctx, w.server(), { wait: false })).toMatchObject({ ok: true });

    w.store.clock.advance(60_000);
    expect(level(w, NAMED, "local")).toMatchObject({ ok: true, old: "all" });
    expect(await sweep(w.store.ctx, w.server(), { full: true })).toMatchObject({
      withdrawn: 2,
      held: 0,
    });
    expect(liveSentRows(w.store.db, w.serverId)).toEqual([]);
    expect(unboundAliases(w.store.db, w.serverId).map((row) => row.alias)).toEqual([NAME]);
    expect(await pullOnce(w.store.ctx, w.server(), { wait: false })).toMatchObject({ ok: true });
    expect(receivedRow(w.store.db, w.serverId, entryUid)).toBeNull();
    expect(receivedMemoryRow(w.store.db, w.serverId, memoryUid)).toBeNull();
    expect((await feedOf(w, [NAME])).items.filter((item) => item.op === "tombstone")).toHaveLength(
      2,
    );
  });

  test("names held: with the row at 1 the pull names remotes alone and the sweep sends nothing of the named project, with no refusal; at 2 again the pull names it and the sweep sends", async () => {
    const w = await world("all", { named: true });
    taxonomy(w);
    ownEntry(w);
    memory(w, "Brand memory", { projectId: NAMED });
    setContract(w.store.db, w.serverId, 1);
    const urls = spyFetch(w);
    expect(await pullOnce(w.store.ctx, w.server(), { wait: false })).toMatchObject({ ok: true });
    expect(lastPullProjects(urls)).toBe(ALIAS);
    expect(await sweep(w.store.ctx, w.server(), { full: true })).toMatchObject({
      sent: 0,
      refused: 0,
      stopped: null,
    });
    expect(refusals(w)).toBe(0);
    expect((await feedOf(w, [NAME])).items).toEqual([]);
    setContract(w.store.db, w.serverId, 2);
    w.store.clock.advance(60_000);
    expect(await pullOnce(w.store.ctx, w.server(), { wait: false })).toMatchObject({ ok: true });
    expect(lastPullProjects(urls).split(",")).toContain(NAME);
    expect(await sweep(w.store.ctx, w.server(), { full: true })).toMatchObject({ sent: 2 });
  });

  test("a 101st bound alias that is a name goes to the extras as any alias", async () => {
    const w = await world("all", { named: true });
    taxonomy(w);
    // One hundred names that sort before the project's, each bound at Receive only.
    const names: string[] = [];
    for (let i = 0; i < 100; i++) {
      const id = 100 + i;
      const alias = `name:a-${String(i).padStart(3, "0")}`;
      w.store.db.run("INSERT INTO projects (id, key, name, created_at) VALUES (?, ?, ?, 1)", [
        id,
        `path:/work/a${i}`,
        `a${i}`,
      ]);
      w.store.db.run("INSERT INTO project_aliases (alias, project_id) VALUES (?, ?)", [
        `path:/work/a${i}`,
        id,
      ]);
      const bound = setLevel(w.store.db, {
        projectId: id,
        destination: w.serverId,
        level: "receive",
        source: "cli",
        now: w.store.clock.now,
        confirm: true,
        as: alias,
        nameId: id.toString(16).padStart(16, "0"),
      });
      if (!bound.ok) throw new Error(`setLevel: ${bound.reason}`);
      names.push(alias);
    }
    const urls = spyFetch(w);
    expect(await pullOnce(w.store.ctx, w.server(), { wait: false })).toMatchObject({ ok: true });
    const pulls = urls.filter((url) => url.includes("/v1/pull")).map(decodeURIComponent);
    const main = pulls.find((url) => url.includes("scope=all")) as string;
    expect(main).toContain(`projects=${names.join(",")}`);
    expect(main).not.toContain(NAME);
    expect(pulls.some((url) => url.includes("scope=project") && url.includes(NAME))).toBe(true);
    const cursors = cursorsOf(w.store.db, w.serverId);
    expect(cursors.mainAliases).toEqual(names);
    expect(Object.keys(cursors.extra).sort()).toEqual([NAME, ALIAS].sort());
  });

  test("a name-bound project with memory off is not named by the pull", async () => {
    const w = await world("knowledge", { named: true });
    w.store.db.run("UPDATE projects SET disabled = 1 WHERE id = ?", [NAMED]);
    const urls = spyFetch(w);
    expect(await pullOnce(w.store.ctx, w.server(), { wait: false })).toMatchObject({ ok: true });
    expect(lastPullProjects(urls)).toBe(ALIAS);
  });
});

describe("the flags a name can carry", () => {
  test("a push answered name: no refusal, no failure, the name flagged missing, the project's items skipped; the name back under its id, the next sweep sends them and clears the flag", async () => {
    const w = await world("all", { named: true });
    taxonomy(w);
    ownEntry(w, "Brand voice");
    ownEntry(w, "Brand tone");
    memory(w, "Brand memory", { projectId: NAMED });
    memory(w, "Site memory");
    w.t.server.db.run("DELETE FROM names WHERE alias = ?", [NAME]);
    const result = await sweep(w.store.ctx, w.server(), { full: true });
    // A name refusal never produces a hold under D-10: nothing was withdrawn, nothing is held.
    expect(result).toMatchObject({ sent: 1, stopped: null, held: 0 });
    expect(readHold(w.store.db, w.serverId)).toBeNull();
    expect(refusals(w)).toBe(0);
    expect(w.server()).toMatchObject({ failures: 0, retryAt: null });
    expect(nameStateOf(w.store.db, w.serverId, NAME)).toBe("missing");
    expect(getMeta(w.store.db, nameFlagKey("missing", w.serverId, NAME))).not.toBeNull();
    expect((await feedOf(w, [ALIAS, NAME])).items.map((item) => item.remoteAlias)).toEqual([ALIAS]);
    expect(liveSentRows(w.store.db, w.serverId)).toHaveLength(1);

    insertName(w.t.server.db, {
      alias: NAME,
      id: w.nameId as string,
      memberId: w.server().memberId,
      deviceId: w.server().deviceId,
      at: w.store.clock.now,
    });
    w.store.clock.advance(60_000);
    expect(await sweep(w.store.ctx, w.server(), { full: true })).toMatchObject({ sent: 3 });
    expect(nameStateOf(w.store.db, w.serverId, NAME)).toBeNull();
    expect(refusals(w)).toBe(0);
  });

  test("a push answered name-purged flags the name purged; nothing leaves under it afterwards; Nothing clears the flag", async () => {
    const w = await world("all", { named: true });
    taxonomy(w);
    ownEntry(w);
    memory(w, "Brand memory", { projectId: NAMED });
    expect(purgeName(w.t.server.db, NAME, w.store.clock.now)).toBe("purged");
    expect(await sweep(w.store.ctx, w.server(), { full: true })).toMatchObject({
      sent: 0,
      stopped: null,
    });
    expect(refusals(w)).toBe(0);
    expect(nameStateOf(w.store.db, w.serverId, NAME)).toBe("purged");
    ownEntry(w, "Brand tone");
    const urls = spyFetch(w);
    w.store.clock.advance(60_000);
    expect(await sweep(w.store.ctx, w.server(), { full: true })).toMatchObject({ sent: 0 });
    expect(urls.filter((url) => url.endsWith("/v1/push"))).toEqual([]);
    expect(level(w, NAMED, "local")).toMatchObject({ ok: true });
    expect(nameStateOf(w.store.db, w.serverId, NAME)).toBeNull();
  });

  test("a pulled upsert whose nameId differs is skipped and flags the name re-created with the new id and creator; the sweep sends nothing under it; a snapshot keeps its rows; the join under the new id clears it and the next pull applies", async () => {
    const w = await world("all", { named: true });
    taxonomy(w);
    const { bob, entryUid: first } = await bobShares(w, "first");
    expect(await pullOnce(w.store.ctx, w.server(), { wait: false })).toMatchObject({ applied: 2 });
    // The registry lost the name (a restore) and Bob created it again under a new id.
    w.t.server.db.run("DELETE FROM names WHERE alias = ?", [NAME]);
    const made = await api(w.t.server, bob.token, "POST", "/v1/names", { alias: NAME });
    expect(made.status).toBe(201);
    const newId = made.body.id as string;
    expect(newId).not.toBe(w.nameId);
    const { entryUid: second } = await bobPushes(w, bob, "second");
    expect(await pullOnce(w.store.ctx, w.server(), { wait: false })).toMatchObject({
      ok: true,
      applied: 0,
    });
    expect(receivedRow(w.store.db, w.serverId, second)).toBeNull();
    expect(nameStateOf(w.store.db, w.serverId, NAME)).toBe("recreated");
    expect(nameFlag(w.store.db, w.serverId, NAME, "recreated")).toMatchObject({
      id: newId,
      member: { id: bob.memberId, name: "Bob" },
    });
    // The sweep sends nothing under the name while the flag stands.
    ownEntry(w);
    expect(await sweep(w.store.ctx, w.server(), { full: true })).toMatchObject({ sent: 0 });
    // A snapshot drops none of its received rows.
    updateState(w.store.ctx, w.serverId, { snapshotDue: true });
    expect(await pullOnce(w.store.ctx, w.server(), { wait: false })).toMatchObject({ ok: true });
    expect(receivedRow(w.store.db, w.serverId, first)).not.toBeNull();
    // Joining again, as commitBinding does: the new id stored, the flag cleared, the items applied.
    expect(
      setLevel(w.store.db, {
        projectId: NAMED,
        destination: w.serverId,
        level: "all",
        source: "cli",
        now: w.store.clock.now,
        confirm: true,
        as: NAME,
        nameId: newId,
        recreated: true,
      }),
    ).toMatchObject({ ok: true });
    rejoinName(w.store.ctx, w.serverId, NAME);
    expect(nameStateOf(w.store.db, w.serverId, NAME)).toBeNull();
    expect(await pullOnce(w.store.ctx, w.server(), { wait: false })).toMatchObject({ ok: true });
    expect(receivedRow(w.store.db, w.serverId, second)).not.toBeNull();
    w.store.clock.advance(60_000);
    expect(await sweep(w.store.ctx, w.server(), { full: true })).toMatchObject({ sent: 1 });
  });

  test("a snapshot without a teammate's memory under the name forgets it: the received row and the imported memory go", async () => {
    const w = await world("all", { named: true });
    taxonomy(w);
    const { entryUid, memoryUid } = await bobShares(w);
    expect(await pullOnce(w.store.ctx, w.server(), { wait: false })).toMatchObject({ applied: 2 });
    const known = receivedMemoryRow(w.store.db, w.serverId, memoryUid);
    expect(known?.memoryId).not.toBeNull();
    // The server lost the memory (a restore to a copy taken before it): its rows are gone, no tombstone.
    w.t.server.db.run("DELETE FROM changes WHERE kind = 'memory' AND project_alias = ?", [NAME]);
    w.t.server.db.run("DELETE FROM memories WHERE project_alias = ?", [NAME]);
    updateState(w.store.ctx, w.serverId, { snapshotDue: true });
    expect(await pullOnce(w.store.ctx, w.server(), { wait: false })).toMatchObject({ ok: true });
    expect(receivedMemoryRow(w.store.db, w.serverId, memoryUid)).toBeNull();
    expect(
      w.store.db
        .query<{ n: number }, [number]>("SELECT count(*) AS n FROM memories WHERE id = ?")
        .get(known?.memoryId as number)?.n,
    ).toBe(0);
    // The entry the server still holds stays.
    expect(receivedRow(w.store.db, w.serverId, entryUid)).not.toBeNull();
  });

  test("an upsert with nameId null (the name purged on the server) and a tombstone under the name are applied as today", async () => {
    const w = await world("all", { named: true });
    taxonomy(w);
    const { bob, entryUid } = await bobShares(w);
    expect(purgeName(w.t.server.db, NAME, w.store.clock.now)).toBe("purged");
    expect((await feedOf(w, [NAME])).items.map((item) => item.nameId)).toEqual([null, null]);
    expect(await pullOnce(w.store.ctx, w.server(), { wait: false })).toMatchObject({ applied: 2 });
    expect(receivedRow(w.store.db, w.serverId, entryUid)).not.toBeNull();
    const current = (await feedOf(w, [NAME])).items.find((item) => item.uid === entryUid);
    const withdrawn = await push(w.t.server, bob.token, [
      {
        op: "withdraw",
        kind: "entry",
        uid: entryUid,
        baseRevision: current?.revision,
        baseHash: current?.hash,
      },
    ]);
    expect(withdrawn.body.results[0]).toMatchObject({ result: "withdrawn" });
    expect(await pullOnce(w.store.ctx, w.server(), { wait: false })).toMatchObject({ applied: 1 });
    expect(receivedRow(w.store.db, w.serverId, entryUid)).toBeNull();
  });

  test("a name forgotten and the level bound by a new remote: the next tick sends the entry as a move on the old row's base", async () => {
    const w = await world("knowledge", { named: true });
    taxonomy(w);
    const oldUid = ownEntry(w);
    expect(await sweep(w.store.ctx, w.server(), { full: true })).toMatchObject({ sent: 1 });
    const oldRow = sentRow(w.store.db, w.serverId, "entry", oldUid);
    expect(level(w, NAMED, "local")).toMatchObject({ ok: true });
    expect(forgetName(w.store.db, NAMED, w.store.clock.now, "cli")).toEqual({
      ok: true,
      alias: NAME,
    });
    const remote = "remote:github.com/acme/brand";
    w.store.db.run("INSERT INTO project_aliases (alias, project_id) VALUES (?, ?)", [
      remote,
      NAMED,
    ]);
    expect(level(w, NAMED, "knowledge")).toMatchObject({ ok: true, boundAlias: remote });
    w.store.clock.advance(5_000);
    expect(await sweep(w.store.ctx, w.server(), { full: false })).toMatchObject({ sent: 1 });
    const newUid = `project:${remote}:${oldUid.slice(-36)}`;
    expect(sentRow(w.store.db, w.serverId, "entry", newUid)).toMatchObject({
      version: (oldRow?.version ?? 0) + 1,
    });
    expect(sentRow(w.store.db, w.serverId, "entry", oldUid)).toMatchObject({ reason: "moved" });
    expect(liveSentRows(w.store.db, w.serverId).map((row) => row.itemUid)).toEqual([newUid]);
    const items = (await feedOf(w, [NAME, remote])).items;
    expect(items.find((item) => item.uid === oldUid)).toMatchObject({
      op: "tombstone",
      movedTo: newUid,
    });
  });
});
