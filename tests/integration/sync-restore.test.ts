// A restore, a move and a compact beside the sync (ADR 0027, AC-79): the sync stopped through
// the flag, the eight tables carried into the copy before the rename, the dropped server's
// rows gone and its received copies deleted at the next start, the hold per server, and the
// copy upgraded in place without the upgrade's backup file.
import { Database } from "bun:sqlite";
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { restoreBackup, runBackup } from "../../src/backup/backup.ts";
import { folderTarget } from "../../src/backup/target.ts";
import type { Redacted } from "../../src/core/redact.ts";
import { type DoctorContext, runChecks } from "../../src/doctor/checks.ts";
import { MODULE_SCHEMAS } from "../../src/engine/module-schemas.ts";
import { personAuthor } from "../../src/modules/knowledge/author.ts";
import { receivedRows, searchEntries } from "../../src/modules/knowledge/index-store.ts";
import { KNOWLEDGE_MIGRATIONS, KNOWLEDGE_MODULE } from "../../src/modules/knowledge/migrations.ts";
import { hashOf } from "../../src/modules/knowledge/repo.ts";
import { writeEntry } from "../../src/modules/knowledge/store.ts";
import { sessionBrief } from "../../src/retrieve/brief.ts";
import { SHARING_MIGRATIONS, SHARING_MODULE } from "../../src/sharing/migrations.ts";
import { generationOf, levelRows, setLevel } from "../../src/sharing/store.ts";
import { CompactBusyError, compact } from "../../src/store/compact.ts";
import {
  DB_FILE,
  LATEST_VERSION,
  MIGRATIONS,
  moduleVersion,
  openDb,
  openStoreFile,
} from "../../src/store/db.ts";
import { insertMemory } from "../../src/store/memories.ts";
import {
  getMeta,
  restoreHoldKey,
  SYNC_LAST_FAILED_START,
  SYNC_LEASE,
  SYNC_STOP,
  setMeta,
} from "../../src/store/meta.ts";
import { moveStore } from "../../src/store/move.ts";
import type { SyncContext } from "../../src/sync/context.ts";
import { pullOnce } from "../../src/sync/inbound.ts";
import { resumePreview, resumeServer } from "../../src/sync/join.ts";
import {
  authorisedUids,
  clearServerLedger,
  liveSentRows,
  openConflicts,
  receivedMemoryRow,
  refusalFor,
  resumeAuthorisedKey,
  writeConflict,
  writeReceivedMemoryRow,
  writeRefusal,
} from "../../src/sync/ledger.ts";
import { sweep } from "../../src/sync/outbound.ts";
import { receivedRoot, writeReceived } from "../../src/sync/received.ts";
import { runSync, startSteps } from "../../src/sync/run.ts";
import {
  deleteServerRows,
  insertPending,
  listServers,
  type ServerRow,
  serverById,
  setStopped,
  writeToken,
} from "../../src/sync/servers.ts";
import { readHold } from "../../src/sync/state.ts";
import {
  cleanSyncDirs,
  openSyncStore,
  type SyncTestStore,
  serverFixture,
  settle,
} from "../helpers/sync.ts";
import {
  ALIAS,
  change,
  cleanWorlds,
  closeWorlds,
  memory,
  taxonomy,
  type World,
  world,
} from "../helpers/sync-world.ts";
import { entryPayload, memberOf, memoryPayload, push } from "../helpers/team.ts";

afterEach(async () => {
  await closeWorlds();
  for (const store of stores.splice(0)) store.close();
});
afterAll(() => {
  cleanWorlds();
  cleanSyncDirs();
});

const stores: SyncTestStore[] = [];
const S2 = "22222222aaaaaaaa";
const TOKEN = `wcm1_${"t".repeat(43)}`;
const BOB = { id: "r27ju6vmw3ly", name: "Bob" };
const UUID_B = "22222222-2222-4333-8444-555555555555";
const UUID_C = "33333333-3333-4333-8444-555555555555";
const V1_SCHEMAS = [
  { module: KNOWLEDGE_MODULE, migrations: KNOWLEDGE_MIGRATIONS.filter((m) => m.version <= 7) },
  { module: SHARING_MODULE, migrations: SHARING_MIGRATIONS.filter((m) => m.version <= 1) },
];

const entryText = (uuid: string, title: string) =>
  `---\nid: ${uuid}\ntitle: ${title}\nkind: knowledge\narea: sales\ncontext: ""\nsubject: ""\nstatus: active\nauthor: Bob\nversion: 1\n---\nBody of ${title}.\n`;

/** A received entry of a server, shared or of the bound project, written as the pull would. */
function received(
  ctx: SyncContext,
  serverId: string,
  uuid: string,
  slug: string,
  title: string,
  scope: "shared" | "project",
  at: number,
  projectId?: number,
): void {
  const text = entryText(uuid, title);
  writeReceived(
    ctx,
    {
      serverId,
      uid: scope === "shared" ? `shared:${uuid}` : `project:${ALIAS}:${uuid}`,
      scope,
      remoteAlias: scope === "shared" ? null : ALIAS,
      member: BOB,
      uuid,
      slug,
      text,
      hash: hashOf(Buffer.from(text)),
      revision: 1,
    },
    projectId === undefined ? { at } : { at, projectId },
  );
}

/** A teammate's memory copy: the memory row and its provenance, as the pull writes them. */
function receivedMemory(ctx: SyncContext, serverId: string, title: string, at: number): number {
  const id = insertMemory(ctx.db, {
    projectId: 1,
    kind: "decision",
    title,
    body: "Theirs." as Redacted,
    terms: "",
    importance: 3,
    branch: null,
    commit: null,
    origin: "imported",
    judge: `team:${serverId}`,
    judgeVersion: "1",
    sourceTurnId: null,
    files: [],
    now: at,
  });
  const uid = `remote:desk:a1b2c3d4:${id}`;
  writeReceivedMemoryRow(
    ctx,
    {
      serverId,
      remoteUid: uid,
      memoryId: id,
      memberId: BOB.id,
      memberName: BOB.name,
      revision: 1,
      hash: "h",
      remoteKind: "decision",
      remoteImportance: 3,
      remoteStatus: "active",
    },
    uid,
    at,
  );
  return id;
}

const target = (w: { store: { dataDir: string } }) => folderTarget(join(w.store.dataDir, "nas"));

async function backupOf(store: SyncTestStore, at: number): Promise<string> {
  const outcome = await runBackup({
    db: store.db,
    storeDir: store.dataDir,
    target: target({ store }),
    keep: 10,
    now: at,
    owner: "test",
  });
  if (!outcome.ok) throw new Error(outcome.detail);
  return outcome.name;
}

/** Runs a restore while the fake clock is moved, until it answers. */
async function restoreWhileTicking<T>(store: SyncTestStore, work: Promise<T>): Promise<T> {
  let done = false;
  void work.then(
    () => {
      done = true;
    },
    () => {
      done = true;
    },
  );
  for (let i = 0; i < 300 && !done; i++) {
    await settle();
    store.clock.advance(1_000);
  }
  return work;
}

/** The live store reopened after a restore, with a context over the new connection. */
function reopen(w: World): SyncContext {
  w.store.db.close();
  const db = openDb({ dataDir: w.store.dataDir, busyTimeoutMs: 2000 });
  w.store.db = db;
  return { ...w.store.ctx, db };
}

const replacedFiles = (dir: string) => readdirSync(dir).filter((n) => /\.replaced-\d+$/.test(n));
const upgradeCopies = (dir: string) =>
  existsSync(join(dir, "backups"))
    ? readdirSync(join(dir, "backups")).filter((n) =>
        /^wizardingcode-mem-\d+-v\d+-\d+\.db$/.test(n),
      )
    : [];

function doctorContext(
  dataDir: string,
  now: number,
  env: Record<string, string | undefined>,
): DoctorContext {
  const missing = (name: string) => join(dataDir, "nowhere", name);
  return {
    dataDir,
    storeDir: dataDir,
    settingsPath: missing("settings.json"),
    codexHooksPath: missing("codex.json"),
    cursorHooksPath: missing("cursor.json"),
    geminiSettingsPath: missing("gemini.json"),
    opencodePluginPath: missing("opencode.ts"),
    qwenSettingsPath: missing("qwen.json"),
    droidSettingsPath: missing("droid.json"),
    copilotHooksPath: missing("copilot.json"),
    antigravityHooksPath: missing("antigravity.json"),
    claudeDesktopConfigPath: missing("claude_desktop_config.json"),
    which: () => null,
    now,
    legacyVariables: [],
    env,
    gitVersion: () => [2, 40, 0],
  };
}

describe("backup --restore beside the sync", () => {
  test("stops the sync, carries the live rows, drops the unlisted server, holds the withdrawals until the resume, and the next start deletes what is owed", async () => {
    const w = await world("all");
    const { store } = w;
    const ctx = store.ctx;
    const now = () => store.clock.now;
    taxonomy(w);
    // What the copy will hold: an own entry and memory sent, a second server with a received
    // entry and memory, its hold key and authorised list, and a stale failed-start mark.
    writeEntry(
      w.knowledge,
      { scope: "project", projectId: 1 },
      change({ title: "Entry one", slug: "entry-one" }),
      personAuthor(w.knowledge),
    );
    memory(w, "Own memory one");
    expect(await sweep(ctx, w.server(), { full: true })).toMatchObject({ sent: 2, refused: 0 });
    insertPending(store.db, serverFixture(S2, { url: "https://two.acme.test" }));
    store.db.run("UPDATE sharing_servers SET confirmed_at = ? WHERE server_id = ?", [now(), S2]);
    received(ctx, S2, UUID_B, "shared-one", "Shared one", "shared", now());
    const theirs = receivedMemory(ctx, S2, "Bob's memory", now());
    setMeta(store.db, restoreHoldKey(S2), JSON.stringify({ reason: "bulk", at: now() }));
    setMeta(store.db, resumeAuthorisedKey(S2), JSON.stringify(["shared:x"]));
    setMeta(
      store.db,
      SYNC_LAST_FAILED_START,
      JSON.stringify({ at: 1, reason: "old", failures: 1 }),
    );
    const copyGeneration = generationOf(store.db) as string;
    const backupAt = now();
    const name = await backupOf(store, backupAt);
    store.clock.advance(60_000);

    // The live store moves on: another entry sent, a refusal, a conflict, a received entry of
    // the bound project (a file the copy's rows lack), and the second server removed.
    writeEntry(
      w.knowledge,
      { scope: "project", projectId: 1 },
      change({ title: "Entry two", slug: "entry-two" }),
      personAuthor(w.knowledge),
    );
    expect(await sweep(ctx, w.server(), { full: true })).toMatchObject({ sent: 1 });
    const sent = liveSentRows(store.db, w.serverId);
    expect(sent).toHaveLength(3);
    writeRefusal(
      ctx,
      w.serverId,
      "entry",
      `project:${ALIAS}:refused`,
      "deadbeef",
      "secret",
      "aws",
      now(),
    );
    writeConflict(ctx, w.serverId, `project:${ALIAS}:${UUID_C}`, {
      at: now(),
      localText: "my text",
      localVersion: 2,
      localHash: "lh",
      serverRevision: 3,
      serverHash: "sh",
      proposalId: null,
    });
    // A teammate's entry of the bound project reaches the server now: the live sync pulls it
    // (its file and rows), the copy's rows lack it, and the start after the restore re-indexes
    // the file from disk.
    const bob = await memberOf(w.t, w.token, "Bob", "desk");
    const theirsHere = entryPayload({
      scope: "project",
      remoteAlias: ALIAS,
      slug: "theirs-here",
      title: "Theirs here",
      area: "sales",
      body: "Bob's body.",
    });
    const pushed = await push(w.t.server, bob.token, [
      {
        op: "send",
        kind: "entry",
        uid: theirsHere.uid,
        baseRevision: 0,
        baseHash: "",
        payload: theirsHere,
      },
    ]);
    expect(pushed.body.results.map((r: { result: string }) => r.result)).toEqual(["applied"]);

    // The sync runs, its pull held on the server. The second server, disabled meanwhile, is
    // removed from the list while it runs, so its received copies stay on disk until the next
    // start. The restore stops the sync through the flag.
    writeToken(ctx, S2, TOKEN);
    setStopped(store.db, S2, "disabled");
    const run = runSync(ctx, { once: false, viewerLive: async () => false });
    for (let i = 0; i < 40 && receivedRows(store.db, w.serverId).length === 0; i++) {
      await settle();
      store.clock.advance(500);
    }
    expect(getMeta(store.db, SYNC_LEASE)).not.toBeNull();
    expect(receivedRows(store.db, w.serverId).map((row) => row.uid)).toEqual([theirsHere.uid]);
    deleteServerRows(store.db, S2);
    clearServerLedger(store.db, S2);
    expect(listServers(store.db).map((row) => row.serverId)).toEqual([w.serverId]);
    const outcome = await restoreWhileTicking(
      store,
      restoreBackup({
        storeDir: store.dataDir,
        dataDir: store.dataDir,
        target: target(w),
        name,
        now: now(),
        clock: store.clock,
        timers: store.timers,
      }),
    );
    expect(await run).toBe(0);
    expect(outcome).toMatchObject({
      ok: true,
      sharingReset: 1,
      servers: { carried: [w.serverId], dropped: [S2] },
      pendingDeletion: [S2],
    });
    expect(replacedFiles(store.dataDir)).toHaveLength(1);
    expect(existsSync(join(store.dataDir, `${DB_FILE}-wal`))).toBe(false);
    expect(upgradeCopies(store.dataDir)).toEqual([]);

    // The restored store: the live rows of the listed server, nothing of the dropped one, the
    // levels reset, the hold set, the stale marks gone.
    const ctx2 = reopen(w);
    const db = ctx2.db;
    expect(getMeta(db, SYNC_STOP)).toBeNull();
    expect(getMeta(db, SYNC_LAST_FAILED_START)).toBeNull();
    expect(listServers(db).map((row) => row.serverId)).toEqual([w.serverId]);
    expect(serverById(db, w.serverId)?.snapshotDue).toBe(true);
    expect(
      liveSentRows(db, w.serverId)
        .map((row) => row.itemUid)
        .sort(),
    ).toEqual(sent.map((row) => row.itemUid).sort());
    expect(
      refusalFor(db, w.serverId, "entry", `project:${ALIAS}:refused`, "deadbeef"),
    ).not.toBeNull();
    expect(openConflicts(db, w.serverId).map((row) => row.localText)).toEqual(["my text"]);
    expect(levelRows(db)).toEqual([]);
    expect(readHold(db, w.serverId)).toMatchObject({ reason: "restore" });
    expect(getMeta(db, restoreHoldKey(S2))).toBeNull();
    expect(authorisedUids(db, S2)).toEqual([]);
    expect(generationOf(db)).not.toBe(copyGeneration);
    for (const table of [
      "sharing_ledger",
      "sharing_sent_hashes",
      "sharing_refusals",
      "sharing_conflicts",
      "sharing_pending_rows",
      "sharing_unbound",
      "sharing_muted_members",
    ]) {
      const column =
        table === "sharing_pending_rows" ||
        table === "sharing_unbound" ||
        table === "sharing_muted_members"
          ? "server_id"
          : "destination";
      expect({
        table,
        n: db
          .query<{ n: number }, [string]>(`SELECT count(*) AS n FROM ${table} WHERE ${column} = ?`)
          .get(S2)?.n,
      }).toEqual({ table, n: 0 });
    }
    // A server re-added after the restore starts with no hold and no authorised uid.
    insertPending(db, serverFixture(S2, { url: "https://two.acme.test" }));
    expect(readHold(db, S2)).toBeNull();
    expect(authorisedUids(db, S2)).toEqual([]);
    deleteServerRows(db, S2);

    // Before the start: the dropped server's copies are in the copy's rows and on disk, but no
    // search and no brief shows them.
    expect(receivedRows(db, S2)).toHaveLength(1);
    expect(existsSync(join(receivedRoot(store.dataDir), S2))).toBe(true);
    const hits = searchEntries(db, ["shared"], [], {}, null, 10, { projectId: 1 });
    expect(hits.filter((hit) => hit.id.startsWith(S2))).toEqual([]);
    const brief = sessionBrief(db, { projectId: 1, branch: null, now: now() });
    expect(brief.text).not.toContain("Bob's memory");
    expect(receivedRows(db, w.serverId).map((row) => row.uid)).toEqual([]);

    // The start: the dropped server's files, rows and memory go; the listed server's file is
    // re-indexed; the sweep holds every withdrawal under the restore.
    expect(await runSync(ctx2, { once: true })).toBe(0);
    expect(receivedRows(db, S2)).toEqual([]);
    expect(existsSync(join(receivedRoot(store.dataDir), S2))).toBe(false);
    expect(
      db
        .query<{ n: number }, [number]>("SELECT count(*) AS n FROM memories WHERE id = ?")
        .get(theirs)?.n,
    ).toBe(0);
    expect(receivedRows(db, w.serverId).map((row) => row.uid)).toEqual([theirsHere.uid]);
    expect(readHold(db, w.serverId)).toMatchObject({ reason: "restore" });
    expect(liveSentRows(db, w.serverId).filter((row) => row.withdrawnAt !== null)).toEqual([]);

    // A level set clears nothing; the resume shows the old generation's memory and releases it;
    // the sweep then withdraws that set and keeps the entries.
    const bound = setLevel(db, {
      projectId: 1,
      destination: w.serverId,
      level: "all",
      source: "cli",
      now: now(),
      confirm: true,
    });
    expect(bound.ok).toBe(true);
    expect(readHold(db, w.serverId)).toMatchObject({ reason: "restore" });
    const previews = resumePreview(ctx2, w.serverId);
    if ("ok" in previews) throw new Error(previews.message);
    expect(previews).toHaveLength(1);
    expect(previews[0]?.hold).toMatchObject({ reason: "restore" });
    expect(previews[0]?.total).toBe(1);
    // A memory uid is `<generation>:<id>`: the old generation's, withdrawn once the resume is confirmed.
    expect(previews[0]?.perProject.flatMap((p) => p.uids)).toEqual([
      expect.stringMatching(/^[0-9a-f]{8}:\d+$/),
    ]);
    resumeServer(ctx2, previews);
    expect(readHold(db, w.serverId)).toBeNull();
    const after = await sweep(ctx2, w.server(), { full: true });
    expect(after).toMatchObject({ withdrawn: 1, held: 0 });
    // The entries stay; the old generation's memory uid is withdrawn and the memory is sent
    // again under the new one, since the project is back at Knowledge and memories.
    const oldUid = previews[0]?.perProject.flatMap((p) => p.uids)[0] as string;
    const rows = liveSentRows(db, w.serverId);
    expect(rows.filter((row) => row.itemKind === "entry")).toHaveLength(2);
    const memories = rows.filter((row) => row.itemKind === "memory").map((row) => row.itemUid);
    expect(memories).toEqual([`${generationOf(db)}:${oldUid.split(":")[1]}`]);
    expect(
      db
        .query<{ withdrawn_at: number | null }, [string, string]>(
          "SELECT withdrawn_at FROM sharing_ledger WHERE destination = ? AND item_uid = ? AND direction = 'sent'",
        )
        .get(w.serverId, oldUid)?.withdrawn_at,
    ).not.toBeNull();
  }, 120_000);

  test("the carry reconciles the received memories: one received after the backup comes back at the snapshot, one tombstoned after it does not revive; a dropped server that delivered only memories is cleaned at the start; a restore unbinds nothing", async () => {
    const w = await world("all");
    const { store } = w;
    const ctx = store.ctx;
    const now = () => store.clock.now;
    taxonomy(w);
    const bob = await memberOf(w.t, w.token, "Bob", "desk");
    let rowId = 0;
    const sendMemory = async (title: string) => {
      rowId++;
      const payload = memoryPayload({ rowId, remoteAlias: ALIAS, title, body: `${title}.` });
      const pushed = await push(w.t.server, bob.token, [
        { op: "send", kind: "memory", uid: payload.uid, baseRevision: 0, baseHash: "", payload },
      ]);
      expect(pushed.body.results[0].result).toBe("applied");
      return { uid: payload.uid, feedUid: `remote:${bob.deviceAlias}:${payload.uid}` };
    };
    const count = (db: SyncContext["db"], id: number) =>
      db.query<{ n: number }, [number]>("SELECT count(*) AS n FROM memories WHERE id = ?").get(id)
        ?.n;
    const first = await sendMemory("First");
    const theirs = entryPayload({
      scope: "project",
      remoteAlias: ALIAS,
      slug: "theirs",
      title: "Theirs",
      area: "sales",
      body: "Bob's body.",
    });
    await push(w.t.server, bob.token, [
      {
        op: "send",
        kind: "entry",
        uid: theirs.uid,
        baseRevision: 0,
        baseHash: "",
        payload: theirs,
      },
    ]);
    expect(await pullOnce(ctx, w.server(), { wait: false })).toMatchObject({ applied: 2 });
    const firstId = receivedMemoryRow(store.db, w.serverId, first.feedUid)?.memoryId as number;
    expect(firstId).not.toBeNull();
    // A second server that delivered one memory and nothing else: no folder of its own.
    insertPending(store.db, serverFixture(S2, { url: "https://two.acme.test" }));
    store.db.run("UPDATE sharing_servers SET confirmed_at = ? WHERE server_id = ?", [now(), S2]);
    const s2Memory = receivedMemory(ctx, S2, "S2's memory", now());
    const name = await backupOf(store, now());
    store.clock.advance(60_000);

    // After the backup: a second memory received, the first tombstoned, the second server gone.
    const second = await sendMemory("Second");
    const withdrawn = await push(w.t.server, bob.token, [
      { op: "withdraw", kind: "memory", uid: first.feedUid, baseRevision: 1, baseHash: "" },
    ]);
    expect(withdrawn.body.results[0].result).toBe("withdrawn");
    expect(await pullOnce(ctx, w.server(), { wait: false })).toMatchObject({ applied: 2 });
    expect(count(store.db, firstId)).toBe(0);
    expect(receivedMemoryRow(store.db, w.serverId, second.feedUid)?.memoryId).not.toBeNull();
    deleteServerRows(store.db, S2);
    clearServerLedger(store.db, S2);

    const outcome = await restoreWhileTicking(
      store,
      restoreBackup({
        storeDir: store.dataDir,
        dataDir: store.dataDir,
        target: target(w),
        name,
        now: now(),
        clock: store.clock,
        timers: store.timers,
      }),
    );
    expect(outcome).toMatchObject({
      ok: true,
      servers: { carried: [w.serverId], dropped: [S2] },
      pendingDeletion: [S2],
    });
    const ctx2 = reopen(w);
    const db = ctx2.db;
    // The first memory: the copy held it, the live ledger no longer does: it does not revive.
    expect(count(db, firstId)).toBe(0);
    expect(receivedMemoryRow(db, w.serverId, first.feedUid)).toBeNull();
    // The second: the live ledger knew it, the copy holds no memory for it: its ledger row is
    // dropped, so the snapshot receives it again instead of reading it as deduped.
    expect(receivedMemoryRow(db, w.serverId, second.feedUid)).toBeNull();
    // A restore unbinds nothing, and the received project copy survives it.
    expect(db.query<{ n: number }, []>("SELECT count(*) AS n FROM sharing_unbound").get()?.n).toBe(
      0,
    );
    expect(receivedRows(db, w.serverId).map((row) => row.uid)).toEqual([theirs.uid]);
    // The dropped server's memory stays until the start, which finds it by its provenance.
    expect(count(db, s2Memory)).toBe(1);
    await startSteps(ctx2);
    expect(count(db, s2Memory)).toBe(0);
    expect(
      db
        .query<{ n: number }, [string]>(
          "SELECT count(*) AS n FROM sharing_received_memories WHERE server_id = ?",
        )
        .get(S2)?.n,
    ).toBe(0);
    // The snapshot brings the second memory back, with its provenance.
    expect(
      setLevel(db, {
        projectId: 1,
        destination: w.serverId,
        level: "all",
        source: "cli",
        now: now(),
        confirm: true,
      }).ok,
    ).toBe(true);
    expect(
      await pullOnce(ctx2, serverById(db, w.serverId) as ServerRow, { wait: false }),
    ).toMatchObject({
      ok: true,
    });
    expect(receivedMemoryRow(db, w.serverId, second.feedUid)?.memoryId).not.toBeNull();
    expect(receivedMemoryRow(db, w.serverId, first.feedUid)).toBeNull();
  }, 120_000);

  test("a copy whose header is in WAL mode keeps every carried row; a -wal file beside the unpacked copy refuses; a fault in the carry leaves the live store unchanged", async () => {
    const w = await world("knowledge");
    const { store } = w;
    taxonomy(w);
    writeEntry(
      w.knowledge,
      { scope: "project", projectId: 1 },
      change({ title: "Entry one", slug: "entry-one" }),
      personAuthor(w.knowledge),
    );
    expect(await sweep(store.ctx, w.server(), { full: true })).toMatchObject({ sent: 1 });
    const name = await backupOf(store, store.clock.now);
    // The copy's header says WAL, as a store that never had its journal mode changed would.
    const gz = join(store.dataDir, "nas", name);
    const plain = join(store.dataDir, "wal-copy.db");
    writeFileSync(plain, gunzipSync(readFileSync(gz)));
    const edit = new Database(plain);
    edit.run("PRAGMA journal_mode = WAL");
    edit.run("INSERT INTO meta (key, value) VALUES ('probe', 'wal')");
    edit.close();
    writeFileSync(gz, gzipSync(readFileSync(plain)));
    store.clock.advance(1_000);
    const restoreNow = store.clock.now;
    const options = {
      storeDir: store.dataDir,
      dataDir: store.dataDir,
      target: target(w),
      name,
      now: restoreNow,
      clock: store.clock,
      timers: store.timers,
    };

    // A -wal file beside the unpacked copy: refused before anything is renamed.
    mkdirSync(join(store.dataDir, "backups"), { recursive: true });
    const stray = join(store.dataDir, "backups", `.restore-${restoreNow}.db-wal`);
    writeFileSync(stray, "");
    expect(await restoreWhileTicking(store, restoreBackup(options))).toMatchObject({
      ok: false,
      reason: "unsound",
    });
    expect(replacedFiles(store.dataDir)).toEqual([]);
    rmSync(stray, { force: true });

    // A fault inside the carry: the live store is untouched, no copy is in place.
    const faulty = await restoreWhileTicking(
      store,
      restoreBackup({
        ...options,
        now: restoreNow + 1,
        onCopy: () => {
          throw new Error("carry failed on purpose");
        },
      }),
    );
    expect(faulty).toMatchObject({
      ok: false,
      reason: "failed",
      detail: expect.stringContaining("carry failed on purpose"),
    });
    expect(replacedFiles(store.dataDir)).toEqual([]);
    expect(liveSentRows(store.db, w.serverId)).toHaveLength(1);
    expect(getMeta(store.db, SYNC_STOP)).toBeNull();
    expect(
      readdirSync(join(store.dataDir, "backups")).filter((n) => n.startsWith(".restore-")),
    ).toEqual([]);

    // The WAL-header copy: every carried row is there after the restore, no -wal beside it.
    const outcome = await restoreWhileTicking(
      store,
      restoreBackup({ ...options, now: restoreNow + 2 }),
    );
    expect(outcome).toMatchObject({ ok: true, servers: { carried: [w.serverId], dropped: [] } });
    expect(existsSync(join(store.dataDir, `${DB_FILE}-wal`))).toBe(false);
    const ctx2 = reopen(w);
    expect(liveSentRows(ctx2.db, w.serverId)).toHaveLength(1);
    expect(getMeta(ctx2.db, "probe")).toBe("wal");
    expect(readHold(ctx2.db, w.serverId)).toMatchObject({ reason: "restore" });
  }, 120_000);

  test("a v1 copy is upgraded in the copy without the upgrade's backup file; the flag reaches the core and the module upgrade", async () => {
    // A store at sharing v1 and knowledge v7, backed up into the live store's folder.
    const live = openSyncStore();
    stores.push(live);
    const v1Dir = mkdtempSync(join(tmpdir(), "wcm-v1-"));
    const v1 = openDb({ dataDir: v1Dir, busyTimeoutMs: 2000, moduleSchemas: V1_SCHEMAS });
    v1.run("INSERT INTO projects (id, key, name, created_at) VALUES (1, 'local:/p', 'p', 1)");
    insertMemory(v1, {
      projectId: 1,
      kind: "fix",
      title: "Old",
      body: "" as Redacted,
      terms: "",
      importance: 3,
      branch: null,
      commit: null,
      origin: "manual",
      judge: "heuristic",
      judgeVersion: "1",
      sourceTurnId: null,
      files: [],
      now: 1,
    });
    expect(moduleVersion(v1, SHARING_MODULE)).toBe(1);
    const out = await runBackup({
      db: v1,
      storeDir: live.dataDir,
      target: target({ store: live }),
      keep: 10,
      now: live.clock.now,
      owner: "test",
    });
    if (!out.ok) throw new Error(out.detail);
    v1.close();
    live.db.close();
    const outcome = await restoreWhileTicking(
      live,
      restoreBackup({
        storeDir: live.dataDir,
        dataDir: live.dataDir,
        target: target({ store: live }),
        name: out.name,
        now: live.clock.now + 1,
        clock: live.clock,
        timers: live.timers,
      }),
    );
    expect(outcome).toMatchObject({
      ok: true,
      servers: { carried: [], dropped: [] },
      pendingDeletion: [],
    });
    expect(upgradeCopies(live.dataDir)).toEqual([]);
    const restored = openDb({ dataDir: live.dataDir, busyTimeoutMs: 2000 });
    live.db = restored;
    expect(moduleVersion(restored, SHARING_MODULE)).toBe(3);
    expect(moduleVersion(restored, KNOWLEDGE_MODULE)).toBe(8);
    expect(restored.query<{ n: number }, []>("SELECT count(*) AS n FROM memories").get()?.n).toBe(
      1,
    );
    // `sync --once` with no server listed runs the start's steps and exits 0.
    expect(await runSync({ ...live.ctx, db: restored }, { once: true })).toBe(0);
    // doctor raises nothing after an ordinary restore.
    const checks = runChecks(doctorContext(live.dataDir, live.clock.now, live.ctx.env));
    const loud = checks.filter(
      (check) =>
        ["database", "sharing", "sync", "knowledge"].includes(check.name) &&
        (check.status === "warn" || check.status === "fail"),
    );
    expect(loud).toEqual([]);

    // The flag on `openStoreFile`: with it, a v1 module copy upgrades with no backup file; without
    // it, the upgrade writes one. The core upgrade the same, from a store one migration behind.
    const moduleDir = mkdtempSync(join(tmpdir(), "wcm-flag-"));
    openDb({ dataDir: moduleDir, busyTimeoutMs: 2000, moduleSchemas: V1_SCHEMAS }).close();
    openStoreFile(moduleDir, DB_FILE, {
      moduleSchemas: MODULE_SCHEMAS,
      upgradeBackup: false,
    }).close();
    expect(upgradeCopies(moduleDir)).toEqual([]);
    const coreDir = mkdtempSync(join(tmpdir(), "wcm-core-"));
    openDb({
      dataDir: coreDir,
      busyTimeoutMs: 2000,
      migrations: MIGRATIONS.slice(0, LATEST_VERSION - 1),
      moduleSchemas: [],
    }).close();
    openStoreFile(coreDir, DB_FILE, {
      migrations: MIGRATIONS,
      moduleSchemas: [],
      upgradeBackup: false,
    }).close();
    expect(upgradeCopies(coreDir)).toEqual([]);
    const coreDirWith = mkdtempSync(join(tmpdir(), "wcm-core-with-"));
    openDb({
      dataDir: coreDirWith,
      busyTimeoutMs: 2000,
      migrations: MIGRATIONS.slice(0, LATEST_VERSION - 1),
      moduleSchemas: [],
    }).close();
    openStoreFile(coreDirWith, DB_FILE, { migrations: MIGRATIONS, moduleSchemas: [] }).close();
    expect(upgradeCopies(coreDirWith)).toHaveLength(1);
  }, 60_000);
});

describe("move and compact beside the sync", () => {
  test("both stop a running sync through the flag and refuse with their busy error when it does not stop within 30 s", async () => {
    const w = await world("knowledge");
    const { store } = w;
    const ctx = store.ctx;
    // compact: the sync runs, its pull held; compact sets the flag, the loop leaves, compact runs.
    const run = runSync(ctx, { once: false, viewerLive: async () => false });
    await settle();
    expect(getMeta(store.db, SYNC_LEASE)).not.toBeNull();
    const compacting = compact(store.db, {
      now: store.clock.now,
      clock: store.clock,
      timers: store.timers,
    });
    const report = await restoreWhileTicking(store, compacting);
    expect(await run).toBe(0);
    expect(report).toMatchObject({ dryRun: false });
    expect(getMeta(store.db, SYNC_STOP)).toBeNull();
    // A sync that never leaves (a lease with no process behind its flag): the busy error at 30 s.
    setMeta(
      store.db,
      SYNC_LEASE,
      JSON.stringify({ owner: `sync-${process.pid}-9.9.9`, until: store.clock.now + 3_600_000 }),
    );
    const stuck = compact(store.db, {
      now: store.clock.now,
      clock: store.clock,
      timers: store.timers,
    });
    await expect(restoreWhileTicking(store, stuck)).rejects.toThrow(CompactBusyError);
    expect(getMeta(store.db, SYNC_STOP)).toBeNull();
    // move: the same stop, the same refusal.
    const to = join(store.dataDir, "elsewhere");
    const refused = await restoreWhileTicking(
      store,
      moveStore({
        dataDir: store.dataDir,
        from: store.dataDir,
        to,
        now: store.clock.now,
        clock: store.clock,
        timers: store.timers,
      }),
    );
    expect(refused).toMatchObject({ ok: false, reason: "busy" });
    expect(refused.ok ? "" : refused.detail).toContain("sync");
    store.db.run("DELETE FROM meta WHERE key = ?", [SYNC_LEASE]);
    const run2 = runSync(ctx, { once: false, viewerLive: async () => false });
    await settle();
    expect(getMeta(store.db, SYNC_LEASE)).not.toBeNull();
    const moved = await restoreWhileTicking(
      store,
      moveStore({
        dataDir: store.dataDir,
        from: store.dataDir,
        to,
        now: store.clock.now,
        clock: store.clock,
        timers: store.timers,
      }),
    );
    expect(await run2).toBe(0);
    expect(moved).toMatchObject({ ok: true, to });
    expect(existsSync(join(to, DB_FILE))).toBe(true);
  }, 120_000);
});
