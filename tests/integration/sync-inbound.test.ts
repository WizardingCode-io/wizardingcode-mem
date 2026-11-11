// The inbound side (ADR 0027): the pull against the in-process server, what each row kind does,
// the main set and the snapshot, the instance rules, and the failures that stop a server.
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Redacted } from "../../src/core/redact.ts";
import { personAuthor } from "../../src/modules/knowledge/author.ts";
import { receivedRow, receivedRows } from "../../src/modules/knowledge/index-store.ts";
import { hashOf, openRepo } from "../../src/modules/knowledge/repo.ts";
import { writeEntry } from "../../src/modules/knowledge/store.ts";
import { memoryHash } from "../../src/sharing/hash.ts";
import { setLevel } from "../../src/sharing/store.ts";
import type { OutgoingMemory } from "../../src/sharing/types.ts";
import { insertMemory } from "../../src/store/memories.ts";
import { SYNC_LEASE, setMeta } from "../../src/store/meta.ts";
import {
  PENDING_AFTER_TRIES,
  planAliases,
  pullOnce,
  resetInbound,
} from "../../src/sync/inbound.ts";
import { confirmJoin, joinServer } from "../../src/sync/join.ts";
import {
  openConflictCount,
  pendingRowCount,
  pendingRows,
  receivedMemoryRow,
  refusalFor,
  sentRow,
  unboundAliases,
} from "../../src/sync/ledger.ts";
import { sweep } from "../../src/sync/outbound.ts";
import { receivedRoot } from "../../src/sync/received.ts";
import { startSteps } from "../../src/sync/run.ts";
import { type ServerRow, serverById } from "../../src/sync/servers.ts";
import { cursorsOf, LeaseLost } from "../../src/sync/state.ts";
import { entryBytes, parseEntryUid } from "../../src/team/contract.ts";
import { insertPurged, markPurged } from "../../src/team/store.ts";
import {
  ALIAS,
  change,
  cleanWorlds,
  closeWorlds,
  commitByHand,
  feed,
  taxonomy,
  type World,
  world,
} from "../helpers/sync-world.ts";
import {
  entryPayload,
  type Joined,
  memberOf,
  memoryPayload,
  pullAll,
  push,
  rehashed,
  startTestServer,
} from "../helpers/team.ts";

afterEach(async () => {
  resetInbound();
  await closeWorlds();
});
afterAll(() => cleanWorlds());

/** Bob joins and pushes a project entry, a shared entry and a memory under the project's alias. */
async function bobShares(
  w: World,
): Promise<{ bob: Joined; uids: { project: string; shared: string; memory: string } }> {
  const bob = await memberOf(w.t, w.token, "Bob", "desk");
  const project = entryPayload({
    scope: "project",
    remoteAlias: ALIAS,
    slug: "bobs-playbook",
    title: "Bob's playbook",
    area: "sales",
    body: "Bob's project body.",
  });
  const shared = entryPayload({
    scope: "shared",
    slug: "team-glossary",
    title: "Team glossary",
    area: "sales",
    body: "The shared glossary.",
  });
  const memory = memoryPayload({
    remoteAlias: ALIAS,
    title: "Bob chose SQLite",
    body: "One file.",
    memoryKind: "weird",
    importance: 3.5,
    status: "draft",
  });
  const answer = await push(w.t.server, bob.token, [
    {
      op: "send",
      kind: "entry",
      uid: project.uid,
      baseRevision: 0,
      baseHash: "",
      payload: project,
    },
    { op: "send", kind: "entry", uid: shared.uid, baseRevision: 0, baseHash: "", payload: shared },
    { op: "send", kind: "memory", uid: memory.uid, baseRevision: 0, baseHash: "", payload: memory },
  ]);
  expect(answer.body.results.map((r: { result: string }) => r.result)).toEqual([
    "applied",
    "applied",
    "applied",
  ]);
  return {
    bob,
    uids: {
      project: project.uid,
      shared: shared.uid,
      memory: `remote:${bob.deviceAlias}:${memory.uid}`,
    },
  };
}

/** The URLs the client asked for, through a fetch spy on the store's context. */
function spyFetch(w: World): string[] {
  const urls: string[] = [];
  const real = w.store.ctx.fetch;
  w.store.ctx.fetch = (input, init) => {
    urls.push(String(input instanceof Request ? input.url : input));
    return real(input, init);
  };
  return urls;
}

describe("the pull", () => {
  test("names scope=all with the bound alias; applies a project entry, a shared entry and a memory with the mapping; saves the cursor; a second pull applies nothing", async () => {
    const w = await world("all");
    taxonomy(w);
    const urls = spyFetch(w);
    const { uids } = await bobShares(w);
    const first = await pullOnce(w.store.ctx, w.server(), { wait: false });
    expect(first).toMatchObject({ ok: true, applied: 3, skipped: 0, stoppedAt: null });
    const pulls = urls.filter((url) => url.includes("/v1/pull"));
    expect(pulls.at(-1)).toContain("scope=all");
    expect(decodeURIComponent(pulls.at(-1) ?? "")).toContain(`projects=${ALIAS}`);
    expect(cursorsOf(w.store.db, w.serverId)).toMatchObject({
      main: 3,
      mainAliases: [ALIAS],
      extra: {},
    });
    const project = receivedRow(w.store.db, w.serverId, uids.project);
    // The feed carries no slug: the client names the file by the title, as the entry module slugs it.
    expect(project).toMatchObject({
      scope: "project",
      remoteAlias: ALIAS,
      projectId: 1,
      memberName: "Bob",
      slug: "bob-s-playbook",
      title: "Bob's playbook",
    });
    expect(
      existsSync(join(receivedRoot(w.store.dataDir), ...(project?.path ?? "").split("/"))),
    ).toBe(true);
    expect(receivedRow(w.store.db, w.serverId, uids.shared)).toMatchObject({
      scope: "shared",
      slug: "team-glossary",
    });
    const known = receivedMemoryRow(w.store.db, w.serverId, uids.memory);
    expect(known?.memoryId).not.toBeNull();
    const memory = w.store.db
      .query<
        {
          kind: string;
          importance: number;
          status: string;
          origin: string;
          judge: string;
          title: string;
        },
        [number]
      >("SELECT kind, importance, status, origin, judge, title FROM memories WHERE id = ?")
      .get(known?.memoryId as number);
    expect(memory).toEqual({
      kind: "discovery",
      importance: 4,
      status: "active",
      origin: "imported",
      judge: `team:${w.serverId}`,
      title: "Bob chose SQLite",
    });
    const provenance = w.store.db
      .query<
        {
          remote_kind: string;
          remote_importance: number;
          remote_status: string;
          member_name: string;
        },
        [number]
      >(
        "SELECT remote_kind, remote_importance, remote_status, member_name FROM sharing_received_memories WHERE memory_id = ?",
      )
      .get(known?.memoryId as number);
    expect(provenance).toEqual({
      remote_kind: "weird",
      remote_importance: 3.5,
      remote_status: "draft",
      member_name: "Bob",
    });
    expect(
      w.store.db
        .query<{ n: number }, [string]>(
          "SELECT count(*) AS n FROM sharing_ledger WHERE item_uid = ? AND direction = 'received'",
        )
        .get(uids.memory)?.n,
    ).toBe(1);
    const second = await pullOnce(w.store.ctx, w.server(), { wait: false });
    expect(second).toMatchObject({ ok: true, applied: 0 });
    expect(cursorsOf(w.store.db, w.serverId).main).toBe(3);
    expect(w.server().lastPullOkAt).not.toBeNull();
  });

  test("a dedupe: a memory equal to an existing one of the project is not inserted, its ledger row written; a later revision that differs is inserted", async () => {
    const w = await world("all");
    taxonomy(w);
    insertMemory(w.store.db, {
      projectId: 1,
      kind: "decision",
      title: "Bob chose SQLite",
      body: "One file." as Redacted,
      terms: "",
      importance: 3,
      branch: null,
      commit: null,
      origin: "distilled",
      judge: "heuristic",
      judgeVersion: "1",
      sourceTurnId: null,
      files: [],
      now: w.store.clock.now,
    });
    const bob = await memberOf(w.t, w.token, "Bob", "desk");
    const memory = memoryPayload({
      remoteAlias: ALIAS,
      title: "Bob chose SQLite",
      body: "One file.",
    });
    await push(w.t.server, bob.token, [
      {
        op: "send",
        kind: "memory",
        uid: memory.uid,
        baseRevision: 0,
        baseHash: "",
        payload: memory,
      },
    ]);
    expect(await pullOnce(w.store.ctx, w.server(), { wait: false })).toMatchObject({
      ok: true,
      applied: 1,
    });
    const feedUid = `remote:${bob.deviceAlias}:${memory.uid}`;
    expect(receivedMemoryRow(w.store.db, w.serverId, feedUid)).toMatchObject({
      memoryId: null,
      hash: memory.hash,
    });
    expect(w.store.db.query<{ n: number }, []>("SELECT count(*) AS n FROM memories").get()?.n).toBe(
      1,
    );
    // Bob revises it to a text no memory here has: inserted.
    const revised = {
      ...memory,
      body: "Two files now.",
      updatedAt: memory.updatedAt + 1,
      version: 2,
      hash: "",
    };
    revised.hash = memoryHash(revised);
    const answer = await push(w.t.server, bob.token, [
      {
        op: "send",
        kind: "memory",
        uid: memory.uid,
        baseRevision: 1,
        baseHash: memory.hash,
        payload: revised,
      },
    ]);
    expect(answer.body.results[0].result).toBe("applied");
    expect(await pullOnce(w.store.ctx, w.server(), { wait: false })).toMatchObject({
      ok: true,
      applied: 1,
    });
    expect(receivedMemoryRow(w.store.db, w.serverId, feedUid)?.memoryId).not.toBeNull();
    expect(w.store.db.query<{ n: number }, []>("SELECT count(*) AS n FROM memories").get()?.n).toBe(
      2,
    );
  });

  test("a tombstone deletes a received copy and a received memory; an own entry's tombstone marks the sent row withdrawn by the admin", async () => {
    const w = await world("all");
    taxonomy(w);
    const { bob, uids } = await bobShares(w);
    expect(await pullOnce(w.store.ctx, w.server(), { wait: false })).toMatchObject({ applied: 3 });
    const memoryId = receivedMemoryRow(w.store.db, w.serverId, uids.memory)?.memoryId as number;
    // Bob withdraws his entry and his memory.
    const withdraw = await push(w.t.server, bob.token, [
      {
        op: "withdraw",
        kind: "entry",
        uid: uids.project,
        baseRevision: 1,
        baseHash: receivedRow(w.store.db, w.serverId, uids.project)?.hash ?? "",
      },
      { op: "withdraw", kind: "memory", uid: uids.memory, baseRevision: 1, baseHash: "" },
    ]);
    expect(withdraw.body.results.map((r: { result: string }) => r.result)).toEqual([
      "withdrawn",
      "withdrawn",
    ]);
    expect(await pullOnce(w.store.ctx, w.server(), { wait: false })).toMatchObject({ applied: 2 });
    expect(receivedRow(w.store.db, w.serverId, uids.project)).toBeNull();
    expect(
      w.store.db
        .query<{ n: number }, [number]>("SELECT count(*) AS n FROM memories WHERE id = ?")
        .get(memoryId)?.n,
    ).toBe(0);
    expect(receivedMemoryRow(w.store.db, w.serverId, uids.memory)).toBeNull();
    // An own entry withdrawn by an admin on the server: the sent row says so, the file stays.
    const written = writeEntry(
      w.knowledge,
      { scope: "project", projectId: 1 },
      change(),
      personAuthor(w.knowledge),
    );
    if (written.kind !== "written") throw new Error("not written");
    expect(await sweep(w.store.ctx, w.server(), { full: true })).toMatchObject({ sent: 1 });
    const own = `project:${ALIAS}:${written.entry.id}`;
    const row = sentRow(w.store.db, w.serverId, "entry", own);
    const admin = await push(w.t.server, w.token, [
      {
        op: "withdraw",
        kind: "entry",
        uid: own,
        baseRevision: row?.version as number,
        baseHash: row?.hash as string,
      },
    ]);
    expect(admin.body.results[0].result).toBe("withdrawn");
    expect(await pullOnce(w.store.ctx, w.server(), { wait: false })).toMatchObject({ ok: true });
    expect(sentRow(w.store.db, w.serverId, "entry", own)).toMatchObject({
      reason: "withdrawn-by-admin",
    });
    expect(sentRow(w.store.db, w.serverId, "entry", own)?.withdrawnAt).not.toBeNull();
  });

  test("the snapshot: a cursor the server no longer has (410) sets the flag; the snapshot re-pulls from zero and clears it; an instance change sets it and drops the pending rows", async () => {
    const w = await world("all");
    taxonomy(w);
    const { uids } = await bobShares(w);
    expect(await pullOnce(w.store.ctx, w.server(), { wait: false })).toMatchObject({ applied: 3 });
    w.store.db.run("UPDATE sharing_servers SET cursors = ? WHERE server_id = ?", [
      JSON.stringify({ main: 999, mainAliases: [ALIAS], extra: {} }),
      w.serverId,
    ]);
    expect(await pullOnce(w.store.ctx, w.server(), { wait: false })).toMatchObject({ ok: false });
    expect(w.server().snapshotDue).toBe(true);
    w.store.db.run(
      "INSERT INTO sharing_pending_rows (server_id, seq, uid, kind, payload, reason, tries, at) VALUES (?, 7, 'x', 'entry', '{}', 'dirty', 10, 1)",
      [w.serverId],
    );
    expect(pendingRowCount(w.store.db, w.serverId)).toBe(1);
    // Another instance answers: the flag set again and the pending rows gone.
    w.store.db.run(
      "UPDATE sharing_servers SET instance = 'old-instance', snapshot_due = 0 WHERE server_id = ?",
      [w.serverId],
    );
    w.store.db.run("UPDATE sharing_servers SET cursors = ? WHERE server_id = ?", [
      JSON.stringify({ main: 0, mainAliases: [ALIAS], extra: {} }),
      w.serverId,
    ]);
    expect(await pullOnce(w.store.ctx, w.server(), { wait: false })).toMatchObject({ ok: true });
    expect(w.server().instance).toBe(w.t.server.instance());
    expect(pendingRowCount(w.store.db, w.serverId)).toBe(0);
    expect(w.server().snapshotDue).toBe(true);
    // The snapshot runs from zero over the main cursor and clears the flag.
    expect(await pullOnce(w.store.ctx, w.server(), { wait: false })).toMatchObject({ ok: true });
    expect(w.server().snapshotDue).toBe(false);
    expect(cursorsOf(w.store.db, w.serverId).main).toBe(3);
    expect(receivedRows(w.store.db, w.serverId)).toHaveLength(2);
    expect(receivedRow(w.store.db, w.serverId, uids.project)).not.toBeNull();
  });

  test("planAliases: the main set is sticky up to 100, an alias that stops being named leaves, a free slot takes the first extra by bytes, a new alias joins and is snapshotted", () => {
    const many = Array.from(
      { length: 105 },
      (_, i) => `remote:github.com/acme/r${String(i).padStart(3, "0")}`,
    );
    const fresh = planAliases({ mainAliases: [], extra: {} }, many);
    expect(fresh.main).toHaveLength(100);
    expect(fresh.extra).toEqual(many.slice(100));
    expect(fresh.joined).toEqual(many.slice(0, 100));
    // One unbound: it leaves, the first extra by bytes is promoted and snapshotted.
    const without = many.filter((a) => a !== many[3]);
    const next = planAliases(
      { mainAliases: fresh.main, extra: Object.fromEntries(fresh.extra.map((a) => [a, 5])) },
      without,
    );
    expect(next.main).not.toContain(many[3]);
    expect(next.main).toContain(many[100] as string);
    expect(next.joined).toEqual([many[100] as string]);
    expect(next.extra).toEqual(many.slice(101));
    // A re-bound alias comes back through the new-alias path, as an extra while the set is full.
    const back = planAliases({ mainAliases: next.main, extra: {} }, many);
    expect(back.main).toHaveLength(100);
    expect(back.extra).toEqual(
      [many[3] as string, ...many.slice(101)].sort((a, b) =>
        Buffer.compare(Buffer.from(a), Buffer.from(b)),
      ),
    );
    expect(back.joined).toEqual([]);
  });

  test("a lost lease: the pull writes no cursor and throws LeaseLost", async () => {
    const w = await world("all");
    taxonomy(w);
    await bobShares(w);
    w.store.ctx.lease = `sync-${process.pid}-0.8.0`;
    setMeta(
      w.store.db,
      SYNC_LEASE,
      JSON.stringify({ owner: "sync-1-9.9.9", until: w.store.clock.now + 60_000 }),
    );
    await expect(pullOnce(w.store.ctx, w.server(), { wait: false })).rejects.toBeInstanceOf(
      LeaseLost,
    );
    expect(cursorsOf(w.store.db, w.serverId).main).toBe(0);
    expect(receivedRows(w.store.db, w.serverId)).toEqual([]);
    w.store.ctx.lease = undefined;
  });

  test("401 with the known instance stops the server as unauthorized, with another as rejoin; 403 as disabled", async () => {
    const w = await world("all");
    taxonomy(w);
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
    const stub = (answer: () => Response) => {
      w.store.ctx.fetch = async () => answer();
    };
    stub(() =>
      json(401, { error: "device revoked", serverId: w.serverId, instance: w.t.server.instance() }),
    );
    expect(await pullOnce(w.store.ctx, w.server(), { wait: false })).toMatchObject({ ok: false });
    expect(w.server().stopped).toBe("unauthorized");
    w.store.db.run("UPDATE sharing_servers SET stopped = NULL WHERE server_id = ?", [w.serverId]);
    stub(() =>
      json(401, { error: "missing or wrong token", serverId: w.serverId, instance: "another" }),
    );
    await pullOnce(w.store.ctx, w.server(), { wait: false });
    expect(w.server().stopped).toBe("rejoin");
    w.store.db.run("UPDATE sharing_servers SET stopped = NULL WHERE server_id = ?", [w.serverId]);
    stub(() =>
      json(403, {
        error: "member disabled",
        serverId: w.serverId,
        instance: w.t.server.instance(),
      }),
    );
    await pullOnce(w.store.ctx, w.server(), { wait: false });
    expect(w.server().stopped).toBe("disabled");
    w.store.db.run("UPDATE sharing_servers SET stopped = NULL WHERE server_id = ?", [w.serverId]);
    stub(() => json(409, { error: "contract", accepted: [2] }));
    await pullOnce(w.store.ctx, w.server(), { wait: false });
    expect(w.server().stopped).toBe("contract");
  });

  test("a project unbound: its copies and memories gone before the next pull's first page, back after a re-bind's snapshot", async () => {
    const w = await world("all");
    taxonomy(w);
    const { uids } = await bobShares(w);
    expect(await pullOnce(w.store.ctx, w.server(), { wait: false })).toMatchObject({ applied: 3 });
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
    expect(await pullOnce(w.store.ctx, w.server(), { wait: false })).toMatchObject({ ok: true });
    expect(receivedRow(w.store.db, w.serverId, uids.project)).toBeNull();
    expect(receivedRow(w.store.db, w.serverId, uids.shared)).not.toBeNull();
    expect(receivedMemoryRow(w.store.db, w.serverId, uids.memory)).toBeNull();
    expect(cursorsOf(w.store.db, w.serverId).mainAliases).toEqual([]);
    // Re-bound: the alias joins the main set and its one-alias snapshot brings the copies back.
    expect(
      setLevel(w.store.db, {
        projectId: 1,
        destination: w.serverId,
        level: "receive",
        source: "cli",
        now: w.store.clock.now,
        confirm: true,
      }).ok,
    ).toBe(true);
    expect(await pullOnce(w.store.ctx, w.server(), { wait: false })).toMatchObject({ ok: true });
    expect(cursorsOf(w.store.db, w.serverId).mainAliases).toEqual([ALIAS]);
    expect(receivedRow(w.store.db, w.serverId, uids.project)).not.toBeNull();
    // The one-alias snapshot brings the memory back too.
    expect(receivedMemoryRow(w.store.db, w.serverId, uids.memory)?.memoryId).not.toBeNull();
  });
});

interface FeedEntry {
  uid: string;
  revision: number;
  hash: string;
  payload: { frontmatter: string; body: string };
}

/** The server's whole feed for the project, every page, as this device reads it. */
async function wholeFeed(w: World): Promise<unknown[]> {
  const items: unknown[] = [];
  let since = 0;
  for (;;) {
    const page = await pullAll(w.t.server, w.token, { since, scope: "all", projects: [ALIAS] });
    items.push(...page.items);
    if (!page.more) return items;
    since = page.next;
  }
}

/** Bob's revision of an entry on the server: the body replaced, pushed on the current base. */
async function bobRevises(w: World, bobToken: string, uid: string, body: string): Promise<void> {
  const current = (await wholeFeed(w)).find((item) => (item as FeedEntry).uid === uid) as FeedEntry;
  const lines = current.payload.frontmatter
    .split("\n")
    .map((line) => (line.startsWith("version: ") ? `version: ${Number(line.slice(9)) + 1}` : line));
  const parsed = parseEntryUid(uid);
  const payload = {
    kind: "entry",
    uid,
    scope: parsed?.scope ?? "project",
    slug: "revised",
    remoteAlias: parsed?.remoteAlias ?? null,
    frontmatter: lines.join("\n"),
    body: `${body}\n`,
    version: current.revision + 1,
    hash: "",
  };
  payload.hash = hashOf(entryBytes(payload as Parameters<typeof entryBytes>[0]));
  const answer = await push(w.t.server, bobToken, [
    {
      op: "send",
      kind: "entry",
      uid,
      baseRevision: current.revision,
      baseHash: current.hash,
      payload,
    },
  ]);
  expect(answer.body.results[0].result).toBe("applied");
}

/** Bob pushes one shared entry with a body of `bytes` characters; its uid. */
async function bobSharesBig(w: World, bob: Joined, i: number, bytes: number): Promise<string> {
  const entry = entryPayload({
    scope: "shared",
    slug: `big-${i}`,
    title: `Big ${i}`,
    area: "sales",
    body: `Entry ${i}. ${"x".repeat(bytes)}`,
  });
  const answer = await push(w.t.server, bob.token, [
    { op: "send", kind: "entry", uid: entry.uid, baseRevision: 0, baseHash: "", payload: entry },
  ]);
  expect(answer.body.results[0].result).toBe("applied");
  return entry.uid;
}

/** `n` more enabled projects, each with its own host-led alias, bound to the server at receive. */
function bindMany(w: World, n: number): string[] {
  const aliases: string[] = [];
  for (let i = 0; i < n; i++) {
    const id = 100 + i;
    const alias = `remote:github.com/acme/r${String(i).padStart(3, "0")}`;
    w.store.db.run("INSERT INTO projects (id, key, name, created_at) VALUES (?, ?, ?, 1)", [
      id,
      alias,
      `r${i}`,
    ]);
    w.store.db.run("INSERT INTO project_aliases (alias, project_id) VALUES (?, ?)", [alias, id]);
    const bound = setLevel(w.store.db, {
      projectId: id,
      destination: w.serverId,
      level: "receive",
      source: "cli",
      now: w.store.clock.now,
      confirm: true,
    });
    if (!bound.ok) throw new Error(`setLevel: ${bound.reason}`);
    aliases.push(alias);
  }
  return aliases;
}

const memoryCount = (w: World, id: number) =>
  w.store.db
    .query<{ n: number }, [number]>("SELECT count(*) AS n FROM memories WHERE id = ?")
    .get(id)?.n;
const vectorCount = (w: World, id: number) =>
  w.store.db
    .query<{ n: number }, [number]>("SELECT count(*) AS n FROM memory_vectors WHERE memory_id = ?")
    .get(id)?.n;

describe("the snapshot's comparison (AC-78)", () => {
  test("a snapshot of more than one page keeps the received rows of its earlier pages; a received memory absent from it is deleted; a sent row absent is cleared and re-sent; a tombstone marks withdrawn by the admin", async () => {
    const w = await world("all");
    taxonomy(w);
    const bob = await memberOf(w.t, w.token, "Bob", "desk");
    // Eleven entries of about 200 KB: the server's page holds 2 MiB, so the snapshot takes two.
    const uids: string[] = [];
    for (let i = 0; i < 11; i++) uids.push(await bobSharesBig(w, bob, i, 200_000));
    const theirs = memoryPayload({ remoteAlias: ALIAS, title: "Bob's memory", body: "Theirs." });
    await push(w.t.server, bob.token, [
      {
        op: "send",
        kind: "memory",
        uid: theirs.uid,
        baseRevision: 0,
        baseHash: "",
        payload: theirs,
      },
    ]);
    const memoryUid = `remote:${bob.deviceAlias}:${theirs.uid}`;
    const urls = spyFetch(w);
    expect(w.server().snapshotDue).toBe(true);
    const first = await pullOnce(w.store.ctx, w.server(), { wait: false });
    expect(first).toMatchObject({ ok: true, applied: 12, skipped: 0 });
    expect(urls.filter((url) => url.includes("/v1/pull"))).toHaveLength(2);
    expect(w.server().snapshotDue).toBe(false);
    // Every page's rows are here after the comparison, not only the last page's.
    expect(
      receivedRows(w.store.db, w.serverId)
        .map((row) => row.uid)
        .sort(),
    ).toEqual([...uids].sort());
    const memoryId = receivedMemoryRow(w.store.db, w.serverId, memoryUid)?.memoryId as number;
    expect(memoryId).not.toBeNull();

    // An own entry sent, then the server restored from an older copy without it, and without
    // Bob's memory: the next snapshot clears the sent row (re-sent on base 0) and deletes the
    // received memory; a revised entry is applied; an admin's tombstone marks the sent row.
    const written = writeEntry(
      w.knowledge,
      { scope: "project", projectId: 1 },
      change(),
      personAuthor(w.knowledge),
    );
    if (written.kind !== "written") throw new Error("not written");
    expect(await sweep(w.store.ctx, w.server(), { full: true })).toMatchObject({ sent: 1 });
    const own = `project:${ALIAS}:${written.entry.id}`;
    // Four own entries: `own` is deleted from the server, `ownTwo` withdrawn by the admin,
    // `ownThree` revised by Bob, `ownFour` left as sent.
    const ownUids: string[] = [];
    for (const [title, slug] of [
      ["Second own", "second-own"],
      ["Third own", "third-own"],
      ["Fourth own", "fourth-own"],
    ]) {
      const more = writeEntry(
        w.knowledge,
        { scope: "project", projectId: 1 },
        change({ title, slug }),
        personAuthor(w.knowledge),
      );
      if (more.kind !== "written") throw new Error("not written");
      ownUids.push(`project:${ALIAS}:${more.entry.id}`);
    }
    expect(await sweep(w.store.ctx, w.server(), { full: true })).toMatchObject({ sent: 3 });
    const [ownTwo, ownThree, ownFour] = ownUids as [string, string, string];
    const fourBefore = sentRow(w.store.db, w.serverId, "entry", ownFour);
    await bobRevises(w, bob.token, ownThree, "Bob revised the third.");
    const row = sentRow(w.store.db, w.serverId, "entry", ownTwo);
    const admin = await push(w.t.server, w.token, [
      {
        op: "withdraw",
        kind: "entry",
        uid: ownTwo,
        baseRevision: row?.version as number,
        baseHash: row?.hash as string,
      },
    ]);
    expect(admin.body.results[0].result).toBe("withdrawn");
    await bobRevises(w, bob.token, uids[0] as string, "Revised by Bob.");
    const revisedHash = (await wholeFeed(w)).find(
      (item) => (item as FeedEntry).uid === uids[0],
    ) as FeedEntry;
    // The server's surgery: the own entry and the memory gone from its tables, as a restore
    // from an older copy leaves them.
    w.t.server.db.run("PRAGMA foreign_keys = OFF");
    w.t.server.db.run("DELETE FROM changes WHERE uid = ?", [own]);
    w.t.server.db.run("DELETE FROM entry_revisions WHERE uuid = ?", [written.entry.id]);
    w.t.server.db.run("DELETE FROM entries WHERE uuid = ?", [written.entry.id]);
    w.t.server.db.run("DELETE FROM changes WHERE kind = 'memory'");
    w.t.server.db.run("DELETE FROM memories");
    w.t.server.db.run("PRAGMA foreign_keys = ON");
    w.store.db.run("UPDATE sharing_servers SET snapshot_due = 1 WHERE server_id = ?", [w.serverId]);
    expect(await pullOnce(w.store.ctx, w.server(), { wait: false })).toMatchObject({ ok: true });
    expect(w.server().snapshotDue).toBe(false);
    expect(sentRow(w.store.db, w.serverId, "entry", own)).toBeNull();
    expect(receivedMemoryRow(w.store.db, w.serverId, memoryUid)).toBeNull();
    expect(memoryCount(w, memoryId)).toBe(0);
    expect(receivedRow(w.store.db, w.serverId, uids[0] as string)?.hash).toBe(revisedHash.hash);
    expect(receivedRows(w.store.db, w.serverId)).toHaveLength(11);
    expect(sentRow(w.store.db, w.serverId, "entry", ownTwo)).toMatchObject({
      reason: "withdrawn-by-admin",
    });
    // Present with another hash: Bob's revision applied to the own file; present with the
    // sent hash: left as it was.
    expect(sentRow(w.store.db, w.serverId, "entry", ownThree)).toMatchObject({ version: 2 });
    const repo = openRepo(w.knowledge, { scope: "project", projectId: 1 });
    expect(readFileSync(join(repo?.path as string, "entries", "third-own.md"), "utf8")).toContain(
      "Bob revised the third.",
    );
    expect(sentRow(w.store.db, w.serverId, "entry", ownFour)).toEqual(fourBefore);
    // The cleared own entry leaves again at the next sweep. So does the withdrawn one: its
    // file stays and the policy still allows it (the owner withdrew it here, as the admin);
    // an item an admin locked on the server is refused there and recorded as such. The
    // revised and the untouched ones send nothing.
    w.store.clock.advance(60_000);
    expect(await sweep(w.store.ctx, w.server(), { full: true })).toMatchObject({ sent: 2 });
    expect(sentRow(w.store.db, w.serverId, "entry", own)).not.toBeNull();
  }, 60_000);

  test("an importance of 0.2 or 9 is clamped to 1 and 5 (3.5 rounds to 4)", async () => {
    const w = await world("all");
    taxonomy(w);
    const bob = await memberOf(w.t, w.token, "Bob", "desk");
    const low = memoryPayload({ rowId: 1, remoteAlias: ALIAS, title: "Low", importance: 0.2 });
    const high = memoryPayload({ rowId: 2, remoteAlias: ALIAS, title: "High", importance: 9 });
    await push(w.t.server, bob.token, [
      { op: "send", kind: "memory", uid: low.uid, baseRevision: 0, baseHash: "", payload: low },
      { op: "send", kind: "memory", uid: high.uid, baseRevision: 0, baseHash: "", payload: high },
    ]);
    expect(await pullOnce(w.store.ctx, w.server(), { wait: false })).toMatchObject({ applied: 2 });
    const importanceOf = (uid: string) =>
      w.store.db
        .query<{ importance: number }, [number]>("SELECT importance FROM memories WHERE id = ?")
        .get(
          receivedMemoryRow(w.store.db, w.serverId, `remote:${bob.deviceAlias}:${uid}`)
            ?.memoryId as number,
        )?.importance;
    expect(importanceOf(low.uid)).toBe(1);
    expect(importanceOf(high.uid)).toBe(5);
  });

  test("the hourly re-apply drops each pending row by its own seq: a later row of the uid that still fails stays set aside", async () => {
    const w = await world("all");
    taxonomy(w);
    const bob = await memberOf(w.t, w.token, "Bob", "desk");
    const entry = entryPayload({
      scope: "shared",
      slug: "pending-twice",
      title: "Pending twice",
      area: "sales",
      body: "First body.",
    });
    const item = (seq: number, revision: number, body: string, hash: string) =>
      JSON.stringify({
        seq,
        kind: "entry",
        uid: entry.uid,
        op: "upsert",
        scope: "shared",
        remoteAlias: null,
        revision,
        hash,
        payload: { frontmatter: entry.frontmatter, body },
        member: { id: bob.memberId, name: "Bob" },
        at: w.store.clock.now,
      });
    // The entry on the server and pulled once (the snapshot), then two rows of its uid set
    // aside: the first as the server holds it (it applies, as a skip by hash), the second a
    // later revision whose hash does not match its text, which the received store refuses on
    // every apply.
    await push(w.t.server, bob.token, [
      { op: "send", kind: "entry", uid: entry.uid, baseRevision: 0, baseHash: "", payload: entry },
    ]);
    expect(await pullOnce(w.store.ctx, w.server(), { wait: false })).toMatchObject({ applied: 1 });
    w.store.db.run(
      "INSERT INTO sharing_pending_rows (server_id, seq, uid, kind, payload, reason, tries, at) VALUES (?, 1, ?, 'entry', ?, 'apply: test', 1, 1)",
      [w.serverId, entry.uid, item(1, 1, entry.body, entry.hash)],
    );
    w.store.db.run(
      "INSERT INTO sharing_pending_rows (server_id, seq, uid, kind, payload, reason, tries, at) VALUES (?, 2, ?, 'entry', ?, 'apply: test', 1, 1)",
      [w.serverId, entry.uid, item(2, 2, "Second body, another hash.", "0".repeat(16))],
    );
    w.store.clock.advance(3_600_000);
    expect(await pullOnce(w.store.ctx, w.server(), { wait: false })).toMatchObject({ ok: true });
    // The second row's failure is logged once (the hash the store refuses), nothing else.
    expect(w.store.lines).toEqual([expect.stringMatching(/pending.*hash/)]);
    expect(receivedRow(w.store.db, w.serverId, entry.uid)?.revision).toBe(1);
    expect(pendingRows(w.store.db, w.serverId).map((row) => row.seq)).toEqual([2]);
  });

  test("the hourly re-apply: an older pending row that still fails is dropped once a newer row of its uid applies, so it never writes over the later revision", async () => {
    const w = await world("all");
    taxonomy(w);
    const bob = await memberOf(w.t, w.token, "Bob", "desk");
    const entry = entryPayload({
      scope: "shared",
      slug: "pending-reversed",
      title: "Pending reversed",
      area: "sales",
      body: "First body.",
    });
    const item = (seq: number, revision: number, body: string, hash: string) =>
      JSON.stringify({
        seq,
        kind: "entry",
        uid: entry.uid,
        op: "upsert",
        scope: "shared",
        remoteAlias: null,
        revision,
        hash,
        payload: { frontmatter: entry.frontmatter, body },
        member: { id: bob.memberId, name: "Bob" },
        at: w.store.clock.now,
      });
    await push(w.t.server, bob.token, [
      { op: "send", kind: "entry", uid: entry.uid, baseRevision: 0, baseHash: "", payload: entry },
    ]);
    expect(await pullOnce(w.store.ctx, w.server(), { wait: false })).toMatchObject({ applied: 1 });
    // The older row (seq 1) is a stale revision whose hash the store refuses on every apply;
    // the newer (seq 2) is the entry as the server holds it, and applies.
    w.store.db.run(
      "INSERT INTO sharing_pending_rows (server_id, seq, uid, kind, payload, reason, tries, at) VALUES (?, 1, ?, 'entry', ?, 'apply: test', 1, 1)",
      [w.serverId, entry.uid, item(1, 1, "Stale body, another hash.", "0".repeat(16))],
    );
    w.store.db.run(
      "INSERT INTO sharing_pending_rows (server_id, seq, uid, kind, payload, reason, tries, at) VALUES (?, 2, ?, 'entry', ?, 'apply: test', 1, 1)",
      [w.serverId, entry.uid, item(2, 1, entry.body, entry.hash)],
    );
    w.store.clock.advance(3_600_000);
    expect(await pullOnce(w.store.ctx, w.server(), { wait: false })).toMatchObject({ ok: true });
    expect(w.store.lines).toEqual([expect.stringMatching(/pending.*hash/)]);
    expect(receivedRow(w.store.db, w.serverId, entry.uid)?.revision).toBe(1);
    // Both rows gone: the newer applied, and the older can no longer come back at a later hour.
    expect(pendingRows(w.store.db, w.serverId)).toEqual([]);
  });

  test("a cut snapshot restarts from the first uncompleted cursor with the flag still set; an empty held page back at once backs off", async () => {
    const w = await world("all");
    taxonomy(w);
    // 101 bound aliases: the main set holds 100 by bytes, and the project's own alias is the extra.
    bindMany(w, 100);
    const { uids } = await bobShares(w);
    const urls = spyFetch(w);
    const real = w.store.ctx.fetch;
    let failExtraOnce = true;
    w.store.ctx.fetch = (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (failExtraOnce && url.includes("scope=project")) {
        failExtraOnce = false;
        return Promise.reject(new TypeError("fetch failed: cut"));
      }
      return real(input, init);
    };
    expect(await pullOnce(w.store.ctx, w.server(), { wait: false })).toMatchObject({ ok: false });
    expect(w.server().snapshotDue).toBe(true);
    const pulls = () => urls.filter((url) => url.includes("/v1/pull"));
    expect(pulls().filter((url) => url.includes("scope=all"))).toHaveLength(1);
    urls.length = 0;
    expect(await pullOnce(w.store.ctx, w.server(), { wait: false })).toMatchObject({ ok: true });
    // The main cursor's snapshot completed: the restart names the extra alias alone.
    expect(pulls().filter((url) => url.includes("scope=all"))).toHaveLength(0);
    expect(pulls().filter((url) => url.includes("scope=project"))).toHaveLength(1);
    expect(w.server().snapshotDue).toBe(false);
    expect(receivedRow(w.store.db, w.serverId, uids.project)).not.toBeNull();
    expect(cursorsOf(w.store.db, w.serverId).extra[ALIAS]).toBe(3);

    // A held pull answered at once with nothing: the server holds its cap, or closed the hold.
    const page = {
      serverId: w.serverId,
      instance: w.t.server.instance(),
      next: cursorsOf(w.store.db, w.serverId).main,
      more: false,
      snapshot: false,
      items: [],
    };
    w.store.ctx.fetch = async () =>
      new Response(JSON.stringify(page), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    const before = w.server();
    expect(before.lastPullAt).not.toBeNull();
    await pullOnce(w.store.ctx, before, { wait: true });
    const after = w.server();
    expect(after.failures).toBe(before.failures + 1);
    expect(after.retryAt).not.toBeNull();
    expect(after.lastError).toContain("held pull answered at once");
  }, 60_000);
});

describe("the rows that cannot be applied (AC-75)", () => {
  test("a row that fails for another reason than locked is set aside at once with the cursor going on, re-applied an hour later, and dropped by a later row of its uid", async () => {
    const w = await world("all");
    taxonomy(w);
    const { bob, uids } = await bobShares(w);
    // The server's folder is a file: no copy can be written under it.
    const root = receivedRoot(w.store.dataDir);
    mkdirSync(root, { recursive: true, mode: 0o700 });
    writeFileSync(join(root, w.serverId), "");
    const first = await pullOnce(w.store.ctx, w.server(), { wait: false });
    expect(first).toMatchObject({ ok: true, applied: 1, skipped: 2, stoppedAt: null });
    expect(cursorsOf(w.store.db, w.serverId).main).toBe(3);
    expect(pendingRowCount(w.store.db, w.serverId)).toBe(2);
    expect(pendingRows(w.store.db, w.serverId).map((row) => row.reason)).toEqual([
      expect.stringMatching(/^apply: /),
      expect.stringMatching(/^apply: /),
    ]);
    expect(receivedRows(w.store.db, w.serverId)).toEqual([]);
    rmSync(join(root, w.serverId));
    // A later row of the shared entry's uid applies and drops its pending row; the other waits.
    await bobRevises(w, bob.token, uids.shared, "Revised glossary.");
    expect(await pullOnce(w.store.ctx, w.server(), { wait: false })).toMatchObject({ applied: 1 });
    expect(receivedRow(w.store.db, w.serverId, uids.shared)).not.toBeNull();
    expect(pendingRows(w.store.db, w.serverId).map((row) => row.uid)).toEqual([uids.project]);
    // An hour later the pending row is re-applied from its payload.
    w.store.clock.advance(3_600_000);
    expect(await pullOnce(w.store.ctx, w.server(), { wait: false })).toMatchObject({ ok: true });
    expect(receivedRow(w.store.db, w.serverId, uids.project)).not.toBeNull();
    expect(pendingRowCount(w.store.db, w.serverId)).toBe(0);
  });

  test("a dirty own target stops the cursor at its seq and is retried; after ten tries it is set aside with the cursor going on; a later row, once the file is committed, becomes a conflict and drops it", async () => {
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
    const uid = `project:${ALIAS}:${written.entry.id}`;
    const bob = await memberOf(w.t, w.token, "Bob", "desk");
    await bobRevises(w, bob.token, uid, "Bob's body.");
    const repo = openRepo(w.knowledge, { scope: "project", projectId: 1 });
    if (repo === null) throw new Error("no repository");
    const file = join(repo.path, "entries", "discovery-call-script.md");
    writeFileSync(file, readFileSync(file, "utf8").replace("The body.", "Edited by hand."));
    // The feed holds Bob's row alone (the own row is no longer current): the cursor stops
    // before it, where it stood.
    for (let i = 1; i < PENDING_AFTER_TRIES; i++) {
      const pulled = await pullOnce(w.store.ctx, w.server(), { wait: false });
      expect(pulled).toMatchObject({ ok: false, stoppedAt: 2, applied: 0 });
      expect(cursorsOf(w.store.db, w.serverId).main).toBe(0);
      expect(pendingRowCount(w.store.db, w.serverId)).toBe(0);
    }
    const tenth = await pullOnce(w.store.ctx, w.server(), { wait: false });
    expect(tenth).toMatchObject({ ok: true, stoppedAt: null, skipped: 1 });
    expect(cursorsOf(w.store.db, w.serverId).main).toBe(2);
    expect(pendingRows(w.store.db, w.serverId)).toMatchObject([
      { uid, seq: 2, reason: "dirty or locked", tries: PENDING_AFTER_TRIES },
    ]);
    expect(readFileSync(file, "utf8")).toContain("Edited by hand.");
    // The edit committed: the next row of the uid is applied over it as a conflict, and the
    // pending row goes with it.
    commitByHand(repo.path, "by hand");
    await bobRevises(w, bob.token, uid, "Bob's second body.");
    expect(await pullOnce(w.store.ctx, w.server(), { wait: false })).toMatchObject({
      ok: true,
      applied: 1,
    });
    expect(pendingRowCount(w.store.db, w.serverId)).toBe(0);
    expect(readFileSync(file, "utf8")).toContain("Bob's second body.");
    expect(openConflictCount(w.store.db, w.serverId)).toBe(1);
  }, 60_000);

  test("a received memory revised on the server is written through the store's writer: its vector row is refreshed, so no search matches the old text", async () => {
    const w = await world("all");
    taxonomy(w);
    const { bob, uids } = await bobShares(w);
    expect(await pullOnce(w.store.ctx, w.server(), { wait: false })).toMatchObject({ applied: 3 });
    const memoryId = receivedMemoryRow(w.store.db, w.serverId, uids.memory)?.memoryId as number;
    // A vector the backfill wrote for the old text.
    w.store.db.run(
      "INSERT INTO memory_vectors (memory_id, model, scale, vec) VALUES (?, 'potion', 1, X'00')",
      [memoryId],
    );
    const current = (await feed(w)).items.find(
      (item) => (item as { uid: string }).uid === uids.memory,
    ) as { revision: number; hash: string; payload: OutgoingMemory };
    const revised: OutgoingMemory = {
      ...current.payload,
      body: "Two files now.",
      updatedAt: current.payload.updatedAt + 1,
      version: current.payload.version + 1,
      hash: "",
    };
    revised.hash = memoryHash(revised);
    const answer = await push(w.t.server, bob.token, [
      {
        op: "send",
        kind: "memory",
        uid: revised.uid,
        baseRevision: current.revision,
        baseHash: current.hash,
        payload: revised,
      },
    ]);
    expect(answer.body.results[0].result).toBe("applied");
    expect(await pullOnce(w.store.ctx, w.server(), { wait: false })).toMatchObject({ applied: 1 });
    expect(
      w.store.db
        .query<{ body: string }, [number]>("SELECT body FROM memories WHERE id = ?")
        .get(memoryId)?.body,
    ).toBe("Two files now.");
    // Without a model the refresh drops the vector, as `insertMemory`'s update path does.
    expect(vectorCount(w, memoryId)).toBe(0);
  });
});

describe("the aliases a pull names (AC-78)", () => {
  test("a 101st bound alias is pulled with scope=project under its own cursor without wait at the sixty-second mark, and its change arrives within a minute", async () => {
    const w = await world("all");
    taxonomy(w);
    const main = bindMany(w, 100);
    const { bob, uids } = await bobShares(w);
    const urls = spyFetch(w);
    // The snapshot: the main cursor over the 100, then the extra alias alone.
    expect(await pullOnce(w.store.ctx, w.server(), { wait: false })).toMatchObject({ applied: 3 });
    const pulls = () => urls.filter((url) => url.includes("/v1/pull")).map(decodeURIComponent);
    const all = pulls().find((url) => url.includes("scope=all")) as string;
    expect(all).toContain(`projects=${main.join(",")}`);
    expect(all).not.toContain(ALIAS);
    expect(pulls().find((url) => url.includes("scope=project"))).toContain(`projects=${ALIAS}`);
    const cursors = cursorsOf(w.store.db, w.serverId);
    expect(cursors.mainAliases).toEqual(main);
    expect(cursors.extra).toEqual({ [ALIAS]: 3 });
    // Bob revises his project entry: the main pull does not name the alias; the extra pull at
    // the sixty-second mark (due at once, since none ran yet) brings the change, without wait.
    urls.length = 0;
    await bobRevises(w, bob.token, uids.project, "Revised playbook.");
    expect(await pullOnce(w.store.ctx, w.server(), { wait: false })).toMatchObject({ applied: 1 });
    const extra = pulls().filter((url) => url.includes("scope=project"));
    expect(extra).toHaveLength(1);
    expect(extra[0]).toContain(`projects=${ALIAS}`);
    expect(extra[0]).not.toMatch(/wait=(?!0\b)\d/);
    expect(pulls().find((url) => url.includes("scope=all"))).not.toContain(ALIAS);
    expect(receivedRow(w.store.db, w.serverId, uids.project)?.body).toContain("Revised playbook.");
    expect(cursorsOf(w.store.db, w.serverId).extra[ALIAS]).toBe(4);
    // Another revision within the minute waits for the next mark; it arrives within a minute.
    urls.length = 0;
    await bobRevises(w, bob.token, uids.project, "Revised again.");
    expect(await pullOnce(w.store.ctx, w.server(), { wait: false })).toMatchObject({ applied: 0 });
    expect(pulls().filter((url) => url.includes("scope=project"))).toHaveLength(0);
    w.store.clock.advance(60_000);
    expect(await pullOnce(w.store.ctx, w.server(), { wait: false })).toMatchObject({ applied: 1 });
    expect(receivedRow(w.store.db, w.serverId, uids.project)?.body).toContain("Revised again.");
    expect(cursorsOf(w.store.db, w.serverId).extra[ALIAS]).toBe(5);
  }, 60_000);

  test("a row written during a one-alias snapshot arrives once; a raise from receive to Knowledge keeps the alias in the main set; a project disabled and re-enabled leaves and returns through the new-alias path, a row written meanwhile arriving", async () => {
    const w = await world("receive");
    taxonomy(w);
    const { bob, uids } = await bobShares(w);
    const urls = spyFetch(w);
    expect(await pullOnce(w.store.ctx, w.server(), { wait: false })).toMatchObject({ applied: 3 });
    const pulls = () => urls.filter((url) => url.includes("/v1/pull"));
    // Raised: no snapshot, the alias stays.
    urls.length = 0;
    expect(
      setLevel(w.store.db, {
        projectId: 1,
        destination: w.serverId,
        level: "knowledge",
        source: "cli",
        now: w.store.clock.now,
        confirm: true,
      }).ok,
    ).toBe(true);
    expect(await pullOnce(w.store.ctx, w.server(), { wait: false })).toMatchObject({ applied: 0 });
    expect(pulls().filter((url) => url.includes("scope=project"))).toHaveLength(0);
    expect(cursorsOf(w.store.db, w.serverId).mainAliases).toEqual([ALIAS]);
    // Disabled: the alias leaves at the next pull, the main cursor stands.
    w.store.db.run("UPDATE projects SET disabled = 1 WHERE id = 1");
    const mainBefore = cursorsOf(w.store.db, w.serverId).main;
    expect(await pullOnce(w.store.ctx, w.server(), { wait: false })).toMatchObject({ ok: true });
    expect(cursorsOf(w.store.db, w.serverId)).toMatchObject({ main: mainBefore, mainAliases: [] });
    // Meanwhile Bob revises; re-enabled, the alias returns through a one-alias snapshot, and a
    // row pushed while that snapshot runs arrives once through the main pull.
    await bobRevises(w, bob.token, uids.project, "While disabled.");
    w.store.db.run("UPDATE projects SET disabled = 0 WHERE id = 1");
    urls.length = 0;
    const real = w.store.ctx.fetch;
    let pushedDuring = false;
    w.store.ctx.fetch = async (input, init) => {
      const answer = await real(input, init);
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("scope=project") && !pushedDuring) {
        pushedDuring = true;
        await bobRevises(w, bob.token, uids.project, "During the snapshot.");
      }
      return answer;
    };
    const back = await pullOnce(w.store.ctx, w.server(), { wait: false });
    expect(pulls().filter((url) => url.includes("scope=project"))).toHaveLength(1);
    expect(cursorsOf(w.store.db, w.serverId).mainAliases).toEqual([ALIAS]);
    // The row of the alias pushed during its snapshot: applied once (by the main pull, after
    // the snapshot's page), the copy at that last revision; the feed shows a key's current row
    // alone, so the main pull never sees the "While disabled" revision again. The one skip is
    // the memory, seen again by the snapshot: the apply is idempotent by hash.
    expect(back).toMatchObject({ ok: true, applied: 2, skipped: 1 });
    expect(receivedRow(w.store.db, w.serverId, uids.project)?.body).toContain(
      "During the snapshot.",
    );
    expect(receivedRow(w.store.db, w.serverId, uids.project)?.revision).toBe(3);
  }, 60_000);
});

describe("the received copies (AC-75)", () => {
  test("a purge deletes a received copy and marks an own entry purged; a tombstone with movedTo a range this machine does not read deletes the copy", async () => {
    const w = await world("knowledge");
    taxonomy(w);
    const { bob, uids } = await bobShares(w);
    const written = writeEntry(
      w.knowledge,
      { scope: "project", projectId: 1 },
      change(),
      personAuthor(w.knowledge),
    );
    if (written.kind !== "written") throw new Error("not written");
    expect(await sweep(w.store.ctx, w.server(), { full: true })).toMatchObject({ sent: 1 });
    const own = `project:${ALIAS}:${written.entry.id}`;
    expect(await pullOnce(w.store.ctx, w.server(), { wait: false })).toMatchObject({ ok: true });
    expect(receivedRow(w.store.db, w.serverId, uids.shared)).not.toBeNull();
    // The operator purges Bob's shared entry and the own entry on the server.
    const sharedUuid = uids.shared.split(":").pop() as string;
    markPurged(w.t.server.db, sharedUuid);
    insertPurged(w.t.server.db, sharedUuid, w.t.clock.now);
    markPurged(w.t.server.db, written.entry.id);
    insertPurged(w.t.server.db, written.entry.id, w.t.clock.now);
    w.store.db.run("UPDATE sharing_servers SET snapshot_due = 1 WHERE server_id = ?", [w.serverId]);
    expect(await pullOnce(w.store.ctx, w.server(), { wait: false })).toMatchObject({ ok: true });
    expect(receivedRow(w.store.db, w.serverId, uids.shared)).toBeNull();
    expect(refusalFor(w.store.db, w.serverId, "entry", own, "any")).toMatchObject({
      reason: "purged",
    });
    expect(sentRow(w.store.db, w.serverId, "entry", own)).toBeNull();
    // Bob moves his project entry to an alias this machine does not read: the copy goes.
    const current = (await feed(w)).items.find(
      (item) => (item as FeedEntry).uid === uids.project,
    ) as FeedEntry;
    const elsewhere = "remote:github.com/acme/elsewhere";
    const movedUid = `project:${elsewhere}:${uids.project.split(":").pop()}`;
    const answer = await push(w.t.server, bob.token, [
      {
        op: "send",
        kind: "entry",
        uid: movedUid,
        baseRevision: current.revision,
        baseHash: current.hash,
        payload: rehashed({
          kind: "entry",
          uid: movedUid,
          scope: "project",
          slug: "bobs-playbook",
          remoteAlias: elsewhere,
          frontmatter: current.payload.frontmatter.replace(
            /^version: (\d+)$/m,
            (_, v: string) => `version: ${Number(v) + 1}`,
          ),
          body: current.payload.body,
          version: current.revision + 1,
          hash: "",
        }),
      },
    ]);
    expect(answer.body.results[0]).toMatchObject({ result: "applied" });
    expect(await pullOnce(w.store.ctx, w.server(), { wait: false })).toMatchObject({ ok: true });
    expect(receivedRow(w.store.db, w.serverId, uids.project)).toBeNull();
    expect(receivedRows(w.store.db, w.serverId)).toEqual([]);
  }, 60_000);

  test("a crash between the files and the rows of an unbind: the start drops the rows and the next reconcile removes the memories; a failed reconcile holds the page and is retried", async () => {
    const w = await world("all");
    taxonomy(w);
    const { uids } = await bobShares(w);
    expect(await pullOnce(w.store.ctx, w.server(), { wait: false })).toMatchObject({ applied: 3 });
    const memoryId = receivedMemoryRow(w.store.db, w.serverId, uids.memory)?.memoryId as number;
    const projectRow = receivedRow(w.store.db, w.serverId, uids.project);
    const file = join(receivedRoot(w.store.dataDir), ...(projectRow?.path ?? "").split("/"));
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
    expect(unboundAliases(w.store.db, w.serverId)).toMatchObject([{ alias: ALIAS }]);
    // The reconcile fails after the files went: the project folder cannot be removed.
    const projectFolder = join(file, "..", "..");
    rmSync(file);
    chmodSync(join(projectFolder, ".."), 0o500);
    try {
      const held = await pullOnce(w.store.ctx, w.server(), { wait: false });
      expect(held).toMatchObject({ ok: false, applied: 0 });
      expect(w.server().lastError).toContain("reconcile");
      expect(unboundAliases(w.store.db, w.serverId)).toHaveLength(1);
      expect(memoryCount(w, memoryId)).toBe(1);
    } finally {
      chmodSync(join(projectFolder, ".."), 0o700);
    }
    // As after a crash: the start drops the row whose file is gone; the next reconcile removes
    // the memory and the unbound row.
    await startSteps(w.store.ctx);
    expect(receivedRow(w.store.db, w.serverId, uids.project)).toBeNull();
    expect(await pullOnce(w.store.ctx, w.server(), { wait: false })).toMatchObject({ ok: true });
    expect(unboundAliases(w.store.db, w.serverId)).toEqual([]);
    expect(memoryCount(w, memoryId)).toBe(0);
    expect(receivedMemoryRow(w.store.db, w.serverId, uids.memory)).toBeNull();
    expect(receivedRow(w.store.db, w.serverId, uids.shared)).not.toBeNull();
  });

  test("an alias names one project (the aliases table's key), so a received memory has one home; a project bound to server A is never named in server B's pull; shared and members copies survive the start", async () => {
    const w = await world("all");
    taxonomy(w);
    // The schema keeps two enabled projects from sharing an alias: the alias is the key.
    w.store.db.run(
      "INSERT INTO projects (id, key, name, created_at) VALUES (2, 'site-two', 'site-two', 1)",
    );
    expect(() =>
      w.store.db.run("INSERT INTO project_aliases (alias, project_id) VALUES (?, 2)", [ALIAS]),
    ).toThrow(/UNIQUE|PRIMARY KEY/);
    const { bob, uids } = await bobShares(w);
    // Bob's workspace entry too: a members copy.
    const members = entryPayload({
      scope: "workspace",
      slug: "bobs-notes",
      title: "Bob's notes",
      area: "sales",
      body: "Bob's workspace body.",
    });
    await push(w.t.server, bob.token, [
      {
        op: "send",
        kind: "entry",
        uid: members.uid,
        baseRevision: 0,
        baseHash: "",
        payload: members,
      },
    ]);
    expect(await pullOnce(w.store.ctx, w.server(), { wait: false })).toMatchObject({ applied: 4 });
    const memoryId = receivedMemoryRow(w.store.db, w.serverId, uids.memory)?.memoryId as number;
    expect(
      w.store.db
        .query<{ project_id: number }, [number]>("SELECT project_id FROM memories WHERE id = ?")
        .get(memoryId)?.project_id,
    ).toBe(1);
    // A second server with project 3 bound to it: its pull names that alias alone.
    const other = await startTestServer({}, { clock: w.store.clock, timers: w.store.timers });
    try {
      const aliasB = "remote:github.com/acme/docs";
      w.store.db.run("INSERT INTO projects (id, key, name, created_at) VALUES (3, ?, 'docs', 1)", [
        aliasB,
      ]);
      w.store.db.run("INSERT INTO project_aliases (alias, project_id) VALUES (?, 3)", [aliasB]);
      const joined = await joinServer(w.store.ctx, {
        url: other.server.origin,
        code: other.code,
        label: "laptop",
        name: "Ana",
      });
      if (!joined.ok) throw new Error(joined.message);
      confirmJoin(w.store.ctx, joined.serverId);
      expect(
        setLevel(w.store.db, {
          projectId: 3,
          destination: joined.serverId,
          level: "receive",
          source: "cli",
          now: w.store.clock.now,
          confirm: true,
        }).ok,
      ).toBe(true);
      const urls = spyFetch(w);
      const serverB = serverById(w.store.db, joined.serverId) as ServerRow;
      expect(await pullOnce(w.store.ctx, serverB, { wait: false })).toMatchObject({ ok: true });
      const named = urls.filter((url) => url.includes("/v1/pull")).map(decodeURIComponent);
      expect(named.length).toBeGreaterThan(0);
      for (const url of named) {
        expect(url).toContain(`projects=${aliasB}`);
        expect(url).not.toContain(ALIAS);
      }
      // The start keeps the shared and the members copies.
      await startSteps(w.store.ctx);
      expect(receivedRow(w.store.db, w.serverId, uids.shared)).not.toBeNull();
      expect(receivedRow(w.store.db, w.serverId, members.uid)).not.toBeNull();
    } finally {
      await other.close();
    }
  }, 60_000);
});
