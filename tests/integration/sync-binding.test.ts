// The two-phase bind under a shared name (ADR 0028): the dry run before any request, the
// contract read, the one lookup, the create or the join on the server, and the write with the
// name's id; the race between the server and the write through the test seam.
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { levelRows, setLevel } from "../../src/sharing/store.ts";
import { BIND_MESSAGES, commitBinding, prepareBinding } from "../../src/sync/binding.ts";
import { pullOnce, resetInbound } from "../../src/sync/inbound.ts";
import { insertPending, serverById, setContract, writeToken } from "../../src/sync/servers.ts";
import { flagName, nameStateOf } from "../../src/sync/state.ts";
import { nameByAlias, purgeName } from "../../src/team/store.ts";
import { openSyncStore, type SyncTestStore, serverFixture } from "../helpers/sync.ts";
import { cleanWorlds, closeWorlds, NAME, type World, world } from "../helpers/sync-world.ts";
import { api, entryPayload, memberOf, push } from "../helpers/team.ts";

const stores: SyncTestStore[] = [];
afterEach(async () => {
  resetInbound();
  for (const store of stores.splice(0)) store.close();
  await closeWorlds();
});
afterAll(() => cleanWorlds());

const AT_ONE = { contract: { current: 1, accepted: [1] } };
const HEX16 = /^[0-9a-f]{16}$/;

interface Seen {
  method: string;
  url: string;
  contract: string | null;
}
function spy(w: World): Seen[] {
  const seen: Seen[] = [];
  const real = w.store.ctx.fetch;
  w.store.ctx.fetch = (input, init) => {
    seen.push({
      method: init?.method ?? "GET",
      url: String(input instanceof Request ? input.url : input),
      contract: new Headers(init?.headers).get("x-wcm-contract"),
    });
    return real(input, init);
  };
  return seen;
}
const mes = (seen: Seen[]) => seen.filter((r) => r.url.endsWith("/v1/me"));
const lookups = (seen: Seen[]) =>
  seen.filter((r) => r.method === "GET" && r.url.includes("/v1/names/"));
const posts = (seen: Seen[]) =>
  seen.filter((r) => r.method === "POST" && r.url.endsWith("/v1/names"));

/** A project on a plain folder, known by its path alone. */
function pathProject(w: World, id: number, name: string): number {
  w.store.db.run("INSERT INTO projects (id, key, name, created_at) VALUES (?, ?, ?, 1)", [
    id,
    `path:/work/${name}`,
    name,
  ]);
  w.store.db.run("INSERT INTO project_aliases (alias, project_id) VALUES (?, ?)", [
    `path:/work/${name}`,
    id,
  ]);
  return id;
}

const prepare = (
  w: World,
  input: { projectId: number; as?: string; level?: "receive" | "knowledge" | "all" },
) =>
  prepareBinding(w.store.ctx, {
    projectId: input.projectId,
    destination: w.serverId,
    level: input.level ?? "knowledge",
    source: "cli",
    ...(input.as === undefined ? {} : { as: input.as }),
  });

const rowOf = (w: World, projectId: number) =>
  levelRows(w.store.db).find((row) => row.projectId === projectId);

describe("prepareBinding", () => {
  test("the dry run's refusals are answered without a request", async () => {
    const w = await world("knowledge", { named: true });
    pathProject(w, 3, "docs");
    const seen = spy(w);
    expect(await prepare(w, { projectId: 1, as: "name:site" })).toMatchObject({
      ok: false,
      reason: "has-remote",
    });
    expect(await prepare(w, { projectId: 3, as: NAME })).toMatchObject({
      ok: false,
      reason: "name-taken",
      other: "brand",
    });
    expect(await prepare(w, { projectId: 2, as: "name:other" })).toMatchObject({
      ok: false,
      reason: "renamed",
    });
    expect(await prepare(w, { projectId: 3 })).toMatchObject({ ok: false, reason: "no-name" });
    w.store.db.run("UPDATE projects SET disabled = 1 WHERE id = 3");
    expect(await prepare(w, { projectId: 3, as: "name:docs" })).toMatchObject({
      ok: false,
      reason: "disabled",
    });
    w.store.db.run("UPDATE projects SET disabled = 0 WHERE id = 3");
    // Bound to another server: one-server, before any request.
    insertPending(w.store.db, serverFixture("s2"));
    w.store.db.run("UPDATE sharing_servers SET confirmed_at = ? WHERE server_id = 's2'", [
      w.store.clock.now,
    ]);
    expect(
      setLevel(w.store.db, {
        projectId: 3,
        destination: "s2",
        level: "receive",
        source: "cli",
        now: w.store.clock.now,
        confirm: true,
        as: "name:docs",
      }),
    ).toMatchObject({ ok: true });
    expect(await prepare(w, { projectId: 3, as: "name:docs" })).toMatchObject({
      ok: false,
      reason: "one-server",
      server: "s2",
    });
    expect(seen).toEqual([]);
  });

  test("the contract: a row at 1 reads /v1/me once; still 1 it refuses with no names request; a bare 404 refuses and sets the row to 1", async () => {
    const w = await world("knowledge");
    pathProject(w, 3, "docs");
    setContract(w.store.db, w.serverId, 1);
    const seen = spy(w);
    expect(await prepare(w, { projectId: 3, as: "name:docs" })).toMatchObject({
      ok: true,
      action: "create",
      name: null,
      storedId: null,
    });
    expect(mes(seen)).toHaveLength(1);
    expect(lookups(seen)).toHaveLength(1);
    expect(w.server().contract).toBe(2);

    const one = await world("knowledge", { server: AT_ONE });
    pathProject(one, 3, "docs");
    const seenOne = spy(one);
    expect(await prepare(one, { projectId: 3, as: "name:docs" })).toMatchObject({
      ok: false,
      reason: "contract",
    });
    expect(mes(seenOne)).toHaveLength(1);
    expect(lookups(seenOne)).toHaveLength(0);
    setContract(one.store.db, one.serverId, 2);
    expect(await prepare(one, { projectId: 3, as: "name:docs" })).toMatchObject({
      ok: false,
      reason: "contract",
    });
    expect(one.server().contract).toBe(1);
    expect(mes(seenOne)).toHaveLength(1);
  });

  test("a server that cannot be reached answers unreachable", async () => {
    const store = openSyncStore({ fetch: (input, init) => fetch(input, init) });
    stores.push(store);
    insertPending(store.db, serverFixture("s1", { url: "http://127.0.0.1:1", contract: 2 }));
    store.db.run("UPDATE sharing_servers SET confirmed_at = ? WHERE server_id = 's1'", [
      store.clock.now,
    ]);
    writeToken(store.ctx, "s1", `wcm1_${"t".repeat(43)}`);
    store.db.run(
      "INSERT INTO projects (id, key, name, created_at) VALUES (3, 'path:/w/d', 'd', 1)",
    );
    store.db.run("INSERT INTO project_aliases (alias, project_id) VALUES ('path:/w/d', 3)");
    const prepared = await prepareBinding(store.ctx, {
      projectId: 3,
      destination: "s1",
      level: "knowledge",
      source: "cli",
      as: "name:docs",
    });
    expect(prepared).toMatchObject({ ok: false, reason: "unreachable" });
    expect(serverById(store.db, "s1")?.stopped).toBeNull();
  });
});

describe("commitBinding", () => {
  test("a create: needs-confirm sends no POST; create false is unknown-name; create true creates and binds with the id; the created id is kept on a re-create", async () => {
    const w = await world("knowledge");
    pathProject(w, 3, "docs");
    const seen = spy(w);
    const creating = await prepare(w, { projectId: 3, as: "name:docs", level: "receive" });
    expect(creating).toMatchObject({ ok: true, action: "create", name: null });
    if (!creating.ok) throw new Error("unreachable");
    expect(lookups(seen)).toHaveLength(1);

    expect(await commitBinding(w.store.ctx, creating, { confirm: false, create: true })).toEqual({
      ok: false,
      reason: "needs-confirm",
    });
    expect(posts(seen)).toHaveLength(0);
    expect(await commitBinding(w.store.ctx, creating, { confirm: true, create: false })).toEqual({
      ok: false,
      reason: "unknown-name",
      name: null,
    });
    expect(posts(seen)).toHaveLength(0);
    expect(rowOf(w, 3)).toBeUndefined();

    const bound = await commitBinding(w.store.ctx, creating, { confirm: true, create: true });
    expect(bound).toMatchObject({
      ok: true,
      boundAlias: "name:docs",
      named: true,
      created: true,
      joined: false,
    });
    expect(posts(seen)).toHaveLength(1);
    const row = rowOf(w, 3);
    expect(row).toMatchObject({ level: "receive", boundAlias: "name:docs" });
    expect(row?.nameId).toMatch(HEX16);
    const onServer = nameByAlias(w.t.server.db, "name:docs");
    expect(onServer?.id).toBe(row?.nameId as string);

    // The server lost the name while the project stayed bound (the sweep flagged it missing):
    // the creator's row still holds its id, and the re-create sends it.
    w.t.server.db.run("DELETE FROM names WHERE alias = 'name:docs'");
    flagName(w.store.ctx, w.serverId, "name:docs", "missing");
    const again = await prepare(w, { projectId: 3, as: "name:docs" });
    expect(again).toMatchObject({ ok: true, action: "create", storedId: row?.nameId });
    if (!again.ok) throw new Error("unreachable");
    expect(await commitBinding(w.store.ctx, again, { confirm: true, create: true })).toMatchObject({
      ok: true,
      created: true,
    });
    expect(nameByAlias(w.t.server.db, "name:docs")?.id).toBe(row?.nameId as string);
    expect(nameStateOf(w.store.db, w.serverId, "name:docs")).toBeNull();
  });

  test("a join: binds with the item's id; create on a join is exists with the item and writes nothing; a purged name's create is purged", async () => {
    const w = await world("knowledge");
    pathProject(w, 3, "docs");
    pathProject(w, 4, "other");
    const bob = await memberOf(w.t, w.token, "Bob", "desk");
    const made = await api(w.t.server, bob.token, "POST", "/v1/names", { alias: "name:team-docs" });
    expect(made.status).toBe(201);
    const seen = spy(w);
    const joining = await prepare(w, { projectId: 3, as: "name:team-docs" });
    expect(joining).toMatchObject({
      ok: true,
      action: "join",
      name: { alias: "name:team-docs", id: made.body.id, createdBy: { name: "Bob" } },
    });
    if (!joining.ok) throw new Error("unreachable");
    expect(lookups(seen)).toHaveLength(1);
    expect(
      await commitBinding(w.store.ctx, joining, { confirm: true, create: true }),
    ).toMatchObject({ ok: false, reason: "exists", name: { alias: "name:team-docs" } });
    expect(rowOf(w, 3)).toBeUndefined();
    const joined = await commitBinding(w.store.ctx, joining, { confirm: true, create: false });
    expect(joined).toMatchObject({
      ok: true,
      boundAlias: "name:team-docs",
      joined: true,
      created: false,
      named: true,
    });
    expect(rowOf(w, 3)?.nameId).toBe(made.body.id);

    const gone = await api(w.t.server, bob.token, "POST", "/v1/names", { alias: "name:gone" });
    expect(gone.status).toBe(201);
    expect(purgeName(w.t.server.db, "name:gone", w.store.clock.now)).toBe("purged");
    const purged = await prepare(w, { projectId: 4, as: "name:gone" });
    expect(purged).toMatchObject({ ok: true, action: "create" });
    if (!purged.ok) throw new Error("unreachable");
    expect(await commitBinding(w.store.ctx, purged, { confirm: true, create: true })).toMatchObject(
      { ok: false, reason: "purged" },
    );
    expect(rowOf(w, 4)).toBeUndefined();
  });

  test("the race: a project disabled between the server and the write refuses disabled with named true, the name left on the server", async () => {
    const w = await world("knowledge");
    pathProject(w, 3, "docs");
    const creating = await prepare(w, { projectId: 3, as: "name:docs" });
    if (!creating.ok) throw new Error("unreachable");
    const outcome = await commitBinding(
      w.store.ctx,
      creating,
      { confirm: true, create: true },
      { afterServer: () => w.store.db.run("UPDATE projects SET disabled = 1 WHERE id = 3") },
    );
    expect(outcome).toMatchObject({
      ok: false,
      reason: "disabled",
      named: true,
      message: BIND_MESSAGES["created-unbound"]("docs"),
    });
    expect(BIND_MESSAGES["created-unbound"]("docs")).toBe(
      "the name `docs` was created on the server; set the level again to use it, or the operator purges it",
    );
    expect(nameByAlias(w.t.server.db, "name:docs")).not.toBeNull();
    expect(rowOf(w, 3)).toBeUndefined();
  });

  test("a join of a re-created name stores the new id and clears the flag", async () => {
    const w = await world("knowledge", { named: true });
    const bob = await memberOf(w.t, w.token, "Bob", "desk");
    w.t.server.db.run("DELETE FROM names WHERE alias = ?", [NAME]);
    const made = await api(w.t.server, bob.token, "POST", "/v1/names", { alias: NAME });
    expect(made.status).toBe(201);
    const entry = entryPayload({
      scope: "project",
      remoteAlias: NAME,
      slug: "late",
      area: "sales",
    });
    await push(w.t.server, bob.token, [
      { op: "send", kind: "entry", uid: entry.uid, baseRevision: 0, baseHash: "", payload: entry },
    ]);
    expect(await pullOnce(w.store.ctx, w.server(), { wait: false })).toMatchObject({ ok: true });
    expect(nameStateOf(w.store.db, w.serverId, NAME)).toBe("recreated");
    const prepared = await prepare(w, { projectId: 2, as: NAME });
    expect(prepared).toMatchObject({
      ok: true,
      action: "join",
      state: "recreated",
      name: { id: made.body.id, createdBy: { name: "Bob" } },
    });
    if (!prepared.ok) throw new Error("unreachable");
    expect(
      await commitBinding(w.store.ctx, prepared, { confirm: true, create: false }),
    ).toMatchObject({
      ok: true,
      joined: true,
    });
    expect(rowOf(w, 2)?.nameId).toBe(made.body.id);
    expect(nameStateOf(w.store.db, w.serverId, NAME)).toBeNull();
  });

  test("binding.ts names no sharing table and is on the boundary test's quiet list", () => {
    const source = readFileSync(new URL("../../src/sync/binding.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/sharing_(levels|ledger|servers|refusals)/);
    const boundary = readFileSync(
      new URL("../unit/sync-boundary.test.ts", import.meta.url),
      "utf8",
    );
    expect(boundary).toContain('"src/sync/binding.ts"');
  });
});
