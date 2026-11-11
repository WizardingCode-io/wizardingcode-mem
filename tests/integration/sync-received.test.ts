// Received items for the agents (ADR 0027, D-6): the files and rows, what the search, the
// browse, the floor and knowledge_get show and hide, the held pin, take, and the deletions.
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { EXIT_USAGE } from "../../src/cli/exit.ts";
import type { Redacted } from "../../src/core/redact.ts";
import type { MomentInput } from "../../src/engine/module.ts";
import { personAuthor } from "../../src/modules/knowledge/author.ts";
import { contribute, openConflictsCount } from "../../src/modules/knowledge/contribute.ts";
import { renderEntry } from "../../src/modules/knowledge/entry.ts";
import { KnowledgeError } from "../../src/modules/knowledge/errors.ts";
import {
  browseEntries,
  ftsCount,
  pinnedEntries,
  rebuildAll,
  receivedRow,
  receivedRows,
  searchEntries,
} from "../../src/modules/knowledge/index-store.ts";
import { hashOf, openRepo } from "../../src/modules/knowledge/repo.ts";
import { writeEntry, writeTaken } from "../../src/modules/knowledge/store.ts";
import { getKnowledge, searchKnowledge } from "../../src/modules/knowledge/tools.ts";
import { visibleRepos } from "../../src/modules/knowledge/visible.ts";
import { setLevel } from "../../src/sharing/store.ts";
import { compact } from "../../src/store/compact.ts";
import { insertMemory } from "../../src/store/memories.ts";
import { touchSession } from "../../src/store/sessions.ts";
import { applyOwnRevision } from "../../src/sync/conflicts.ts";
import { pullOnce } from "../../src/sync/inbound.ts";
import { muteServer } from "../../src/sync/join.ts";
import { writeConflict } from "../../src/sync/ledger.ts";
import { sweep } from "../../src/sync/outbound.ts";
import {
  deleteServerReceived,
  orphanServerIds,
  receivedRoot,
  reconcileReceived,
  reindexReceived,
  writeReceived,
} from "../../src/sync/received.ts";
import { insertPending } from "../../src/sync/servers.ts";
import { entryBytes } from "../../src/team/contract.ts";
import { runCliWith } from "../helpers/cli.ts";
import { serverFixture } from "../helpers/sync.ts";
import {
  ALIAS,
  change,
  cleanWorlds,
  closeWorlds,
  feed,
  taxonomy,
  type World,
  world,
} from "../helpers/sync-world.ts";
import { entryPayload, memberOf, memoryPayload, push } from "../helpers/team.ts";

afterEach(async () => {
  await closeWorlds();
});
afterAll(() => cleanWorlds());

const BOB = { id: "r27ju6vmw3ly", name: "Bob" };
const UUID_A = "11111111-2222-4333-8444-555555555555";
const UUID_B = "22222222-2222-4333-8444-555555555555";
const UUID_C = "33333333-2222-4333-8444-555555555555";

/** A teammate's entry as the server holds it. */
function remoteEntry(
  w: World,
  over: {
    uuid: string;
    slug: string;
    scope?: "workspace" | "shared" | "project";
    title?: string;
    body?: string;
    member?: { id: string; name: string };
    revision?: number;
    area?: string;
  },
) {
  const scope = over.scope ?? "project";
  const text = renderEntry({
    id: over.uuid,
    slug: over.slug,
    title: over.title ?? "Discovery call script",
    kind: "strategy",
    area: over.area ?? "sales",
    context: "agency clients",
    subject: "discovery call",
    status: "active",
    author: over.member?.name ?? BOB.name,
    version: over.revision ?? 1,
    created: null,
    updated: null,
    supersedes: null,
    pinned: false,
    body: over.body ?? "The teammate's discovery script body.",
    extra: [],
    problem: null,
  });
  const remoteAlias = scope === "project" ? ALIAS : null;
  return {
    serverId: w.serverId,
    uid: scope === "project" ? `project:${ALIAS}:${over.uuid}` : `${scope}:${over.uuid}`,
    scope,
    remoteAlias,
    member: over.member ?? BOB,
    uuid: over.uuid,
    slug: over.slug,
    text,
    hash: hashOf(Buffer.from(text)),
    revision: over.revision ?? 1,
  };
}

const serverName = (w: World) => w.server().name;

/** A prompt's moment for project 1, with a session. */
function prompt(w: World, text: string, projectId = 1): MomentInput {
  const session = touchSession(w.store.db, {
    agent: "claude-code",
    agentSessionId: `s-${text.length}-${projectId}`,
    projectId,
    cwd: w.store.dataDir,
    branch: null,
    now: w.store.clock.now,
  });
  return {
    db: w.store.db,
    moment: "prompt",
    projectId,
    branch: null,
    root: w.store.dataDir,
    sessionId: session.id,
    epoch: session.contextEpoch,
    prompt: text,
    path: null,
    error: null,
    now: w.store.clock.now,
    budgetChars: 480,
  };
}

describe("the received store", () => {
  test("a file verbatim with the server's hash, the rows in one transaction, a revision replacing them, the folders per scope", async () => {
    const w = await world();
    taxonomy(w);
    const entry = remoteEntry(w, { uuid: UUID_A, slug: "discovery-call-script" });
    const written = writeReceived(w.store.ctx, entry, { at: w.store.clock.now });
    expect(written.path).toMatch(
      new RegExp(
        `^${w.serverId}/projects/[a-z0-9-]+-[0-9a-f]{8}/entries/discovery-call-script--11111111\\.md$`,
      ),
    );
    const file = join(receivedRoot(w.store.dataDir), ...written.path.split("/"));
    expect(readFileSync(file, "utf8")).toBe(entry.text);
    expect(hashOf(readFileSync(file))).toBe(entry.hash);
    const row = receivedRow(w.store.db, w.serverId, entry.uid);
    expect(row).toMatchObject({
      projectId: 1,
      memberId: BOB.id,
      memberName: "Bob",
      slug: "discovery-call-script",
      title: "Discovery call script",
      status: "active",
      revision: 1,
    });
    const ledger = w.store.db
      .query<{ direction: string; version: number; hash: string }, [string]>(
        "SELECT direction, version, hash FROM sharing_ledger WHERE item_uid = ?",
      )
      .all(entry.uid);
    expect(ledger).toEqual([{ direction: "received", version: 1, hash: entry.hash }]);
    const counts = ftsCount(w.store.db);
    expect(counts.rows).toBe(counts.active);
    // A revision replaces the row and its search row.
    const revised = remoteEntry(w, {
      uuid: UUID_A,
      slug: "discovery-call-script",
      body: "Revised body.",
      revision: 2,
    });
    writeReceived(w.store.ctx, revised, { at: w.store.clock.now + 1 });
    expect(receivedRows(w.store.db, w.serverId)).toHaveLength(1);
    expect(receivedRow(w.store.db, w.serverId, entry.uid)?.body).toBe("Revised body.");
    expect(ftsCount(w.store.db).rows).toBe(ftsCount(w.store.db).active);
    // The shared and the member folders.
    const shared = writeReceived(
      w.store.ctx,
      remoteEntry(w, { uuid: UUID_B, slug: "shared-one", scope: "shared" }),
      { at: w.store.clock.now },
    );
    expect(shared.path).toBe(`${w.serverId}/shared/entries/shared-one--22222222.md`);
    const mine = writeReceived(
      w.store.ctx,
      remoteEntry(w, {
        uuid: UUID_C,
        slug: "my-other-device",
        scope: "workspace",
        member: { id: w.server().memberId, name: "Ana" },
      }),
      { at: w.store.clock.now },
    );
    expect(mine.path).toBe(
      `${w.serverId}/members/${w.server().memberId}/entries/my-other-device--33333333.md`,
    );
    // A text whose hash is not the server's is refused, nothing written.
    expect(() =>
      writeReceived(
        w.store.ctx,
        {
          ...remoteEntry(w, { uuid: UUID_B, slug: "bad", scope: "shared" }),
          hash: "0000000000000000",
        },
        { at: 1 },
      ),
    ).toThrow(/hash/);
  });

  test("search, browse, the floor and knowledge_get show received entries with their provenance; the floor shows at most one", async () => {
    const w = await world();
    taxonomy(w);
    writeReceived(w.store.ctx, remoteEntry(w, { uuid: UUID_A, slug: "discovery-call-script" }), {
      at: w.store.clock.now,
    });
    writeReceived(
      w.store.ctx,
      remoteEntry(w, {
        uuid: UUID_B,
        slug: "discovery-follow-up",
        title: "Discovery follow-up call",
        scope: "shared",
      }),
      { at: w.store.clock.now },
    );
    writeReceived(
      w.store.ctx,
      remoteEntry(w, {
        uuid: UUID_C,
        slug: "my-notes",
        title: "Discovery notes from my desk",
        scope: "workspace",
        member: { id: w.server().memberId, name: "Ana" },
      }),
      { at: w.store.clock.now },
    );
    const listed = searchKnowledge(w.knowledge, { projectId: 1 }, { query: "discovery call" });
    expect(listed).toContain(":discovery-call-script--11111111");
    expect(listed).toContain("(from Bob via ");
    expect(listed).toContain("(from Ana (another device) via ");
    const browsed = browseEntries(
      w.store.db,
      visibleRepos(w.store.db, 1).map((r) => r.id),
      {},
      10,
      { projectId: 1 },
    );
    expect(browsed.map((hit) => hit.slug).sort()).toEqual([
      "discovery-call-script",
      "discovery-follow-up",
      "my-notes",
    ]);
    expect(
      browsed.every(
        (hit) => hit.repoId === 0 && hit.received !== undefined && hit.pinned === false,
      ),
    ).toBe(true);
    // The test server's name is its host with a port, which holds a colon: it is named by its id,
    // and the search's references say so; the name form answers with the id to use.
    expect(serverName(w)).toContain(":");
    expect(listed).toContain(`${w.serverId}:discovery-call-script--11111111`);
    const got = getKnowledge(
      w.knowledge,
      { projectId: 1 },
      {
        refs: [
          `${serverName(w)}:discovery-call-script--11111111`,
          `${w.serverId}:discovery-follow-up--22222222`,
          `${w.serverId}:discovery-call-script--11111111`,
        ],
      },
    );
    expect(got).toContain(`use its id: ${w.serverId}:discovery-call-script--11111111`);
    expect(got).toContain("from Bob via");
    expect(got).toContain("The teammate's discovery script body.");
    expect(got).toContain(`id: ${UUID_A}`);
    expect(got).toContain(`# ${w.serverId}:discovery-follow-up--22222222`);
    // The floor: two received entries match; one is shown; its shown row keys on the entry id.
    const shown = contribute(prompt(w, "How do we run the discovery call with agency clients?"));
    expect(shown).not.toBeNull();
    expect((shown ?? "").match(/via /g)?.length).toBe(1);
    const rows = w.store.db
      .query<{ repo_id: number; entry_id: string }, []>(
        "SELECT repo_id, entry_id FROM knowledge_shown",
      )
      .all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.repo_id).toBe(0);
    expect(rows[0]?.entry_id).toMatch(new RegExp(`^${w.serverId}\\|`));
    // The pinned block never shows them.
    expect(
      pinnedEntries(
        w.store.db,
        visibleRepos(w.store.db, 1).map((r) => r.id),
      ),
    ).toEqual([]);
  });

  test("hidden: a muted server, a muted member, an unlisted server, an unbound alias; a project with no repository still gets hits", async () => {
    const w = await world();
    taxonomy(w);
    writeReceived(w.store.ctx, remoteEntry(w, { uuid: UUID_A, slug: "project-entry" }), {
      at: w.store.clock.now,
    });
    writeReceived(
      w.store.ctx,
      remoteEntry(w, {
        uuid: UUID_B,
        slug: "shared-entry",
        scope: "shared",
        member: { id: "x7y8z9a1b2c3", name: "Cy" },
      }),
      { at: w.store.clock.now },
    );
    const search = (projectId: number | null) =>
      searchEntries(
        w.store.db,
        ["discovery"],
        projectId === null ? [] : visibleRepos(w.store.db, projectId).map((r) => r.id),
        {},
        null,
        10,
        { projectId },
      )
        .map((hit) => hit.slug)
        .sort();
    expect(search(1)).toEqual(["project-entry", "shared-entry"]);
    muteServer(w.store.ctx, w.serverId, { muted: true, memberId: "x7y8z9a1b2c3" });
    expect(search(1)).toEqual(["project-entry"]);
    muteServer(w.store.ctx, w.serverId, { muted: false, memberId: "x7y8z9a1b2c3" });
    muteServer(w.store.ctx, w.serverId, { muted: true });
    expect(search(1)).toEqual([]);
    muteServer(w.store.ctx, w.serverId, { muted: false });
    // The project's alias no longer bound: its copies hidden, the shared one stays.
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
    expect(search(1)).toEqual(["shared-entry"]);
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
    expect(search(1)).toEqual(["project-entry", "shared-entry"]);
    // A project with no repository of its own (no knowledge folder) still gets the shared hits and its alias's.
    expect(visibleRepos(w.store.db, 1).filter((r) => r.scope === "project")).toEqual([]);
    expect(
      contribute(prompt(w, "How do we run the discovery call script with agency clients?")),
    ).not.toBeNull();
    // An unlisted server: its rows hidden until the start deletes them.
    w.store.db.run("UPDATE knowledge_received SET server_id = 'deadbeefdeadbeef'");
    expect(search(1)).toEqual([]);
    expect(orphanServerIds(w.store.ctx)).toEqual(["deadbeefdeadbeef"]);
  });

  test("a held pin: a revised own entry leaves the pinned block, shows revised by with (pin held), and an edit releases it; a rebuild keeps the marker", async () => {
    const w = await world();
    taxonomy(w);
    const written = writeEntry(
      w.knowledge,
      { scope: "project", projectId: 1 },
      change({ pinned: true }),
      personAuthor(w.knowledge),
    );
    if (written.kind !== "written") throw new Error("not written");
    expect(await sweep(w.store.ctx, w.server(), { full: true })).toMatchObject({ sent: 1 });
    const repoIds = visibleRepos(w.store.db, 1).map((r) => r.id);
    expect(pinnedEntries(w.store.db, repoIds).map((p) => p.slug)).toEqual([
      "discovery-call-script",
    ]);
    const bob = await memberOf(w.t, w.token, "Bob", "desk");
    const uid = `project:${ALIAS}:${written.entry.id}`;
    const current = (await feed(w)).items.find((item) => (item as { uid: string }).uid === uid) as {
      revision: number;
      hash: string;
      payload: { frontmatter: string; body: string };
    };
    const payload = {
      kind: "entry",
      uid,
      scope: "project",
      slug: "discovery-call-script",
      remoteAlias: ALIAS,
      frontmatter: current.payload.frontmatter.replace("version: 1", "version: 2"),
      body: "Bob's body.\n",
      version: 2,
      hash: "",
    };
    payload.hash = hashOf(entryBytes(payload as Parameters<typeof entryBytes>[0]));
    const pushed = await push(w.t.server, bob.token, [
      {
        op: "send",
        kind: "entry",
        uid,
        baseRevision: current.revision,
        baseHash: current.hash,
        payload,
      },
    ]);
    expect(pushed.body.results[0].result).toBe("applied");
    const revised = (await feed(w)).items.find((item) => (item as { uid: string }).uid === uid) as {
      hash: string;
      member: { id: string; name: string };
      payload: { frontmatter: string; body: string };
    };
    const applied = applyOwnRevision(
      w.store.ctx,
      w.server(),
      {
        uid,
        revision: 2,
        hash: revised.hash,
        text: revised.payload.frontmatter + revised.payload.body,
        member: revised.member,
      },
      w.knowledge,
    );
    expect(applied.kind).toBe("applied");
    expect(pinnedEntries(w.store.db, repoIds)).toEqual([]);
    const listed = searchKnowledge(w.knowledge, { projectId: 1 }, { query: "discovery call" });
    expect(listed).toContain("revised by Bob via");
    expect(listed).toContain("(pin held)");
    const floor = contribute(prompt(w, "discovery call script for agency clients"));
    expect(floor).toContain("pin held");
    // A rebuild keeps the marker: it is derived from the ledger and the index hash.
    rebuildAll(w.knowledge);
    expect(searchKnowledge(w.knowledge, { projectId: 1 }, { query: "discovery call" })).toContain(
      "(pin held)",
    );
    expect(pinnedEntries(w.store.db, repoIds)).toEqual([]);
    // The person's edit releases the pin.
    writeEntry(
      w.knowledge,
      { scope: "project", projectId: 1 },
      change({ slug: "discovery-call-script", baseVersion: 2, body: "Ana again.", pinned: true }),
      personAuthor(w.knowledge),
    );
    expect(pinnedEntries(w.store.db, repoIds).map((p) => p.slug)).toEqual([
      "discovery-call-script",
    ]);
    expect(
      searchKnowledge(w.knowledge, { projectId: 1 }, { query: "discovery call" }),
    ).not.toContain("revised by");
  });

  test("take copies a received entry into the own repository under its uuid; the copy is then hidden; a pinned write of a received ref is refused", async () => {
    const w = await world();
    taxonomy(w);
    writeReceived(
      w.store.ctx,
      remoteEntry(w, {
        uuid: UUID_B,
        slug: "shared-playbook",
        title: "Shared playbook",
        scope: "shared",
      }),
      { at: w.store.clock.now },
    );
    const taken = writeTaken(
      w.knowledge,
      { scope: "shared" },
      {
        slug: "shared-playbook",
        title: "Shared playbook",
        kind: "strategy",
        area: "sales",
        context: "agency clients",
        subject: "discovery call",
        body: "The teammate's discovery script body.",
      },
      UUID_B,
      personAuthor(w.knowledge),
    );
    expect(taken).toMatchObject({ id: UUID_B, slug: "shared-playbook", version: 1 });
    const repo = openRepo(w.knowledge, { scope: "shared" });
    expect(existsSync(join(repo?.path as string, "entries", "shared-playbook.md"))).toBe(true);
    const listed = searchKnowledge(w.knowledge, { projectId: 1 }, { query: "shared playbook" });
    expect(listed).toContain("shared/shared-playbook");
    expect(listed).not.toContain("from Bob");
    expect(receivedRows(w.store.db, w.serverId)).toHaveLength(1);
    // Taking it twice is refused: the uuid is already an own entry.
    expect(() =>
      writeTaken(
        w.knowledge,
        { scope: "shared" },
        {
          slug: "another",
          title: "x",
          kind: "strategy",
          area: "sales",
          context: "",
          subject: "",
          body: "b",
        },
        UUID_B,
        personAuthor(w.knowledge),
      ),
    ).toThrow(/already/);
  });

  test("a project with two host-led remotes: the copies under the alias its level binds show; those under its other alias, which no pull refreshes, stay hidden", async () => {
    const w = await world();
    taxonomy(w);
    // The other alias sorts before the bound one, so a reader that took the first by name would pick it.
    const other = "remote:github.com/acme/a-second";
    w.store.db.run("INSERT INTO project_aliases (alias, project_id) VALUES (?, 1)", [other]);
    writeReceived(
      w.store.ctx,
      remoteEntry(w, { uuid: UUID_A, slug: "bound-copy", title: "Bound copy" }),
      { at: w.store.clock.now },
    );
    const unbound = remoteEntry(w, { uuid: UUID_B, slug: "other-copy", title: "Other copy" });
    writeReceived(
      w.store.ctx,
      { ...unbound, uid: `project:${other}:${UUID_B}`, remoteAlias: other },
      { at: w.store.clock.now },
    );
    const found = searchKnowledge(w.knowledge, { projectId: 1 }, { query: "copy" });
    expect(found).toContain("bound-copy");
    expect(found).not.toContain("other-copy");
    const listed = browseEntries(
      w.store.db,
      visibleRepos(w.store.db, 1).map((r) => r.id),
      {},
      10,
      {
        projectId: 1,
      },
    );
    expect(listed.map((hit) => hit.slug)).toEqual(["bound-copy"]);
  });

  test("reindexReceived: a row made from a file, a row dropped for a gone file, a linked server folder refused", async () => {
    const w = await world();
    taxonomy(w);
    const entry = remoteEntry(w, { uuid: UUID_A, slug: "project-entry" });
    const { path } = writeReceived(w.store.ctx, entry, { at: w.store.clock.now });
    writeReceived(
      w.store.ctx,
      remoteEntry(w, { uuid: UUID_B, slug: "shared-entry", scope: "shared" }),
      { at: w.store.clock.now },
    );
    // The row lost (a crash between the file and the rows' transaction): re-made from the file and its folder's alias.
    w.store.db.run(
      "DELETE FROM knowledge_fts WHERE rowid = (SELECT fts_rowid FROM knowledge_received WHERE uid = ?)",
      [entry.uid],
    );
    w.store.db.run("DELETE FROM knowledge_received WHERE uid = ?", [entry.uid]);
    expect(reindexReceived(w.store.ctx)).toEqual({ indexed: 1, dropped: 0 });
    expect(receivedRow(w.store.db, w.serverId, entry.uid)).toMatchObject({
      remoteAlias: ALIAS,
      projectId: 1,
      slug: "project-entry",
      id: UUID_A,
    });
    // The file gone: the row dropped.
    rmSync(join(receivedRoot(w.store.dataDir), ...path.split("/")));
    expect(reindexReceived(w.store.ctx)).toEqual({ indexed: 0, dropped: 1 });
    expect(receivedRows(w.store.db, w.serverId).map((r) => r.slug)).toEqual(["shared-entry"]);
    expect(ftsCount(w.store.db).rows).toBe(ftsCount(w.store.db).active);
    // A project folder with no manifest names no alias, so a file in it has no uid: passed by,
    // never indexed under a uid nothing can parse.
    const orphan = join(
      receivedRoot(w.store.dataDir),
      w.serverId,
      "projects",
      "orphan-folder-0badc0de",
      "entries",
    );
    mkdirSync(orphan, { recursive: true });
    const sharedFile = join(
      receivedRoot(w.store.dataDir),
      w.serverId,
      "shared",
      "entries",
      `shared-entry--${UUID_B.slice(0, 8)}.md`,
    );
    writeFileSync(join(orphan, `orphan-entry--${UUID_B.slice(0, 8)}.md`), readFileSync(sharedFile));
    expect(reindexReceived(w.store.ctx)).toEqual({ indexed: 0, dropped: 0 });
    expect(receivedRows(w.store.db, w.serverId).map((r) => r.slug)).toEqual(["shared-entry"]);
    rmSync(join(orphan, ".."), { recursive: true, force: true });
    // A link where the server's folder is: refused, nothing dropped.
    const folder = join(receivedRoot(w.store.dataDir), w.serverId);
    const away = `${folder}.away`;
    rmSync(folder, { recursive: true, force: true });
    mkdirSync(away, { recursive: true });
    symlinkSync(away, folder);
    expect(() => reindexReceived(w.store.ctx)).toThrow(/not a folder of its own/);
    expect(receivedRows(w.store.db, w.serverId)).toHaveLength(1);
    expect(() => deleteServerReceived(w.store.ctx, w.serverId)).toThrow(/not a folder of its own/);
    rmSync(folder);
  });

  test("deleteServerReceived and reconcileReceived: files, rows, search rows and received memories; a re-bind keeps the copies", async () => {
    const w = await world();
    taxonomy(w);
    writeReceived(w.store.ctx, remoteEntry(w, { uuid: UUID_A, slug: "project-entry" }), {
      at: w.store.clock.now,
    });
    writeReceived(
      w.store.ctx,
      remoteEntry(w, { uuid: UUID_B, slug: "shared-entry", scope: "shared" }),
      { at: w.store.clock.now },
    );
    const received = insertMemory(w.store.db, {
      projectId: 1,
      kind: "decision",
      title: "From Bob",
      body: "Bob's memory." as Redacted,
      terms: "",
      importance: 3,
      branch: null,
      commit: null,
      origin: "imported",
      judge: `team:${w.serverId}`,
      judgeVersion: "1",
      sourceTurnId: null,
      files: [],
      now: w.store.clock.now,
    });
    w.store.db.run(
      `INSERT INTO sharing_received_memories (memory_id, server_id, remote_uid, member_id, member_name, revision, hash, remote_kind, remote_importance, remote_status)
       VALUES (?, ?, 'remote:desk:a1b2c3d4:1', ?, 'Bob', 1, 'h', 'decision', 3, 'active')`,
      [received, w.serverId, BOB.id],
    );
    w.store.db.run(
      `INSERT INTO sharing_ledger (destination, item_kind, item_uid, direction, version, hash, policy_epoch, at)
       VALUES (?, 'memory', 'remote:desk:a1b2c3d4:1', 'received', 1, 'h', 0, 1)`,
      [w.serverId],
    );
    w.store.db.run(
      "INSERT INTO memory_vectors (memory_id, model, scale, vec) VALUES (?, 'm', 1.0, x'00')",
      [received],
    );
    // Another memory superseded by the received one goes back to active when it is deleted.
    const older = insertMemory(w.store.db, {
      projectId: 1,
      kind: "decision",
      title: "Older",
      body: "b" as Redacted,
      terms: "",
      importance: 3,
      branch: null,
      commit: null,
      origin: "distilled",
      judge: "heuristic",
      judgeVersion: "1",
      sourceTurnId: null,
      files: [],
      now: 1,
    });
    w.store.db.run("UPDATE memories SET status = 'superseded', superseded_by = ? WHERE id = ?", [
      received,
      older,
    ]);

    // An unbind of the alias: the project copies and memories go, the shared copy stays.
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
    expect(
      w.store.db.query<{ n: number }, []>("SELECT count(*) AS n FROM sharing_unbound").get()?.n,
    ).toBe(1);
    expect(reconcileReceived(w.store.ctx, w.serverId)).toEqual({ aliases: [ALIAS] });
    expect(receivedRows(w.store.db, w.serverId).map((r) => r.slug)).toEqual(["shared-entry"]);
    expect(
      w.store.db
        .query<{ n: number }, [number]>("SELECT count(*) AS n FROM memories WHERE id = ?")
        .get(received)?.n,
    ).toBe(0);
    expect(
      w.store.db
        .query<{ n: number }, [number]>(
          "SELECT count(*) AS n FROM memory_vectors WHERE memory_id = ?",
        )
        .get(received)?.n,
    ).toBe(0);
    expect(
      w.store.db
        .query<{ status: string; superseded_by: number | null }, [number]>(
          "SELECT status, superseded_by FROM memories WHERE id = ?",
        )
        .get(older),
    ).toEqual({ status: "active", superseded_by: null });
    expect(
      w.store.db.query<{ n: number }, []>("SELECT count(*) AS n FROM sharing_unbound").get()?.n,
    ).toBe(0);
    expect(readdirSync(join(receivedRoot(w.store.dataDir), w.serverId, "projects"))).toEqual([]);

    // A re-bind before the reconcile keeps the copies.
    writeReceived(w.store.ctx, remoteEntry(w, { uuid: UUID_A, slug: "project-entry" }), {
      at: w.store.clock.now,
    });
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
    expect(reconcileReceived(w.store.ctx, w.serverId)).toEqual({ aliases: [] });
    expect(receivedRows(w.store.db, w.serverId)).toHaveLength(2);

    // The whole server: everything of it gone.
    const gone = deleteServerReceived(w.store.ctx, w.serverId);
    expect(gone).toEqual({ rows: 2, memories: 0 });
    expect(receivedRows(w.store.db)).toEqual([]);
    expect(existsSync(join(receivedRoot(w.store.dataDir), w.serverId))).toBe(false);
    expect(ftsCount(w.store.db).rows).toBe(ftsCount(w.store.db).active);
    expect(
      w.store.db
        .query<{ n: number }, [string]>(
          "SELECT count(*) AS n FROM sharing_ledger WHERE destination = ? AND direction = 'received'",
        )
        .get(w.serverId)?.n,
    ).toBe(0);
  });

  test("compact keeps the shown rows of received entries; the session-start line counts open conflicts even with no pin", async () => {
    const w = await world();
    taxonomy(w);
    writeReceived(w.store.ctx, remoteEntry(w, { uuid: UUID_A, slug: "discovery-call-script" }), {
      at: w.store.clock.now,
    });
    expect(contribute(prompt(w, "the discovery call script for agency clients"))).not.toBeNull();
    expect(
      w.store.db
        .query<{ n: number }, []>("SELECT count(*) AS n FROM knowledge_shown WHERE repo_id = 0")
        .get()?.n,
    ).toBe(1);
    // The session is live: the row of repository 0 stays while its received entry does.
    const report = await compact(w.store.db, {
      now: w.store.clock.now + 86_400_000,
      dryRun: false,
    });
    expect(report.knowledgeShown).toBe(0);
    expect(
      w.store.db
        .query<{ n: number }, []>("SELECT count(*) AS n FROM knowledge_shown WHERE repo_id = 0")
        .get()?.n,
    ).toBe(1);
    // A conflicts row: the session-start block says so even with nothing pinned.
    writeConflict(w.store.ctx, w.serverId, `project:${ALIAS}:${UUID_A}`, {
      at: 1,
      localText: "t",
      localVersion: 1,
      localHash: "h",
      serverRevision: 2,
      serverHash: "s",
      proposalId: null,
    });
    expect(openConflictsCount(w.store.db)).toBe(1);
    const start = contribute({
      ...prompt(w, "x"),
      moment: "session-start",
      prompt: null,
      budgetChars: 840,
    });
    expect(start).toContain("1 open conflict with the team");
  });
});

/** A row of a table by its columns: every NOT NULL column without a default filled by type. */
function insertRow(db: World["store"]["db"], table: string, values: Record<string, unknown>): void {
  const columns = db
    .query<
      { name: string; type: string; notnull: number; dflt_value: string | null; pk: number },
      []
    >(`PRAGMA table_info(${table})`)
    .all();
  const row: Record<string, unknown> = {};
  for (const column of columns) {
    if (column.name in values) {
      row[column.name] = values[column.name];
      continue;
    }
    if (column.pk === 1 && /INT/i.test(column.type)) continue;
    if (column.notnull === 1 && column.dflt_value === null)
      row[column.name] = /INT|REAL|NUM/i.test(column.type) ? 0 : "x";
  }
  const names = Object.keys(row);
  db.run(
    `INSERT INTO ${table} (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")})`,
    names.map((name) => row[name]) as (string | number | null)[],
  );
}

/** The store's environment as a child process takes it: the defined values alone. */
const envOf = (w: World): Record<string, string> => ({
  ...Object.fromEntries(
    Object.entries(w.store.ctx.env).filter(
      (pair): pair is [string, string] => pair[1] !== undefined,
    ),
  ),
  // The data directory named outright: the child resolves its store from it.
  WIZARDINGCODE_MEM_DATA_DIR: w.store.dataDir,
});

describe("the received store's refusals and bounds (AC-75)", () => {
  test("knowledge write --pinned refuses a received reference; knowledge_get refuses a name two servers share", async () => {
    const w = await world();
    taxonomy(w);
    writeReceived(w.store.ctx, remoteEntry(w, { uuid: UUID_A, slug: "discovery-call-script" }), {
      at: w.store.clock.now,
    });
    const ref = `${w.serverId}:discovery-call-script--11111111`;
    const written = await runCliWith(
      { env: envOf(w) },
      "knowledge",
      "write",
      "--scope",
      "shared",
      "--title",
      "Taken over",
      "--kind",
      "strategy",
      "--area",
      "sales",
      "--slug",
      ref,
      "--pinned",
      "--body",
      "Mine now.",
    );
    expect(written.exitCode).toBe(EXIT_USAGE);
    expect(written.stderr).toContain("cannot be written or pinned");
    expect(receivedRows(w.store.db, w.serverId)).toHaveLength(1);
    // Two servers named alike: the name form is refused with both ids; the id form reads.
    insertPending(
      w.store.db,
      serverFixture("22222222aaaaaaaa", { url: "https://two.acme.test", name: "acme" }),
    );
    w.store.db.run("UPDATE sharing_servers SET confirmed_at = ?, name = 'acme'", [
      w.store.clock.now,
    ]);
    const byName = getKnowledge(
      w.knowledge,
      { projectId: 1 },
      { refs: [`acme:${ref.split(":")[1]}`] },
    );
    expect(byName).toContain("two servers are named acme");
    expect(byName).toContain(w.serverId);
    expect(byName).toContain("22222222aaaaaaaa");
    expect(getKnowledge(w.knowledge, { projectId: 1 }, { refs: [ref] })).toContain(
      "The teammate's discovery script body.",
    );
  });

  test("the largest chunk, 50 mixed rows on a project with 2,000 memories and 500 entries, holds each write transaction under 50 ms; a pulled entry is on disk within 5 s", async () => {
    const w = await world("all");
    taxonomy(w);
    const db = w.store.db;
    // The fixture: 2,000 memories and 500 index rows of the project's repository.
    const repo = openRepo(
      w.knowledge,
      { scope: "project", projectId: 1 },
      { create: personAuthor(w.knowledge) },
    );
    if (repo === null) throw new Error("no repository");
    db.transaction(() => {
      const insert = db.query(
        `INSERT INTO memories (project_id, kind, title, body, terms, importance, origin, judge, judge_version, created_at, updated_at)
         VALUES (1, 'decision', ?, ?, '', 3, 'distilled', 'heuristic', '1', ?, ?)`,
      );
      for (let i = 0; i < 2_000; i++)
        insert.run(`Memory ${i}`, `Body ${i}.`, w.store.clock.now - i, w.store.clock.now - i);
      for (let i = 0; i < 500; i++) {
        insertRow(db, "knowledge_entries", {
          id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
          repo_id: repo.id,
          slug: `entry-${i}`,
          path: `entries/entry-${i}.md`,
          title: `Entry ${i}`,
          kind: "knowledge",
          area: "sales",
          status: "active",
          body: `Body ${i}.`,
          hash: String(i).padStart(16, "0"),
          version: 1,
        });
      }
    })();
    // Bob's 50 rows: 25 entries and 25 memories, one page.
    const bob = await memberOf(w.t, w.token, "Bob", "desk");
    const items = [];
    for (let i = 0; i < 25; i++) {
      const entry = entryPayload({
        scope: "shared",
        slug: `shared-${i}`,
        title: `Shared ${i}`,
        area: "sales",
        body: `Shared body ${i}.`,
      });
      items.push({
        op: "send",
        kind: "entry",
        uid: entry.uid,
        baseRevision: 0,
        baseHash: "",
        payload: entry,
      });
      const theirs = memoryPayload({
        rowId: i + 1,
        remoteAlias: ALIAS,
        title: `Theirs ${i}`,
        body: `Their body ${i}.`,
      });
      items.push({
        op: "send",
        kind: "memory",
        uid: theirs.uid,
        baseRevision: 0,
        baseHash: "",
        payload: theirs,
      });
    }
    const pushed = await push(w.t.server, bob.token, items);
    expect(pushed.body.results.every((r: { result: string }) => r.result === "applied")).toBe(true);
    // Every write transaction of the apply timed from BEGIN IMMEDIATE to its end.
    let longest = 0;
    const realTransaction = db.transaction.bind(db);
    const timed = new Proxy(db, {
      get(target, prop) {
        if (prop !== "transaction") {
          const value = Reflect.get(target, prop, target);
          return typeof value === "function" ? value.bind(target) : value;
        }
        return (fn: (...args: unknown[]) => unknown) => {
          const tx = realTransaction(fn);
          const wrapped = (...args: unknown[]) => tx(...args);
          wrapped.immediate = (...args: unknown[]) => {
            const started = performance.now();
            try {
              return tx.immediate(...args);
            } finally {
              longest = Math.max(longest, performance.now() - started);
            }
          };
          wrapped.deferred = tx.deferred;
          wrapped.exclusive = tx.exclusive;
          return wrapped;
        };
      },
    });
    const ctx = { ...w.store.ctx, db: timed };
    const chunkStarted = performance.now();
    expect(await pullOnce(ctx, w.server(), { wait: false })).toMatchObject({
      ok: true,
      applied: 50,
    });
    const chunkMs = performance.now() - chunkStarted;
    expect(longest).toBeLessThan(50);
    expect(chunkMs).toBeLessThan(5_000);
    // One more entry, pulled with wait: on disk within 5 s, its hash the server's.
    const late = entryPayload({
      scope: "shared",
      slug: "late-one",
      title: "Late one",
      area: "sales",
      body: "Late body.",
    });
    await push(w.t.server, bob.token, [
      { op: "send", kind: "entry", uid: late.uid, baseRevision: 0, baseHash: "", payload: late },
    ]);
    const started = performance.now();
    expect(await pullOnce(ctx, w.server(), { wait: true })).toMatchObject({ ok: true, applied: 1 });
    expect(performance.now() - started).toBeLessThan(5_000);
    const row = receivedRow(db, w.serverId, late.uid);
    expect(row?.path).toMatch(/^[0-9a-f]{16}\/shared\/entries\/late-one--[0-9a-f]{8}\.md$/);
    const file = join(receivedRoot(w.store.dataDir), ...(row?.path ?? "").split("/"));
    expect(existsSync(file)).toBe(true);
    expect(hashOf(readFileSync(file))).toBe(late.hash);
  }, 60_000);
});

describe("the received copies and the person's commands (AC-87)", () => {
  test("knowledge rebuild keeps a received entry's search row; knowledge take through the CLI copies it under its uuid", async () => {
    const w = await world();
    taxonomy(w);
    writeReceived(
      w.store.ctx,
      remoteEntry(w, {
        uuid: UUID_B,
        slug: "shared-playbook",
        title: "Shared playbook",
        scope: "shared",
      }),
      { at: w.store.clock.now },
    );
    const ref = `${w.serverId}:shared-playbook--22222222`;
    const before = searchKnowledge(w.knowledge, { projectId: 1 }, { query: "shared playbook" });
    expect(before).toContain(ref);
    rebuildAll(w.knowledge);
    expect(receivedRows(w.store.db, w.serverId)).toHaveLength(1);
    expect(searchKnowledge(w.knowledge, { projectId: 1 }, { query: "shared playbook" })).toBe(
      before,
    );
    expect(ftsCount(w.store.db).rows).toBe(ftsCount(w.store.db).active);
    // The command: the reference resolved as knowledge_get resolves it, the copy under the uuid.
    const notFound = await runCliWith(
      { env: envOf(w) },
      "knowledge",
      "take",
      `${w.serverId}:shared-playbook--deadbeef`,
      "--scope",
      "shared",
    );
    expect(notFound.exitCode).toBe(1);
    expect(notFound.stderr).toContain("Not found");
    const taken = await runCliWith(
      { env: envOf(w) },
      "knowledge",
      "take",
      ref,
      "--scope",
      "shared",
    );
    expect(taken.stderr).toBe("");
    expect(taken.exitCode).toBe(0);
    expect(taken.stdout).toContain("taken shared-playbook (v1) from");
    const repo = openRepo(w.knowledge, { scope: "shared" });
    const file = join(repo?.path as string, "entries", "shared-playbook.md");
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, "utf8")).toContain(`id: ${UUID_B}`);
  }, 60_000);

  test("the floor renders a teammate's name through agentName: cut at 80 characters, control characters stripped", async () => {
    const w = await world();
    taxonomy(w);
    const name = `${"B".repeat(100)}\u0007 Bell`;
    writeReceived(
      w.store.ctx,
      remoteEntry(w, {
        uuid: UUID_A,
        slug: "discovery-call-script",
        member: { id: BOB.id, name },
      }),
      { at: w.store.clock.now },
    );
    const floor = contribute(prompt(w, "How do we run the discovery call with agency clients?"));
    expect(floor).not.toBeNull();
    expect(floor).toContain("via ");
    expect(floor).not.toContain("\u0007");
    // The cut is at 80 exactly: the eightieth B is there, the eighty-first is not.
    expect(floor).not.toContain("B".repeat(81));
    expect(floor).toContain("B".repeat(80));
    // The reference the line names is the one knowledge_get takes (the server by its id here).
    expect(floor).toContain(`${w.serverId}:discovery-call-script--11111111`);
  });

  test("a linked received/ root is refused by every reader and writer", async () => {
    const w = await world();
    taxonomy(w);
    const root = receivedRoot(w.store.dataDir);
    const away = `${root}.away`;
    mkdirSync(away, { recursive: true });
    symlinkSync(away, root);
    const entry = remoteEntry(w, { uuid: UUID_A, slug: "project-entry" });
    expect(() => writeReceived(w.store.ctx, entry, { at: w.store.clock.now })).toThrow(
      KnowledgeError,
    );
    expect(() => reindexReceived(w.store.ctx)).toThrow(KnowledgeError);
    expect(() => orphanServerIds(w.store.ctx)).toThrow(KnowledgeError);
    expect(receivedRows(w.store.db, w.serverId)).toEqual([]);
    rmSync(root);
  });
});
