// Leaving a server and resuming its withdrawals (ADR 0027, D-10): the removal behind the stop
// flag, with or without the withdrawal of what was sent, every deletion it owes, and the resume
// that releases a hold for the set it showed.
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ADAPTERS } from "../../src/adapters/index.ts";
import type { AgentAdapter, HookInput } from "../../src/adapters/types.ts";
import type { AgentId } from "../../src/core/types.ts";
import { handleHook } from "../../src/hooks/handle.ts";
import { personAuthor } from "../../src/modules/knowledge/author.ts";
import { receivedRows } from "../../src/modules/knowledge/index-store.ts";
import { hashOf } from "../../src/modules/knowledge/repo.ts";
import { writeEntry } from "../../src/modules/knowledge/store.ts";
import { levelRows, recentChanges } from "../../src/sharing/store.ts";
import { supersede } from "../../src/store/memories.ts";
import {
  getMeta,
  liveLease,
  restoreHoldKey,
  SYNC_LEASE,
  SYNC_STOP,
  setMeta,
} from "../../src/store/meta.ts";
import type { Fetch } from "../../src/sync/context.ts";
import { pullOnce } from "../../src/sync/inbound.ts";
import { removeServer, resumePreview, resumeServer } from "../../src/sync/join.ts";
import {
  authorisedUids,
  liveSentRows,
  receivedMemoryRow,
  resumeAuthorisedKey,
  writeConflict,
} from "../../src/sync/ledger.ts";
import { sweep } from "../../src/sync/outbound.ts";
import { receivedRoot, writeReceived } from "../../src/sync/received.ts";
import { runSync } from "../../src/sync/run.ts";
import {
  insertPending,
  mutedMembers,
  muteMember,
  readTokens,
  serverById,
} from "../../src/sync/servers.ts";
import { startSync } from "../../src/sync/spawn.ts";
import { readHold } from "../../src/sync/state.ts";
import { runCliWith } from "../helpers/cli.ts";
import { serverFixture, settle } from "../helpers/sync.ts";
import {
  ALIAS,
  change,
  cleanWorlds,
  closeWorlds,
  commitByHand,
  feed,
  memory,
  taxonomy,
  type World,
  world,
} from "../helpers/sync-world.ts";
import { memberOf, memoryPayload, push } from "../helpers/team.ts";

afterEach(async () => {
  await closeWorlds();
});
afterAll(() => cleanWorlds());

const UUID_B = "22222222-2222-4333-8444-555555555555";

/** Entries written and swept, so the server holds sent rows of this device. */
async function sent(w: World, n: number): Promise<string[]> {
  taxonomy(w);
  for (let i = 0; i < n; i++) {
    writeEntry(
      w.knowledge,
      { scope: "project", projectId: 1 },
      change({ title: `Entry ${i}`, slug: `entry-${i}` }),
      personAuthor(w.knowledge),
    );
  }
  expect(await sweep(w.store.ctx, w.server(), { full: true })).toMatchObject({ sent: n });
  return liveSentRows(w.store.db, w.serverId).map((row) => row.itemUid);
}

describe("share server remove", () => {
  test("stops a sync whose pull is held, deletes everything it owes, and the next spawn finds no server", async () => {
    const w = await world("knowledge");
    await sent(w, 2);
    // A received copy, a refusal, a conflict, a hold, an authorised list and an unbound row.
    const text =
      '---\nid: 22222222-2222-4333-8444-555555555555\ntitle: Shared one\nkind: knowledge\narea: sales\ncontext: ""\nsubject: ""\nstatus: active\nauthor: Bob\nversion: 1\n---\nBody.\n';
    writeReceived(
      w.store.ctx,
      {
        serverId: w.serverId,
        uid: `shared:${UUID_B}`,
        scope: "shared",
        remoteAlias: null,
        member: { id: "r27ju6vmw3ly", name: "Bob" },
        uuid: UUID_B,
        slug: "shared-one",
        text,
        hash: hashOf(Buffer.from(text)),
        revision: 1,
      },
      { at: w.store.clock.now },
    );
    expect(receivedRows(w.store.db)).toHaveLength(1);
    w.store.db.run(
      "INSERT INTO sharing_refusals (destination, item_kind, item_uid, hash, reason, rule, at) VALUES (?, 'entry', 'x', 'h', 'secret', 'aws', 1)",
      [w.serverId],
    );
    writeConflict(w.store.ctx, w.serverId, "project:x", {
      at: 1,
      localText: "t",
      localVersion: 1,
      localHash: "h",
      serverRevision: 2,
      serverHash: "s",
      proposalId: null,
    });
    setMeta(w.store.db, restoreHoldKey(w.serverId), JSON.stringify({ reason: "bulk", at: 1 }));
    setMeta(w.store.db, resumeAuthorisedKey(w.serverId), JSON.stringify(["project:x"]));
    w.store.db.run(
      "INSERT INTO sharing_unbound (server_id, alias, at) VALUES (?, 'remote:github.com/acme/other', 1)",
      [w.serverId],
    );
    // The sync runs with the real hooks: its pull is held on the server.
    const run = runSync(w.store.ctx, { once: false, viewerLive: async () => false });
    await settle();
    expect(liveLease(w.store.db, SYNC_LEASE, w.store.clock.now)).not.toBeNull();
    const removing = removeServer(w.store.ctx, w.serverId, { withdraw: false, yes: false });
    await settle();
    expect(removing).toBeInstanceOf(Promise);
    // Open conflicts refuse without yes: nothing stopped, nothing removed.
    const refused = await removing;
    expect(refused).toMatchObject({ ok: false, reason: "open-conflicts" });
    expect(getMeta(w.store.db, SYNC_STOP)).toBeNull();
    const removingYes = removeServer(w.store.ctx, w.serverId, { withdraw: false, yes: true });
    await settle();
    expect(getMeta(w.store.db, SYNC_STOP)).not.toBeNull();
    w.store.clock.advance(5_000);
    await settle();
    expect(await run).toBe(0);
    w.store.clock.advance(250);
    await settle();
    const removed = await removingYes;
    expect(removed).toMatchObject({ ok: true, levels: 1 });
    expect(serverById(w.store.db, w.serverId)).toBeNull();
    expect(levelRows(w.store.db)).toEqual([]);
    expect(readTokens(w.store.dataDir)[w.serverId]).toBeUndefined();
    expect(receivedRows(w.store.db)).toEqual([]);
    expect(existsSync(join(receivedRoot(w.store.dataDir), w.serverId))).toBe(false);
    for (const table of [
      "sharing_ledger",
      "sharing_sent_hashes",
      "sharing_refusals",
      "sharing_conflicts",
      "sharing_unbound",
      "sharing_pending_rows",
      "sharing_received_memories",
    ]) {
      expect(
        w.store.db.query<{ n: number }, []>(`SELECT count(*) AS n FROM ${table}`).get()?.n,
      ).toBe(0);
    }
    expect(getMeta(w.store.db, restoreHoldKey(w.serverId))).toBeNull();
    expect(getMeta(w.store.db, resumeAuthorisedKey(w.serverId))).toBeNull();
    expect(getMeta(w.store.db, SYNC_STOP)).toBeNull();
    expect(recentChanges(w.store.db, 1)[0]).toMatchObject({
      what: `server:${w.serverId}`,
      new: "",
    });
    expect(startSync(w.store.db, {}, w.store.clock.now, () => undefined)).toBe("no-server");
  });

  test("remove deletes the received memories with the superseded_by rule, the member mutes and the pending rows", async () => {
    const w = await world("all");
    taxonomy(w);
    const bob = await memberOf(w.t, w.token, "Bob", "desk");
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
    const feedUid = `remote:${bob.deviceAlias}:${theirs.uid}`;
    expect(await pullOnce(w.store.ctx, w.server(), { wait: false })).toMatchObject({ applied: 1 });
    const received = receivedMemoryRow(w.store.db, w.serverId, feedUid)?.memoryId as number;
    // An own memory superseded by the received one, a muted member, a pending row.
    const own = memory(w, "Mine, superseded");
    supersede(w.store.db, own, received, w.store.clock.now);
    muteMember(w.store.db, w.serverId, bob.memberId, true);
    w.store.db.run(
      "INSERT INTO sharing_pending_rows (server_id, seq, uid, kind, payload, reason, tries, at) VALUES (?, 9, 'x', 'entry', '{}', 'dirty', 10, 1)",
      [w.serverId],
    );
    expect(mutedMembers(w.store.db, w.serverId)).toEqual([bob.memberId]);
    const removed = await removeServer(w.store.ctx, w.serverId, { withdraw: false, yes: true });
    expect(removed).toMatchObject({ ok: true });
    const count = (table: string) =>
      w.store.db.query<{ n: number }, []>(`SELECT count(*) AS n FROM ${table}`).get()?.n;
    expect(count("sharing_received_memories")).toBe(0);
    expect(count("sharing_muted_members")).toBe(0);
    expect(count("sharing_pending_rows")).toBe(0);
    expect(
      w.store.db
        .query<{ n: number }, [number]>("SELECT count(*) AS n FROM memories WHERE id = ?")
        .get(received)?.n,
    ).toBe(0);
    expect(
      w.store.db
        .query<{ status: string; superseded_by: number | null }, [number]>(
          "SELECT status, superseded_by FROM memories WHERE id = ?",
        )
        .get(own),
    ).toEqual({ status: "active", superseded_by: null });
  });

  test("with two servers listed, removing one leaves the other to the next spawn: the session-start and prompt hooks restart the sync", async () => {
    const w = await world("knowledge");
    insertPending(w.store.db, serverFixture("s2"));
    w.store.db.run("UPDATE sharing_servers SET confirmed_at = ? WHERE server_id = 's2'", [
      w.store.clock.now,
    ]);
    const removed = await removeServer(w.store.ctx, w.serverId, { withdraw: false, yes: true });
    expect(removed).toMatchObject({ ok: true });
    expect(serverById(w.store.db, w.serverId)).toBeNull();
    expect(getMeta(w.store.db, SYNC_STOP)).toBeNull();
    // The hooks' spawn: the dep the command wires to `startSync`, counted here.
    const outcomes: string[] = [];
    const spawned: string[][] = [];
    const deps = {
      db: w.store.db,
      now: () => w.store.clock.now,
      spawnDistill: () => {},
      spawnSync: () => {
        outcomes.push(
          startSync(w.store.db, {}, w.store.clock.now, (...args: string[]) => {
            spawned.push(args);
          }),
        );
      },
    };
    const adapter = ADAPTERS["claude-code"] as AgentAdapter;
    const input: HookInput = {
      agent: "claude-code" as AgentId,
      event: "session-start",
      sessionId: "remove-spawn-1",
      cwd: w.store.dataDir,
      turnId: null,
      transcriptPath: null,
      prompt: null,
      finalText: null,
      source: null,
      toolError: null,
      toolFile: null,
      subagent: false,
    };
    handleHook(deps, adapter, input);
    expect(outcomes).toEqual(["spawned"]);
    expect(spawned).toEqual([["sync", "--auto"]]);
    handleHook(deps, adapter, { ...input, event: "prompt", prompt: "hello", turnId: "t1" });
    expect(outcomes).toEqual(["spawned", "spawned"]);
    handleHook(deps, adapter, { ...input, event: "session-end" });
    expect(outcomes).toHaveLength(2);
  });

  test("--withdraw: a stale withdraw retried once on current; with the server down the removal is refused with the count and the token kept", async () => {
    const w = await world("knowledge");
    const uids = await sent(w, 3);
    // A teammate revises one entry on the server: this device's base for it is stale.
    const bob = await memberOf(w.t, w.token, "Bob", "desk");
    const current = (await feed(w)).items.find(
      (item) => (item as { uid: string }).uid === uids[0],
    ) as { revision: number; hash: string; payload: { frontmatter: string; body: string } };
    const payload = {
      kind: "entry",
      uid: uids[0],
      scope: "project",
      slug: "entry-0",
      remoteAlias: ALIAS,
      frontmatter: current.payload.frontmatter.replace("version: 1", "version: 2"),
      body: "Bob's body.\n",
      version: 2,
      hash: "",
    };
    const { entryBytes } = await import("../../src/team/contract.ts");
    payload.hash = hashOf(entryBytes(payload as Parameters<typeof entryBytes>[0]));
    const pushed = await push(w.t.server, bob.token, [
      {
        op: "send",
        kind: "entry",
        uid: uids[0],
        baseRevision: current.revision,
        baseHash: current.hash,
        payload,
      },
    ]);
    expect(pushed.body.results[0].result).toBe("applied");
    // The server down: refused with the count, everything kept.
    const real = w.store.ctx.fetch;
    const down: Fetch = () => Promise.reject(new TypeError("fetch failed: ECONNREFUSED"));
    w.store.ctx.fetch = down;
    const refused = await removeServer(w.store.ctx, w.serverId, { withdraw: true, yes: true });
    expect(refused).toMatchObject({ ok: false, reason: "withdraw-left" });
    if (refused.ok) throw new Error("unreachable");
    expect(refused.message).toContain("3 items");
    expect(serverById(w.store.db, w.serverId)).not.toBeNull();
    expect(readTokens(w.store.dataDir)[w.serverId]).toBeDefined();
    expect(getMeta(w.store.db, SYNC_STOP)).toBeNull();
    // The server back: the stale withdraw retried on current, everything withdrawn, the server removed.
    w.store.ctx.fetch = real;
    const removed = await removeServer(w.store.ctx, w.serverId, { withdraw: true, yes: true });
    expect(removed).toMatchObject({ ok: true });
    const page = await feed(w);
    expect(
      page.items
        .filter((item) => uids.includes((item as { uid: string }).uid))
        .every((item) => (item as { op: string }).op === "tombstone"),
    ).toBe(true);
  });

  test("a folder left by a crashed remove is deleted at the sync's start", async () => {
    const w = await world("knowledge");
    taxonomy(w);
    const folder = join(receivedRoot(w.store.dataDir), w.serverId, "shared", "entries");
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "left--12345678.md"), "---\n---\n");
    // The rows' transaction landed, the folder's deletion did not.
    w.store.db.run("DELETE FROM sharing_levels");
    w.store.db.run("DELETE FROM sharing_servers");
    expect(existsSync(folder)).toBe(true);
    const run = runSync(w.store.ctx, { once: true });
    expect(await run).toBe(0);
    expect(existsSync(join(receivedRoot(w.store.dataDir), w.serverId))).toBe(false);
  });

  test("the CLI says the device stays listed on the server", async () => {
    const w = await world("knowledge");
    const env = {
      PATH: process.env.PATH ?? "",
      HOME: w.store.dataDir,
      WIZARDINGCODE_HOME: w.store.dataDir,
      WIZARDINGCODE_MEM_DATA_DIR: w.store.dataDir,
      WIZARDINGCODE_MEM_MIGRATE: "off",
      WIZARDINGCODE_MEM_DISTILL: "off",
      WIZARDINGCODE_MEM_UI_AUTO_OPEN: "off",
      WIZARDINGCODE_MEM_SYNC: "off",
    };
    const result = await runCliWith({ env }, "share", "server", "remove", w.serverId, "--yes");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("stays listed on the server until an admin revokes it");
    expect(serverById(w.store.db, w.serverId)).toBeNull();
  });
});

describe("share server resume", () => {
  test("shows the withdrawals per project, clears nothing without the yes, clears a restore and a bulk hold on it, and the sweep withdraws the shown set", async () => {
    const w = await world("knowledge");
    const uids = await sent(w, 25);
    const repo = (await import("../../src/modules/knowledge/repo.ts")).openRepo(w.knowledge, {
      scope: "project",
      projectId: 1,
    });
    if (repo === null) throw new Error("no repository");
    (await import("../helpers/stub-git.ts")).realGit(repo.path, "rm", "-q", "-r", "entries");
    commitByHand(repo.path, "gone");
    w.store.clock.advance(60_000);
    expect(await sweep(w.store.ctx, w.server(), { full: true })).toMatchObject({
      withdrawn: 0,
      held: 25,
    });
    expect(readHold(w.store.db, w.serverId)).toMatchObject({ reason: "bulk" });
    const previews = resumePreview(w.store.ctx, w.serverId);
    if ("ok" in previews) throw new Error(previews.message);
    expect(previews).toHaveLength(1);
    expect(previews[0]).toMatchObject({
      serverId: w.serverId,
      total: 25,
      hold: { reason: "bulk" },
    });
    expect(previews[0]?.perProject.map((p) => [p.projectId, p.count])).toEqual([[1, 25]]);
    // Nothing without the yes: the hold stands.
    expect(readHold(w.store.db, w.serverId)).not.toBeNull();
    expect(authorisedUids(w.store.db, w.serverId)).toEqual([]);
    // The yes: the hold cleared, the shown set authorised, the sweep withdraws it with no new hold.
    expect(resumeServer(w.store.ctx, previews)).toEqual({ released: [w.serverId] });
    expect(readHold(w.store.db, w.serverId)).toBeNull();
    expect(authorisedUids(w.store.db, w.serverId).sort()).toEqual([...uids].sort());
    w.store.clock.advance(60_000);
    expect(await sweep(w.store.ctx, w.server(), { full: true })).toMatchObject({
      withdrawn: 25,
      held: 0,
    });
    expect(readHold(w.store.db, w.serverId)).toBeNull();
    expect(authorisedUids(w.store.db, w.serverId)).toEqual([]);
    // A restore hold is cleared the same way; every server when none is named.
    setMeta(w.store.db, restoreHoldKey(w.serverId), JSON.stringify({ reason: "restore", at: 1 }));
    const all = resumePreview(w.store.ctx, null);
    if ("ok" in all) throw new Error(all.message);
    expect(all[0]?.hold).toMatchObject({ reason: "restore" });
    resumeServer(w.store.ctx, all);
    expect(readHold(w.store.db, w.serverId)).toBeNull();
    expect(resumePreview(w.store.ctx, "nobody")).toMatchObject({
      ok: false,
      reason: "unknown-server",
    });
  });
});
