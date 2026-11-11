// Conflicts (ADR 0027, D-2 and D-8): a teammate's revision of an own entry applied verbatim
// but for the pin, the ledger moved, the person's in-flight text kept as a proposal with a
// conflicts row, the rows closed by a decision or at the sync's start.
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { personAuthor } from "../../src/modules/knowledge/author.ts";
import { hashOf, openRepo } from "../../src/modules/knowledge/repo.ts";
import { acceptProposal, rejectProposal, writeEntry } from "../../src/modules/knowledge/store.ts";
import { setServerLists } from "../../src/sharing/store.ts";
import { applyOwnRevision, closeConflict, closeOrphanConflicts } from "../../src/sync/conflicts.ts";
import { pullOnce } from "../../src/sync/inbound.ts";
import { confirmJoin, joinServer } from "../../src/sync/join.ts";
import { appliedRow, openConflictCount, openConflicts, sentRow } from "../../src/sync/ledger.ts";
import { sweep } from "../../src/sync/outbound.ts";
import { serverById } from "../../src/sync/servers.ts";
import { entryBytes } from "../../src/team/contract.ts";
import { realGit } from "../helpers/stub-git.ts";
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
import { memberOf, push, startTestServer, type TestServer } from "../helpers/team.ts";

const extraServers: TestServer[] = [];
afterEach(async () => {
  for (const t of extraServers.splice(0)) await t.close();
  await closeWorlds();
});
afterAll(() => cleanWorlds());

const ref = { scope: "project", projectId: 1 } as const;

interface FeedEntry {
  uid: string;
  revision: number;
  hash: string;
  payload: { frontmatter: string; body: string };
  member: { id: string; name: string };
}

/** The own entry written, swept to the server, and a teammate joined. */
async function shared(w: World, over: Parameters<typeof change>[0] = {}) {
  taxonomy(w);
  const written = writeEntry(w.knowledge, ref, change(over), personAuthor(w.knowledge));
  if (written.kind !== "written") throw new Error("not written");
  expect(await sweep(w.store.ctx, w.server(), { full: true })).toMatchObject({ sent: 1 });
  const bob = await memberOf(w.t, w.token, "Bob", "desk");
  const uid = `project:${ALIAS}:${written.entry.id}`;
  return { written, bob, uid };
}

/** Bob's revision of the entry on the server: the body replaced, pushed on the current base. */
async function bobRevises(w: World, bobToken: string, uid: string, body: string, pinned = false) {
  const current = (await feed(w)).items.find(
    (item) => (item as FeedEntry).uid === uid,
  ) as FeedEntry;
  // Bob's store wrote the next version into the frontmatter, as every client does.
  const lines = current.payload.frontmatter
    .split("\n")
    .map((line) => (line.startsWith("version: ") ? `version: ${Number(line.slice(9)) + 1}` : line));
  if (pinned) lines.splice(lines.length - 2, 0, "pinned: true");
  const payload = {
    kind: "entry",
    uid,
    scope: "project",
    slug: "discovery-call-script",
    remoteAlias: ALIAS,
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
  const revised = (await feed(w)).items.find(
    (item) =>
      (item as FeedEntry).uid === uid && (item as FeedEntry).revision === current.revision + 1,
  ) as FeedEntry;
  return {
    uid,
    revision: revised.revision,
    hash: revised.hash,
    text: revised.payload.frontmatter + revised.payload.body,
    member: revised.member,
  };
}

const fileOf = (w: World) => {
  const repo = openRepo(w.knowledge, ref);
  if (repo === null) throw new Error("no repository");
  return join(repo.path, "entries", "discovery-call-script.md");
};

describe("a teammate's revision", () => {
  test("is applied verbatim, the ledger moved, the file's hash the server's, nothing sent next, and the commit the member's with the sync as committer", async () => {
    const w = await world();
    const { bob, uid } = await shared(w);
    const remote = await bobRevises(w, bob.token, uid, "Bob's body.");
    const outcome = applyOwnRevision(w.store.ctx, w.server(), remote, w.knowledge);
    expect(outcome).toMatchObject({ kind: "applied", version: 2, hash: remote.hash });
    expect(readFileSync(fileOf(w), "utf8")).toBe(remote.text);
    expect(sentRow(w.store.db, w.serverId, "entry", uid)).toMatchObject({
      version: 2,
      hash: remote.hash,
      localHash: remote.hash,
    });
    expect(appliedRow(w.store.db, w.serverId, uid)).toMatchObject({
      version: 2,
      hash: remote.hash,
      localHash: remote.hash,
    });
    const repo = openRepo(w.knowledge, ref);
    expect(realGit(repo?.path as string, "log", "-1", "--format=%an|%cn|%s").trim()).toBe(
      `Bob|wizardingcode-mem sync|sync: apply ${uid} revision 2 from ${w.server().name}`,
    );
    w.store.clock.advance(60_000);
    expect(await sweep(w.store.ctx, w.server(), { full: true })).toMatchObject({ sent: 0 });
    // The feed shows the current row of the uid: Bob's revision, nothing of ours after it.
    expect((await feed(w)).items.filter((item) => (item as FeedEntry).uid === uid)).toMatchObject([
      { revision: 2 },
    ]);
    // An echo of what this machine holds is skipped; a revision of an entry not its own too.
    expect(applyOwnRevision(w.store.ctx, w.server(), remote, w.knowledge)).toEqual({
      kind: "skipped",
      why: "echo",
    });
    expect(
      applyOwnRevision(
        w.store.ctx,
        w.server(),
        { ...remote, uid: "workspace:11111111-2222-4333-8444-555555555555" },
        w.knowledge,
      ),
    ).toEqual({ kind: "skipped", why: "not-own" });
  });

  test("arrives through the pull: applied to the file, the applied row written; with an edit committed by hand before the index refreshed, the file's hash decides and it is a conflict", async () => {
    const w = await world();
    const { bob, uid } = await shared(w);
    const remote = await bobRevises(w, bob.token, uid, "Bob's body.");
    expect(await pullOnce(w.store.ctx, w.server(), { wait: false })).toMatchObject({
      ok: true,
      applied: 1,
    });
    expect(readFileSync(fileOf(w), "utf8")).toBe(remote.text);
    expect(appliedRow(w.store.db, w.serverId, uid)).toMatchObject({ version: 2 });
    expect(openConflictCount(w.store.db, w.serverId)).toBe(0);
    // The person edits in their editor and commits by hand: the index still holds the old
    // hash, the file does not. Bob's next revision must not overwrite that edit silently.
    const file = fileOf(w);
    writeFileSync(file, readFileSync(file, "utf8").replace("Bob's body.", "Ana by hand."));
    const repo = openRepo(w.knowledge, ref);
    commitByHand(repo?.path as string, "by hand");
    await bobRevises(w, bob.token, uid, "Bob's third body.");
    expect(await pullOnce(w.store.ctx, w.server(), { wait: false })).toMatchObject({
      ok: true,
      applied: 1,
    });
    expect(readFileSync(file, "utf8")).toContain("Bob's third body.");
    expect(openConflictCount(w.store.db, w.serverId)).toBe(1);
    expect(openConflicts(w.store.db, w.serverId)[0]?.localText).toContain("Ana by hand.");
  });

  test("keeps the local pin and ignores a pin the revision adds; a teammate's revert to a once-sent text is their revision", async () => {
    const w = await world();
    const { bob, uid } = await shared(w, { pinned: true });
    const remote = await bobRevises(w, bob.token, uid, "Bob's body.");
    expect(applyOwnRevision(w.store.ctx, w.server(), remote, w.knowledge)).toMatchObject({
      kind: "applied",
    });
    const after = readFileSync(fileOf(w), "utf8");
    expect(after).toContain("pinned: true");
    expect(after).not.toBe(remote.text);
    w.store.clock.advance(60_000);
    expect(await sweep(w.store.ctx, w.server(), { full: true })).toMatchObject({ sent: 0 });
    // The person's edit after the apply is sent on the teammate's revision, no conflict.
    writeEntry(
      w.knowledge,
      ref,
      change({ slug: "discovery-call-script", baseVersion: 2, body: "Ana again.", pinned: true }),
      personAuthor(w.knowledge),
    );
    w.store.clock.advance(60_000);
    expect(await sweep(w.store.ctx, w.server(), { full: true })).toMatchObject({ sent: 1 });
    const items = (await feed(w)).items.filter(
      (item) => (item as FeedEntry).uid === uid,
    ) as FeedEntry[];
    expect(items.at(-1)?.revision).toBe(3);
    expect(openConflictCount(w.store.db, w.serverId)).toBe(0);
    // Bob reverts to the once-sent first text: a revision of his, applied, not a rollback.
    const revert = await bobRevises(w, bob.token, uid, "The body.", false);
    expect(applyOwnRevision(w.store.ctx, w.server(), revert, w.knowledge)).toMatchObject({
      kind: "applied",
      version: 4,
    });
    expect(sentRow(w.store.db, w.serverId, "entry", uid)?.version).toBe(4);
  });

  test("a local edit in flight becomes a proposal on the new base with a conflicts row; two conflicts keep both texts; accept and reject close the rows", async () => {
    const w = await world();
    const { bob, uid, written } = await shared(w);
    // The person's edit, committed here, not yet swept.
    writeEntry(
      w.knowledge,
      ref,
      change({ slug: "discovery-call-script", baseVersion: 1, body: "Ana's second body." }),
      personAuthor(w.knowledge),
    );
    const remote = await bobRevises(w, bob.token, uid, "Bob's body.");
    const outcome = applyOwnRevision(w.store.ctx, w.server(), remote, w.knowledge);
    expect(outcome).toMatchObject({ kind: "conflict", version: 2 });
    if (outcome.kind !== "conflict") throw new Error("unreachable");
    expect(readFileSync(fileOf(w), "utf8")).toBe(remote.text);
    const conflicts = openConflicts(w.store.db, w.serverId);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      itemUid: uid,
      localVersion: 2,
      serverRevision: 2,
      serverHash: remote.hash,
      proposalId: outcome.proposalId,
    });
    expect(conflicts[0]?.localText).toContain("Ana's second body.");
    const repo = openRepo(w.knowledge, ref);
    expect(realGit(repo?.path as string, "log", "-1", "--format=%an|%cn").trim()).toBe(
      "Ana|wizardingcode-mem sync",
    );
    const proposal = w.store.db
      .query<
        { state: string; proposed_by: string; on_behalf_of: string; base_version: number },
        [string]
      >(
        "SELECT state, proposed_by, on_behalf_of, base_version FROM knowledge_proposals WHERE id = ?",
      )
      .get(outcome.proposalId);
    expect(proposal).toEqual({
      state: "open",
      proposed_by: `sync:${w.serverId}`,
      on_behalf_of: "Ana",
      base_version: 2,
    });
    // A second conflict on the same entry: another local edit, another revision of Bob's.
    writeEntry(
      w.knowledge,
      ref,
      change({ slug: "discovery-call-script", baseVersion: 2, body: "Ana's third body." }),
      personAuthor(w.knowledge),
    );
    w.store.clock.advance(1_000);
    const second = await bobRevises(w, bob.token, uid, "Bob again.");
    const again = applyOwnRevision(w.store.ctx, w.server(), second, w.knowledge);
    expect(again).toMatchObject({ kind: "conflict", version: 3 });
    expect(openConflicts(w.store.db, w.serverId)).toHaveLength(2);
    expect(openConflictCount(w.store.db, w.serverId)).toBe(2);
    // The first proposal's base (version 2) is behind the file (version 3): the person rejects
    // it; the row closes. The second, on the current base, is accepted: a new version, sent by
    // the next sweep; its row closes.
    if (again.kind !== "conflict") throw new Error("unreachable");
    rejectProposal(w.knowledge, ref, outcome.proposalId, personAuthor(w.knowledge));
    expect(closeConflict(w.store.db, outcome.proposalId, w.store.clock.now)).toBe(1);
    expect(openConflictCount(w.store.db, w.serverId)).toBe(1);
    const accepted = acceptProposal(w.knowledge, ref, again.proposalId, personAuthor(w.knowledge));
    expect(accepted.body).toContain("Ana's third body.");
    expect(accepted.version).toBe(4);
    expect(closeConflict(w.store.db, again.proposalId, w.store.clock.now)).toBe(1);
    expect(openConflictCount(w.store.db, w.serverId)).toBe(0);
    w.store.clock.advance(60_000);
    expect(await sweep(w.store.ctx, w.server(), { full: true })).toMatchObject({ sent: 1 });
    const items = (await feed(w)).items.filter(
      (item) => (item as FeedEntry).uid === uid,
    ) as FeedEntry[];
    expect(items.at(-1)?.revision).toBe(4);
    expect(items.at(-1)?.payload.body).toContain("Ana's third body.");
    expect(written.entry.id).toBeDefined();
  });

  test("closeOrphanConflicts closes a row whose proposal was decided without its close, or is gone", async () => {
    const w = await world();
    const { bob, uid } = await shared(w);
    writeEntry(
      w.knowledge,
      ref,
      change({ slug: "discovery-call-script", baseVersion: 1, body: "In flight." }),
      personAuthor(w.knowledge),
    );
    const remote = await bobRevises(w, bob.token, uid, "Bob's body.");
    const outcome = applyOwnRevision(w.store.ctx, w.server(), remote, w.knowledge);
    if (outcome.kind !== "conflict") throw new Error("expected a conflict");
    expect(closeOrphanConflicts(w.store.ctx, w.serverId)).toBe(0);
    rejectProposal(w.knowledge, ref, outcome.proposalId, personAuthor(w.knowledge));
    // The close was lost: the start closes it.
    expect(openConflictCount(w.store.db, w.serverId)).toBe(1);
    expect(closeOrphanConflicts(w.store.ctx, w.serverId)).toBe(1);
    expect(openConflictCount(w.store.db, w.serverId)).toBe(0);
    // A row whose proposal is gone from the index.
    w.store.db.run(
      `INSERT INTO sharing_conflicts (destination, item_uid, at, local_text, local_version, local_hash, server_revision, server_hash, proposal_id)
       VALUES (?, ?, 5, 't', 1, 'h', 2, 'sh', 'gone-proposal')`,
      [w.serverId, uid],
    );
    expect(closeOrphanConflicts(w.store.ctx)).toBe(1);
    expect(openConflictCount(w.store.db, w.serverId)).toBe(0);
  });

  test("an own workspace entry on two servers: revised on one, still sent to the other", async () => {
    const w = await world();
    taxonomy(w);
    const t2 = await startTestServer({}, { clock: w.store.clock, timers: w.store.timers });
    extraServers.push(t2);
    const second = await joinServer(w.store.ctx, {
      url: t2.server.origin,
      code: t2.code,
      label: "laptop",
      name: "Ana",
    });
    if (!second.ok) throw new Error(second.message);
    confirmJoin(w.store.ctx, second.serverId);
    setServerLists(
      w.store.db,
      second.serverId,
      { roots: ["workspace"], areas: ["workspace:sales"] },
      { source: "cli", now: w.store.clock.now, confirm: true },
    );
    const written = writeEntry(
      w.knowledge,
      { scope: "workspace" },
      change(),
      personAuthor(w.knowledge),
    );
    if (written.kind !== "written") throw new Error("not written");
    const uid = `workspace:${written.entry.id}`;
    const serverB = () =>
      serverById(w.store.db, second.serverId) as NonNullable<ReturnType<typeof serverById>>;
    expect(await sweep(w.store.ctx, w.server(), { full: true })).toMatchObject({ sent: 1 });
    expect(await sweep(w.store.ctx, serverB(), { full: true })).toMatchObject({ sent: 1 });
    // A teammate on the first server revises it; applied here; the second server gets it next.
    const bob = await memberOf(w.t, w.token, "Bob", "desk");
    const current = (await feed(w)).items.find(
      (item) => (item as FeedEntry).uid === uid,
    ) as FeedEntry;
    const payload = {
      kind: "entry",
      uid,
      scope: "workspace",
      slug: "discovery-call-script",
      remoteAlias: null,
      frontmatter: current.payload.frontmatter.replace("version: 1", "version: 2"),
      body: "Bob's workspace body.\n",
      version: 2,
      hash: "",
    };
    payload.hash = hashOf(entryBytes(payload as Parameters<typeof entryBytes>[0]));
    const answer = await push(w.t.server, bob.token, [
      {
        op: "send",
        kind: "entry",
        uid,
        baseRevision: current.revision,
        baseHash: current.hash,
        payload,
      },
    ]);
    // A workspace entry belongs to its creator: Bob's push is refused on the server, so the
    // revision comes from the admin's second device instead.
    expect(answer.body.results[0].result).toBe("refused");
    const own = await push(w.t.server, w.token, [
      {
        op: "send",
        kind: "entry",
        uid,
        baseRevision: current.revision,
        baseHash: current.hash,
        payload,
      },
    ]);
    expect(own.body.results[0].result).toBe("applied");
    const revised = (await feed(w)).items.find(
      (item) => (item as FeedEntry).uid === uid && (item as FeedEntry).revision === 2,
    ) as FeedEntry;
    const outcome = applyOwnRevision(
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
    expect(outcome).toMatchObject({ kind: "applied", version: 2 });
    w.store.clock.advance(60_000);
    expect(await sweep(w.store.ctx, w.server(), { full: true })).toMatchObject({ sent: 0 });
    expect(await sweep(w.store.ctx, serverB(), { full: true })).toMatchObject({ sent: 1 });
    const onB = await feed({
      ...w,
      t: t2,
      token: (await import("../../src/sync/servers.ts")).readTokens(w.store.dataDir)[
        second.serverId
      ] as string,
    });
    expect(
      (onB.items.filter((item) => (item as FeedEntry).uid === uid).at(-1) as FeedEntry).payload
        .body,
    ).toContain("Bob's workspace body.");
  });
});
