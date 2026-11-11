// The sync writer in the knowledge store (ADR 0027, D-2 and D-8): a teammate's revision applied
// to an own file verbatim but for the local pin, under the member's name with the sync as
// committer, and the person's text kept as a proposal outside the quota.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { agentName, CONTROL } from "../../src/core/agent-name.ts";
import {
  agentWriter,
  authorOf,
  identityOf,
  personAuthor,
  syncCommitter,
} from "../../src/modules/knowledge/author.ts";
import { parseEntry, parseProposal, renderEntry } from "../../src/modules/knowledge/entry.ts";
import {
  ensureRepo,
  hashOf,
  type Intent,
  leaseKey,
  openRepo,
  reachedByFolders,
  readIntent,
  refuseLinkedRootsAt,
  stagePaths,
  writeIntent,
} from "../../src/modules/knowledge/repo.ts";
import {
  applyRevision,
  proposeConflict,
  readEntry,
  writeEntry,
} from "../../src/modules/knowledge/store.ts";
import type {
  EntryChange,
  KnowledgeEntry,
  KnowledgeStore,
  Repo,
  SyncWriter,
} from "../../src/modules/knowledge/types.ts";
import { setMeta } from "../../src/store/meta.ts";
import { codeOf, type Fixture, knowledgeFixture, thrown } from "../helpers/knowledge.ts";
import { realGit } from "../helpers/stub-git.ts";

const WORKSPACE = { scope: "workspace" } as const;
const NOW = Date.UTC(2026, 10, 10, 9, 0, 0);
const sync: SyncWriter = {
  kind: "sync",
  serverId: "srv1",
  serverName: "Team One",
  member: { id: "mem-7", name: "Bob" },
};
const UID = "workspace:11111111-2222-4333-8444-555555555555";

let fx: Fixture;
let store: KnowledgeStore;
beforeEach(() => {
  fx = knowledgeFixture("knowledge-sync-writer");
  store = fx.store({ now: () => NOW, env: { WIZARDINGCODE_MEM_AUTHOR: "Zoë" } });
});
afterEach(() => {
  fx.close();
});

const change = (over: Partial<EntryChange> = {}): EntryChange => ({
  title: "Discovery call script",
  kind: "strategy",
  area: "sales",
  context: "agency clients",
  subject: "discovery call",
  body: "The person's body.",
  ...over,
});
const SLUG = "discovery-call-script";
const person = () => personAuthor(store);
const workspace = (): Repo => openRepo(store, WORKSPACE) as Repo;
const entryFile = (repo: Repo, slug = SLUG) => join(repo.path, "entries", `${slug}.md`);
const log = (repo: Repo) => realGit(repo.path, "log", "-1", "--format=%an|%ae|%cn|%ce|%s").trim();
const status = (repo: Repo) =>
  realGit(repo.path, "status", "--porcelain", "--untracked-files=all").trimEnd();

function written(result: ReturnType<typeof writeEntry>): KnowledgeEntry {
  if (result.kind !== "written") throw new Error("expected a written entry");
  return result.entry;
}

/** The server's text of a teammate's revision: the entry rendered as the server holds it. */
const revision = (entry: KnowledgeEntry, over: Partial<KnowledgeEntry> = {}) =>
  renderEntry({
    ...entry,
    version: entry.version + 1,
    author: "Bob",
    updated: "2026-11-10T10:00:00Z",
    body: "The teammate's body.",
    pinned: false,
    ...over,
  });

const entryRow = (repo: Repo, slug = SLUG) =>
  fx.db
    .query<{ version: number; hash: string; author: string; body: string }, [number, string]>(
      "SELECT version, hash, author, body FROM knowledge_entries WHERE repo_id = ? AND slug = ?",
    )
    .get(repo.id, slug);

describe("the sync writer's identities", () => {
  test("the member is the author, the sync the committer, sync:<serverId> the proposer", () => {
    expect(identityOf(sync)).toEqual({ name: "Bob", email: "mem-7@members.wizardingcode.invalid" });
    expect(syncCommitter(sync)).toEqual({
      name: "wizardingcode-mem sync",
      email: "sync@srv1.wizardingcode.invalid",
    });
    expect(authorOf(sync)).toBe("sync:srv1");
    expect(authorOf(agentWriter("claude-code"))).toBe("agent:claude-code");
  });

  test("agentName strips control characters and clips at 80", () => {
    expect(agentName("Bob\u0000\u001f Smith\u007f")).toBe("Bob Smith");
    expect(agentName(`${"a".repeat(100)}`)).toHaveLength(80);
    expect(agentName("  spaced  ")).toBe("spaced");
    expect("a\nb".replace(CONTROL, "?")).toBe("a?b");
  });

  test("writeEntry refuses the sync writer", () => {
    const call = () => writeEntry(store, WORKSPACE, change(), sync);
    expect(codeOf(call)).toBe("invalid");
    expect(thrown(call).message).toContain("sync");
    expect(existsSync(join(fx.dataDir, "knowledge"))).toBe(false);
  });
});

describe("applyRevision", () => {
  test("writes the text verbatim when the entry has no pin, under the member with the sync as committer", () => {
    const entry = written(writeEntry(store, WORKSPACE, change(), person()));
    const repo = workspace();
    const text = revision(entry);
    const result = applyRevision(store, WORKSPACE, entry.id, text, sync, {
      uid: UID,
      revision: 4,
    });
    expect(readFileSync(entryFile(repo), "utf8")).toBe(text);
    expect(result).toEqual({ version: 2, hash: hashOf(Buffer.from(text)) });
    expect(log(repo)).toBe(
      `Bob|mem-7@members.wizardingcode.invalid|wizardingcode-mem sync|sync@srv1.wizardingcode.invalid|sync: apply ${UID} revision 4 from Team One`,
    );
    expect(status(repo)).toBe("");
    expect(readIntent(repo)).toBeNull();
    expect(entryRow(repo)).toEqual({
      version: 2,
      hash: result.hash,
      author: "Bob",
      body: "The teammate's body.",
    });
    expect(readEntry(store, WORKSPACE, SLUG)?.version).toBe(2);
  });

  test("keeps the local pinned line when the text has none, and drops a text's pin when the file had none", () => {
    const pinned = written(writeEntry(store, WORKSPACE, change({ pinned: true }), person()));
    const repo = workspace();
    const text = revision(pinned);
    expect(text).not.toContain("pinned:");
    const result = applyRevision(store, WORKSPACE, pinned.id, text, sync, {
      uid: UID,
      revision: 2,
    });
    const after = readFileSync(entryFile(repo), "utf8");
    expect(after).toContain("\npinned: true\n---\n");
    expect(after.replace("pinned: true\n", "")).toBe(text);
    expect(parseEntry(after, SLUG, null).pinned).toBe(true);
    expect(result.hash).toBe(hashOf(Buffer.from(after)));
    expect(result.hash).not.toBe(hashOf(Buffer.from(text)));

    const plain = written(
      writeEntry(store, WORKSPACE, change({ title: "Plain entry", slug: "plain" }), person()),
    );
    const pinningText = revision(plain, { pinned: true });
    expect(pinningText).toContain("pinned: true");
    applyRevision(store, WORKSPACE, plain.id, pinningText, sync, {
      uid: "workspace:x",
      revision: 2,
    });
    const plainAfter = readFileSync(entryFile(repo, "plain"), "utf8");
    expect(plainAfter).not.toContain("pinned");
    expect(plainAfter).toBe(pinningText.replace("pinned: true\n", ""));
    expect(parseEntry(plainAfter, "plain", null).pinned).toBe(false);
  });

  test("an interrupted apply is put back by its intent record", () => {
    const entry = written(writeEntry(store, WORKSPACE, change(), person()));
    const repo = workspace();
    const before = readFileSync(entryFile(repo), "utf8");
    const half = revision(entry);
    writeFileSync(entryFile(repo), half);
    stagePaths(store, repo, ["entries/discovery-call-script.md"], "apply");
    const intent: Intent = {
      operation: "apply",
      writer: sync,
      existed: ["entries/discovery-call-script.md"],
      created: [],
      written: { "entries/discovery-call-script.md": hashOf(Buffer.from(half)) },
    };
    writeIntent(repo, intent);
    expect(readIntent(repo)).toEqual(intent);
    openRepo(store, WORKSPACE);
    expect(readFileSync(entryFile(repo), "utf8")).toBe(before);
    expect(status(repo)).toBe("");
    expect(readIntent(repo)).toBeNull();
  });

  test("throws locked while another live process holds the repository's lease, and missing for an unknown id", () => {
    const entry = written(writeEntry(store, WORKSPACE, change(), person()));
    setMeta(
      fx.db,
      leaseKey("knowledge/workspace"),
      JSON.stringify({ owner: `${process.pid}-other`, until: NOW + 60_000 }),
    );
    const call = () =>
      applyRevision(store, WORKSPACE, entry.id, revision(entry), sync, {
        uid: UID,
        revision: 2,
      });
    expect(codeOf(call)).toBe("locked");
    fx.db.run("DELETE FROM meta WHERE key = ?", [leaseKey("knowledge/workspace")]);
    const unknown = () =>
      applyRevision(store, WORKSPACE, "11111111-2222-4333-8444-555555555555", "x", sync, {
        uid: UID,
        revision: 2,
      });
    expect(codeOf(unknown)).toBe("missing");
    const byHand = () =>
      applyRevision(store, WORKSPACE, entry.id, revision(entry), person(), {
        uid: UID,
        revision: 2,
      });
    expect(codeOf(byHand)).toBe("invalid");
  });
});

describe("proposeConflict", () => {
  test("keeps the person's text as a proposal by sync:<serverId> on their behalf, committed under their identity", () => {
    const entry = written(writeEntry(store, WORKSPACE, change(), person()));
    const repo = workspace();
    const local = readFileSync(entryFile(repo), "utf8");
    const text = revision(entry);
    const applied = applyRevision(store, WORKSPACE, entry.id, text, sync, {
      uid: UID,
      revision: 2,
    });
    const { id } = proposeConflict(store, WORKSPACE, entry.id, local, sync, applied);
    const file = join(repo.path, "proposals", "open", `${id}.md`);
    expect(existsSync(file)).toBe(true);
    const proposal = parseProposal(readFileSync(file, "utf8"), `${id}.md`, null);
    expect(proposal).toMatchObject({
      id,
      entryId: entry.id,
      slug: SLUG,
      baseVersion: 2,
      baseHash: applied.hash,
      proposedBy: "sync:srv1",
      onBehalfOf: "Zoë",
      title: "Discovery call script",
      body: "The person's body.",
      decision: null,
    });
    expect(log(repo)).toBe(
      `Zoë|${identityOf(person()).email}|wizardingcode-mem sync|sync@srv1.wizardingcode.invalid|knowledge: propose ${id} for ${SLUG}`,
    );
    expect(readIntent(repo)).toBeNull();
    const row = fx.db
      .query<{ state: string; proposed_by: string; on_behalf_of: string }, [string]>(
        "SELECT state, proposed_by, on_behalf_of FROM knowledge_proposals WHERE id = ?",
      )
      .get(id);
    expect(row).toEqual({ state: "open", proposed_by: "sync:srv1", on_behalf_of: "Zoë" });
  });

  test("drops the pinned line, redacts, and is written as the 6th open proposal", () => {
    const entry = written(writeEntry(store, WORKSPACE, change({ pinned: true }), person()));
    const repo = workspace();
    const key = ["AKIA", "A1B2C3D4", "E5F6G7H8"].join("");
    const local = readFileSync(entryFile(repo), "utf8").replace(
      "The person's body.",
      `The person's body with ${key}.`,
    );
    expect(local).toContain("pinned: true");
    const applied = applyRevision(store, WORKSPACE, entry.id, revision(entry), sync, {
      uid: UID,
      revision: 2,
    });
    // Five agent proposals fill the quota for the entry.
    const agent = agentWriter("claude-code");
    for (let i = 0; i < 5; i++) {
      const result = writeEntry(
        store,
        WORKSPACE,
        change({ slug: SLUG, baseVersion: 2, body: `agent ${i}` }),
        agent,
      );
      expect(result.kind).toBe("proposed");
    }
    const sixth = () =>
      writeEntry(store, WORKSPACE, change({ slug: SLUG, baseVersion: 2, body: "agent 6" }), agent);
    expect(codeOf(sixth)).toBe("quota");
    const { id } = proposeConflict(store, WORKSPACE, entry.id, local, sync, applied);
    const text = readFileSync(join(repo.path, "proposals", "open", `${id}.md`), "utf8");
    expect(text).not.toContain("pinned");
    expect(text).not.toContain(key);
    expect(text).toContain("The person's body with");
    const open = fx.db
      .query<{ n: number }, [number]>(
        "SELECT count(*) AS n FROM knowledge_proposals WHERE repo_id = ? AND state = 'open'",
      )
      .get(repo.id);
    expect(open?.n).toBe(6);
  });

  test("refuses a person as the writer and a base the file has moved past", () => {
    const entry = written(writeEntry(store, WORKSPACE, change(), person()));
    const repo = workspace();
    const local = readFileSync(entryFile(repo), "utf8");
    const applied = applyRevision(store, WORKSPACE, entry.id, revision(entry), sync, {
      uid: UID,
      revision: 2,
    });
    expect(
      codeOf(() => proposeConflict(store, WORKSPACE, entry.id, local, person(), applied)),
    ).toBe("invalid");
    expect(
      codeOf(() =>
        proposeConflict(store, WORKSPACE, entry.id, local, sync, { version: 1, hash: "x" }),
      ),
    ).toBe("stale");
  });
});

describe("the repository helpers the received tree needs", () => {
  test("reachedByFolders and refuseLinkedRootsAt", () => {
    const repo = ensureRepo(store, WORKSPACE);
    expect(reachedByFolders(repo.path, "entries/a.md")).toBe(true);
    writeFileSync(join(repo.path, "not-a-folder"), "");
    expect(reachedByFolders(repo.path, "not-a-folder/a.md")).toBe(false);
    expect(() => refuseLinkedRootsAt(join(fx.dataDir, "knowledge", "received"))).not.toThrow();
    writeFileSync(join(fx.dataDir, "knowledge", "received"), "");
    expect(codeOf(() => refuseLinkedRootsAt(join(fx.dataDir, "knowledge", "received")))).toBe(
      "invalid",
    );
  });
});
