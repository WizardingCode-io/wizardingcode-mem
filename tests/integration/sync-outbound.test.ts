// The outbound side (ADR 0027): the sweep against the in-process team server on one fake
// clock. What leaves, how it is cut, what the answers write, and the withdrawals behind D-10.
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Redacted } from "../../src/core/redact.ts";
import { personAuthor } from "../../src/modules/knowledge/author.ts";
import { renderTaxonomy } from "../../src/modules/knowledge/entry.ts";
import { openRepo, resetGitCaches } from "../../src/modules/knowledge/repo.ts";
import { writeEntry } from "../../src/modules/knowledge/store.ts";
import { openStore } from "../../src/modules/knowledge/store-open.ts";
import type { EntryChange, KnowledgeStore } from "../../src/modules/knowledge/types.ts";
import { ledgerRecords } from "../../src/sharing/report.ts";
import { generationOf, setLevel } from "../../src/sharing/store.ts";
import { memoryUid } from "../../src/sharing/types.ts";
import { insertMemory } from "../../src/store/memories.ts";
import { dirtyKey, getMeta, restoreHoldKey, setMeta } from "../../src/store/meta.ts";
import type { Fetch } from "../../src/sync/context.ts";
import { confirmJoin, joinServer } from "../../src/sync/join.ts";
import {
  authorisedUids,
  liveSentRows,
  refusalFor,
  resumeAuthorisedKey,
  sentRow,
} from "../../src/sync/ledger.ts";
import { BATCH_BYTES, BATCH_ITEMS, sweep, wouldWithdraw } from "../../src/sync/outbound.ts";
import { serverById } from "../../src/sync/servers.ts";
import { readHold } from "../../src/sync/state.ts";
import type { PushItemShape, PushResultShape } from "../../src/team/contract.ts";
import { realGit } from "../helpers/stub-git.ts";
import {
  cleanSyncDirs,
  fakeClock,
  fakeTimers,
  openSyncStore,
  type SyncTestStore,
} from "../helpers/sync.ts";
import { api, cleanTestDirs, pullAll, startTestServer, type TestServer } from "../helpers/team.ts";

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

interface World {
  t: TestServer;
  store: SyncTestStore;
  knowledge: KnowledgeStore;
  serverId: string;
  token: string;
  projectId: number;
  server: () => NonNullable<ReturnType<typeof serverById>>;
}

/** A server, a confirmed client store with a knowledge store and one project bound to it. */
async function world(level: "knowledge" | "all" = "knowledge"): Promise<World> {
  const clock = fakeClock();
  const timers = fakeTimers(clock);
  const t = await startTestServer({}, { clock, timers });
  servers.push(t);
  const store = openSyncStore({ clock, timers, fetch: realFetch });
  stores.push(store);
  store.ctx.env = {
    ...store.ctx.env,
    PATH: process.env.PATH,
    HOME: store.dataDir,
    WIZARDINGCODE_MEM_AUTHOR: "Ana",
  };
  resetGitCaches();
  writeFileSync(
    join(store.dataDir, "env"),
    "WIZARDINGCODE_MEM_SHARE_ROOTS=workspace\nWIZARDINGCODE_MEM_SHARE_AREAS=workspace:sales\n",
  );
  const knowledge = openStore({
    db: store.db,
    dataDir: store.dataDir,
    env: store.ctx.env,
    now: () => clock.now,
  });
  store.db.run("INSERT INTO projects (id, key, name, created_at) VALUES (1, ?, 'site', 1)", [
    ALIAS,
  ]);
  store.db.run("INSERT INTO project_aliases (alias, project_id) VALUES (?, 1)", [ALIAS]);
  const joined = await joinServer(store.ctx, {
    url: t.server.origin,
    code: t.code,
    label: "laptop",
    name: "Ana",
  });
  if (!joined.ok) throw new Error(`join failed: ${joined.message}`);
  confirmJoin(store.ctx, joined.serverId);
  const bound = setLevel(store.db, {
    projectId: 1,
    destination: joined.serverId,
    level,
    source: "cli",
    now: clock.now,
    confirm: true,
  });
  if (!bound.ok) throw new Error(`setLevel failed: ${bound.reason}`);
  const token = (await import("../../src/sync/servers.ts")).readTokens(store.dataDir)[
    joined.serverId
  ] as string;
  return {
    t,
    store,
    knowledge,
    serverId: joined.serverId,
    token,
    projectId: 1,
    server: () =>
      serverById(store.db, joined.serverId) as NonNullable<ReturnType<typeof serverById>>,
  };
}

const change = (over: Partial<EntryChange> = {}): EntryChange => ({
  title: "Discovery call script",
  kind: "strategy",
  area: "sales",
  context: "agency clients",
  subject: "discovery call",
  body: "The body.",
  ...over,
});

/** Writes the workspace taxonomy with the sales area, so the policy's area is in force. */
function taxonomy(w: World): void {
  const repo = openRepo(w.knowledge, { scope: "workspace" }, { create: personAuthor(w.knowledge) });
  if (repo === null) throw new Error("no workspace repository");
  writeFileSync(
    join(repo.path, "taxonomy.md"),
    renderTaxonomy({
      version: 2,
      updated: "2026-11-10T00:00:00Z",
      areas: [
        { id: "sales", label: "Sales" },
        { id: "code", label: "Code" },
      ],
    }),
  );
  realGit(repo.path, "add", "-A");
  realGit(repo.path, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "taxonomy");
}

const feed = (w: World) =>
  pullAll(w.t.server, w.token, { since: 0, scope: "all", projects: [ALIAS] });

const memory = (w: World, title: string, over: Partial<{ importance: number; now: number }> = {}) =>
  insertMemory(w.store.db, {
    projectId: w.projectId,
    kind: "decision",
    title,
    body: "One file, one process." as Redacted,
    terms: "",
    importance: over.importance ?? 3,
    branch: null,
    commit: null,
    origin: "distilled",
    judge: "heuristic",
    judgeVersion: "1",
    sourceTurnId: null,
    files: [],
    now: over.now ?? w.store.clock.now,
  });

describe("the sweep sends", () => {
  test("an entry leaves with its pin removed and its hash equal to the server's; the ledger row; the next sweep is quiet", async () => {
    const w = await world();
    taxonomy(w);
    const written = writeEntry(
      w.knowledge,
      { scope: "project", projectId: 1 },
      change({ pinned: true }),
      personAuthor(w.knowledge),
    );
    if (written.kind !== "written") throw new Error("not written");
    const first = await sweep(w.store.ctx, w.server(), { full: true });
    expect(first).toMatchObject({ sent: 1, refused: 0, withdrawn: 0, stopped: null });
    const page = await feed(w);
    expect(page.items).toHaveLength(1);
    const item = page.items[0] as {
      uid: string;
      hash: string;
      revision: number;
      payload: { frontmatter: string };
    };
    expect(item.uid).toBe(`project:${ALIAS}:${written.entry.id}`);
    expect(item.payload.frontmatter).not.toContain("pinned");
    const row = sentRow(w.store.db, w.serverId, "entry", item.uid);
    expect(row).toMatchObject({
      version: 1,
      hash: item.hash,
      instance: w.t.server.instance(),
      withdrawnAt: null,
    });
    expect(row?.localHash).not.toBe("");
    expect(row?.localHash).not.toBe(item.hash);
    const records = ledgerRecords(w.store.db, w.serverId, "entry").get(item.uid);
    expect(records?.[0]?.hash).toBe(row?.localHash);
    // The next sweep, tick or full, sends nothing.
    w.store.clock.advance(5_000);
    expect(await sweep(w.store.ctx, w.server(), { full: false })).toMatchObject({ sent: 0 });
    expect(await sweep(w.store.ctx, w.server(), { full: true })).toMatchObject({ sent: 0 });
    expect((await feed(w)).items).toHaveLength(1);
    expect(w.server().lastSweepEpoch).not.toBeNull();
    expect(w.server().lastPushOkAt).not.toBeNull();
  });

  test("an uncommitted edit is counted as dirty and leaves once committed; a change is sent as a new revision on the sent base", async () => {
    const w = await world();
    taxonomy(w);
    const written = writeEntry(
      w.knowledge,
      { scope: "project", projectId: 1 },
      change(),
      personAuthor(w.knowledge),
    );
    if (written.kind !== "written") throw new Error("not written");
    expect(await sweep(w.store.ctx, w.server(), { full: true })).toMatchObject({ sent: 1 });
    const repo = openRepo(w.knowledge, { scope: "project", projectId: 1 });
    if (repo === null) throw new Error("no repository");
    const file = join(repo.path, "entries", "discovery-call-script.md");
    writeFileSync(file, readFileSync(file, "utf8").replace("The body.", "Edited by hand."));
    w.store.clock.advance(60_000);
    const dirty = await sweep(w.store.ctx, w.server(), { full: true });
    expect(dirty).toMatchObject({ sent: 0, dirty: 1 });
    expect(getMeta(w.store.db, dirtyKey(w.serverId))).toBe("1");
    expect((await feed(w)).items[0]).toMatchObject({ revision: 1 });
    realGit(repo.path, "add", "-A");
    realGit(repo.path, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "by hand");
    w.store.clock.advance(60_000);
    const committed = await sweep(w.store.ctx, w.server(), { full: true });
    expect(committed).toMatchObject({ sent: 1, dirty: 0 });
    const page = await feed(w);
    expect(page.items[0]).toMatchObject({ revision: 2 });
    expect((page.items[0] as { payload: { body: string } }).payload.body).toContain(
      "Edited by hand.",
    );
    expect(
      sentRow(w.store.db, w.serverId, "entry", (page.items[0] as { uid: string }).uid)?.version,
    ).toBe(2);
  });

  test("memories of a project at all leave; a past-dated memory is seen once by the max-id rule; a stale memory is recorded as sent and the next sweep is quiet", async () => {
    const w = await world("all");
    taxonomy(w);
    memory(w, "We chose SQLite");
    expect(await sweep(w.store.ctx, w.server(), { full: true })).toMatchObject({ sent: 1 });
    const generation = generationOf(w.store.db) as string;
    w.store.clock.advance(5_000);
    // A row inserted with a past updated_at: not by time, by id.
    const old = memory(w, "An old decision", { now: w.store.clock.now - 86_400_000 });
    expect(await sweep(w.store.ctx, w.server(), { full: false })).toMatchObject({ sent: 1 });
    expect(sentRow(w.store.db, w.serverId, "memory", memoryUid(generation, old))).not.toBeNull();
    w.store.clock.advance(5_000);
    expect(await sweep(w.store.ctx, w.server(), { full: false })).toMatchObject({ sent: 0 });
    // The server holds a later copy of a memory (another generation after a restore): stale,
    // recorded as sent with the local hash; the next sweep sends nothing; a change leaves.
    const later = memory(w, "Later elsewhere");
    const uid = memoryUid(generation, later);
    const payload = {
      kind: "memory",
      uid,
      remoteAlias: ALIAS,
      title: "Later elsewhere",
      body: "Newer on the server.",
      memoryKind: "decision",
      importance: 3,
      status: "active",
      createdAt: w.store.clock.now,
      updatedAt: w.store.clock.now + 60_000,
      version: w.store.clock.now + 60_000,
      hash: "",
    };
    payload.hash = (await import("../../src/sharing/hash.ts")).memoryHash(payload);
    const pushed = await api(w.t.server, w.token, "POST", "/v1/push", {
      epoch: 1,
      items: [{ op: "send", kind: "memory", uid, baseRevision: 0, baseHash: "", payload }],
    });
    expect(pushed.body.results[0].result).toBe("applied");
    w.store.clock.advance(5_000);
    const stale = await sweep(w.store.ctx, w.server(), { full: true });
    expect(stale.sent).toBe(1);
    const recorded = sentRow(w.store.db, w.serverId, "memory", uid);
    expect(recorded).toMatchObject({ version: 1, hash: payload.hash });
    expect(recorded?.localHash).not.toBe(payload.hash);
    w.store.clock.advance(5_000);
    expect(await sweep(w.store.ctx, w.server(), { full: true })).toMatchObject({ sent: 0 });
    w.store.db.run("UPDATE memories SET title = 'Changed here', updated_at = ? WHERE id = ?", [
      w.store.clock.now + 120_000,
      later,
    ]);
    w.store.clock.advance(5_000);
    expect(await sweep(w.store.ctx, w.server(), { full: false })).toMatchObject({ sent: 1 });
  });

  test("a widening sends the old memories in batches of at most 200 items and 900 KiB, the live change first; the edge redacts a key before it leaves", async () => {
    const w = await world("knowledge");
    taxonomy(w);
    for (let i = 0; i < 450; i++) memory(w, `Decision ${i}`);
    w.store.clock.advance(1_000);
    expect(await sweep(w.store.ctx, w.server(), { full: true })).toMatchObject({ sent: 0 });
    const widened = setLevel(w.store.db, {
      projectId: 1,
      destination: w.serverId,
      level: "all",
      source: "cli",
      now: w.store.clock.now,
      confirm: true,
    });
    expect(widened.ok).toBe(true);
    w.store.clock.advance(5_000);
    // One memory written since the last sweep: the live change, ahead of the backlog.
    const live = memory(w, "The live change");
    const generation = generationOf(w.store.db) as string;
    const batches = interceptPush(w);
    const first = await sweep(w.store.ctx, w.server(), { full: false });
    expect(first).toMatchObject({ sent: 451, stopped: null });
    expect(batches.length).toBeGreaterThanOrEqual(3);
    expect(batches.reduce((sum, batch) => sum + batch.items.length, 0)).toBe(451);
    for (const batch of batches) {
      expect(batch.items.length).toBeLessThanOrEqual(BATCH_ITEMS);
      expect(batch.bytes).toBeLessThanOrEqual(BATCH_BYTES);
    }
    expect(batches[0]?.items[0]?.uid).toBe(memoryUid(generation, live));
    expect(liveSentRows(w.store.db, w.serverId, "memory")).toHaveLength(451);
    // A memory with a key: the edge redacts it before it leaves, so the server sees no secret
    // and the memory is sent, its body without the key.
    const secret = memory(w, `Token ${["AKIA", "A1B2C3D4", "E5F6G7H8"].join("")}`);
    w.store.db.run("UPDATE memories SET body = ? WHERE id = ?", [
      `key ${["AKIA", "A1B2C3D4", "E5F6G7H8"].join("")} here`,
      secret,
    ]);
    w.store.clock.advance(5_000);
    batches.length = 0;
    expect(await sweep(w.store.ctx, w.server(), { full: false })).toMatchObject({
      sent: 1,
      refused: 0,
    });
    expect(JSON.stringify(batches)).not.toContain("AKIA");
  });
});

/** Every `/v1/push` the client sends: its items and the serialized body's size. */
function interceptPush(
  w: World,
  answer?: (items: PushItemShape[], forward: () => Promise<Response>) => Promise<Response>,
): { items: PushItemShape[]; bytes: number }[] {
  const batches: { items: PushItemShape[]; bytes: number }[] = [];
  const real = w.store.ctx.fetch;
  w.store.ctx.fetch = (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.includes("/v1/push")) return real(input, init);
    const body = String(init?.body ?? "");
    const items = (JSON.parse(body) as { items: PushItemShape[] }).items;
    batches.push({ items, bytes: Buffer.byteLength(body, "utf8") });
    const forward = () => real(input, init);
    return answer === undefined ? forward() : answer(items, forward);
  };
  return batches;
}

/** A server's answer made here: the lines given, status 200. */
const answered = (results: PushResultShape[]) =>
  new Response(JSON.stringify({ results }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

describe("the answers a push gets (AC-77)", () => {
  test("a refusal is stored with its reason and rule and never re-sent for that hash; a changed text leaves", async () => {
    const w = await world("all");
    taxonomy(w);
    const id = memory(w, "Plain enough");
    const uid = memoryUid(generationOf(w.store.db) as string, id);
    const batches = interceptPush(w, async (items) =>
      answered(
        items.map((item) => ({
          uid: item.uid,
          result: "refused",
          reason: "secret",
          rule: "aws-access-key",
        })),
      ),
    );
    expect(await sweep(w.store.ctx, w.server(), { full: true })).toMatchObject({
      sent: 0,
      refused: 1,
    });
    const hash = ((batches[0]?.items[0]?.payload ?? {}) as { hash: string }).hash;
    expect(refusalFor(w.store.db, w.serverId, "memory", uid, hash)).toEqual({
      reason: "secret",
      rule: "aws-access-key",
    });
    expect(sentRow(w.store.db, w.serverId, "memory", uid)).toBeNull();
    // The next sweeps push nothing for that hash.
    batches.length = 0;
    w.store.clock.advance(60_000);
    expect(await sweep(w.store.ctx, w.server(), { full: true })).toMatchObject({ sent: 0 });
    expect(batches).toEqual([]);
    // Changed here: a new hash, sent to the real server.
    w.store.ctx.fetch = realFetch;
    w.store.db.run("UPDATE memories SET body = 'Changed body.', updated_at = ? WHERE id = ?", [
      w.store.clock.now,
      id,
    ]);
    w.store.clock.advance(5_000);
    expect(await sweep(w.store.ctx, w.server(), { full: false })).toMatchObject({ sent: 1 });
    expect(sentRow(w.store.db, w.serverId, "memory", uid)).not.toBeNull();
  });

  test("purged leaves a purged row and the uid is never re-sent; rate and storage schedule the next sweep", async () => {
    const w = await world("all");
    taxonomy(w);
    const id = memory(w, "Purged later");
    const uid = memoryUid(generationOf(w.store.db) as string, id);
    expect(await sweep(w.store.ctx, w.server(), { full: true })).toMatchObject({ sent: 1 });
    w.store.db.run("UPDATE memories SET body = 'Second.', updated_at = ? WHERE id = ?", [
      w.store.clock.now + 1,
      id,
    ]);
    const batches = interceptPush(w, async (items) =>
      answered(items.map((item) => ({ uid: item.uid, result: "refused", reason: "purged" }))),
    );
    w.store.clock.advance(5_000);
    expect(await sweep(w.store.ctx, w.server(), { full: false })).toMatchObject({ refused: 1 });
    expect(refusalFor(w.store.db, w.serverId, "memory", uid, "whatever")).toEqual({
      reason: "purged",
      rule: null,
    });
    expect(sentRow(w.store.db, w.serverId, "memory", uid)).toBeNull();
    batches.length = 0;
    w.store.db.run("UPDATE memories SET body = 'Third.', updated_at = ? WHERE id = ?", [
      w.store.clock.now + 1,
      id,
    ]);
    w.store.clock.advance(60_000);
    expect(await sweep(w.store.ctx, w.server(), { full: true })).toMatchObject({ sent: 0 });
    expect(batches).toEqual([]);

    // Rate: the sweep stops and the next one waits at least five seconds.
    const other = memory(w, "Rated");
    interceptPush(w, async (items) =>
      answered(items.map((item) => ({ uid: item.uid, result: "refused", reason: "rate" }))),
    );
    w.store.clock.advance(5_000);
    const rated = await sweep(w.store.ctx, w.server(), { full: false });
    expect(rated).toMatchObject({ sent: 0, stopped: "rate" });
    const retryAt = w.server().retryAt as number;
    expect(retryAt).toBeGreaterThanOrEqual(w.store.clock.now + 5_000);
    expect(await sweep(w.store.ctx, w.server(), { full: true })).toMatchObject({
      sent: 0,
      stopped: null,
    });
    // Storage: ten minutes.
    w.store.db.run("UPDATE sharing_servers SET retry_at = NULL WHERE server_id = ?", [w.serverId]);
    interceptPush(w, async (items) =>
      answered(items.map((item) => ({ uid: item.uid, result: "refused", reason: "storage" }))),
    );
    w.store.clock.advance(5_000);
    expect(await sweep(w.store.ctx, w.server(), { full: true })).toMatchObject({
      stopped: "storage",
    });
    expect(w.server().retryAt).toBe(w.store.clock.now + 10 * 60_000);
    // Past the wait, against the real server, it leaves.
    w.store.ctx.fetch = realFetch;
    w.store.clock.advance(10 * 60_000 + 1);
    expect(await sweep(w.store.ctx, w.server(), { full: true })).toMatchObject({ sent: 1 });
    expect(
      sentRow(
        w.store.db,
        w.serverId,
        "memory",
        memoryUid(generationOf(w.store.db) as string, other),
      ),
    ).not.toBeNull();
  });

  test("a batch is cut at 900 KiB of serialized body before it reaches 200 items", async () => {
    const w = await world("all");
    taxonomy(w);
    for (let i = 0; i < 12; i++) {
      const id = memory(w, `Long ${i}`);
      w.store.db.run("UPDATE memories SET body = ? WHERE id = ?", [
        `${i} ${"y".repeat(100_000)}`,
        id,
      ]);
    }
    const batches = interceptPush(w);
    expect(await sweep(w.store.ctx, w.server(), { full: true })).toMatchObject({ sent: 12 });
    // Twelve items of 100 KB: far under the item cap, over the byte cap, so the body decides.
    // The cap is the spec's 900 KiB, not whatever the constant happens to hold.
    expect(BATCH_BYTES).toBe(900 * 1024);
    expect(batches.length).toBeGreaterThanOrEqual(2);
    expect(batches.reduce((sum, batch) => sum + batch.items.length, 0)).toBe(12);
    for (const batch of batches) {
      expect(batch.items.length).toBeLessThan(BATCH_ITEMS);
      expect(batch.bytes).toBeLessThanOrEqual(BATCH_BYTES);
      expect(batch.bytes).toBeGreaterThan(BATCH_BYTES / 4);
    }
  });

  test("a 413 splits the batch and the items are applied; an item over the per-item limit is refused locally as too-large", async () => {
    const w = await world("all");
    taxonomy(w);
    for (const title of ["One", "Two", "Three"]) memory(w, title);
    let refusedOnce = false;
    const batches = interceptPush(w, async (items, forward) => {
      if (items.length > 1 && !refusedOnce) {
        refusedOnce = true;
        return new Response("", { status: 413 });
      }
      return forward();
    });
    expect(await sweep(w.store.ctx, w.server(), { full: true })).toMatchObject({
      sent: 3,
      refused: 0,
    });
    expect(batches.map((batch) => batch.items.length)).toEqual([3, 2, 1]);
    expect(liveSentRows(w.store.db, w.serverId, "memory")).toHaveLength(3);
    expect((await feed(w)).items).toHaveLength(3);
    // An entry whose file is under the store's limit but whose serialized item is over it:
    // refused here, with no push.
    const written = writeEntry(
      w.knowledge,
      { scope: "project", projectId: 1 },
      change({ title: "Quoted", slug: "quoted", body: '"'.repeat(200_000) }),
      personAuthor(w.knowledge),
    );
    if (written.kind !== "written") throw new Error("not written");
    batches.length = 0;
    w.store.clock.advance(60_000);
    expect(await sweep(w.store.ctx, w.server(), { full: true })).toMatchObject({
      sent: 0,
      refused: 1,
    });
    expect(batches).toEqual([]);
    const uid = `project:${ALIAS}:${written.entry.id}`;
    expect(
      w.store.db
        .query<{ reason: string }, [string, string]>(
          "SELECT reason FROM sharing_refusals WHERE destination = ? AND item_uid = ?",
        )
        .get(w.serverId, uid),
    ).toEqual({ reason: "too-large" });
  });

  test("a move sends the new uid on the old row's base and retires the old row with reason moved", async () => {
    const w = await world("knowledge");
    taxonomy(w);
    const written = writeEntry(
      w.knowledge,
      { scope: "project", projectId: 1 },
      change(),
      personAuthor(w.knowledge),
    );
    if (written.kind !== "written") throw new Error("not written");
    expect(await sweep(w.store.ctx, w.server(), { full: true })).toMatchObject({ sent: 1 });
    const oldUid = `project:${ALIAS}:${written.entry.id}`;
    const oldRow = sentRow(w.store.db, w.serverId, "entry", oldUid);
    // The project's remote changes: the level is bound again under the new alias.
    const alias2 = "remote:github.com/acme/site-two";
    w.store.db.run("UPDATE project_aliases SET alias = ? WHERE alias = ?", [alias2, ALIAS]);
    expect(
      setLevel(w.store.db, {
        projectId: 1,
        destination: w.serverId,
        level: "knowledge",
        source: "cli",
        now: w.store.clock.now,
        confirm: true,
      }),
    ).toMatchObject({ ok: true, boundAlias: alias2 });
    const batches = interceptPush(w);
    w.store.clock.advance(60_000);
    expect(await sweep(w.store.ctx, w.server(), { full: true })).toMatchObject({ sent: 1 });
    const newUid = `project:${alias2}:${written.entry.id}`;
    expect(batches[0]?.items[0]).toMatchObject({
      uid: newUid,
      baseRevision: oldRow?.version,
      baseHash: oldRow?.hash,
    });
    expect(sentRow(w.store.db, w.serverId, "entry", oldUid)).toMatchObject({ reason: "moved" });
    expect(sentRow(w.store.db, w.serverId, "entry", oldUid)?.withdrawnAt).not.toBeNull();
    expect(liveSentRows(w.store.db, w.serverId).map((row) => row.itemUid)).toEqual([newUid]);
    const items = (
      await pullAll(w.t.server, w.token, { since: 0, scope: "all", projects: [ALIAS, alias2] })
    ).items as { uid: string; op: string; movedTo?: string; revision: number }[];
    expect(items.find((item) => item.uid === oldUid)).toMatchObject({
      op: "tombstone",
      movedTo: newUid,
    });
    expect(items.find((item) => item.uid === newUid)).toMatchObject({ op: "upsert", revision: 2 });
  });

  test("a withdrawal sweep interrupted by rate after half of it keeps the rest authorised and finishes at the next", async () => {
    const w = await world("knowledge");
    taxonomy(w);
    for (let i = 0; i < 25; i++) {
      writeEntry(
        w.knowledge,
        { scope: "project", projectId: 1 },
        change({ title: `Entry ${i}`, slug: `entry-${i}` }),
        personAuthor(w.knowledge),
      );
    }
    expect(await sweep(w.store.ctx, w.server(), { full: true })).toMatchObject({ sent: 25 });
    const uids = liveSentRows(w.store.db, w.serverId).map((row) => row.itemUid);
    const repo = openRepo(w.knowledge, { scope: "project", projectId: 1 });
    if (repo === null) throw new Error("no repository");
    realGit(repo.path, "rm", "-q", "-r", "entries");
    realGit(repo.path, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "gone");
    w.store.clock.advance(60_000);
    expect(await sweep(w.store.ctx, w.server(), { full: true })).toMatchObject({ held: 25 });
    w.store.db.run("DELETE FROM meta WHERE key = ?", [restoreHoldKey(w.serverId)]);
    setMeta(w.store.db, resumeAuthorisedKey(w.serverId), JSON.stringify(uids));
    // The server takes the first twelve withdrawals and rate-limits the rest of the batch.
    interceptPush(w, async (items, forward) => {
      if (items[0]?.op !== "withdraw") return forward();
      const taken = items.slice(0, 12);
      const real = w.store.ctx.fetch;
      w.store.ctx.fetch = realFetch;
      const answer = await new (await import("../../src/sync/client.ts")).SyncClient(w.store.ctx, {
        url: w.t.server.origin,
        token: w.token,
      }).push(taken, 1);
      w.store.ctx.fetch = real;
      if (!answer.ok) throw new Error(answer.kind);
      return answered([
        ...answer.body.results,
        ...items
          .slice(12)
          .map((item) => ({ uid: item.uid, result: "refused" as const, reason: "rate" as const })),
      ]);
    });
    w.store.clock.advance(60_000);
    const half = await sweep(w.store.ctx, w.server(), { full: true });
    expect(half).toMatchObject({ withdrawn: 12, held: 0, stopped: "rate" });
    expect(authorisedUids(w.store.db, w.serverId)).toHaveLength(13);
    expect(liveSentRows(w.store.db, w.serverId)).toHaveLength(13);
    // The next sweep, past the wait, withdraws the rest and holds nothing.
    w.store.ctx.fetch = realFetch;
    w.store.clock.advance(60_000);
    expect(await sweep(w.store.ctx, w.server(), { full: true })).toMatchObject({
      withdrawn: 13,
      held: 0,
    });
    expect(authorisedUids(w.store.db, w.serverId)).toEqual([]);
    expect(liveSentRows(w.store.db, w.serverId)).toHaveLength(0);
    expect(readHold(w.store.db, w.serverId)).toBeNull();
  });
});

describe("the withdrawals", () => {
  test("a project set to Nothing: its 25 sent entries withdrawn at once, no hold (the person's own narrowing)", async () => {
    const w = await world("knowledge");
    taxonomy(w);
    for (let i = 0; i < 25; i++) {
      writeEntry(
        w.knowledge,
        { scope: "project", projectId: 1 },
        change({ title: `Entry ${i}`, slug: `entry-${i}` }),
        personAuthor(w.knowledge),
      );
    }
    expect(await sweep(w.store.ctx, w.server(), { full: true })).toMatchObject({ sent: 25 });
    w.store.clock.advance(1_000);
    expect(
      setLevel(w.store.db, {
        projectId: 1,
        destination: w.serverId,
        level: "local",
        source: "cli",
        now: w.store.clock.now,
        confirm: true,
      }).ok,
    ).toBe(true);
    w.store.clock.advance(60_000);
    const withdrawn = await sweep(w.store.ctx, w.server(), { full: true });
    expect(withdrawn).toMatchObject({ withdrawn: 25, held: 0 });
    expect(readHold(w.store.db, w.serverId)).toBeNull();
    expect(liveSentRows(w.store.db, w.serverId)).toHaveLength(0);
    const page = await feed(w);
    expect(page.items.every((item) => (item as { op: string }).op === "tombstone")).toBe(true);
  });

  test("25 entries deleted from a present repository are held under bulk; the authorised uids are withdrawn by the next sweeps; an interrupted sweep keeps the rest", async () => {
    const w = await world("knowledge");
    taxonomy(w);
    for (let i = 0; i < 25; i++) {
      writeEntry(
        w.knowledge,
        { scope: "project", projectId: 1 },
        change({ title: `Entry ${i}`, slug: `entry-${i}` }),
        personAuthor(w.knowledge),
      );
    }
    expect(await sweep(w.store.ctx, w.server(), { full: true })).toMatchObject({ sent: 25 });
    const uids = liveSentRows(w.store.db, w.serverId).map((row) => row.itemUid);
    const repo = openRepo(w.knowledge, { scope: "project", projectId: 1 });
    if (repo === null) throw new Error("no repository");
    realGit(repo.path, "rm", "-q", "-r", "entries");
    realGit(repo.path, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "gone");
    w.store.clock.advance(60_000);
    const held = await sweep(w.store.ctx, w.server(), { full: true });
    expect(held).toMatchObject({ withdrawn: 0, held: 25 });
    expect(readHold(w.store.db, w.serverId)).toMatchObject({ reason: "bulk" });
    expect(wouldWithdraw(w.store.ctx, w.server())).toHaveLength(25);
    // The person's resume authorises the shown set (the command is task 16; the key is the sweep's).
    w.store.db.run("DELETE FROM meta WHERE key = ?", [restoreHoldKey(w.serverId)]);
    setMeta(w.store.db, resumeAuthorisedKey(w.serverId), JSON.stringify(uids));
    w.store.clock.advance(60_000);
    const released = await sweep(w.store.ctx, w.server(), { full: true });
    expect(released).toMatchObject({ withdrawn: 25, held: 0 });
    expect(getMeta(w.store.db, resumeAuthorisedKey(w.serverId))).toBeNull();
    expect(readHold(w.store.db, w.serverId)).toBeNull();
  });

  test("an entry of an unmounted repository is never withdrawn", async () => {
    const w = await world("knowledge");
    taxonomy(w);
    writeEntry(
      w.knowledge,
      { scope: "project", projectId: 1 },
      change(),
      personAuthor(w.knowledge),
    );
    expect(await sweep(w.store.ctx, w.server(), { full: true })).toMatchObject({ sent: 1 });
    const repo = openRepo(w.knowledge, { scope: "project", projectId: 1 });
    if (repo === null) throw new Error("no repository");
    // The repository's folder goes away (a disk unmounted); its index rows stay.
    const { renameSync } = await import("node:fs");
    renameSync(repo.path, `${repo.path}.away`);
    w.store.clock.advance(60_000);
    const kept = await sweep(w.store.ctx, w.server(), { full: true });
    expect(kept).toMatchObject({ withdrawn: 0, held: 0 });
    expect(liveSentRows(w.store.db, w.serverId)).toHaveLength(1);
    renameSync(`${repo.path}.away`, repo.path);
  });
});

describe("a stale answer on an entry", () => {
  test("a server rollback (a current below the sent revision, or another instance) is re-sent on current; an unchanged text is appliedAs", async () => {
    const w = await world("knowledge");
    taxonomy(w);
    const ref = { scope: "project", projectId: 1 } as const;
    const written = writeEntry(w.knowledge, ref, change(), personAuthor(w.knowledge));
    if (written.kind !== "written") throw new Error("not written");
    expect(await sweep(w.store.ctx, w.server(), { full: true })).toMatchObject({ sent: 1 });
    const uid = `project:${ALIAS}:${written.entry.id}`;
    // The ledger believes revision 5 while the text is unchanged: the server answers appliedAs 1.
    w.store.db.run(
      "UPDATE sharing_ledger SET version = 5, local_hash = 'moved-by-hand' WHERE item_uid = ?",
      [uid],
    );
    w.store.clock.advance(60_000);
    expect(await sweep(w.store.ctx, w.server(), { full: true })).toMatchObject({ sent: 1 });
    expect((await feed(w)).items[0]).toMatchObject({ uid, revision: 1 });
    expect(sentRow(w.store.db, w.serverId, "entry", uid)?.version).toBe(1);
    // A changed text on a rolled-back server: stale with a current below the sent revision, re-sent on it.
    writeEntry(
      w.knowledge,
      ref,
      change({ slug: "discovery-call-script", baseVersion: 1, body: "Second body." }),
      personAuthor(w.knowledge),
    );
    w.store.db.run("UPDATE sharing_ledger SET version = 5 WHERE item_uid = ?", [uid]);
    w.store.clock.advance(60_000);
    const resent = await sweep(w.store.ctx, w.server(), { full: true });
    expect(resent).toMatchObject({ sent: 1, stopped: null });
    expect((await feed(w)).items[0]).toMatchObject({ uid, revision: 2 });
    expect(sentRow(w.store.db, w.serverId, "entry", uid)).toMatchObject({
      version: 2,
      instance: w.t.server.instance(),
    });
    // Another instance: the same path.
    writeEntry(
      w.knowledge,
      ref,
      change({ slug: "discovery-call-script", baseVersion: 2, body: "Third body." }),
      personAuthor(w.knowledge),
    );
    w.store.db.run(
      "UPDATE sharing_ledger SET version = 9, instance = 'old-instance' WHERE item_uid = ?",
      [uid],
    );
    w.store.clock.advance(60_000);
    expect(await sweep(w.store.ctx, w.server(), { full: true })).toMatchObject({ sent: 1 });
    expect((await feed(w)).items[0]).toMatchObject({ revision: 3 });
    expect(sentRow(w.store.db, w.serverId, "entry", uid)?.instance).toBe(w.t.server.instance());
  });
});
