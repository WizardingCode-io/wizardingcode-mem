import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { redact } from "../../src/core/redact.ts";
import { agentWriter, identityOf, personAuthor } from "../../src/modules/knowledge/author.ts";
import {
  nowIso,
  parseEntry,
  parseProposal,
  slugify,
  UUID,
} from "../../src/modules/knowledge/entry.ts";
import { ModuleSchemaTooNewError } from "../../src/modules/knowledge/errors.ts";
import { fileHash, rebuildRepo } from "../../src/modules/knowledge/index-store.ts";
import {
  ensureRepo,
  headOf,
  leaseKey,
  openRepo,
  readIntent,
  readManifest,
} from "../../src/modules/knowledge/repo.ts";
import {
  acceptProposal,
  readEntry,
  rejectProposal,
  writeEntry,
} from "../../src/modules/knowledge/store.ts";
import type {
  EntryChange,
  KnowledgeEntry,
  KnowledgeProposal,
  KnowledgeStore,
  Repo,
} from "../../src/modules/knowledge/types.ts";
import { setMeta } from "../../src/store/meta.ts";
import { codeOf, type Fixture, knowledgeFixture, thrown } from "../helpers/knowledge.ts";
import { realGit, stubGit } from "../helpers/stub-git.ts";

const WORKSPACE = { scope: "workspace" } as const;
const agent = agentWriter("claude-code");
const NOW = Date.UTC(2026, 10, 9, 8, 0, 0);

let fx: Fixture;
let store: KnowledgeStore;
let clock: number;
beforeEach(() => {
  fx = knowledgeFixture("knowledge-store");
  clock = NOW;
  store = fx.store({ now: () => clock, env: { WIZARDINGCODE_MEM_AUTHOR: "Zoë" } });
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
  body: "The body.",
  ...over,
});

const SLUG = "discovery-call-script";
const person = () => personAuthor(store);
/** A text with the shape of a key, put together at run time: no key-shaped text sits in this file. */
const fakeAwsKey = () => ["AKIA", "A1B2C3D4", "E5F6G7H8"].join("");

function written(result: ReturnType<typeof writeEntry>): KnowledgeEntry {
  if (result.kind !== "written") throw new Error("expected a written entry");
  return result.entry;
}
function proposed(result: ReturnType<typeof writeEntry>): KnowledgeProposal {
  if (result.kind !== "proposed") throw new Error("expected a proposal");
  return result.proposal;
}

const workspace = (): Repo => openRepo(store, WORKSPACE) as Repo;
const entryFile = (repo: Repo, slug = SLUG) => join(repo.path, "entries", `${slug}.md`);
const openFile = (repo: Repo, id: string) => join(repo.path, "proposals", "open", `${id}.md`);
const decidedFile = (repo: Repo, id: string) => join(repo.path, "proposals", "decided", `${id}.md`);
const commits = (repo: Repo) => Number(realGit(repo.path, "rev-list", "--count", "HEAD").trim());
const status = (repo: Repo) => realGit(repo.path, "status", "--porcelain", "--untracked-files=all");

interface EntryRow {
  id: string;
  slug: string;
  path: string;
  title: string;
  version: number;
  author: string;
  status: string;
  body: string;
  problem: string | null;
  hash: string;
}
const entryRow = (repo: Repo, slug = SLUG) =>
  fx.db
    .query<EntryRow, [number, string]>(
      "SELECT id, slug, path, title, version, author, status, body, problem, hash FROM knowledge_entries WHERE repo_id = ? AND slug = ?",
    )
    .get(repo.id, slug);

interface ProposalRow {
  id: string;
  path: string;
  state: string;
  entry_id: string;
  slug: string;
  base_version: number;
  base_hash: string;
  proposed_by: string;
  decided_by: string | null;
  decided_version: number | null;
  title: string;
  context: string;
  body: string;
}
const proposalRow = (repo: Repo, id: string) =>
  fx.db
    .query<ProposalRow, [number, string]>(
      "SELECT id, path, state, entry_id, slug, base_version, base_hash, proposed_by, decided_by, decided_version, title, context, body FROM knowledge_proposals WHERE repo_id = ? AND id = ?",
    )
    .get(repo.id, id);

const repoRow = (repo: Repo) =>
  fx.db
    .query<{ head: string | null; fingerprint: string | null }, [number]>(
      "SELECT head, fingerprint FROM knowledge_repos WHERE id = ?",
    )
    .get(repo.id);

/** Everything a failed operation must leave as it was. */
const snapshot = (repo: Repo) => ({
  commits: commits(repo),
  head: repoRow(repo),
  entries: fx.db.query("SELECT * FROM knowledge_entries ORDER BY slug").all(),
  proposals: fx.db.query("SELECT * FROM knowledge_proposals ORDER BY id").all(),
});

/** A store whose first `git commit` fails. */
const failingCommit = (name: string) =>
  fx.store({
    now: () => clock,
    env: {
      WIZARDINGCODE_MEM_AUTHOR: "Zoë",
      PATH: fx.pathWith(stubGit(join(fx.dir, name), { failOnce: "commit", stderr: "fatal: boom" })),
    },
  });

/** Commits a hand edit with the real git, so the tree is clean and the content is not the engine's. */
function commitByHand(repo: Repo, path: string): void {
  realGit(repo.path, "add", "--", path);
  realGit(
    repo.path,
    "-c",
    "user.name=Hand",
    "-c",
    "user.email=hand@example.invalid",
    "commit",
    "-q",
    "-m",
    "by hand",
    "--",
    path,
  );
}

describe("a person's write", () => {
  test("a new entry is a file at version 1, one commit by path, and an index row", () => {
    const entry = written(writeEntry(store, WORKSPACE, change(), person()));
    const repo = workspace();
    expect(entry).toMatchObject({
      slug: SLUG,
      title: "Discovery call script",
      kind: "strategy",
      area: "sales",
      context: "agency clients",
      subject: "discovery call",
      status: "active",
      author: "Zoë",
      version: 1,
      created: nowIso(NOW),
      updated: nowIso(NOW),
      body: "The body.",
      problem: null,
    });
    expect(entry.id).toMatch(UUID);

    const text = readFileSync(entryFile(repo), "utf8");
    expect(parseEntry(text, SLUG, null)).toEqual(entry);
    expect(realGit(repo.path, "log", "-1", "--format=%s|%an|%cn").trim()).toBe(
      `knowledge: create ${SLUG} (v1)|Zoë|Zoë`,
    );
    expect(realGit(repo.path, "show", "--name-only", "--format=", "HEAD").trim()).toBe(
      `entries/${SLUG}.md`,
    );
    expect(readIntent(repo)).toBeNull();
    expect(status(repo)).toBe("");
    expect(entryRow(repo)).toMatchObject({
      id: entry.id,
      path: `entries/${SLUG}.md`,
      version: 1,
      author: "Zoë",
      status: "active",
      body: "The body.",
      problem: null,
      hash: fileHash(readFileSync(entryFile(repo))),
    });
    expect(repoRow(repo)?.head).toBe(headOf(repo.path));
    expect(repoRow(repo)?.head).not.toBeNull();
  });

  test("a write on the current version gives the next one and keeps created", () => {
    const first = written(writeEntry(store, WORKSPACE, change(), person()));
    const repo = workspace();
    const before = commits(repo);
    clock += 60_000;
    const second = written(
      writeEntry(
        store,
        WORKSPACE,
        change({ slug: SLUG, body: "Better.", baseVersion: 1 }),
        person(),
      ),
    );
    expect(second).toMatchObject({
      id: first.id,
      version: 2,
      created: nowIso(NOW),
      updated: nowIso(NOW + 60_000),
      body: "Better.",
    });
    expect(commits(repo)).toBe(before + 1);
    expect(realGit(repo.path, "log", "-1", "--format=%s").trim()).toBe(
      `knowledge: update ${SLUG} (v2)`,
    );
    expect(entryRow(repo)).toMatchObject({ version: 2, body: "Better." });
    expect(readEntry(store, WORKSPACE, SLUG)).toEqual(second);
  });

  test("a write on a stale version is refused and nothing changes", () => {
    writeEntry(store, WORKSPACE, change(), person());
    writeEntry(store, WORKSPACE, change({ slug: SLUG, baseVersion: 1 }), person());
    const repo = workspace();
    const text = readFileSync(entryFile(repo), "utf8");
    const before = snapshot(repo);
    const stale = () =>
      writeEntry(store, WORKSPACE, change({ slug: SLUG, body: "Late.", baseVersion: 1 }), person());
    expect(codeOf(stale)).toBe("stale");
    expect(thrown(stale).message).toContain("version 2");
    expect(thrown(stale).message).toContain("version 1");
    expect(readFileSync(entryFile(repo), "utf8")).toBe(text);
    expect(snapshot(repo)).toEqual(before);
  });

  test("a new entry whose slug exists is refused; base version 0 is a new entry too", () => {
    writeEntry(store, WORKSPACE, change(), person());
    const again = () => writeEntry(store, WORKSPACE, change(), person());
    expect(codeOf(again)).toBe("exists");
    expect(thrown(again).message).toBe(
      `entries/${SLUG}.md exists at version 1; write with base version 1 to change it`,
    );
    expect(codeOf(() => writeEntry(store, WORKSPACE, change({ baseVersion: 0 }), person()))).toBe(
      "exists",
    );
    expect(
      written(writeEntry(store, WORKSPACE, change({ title: "Another", baseVersion: 0 }), person()))
        .version,
    ).toBe(1);
  });

  test("a change to an entry that does not exist is refused", () => {
    expect(
      codeOf(() =>
        writeEntry(store, WORKSPACE, change({ slug: "ghost", baseVersion: 2 }), person()),
      ),
    ).toBe("missing");
  });

  test("the fields are checked, and the area against the taxonomy", () => {
    const refused = (over: Partial<EntryChange>, field: string) => {
      const call = () => writeEntry(store, WORKSPACE, change(over), person());
      expect(codeOf(call)).toBe("invalid");
      expect(thrown(call).message).toContain(field);
    };
    refused({ area: "legal" }, "area");
    refused({ area: "Legal!" }, "area");
    refused({ kind: "rule" }, "kind");
    refused({ status: "gone" }, "status");
    refused({ title: "" }, "title");
    refused({ title: "two\nlines" }, "title");
    refused({ title: "t".repeat(201) }, "title");
    refused({ context: "c".repeat(121) }, "context");
    refused({ subject: "s".repeat(121) }, "subject");
    refused({ slug: "Not A Slug" }, "slug");
    refused({ baseVersion: 1.5 }, "base version");
    refused({ supersedes: "not-an-id" }, "supersedes");
    refused({ body: "x".repeat(262144) }, "256 KiB");
    // Nothing was created by a refused write.
    expect(existsSync(join(fx.dataDir, "knowledge", "workspace", "entries", `${SLUG}.md`))).toBe(
      false,
    );
  });

  test("a status and a supersedes id are written; unknown keys survive a rewrite", () => {
    const first = written(
      writeEntry(
        store,
        WORKSPACE,
        change({ status: "draft", supersedes: "3f2a9c6e-7b1d-4e0f-8a2b-9c1d2e3f4a5b" }),
        person(),
      ),
    );
    expect(first).toMatchObject({
      status: "draft",
      supersedes: "3f2a9c6e-7b1d-4e0f-8a2b-9c1d2e3f4a5b",
    });
    const repo = workspace();
    // A key a later version wrote, added and committed outside this engine.
    writeFileSync(
      entryFile(repo),
      readFileSync(entryFile(repo), "utf8").replace(
        "---\nThe body.",
        "pinned: true\n---\nThe body.",
      ),
    );
    commitByHand(repo, `entries/${SLUG}.md`);
    const second = written(
      writeEntry(store, WORKSPACE, change({ slug: SLUG, baseVersion: 1 }), person()),
    );
    expect(second).toMatchObject({ status: "draft", version: 2, extra: ["pinned: true"] });
    expect(second.supersedes).toBe("3f2a9c6e-7b1d-4e0f-8a2b-9c1d2e3f4a5b");
    expect(readFileSync(entryFile(repo), "utf8")).toContain("\npinned: true\n---\n");
  });

  test("a project write before any workspace write creates the workspace repository first", () => {
    const projectId = fx.addProject("gitdir:/x/.git", "path:/x");
    const ref = { scope: "project", projectId } as const;
    const entry = written(writeEntry(store, ref, change(), person()));
    expect(entry.area).toBe("sales");
    const root = workspace();
    expect(existsSync(join(root.path, "taxonomy.md"))).toBe(true);
    expect(realGit(root.path, "log", "-1", "--format=%an|%s").trim()).toBe(
      "Zoë|knowledge: repository (format 1)",
    );
    const repo = openRepo(store, ref) as Repo;
    expect(readManifest(repo.path)?.scope).toBe("project");
    expect(existsSync(entryFile(repo))).toBe(true);
    expect(existsSync(entryFile(root))).toBe(false);
    expect(
      codeOf(() => writeEntry(store, ref, change({ title: "Other", area: "legal" }), person())),
    ).toBe("invalid");
  });

  test("a target changed outside the engine refuses the write, naming knowledge adopt", () => {
    writeEntry(store, WORKSPACE, change(), person());
    const repo = workspace();
    writeFileSync(entryFile(repo), `${readFileSync(entryFile(repo), "utf8")}A hand edit.\n`);
    const call = () =>
      writeEntry(store, WORKSPACE, change({ slug: SLUG, baseVersion: 1 }), person());
    expect(codeOf(call)).toBe("dirty");
    expect(thrown(call).message).toContain("knowledge adopt");
    expect(thrown(call).message).toContain(`entries/${SLUG}.md`);
  });

  test("a symlinked entry file is refused and its target left alone", () => {
    const repo = ensureRepo(store, WORKSPACE);
    const outside = join(fx.dir, "outside.md");
    writeFileSync(outside, "outside the repository\n");
    symlinkSync(outside, entryFile(repo, "link"));
    const call = () => writeEntry(store, WORKSPACE, change({ slug: "link" }), person());
    expect(codeOf(call)).toBe("invalid");
    expect(thrown(call).message).toContain("entries/link.md");
    expect(readFileSync(outside, "utf8")).toBe("outside the repository\n");
  });

  test("a file the index holds with a problem is refused, naming the problem and the way out", () => {
    const repo = ensureRepo(store, WORKSPACE);
    writeFileSync(
      entryFile(repo, "hand"),
      "---\ntitle: By hand\nkind: knowledge\narea: sales\nstatus: active\nversion: 1\n---\nA note.\n",
    );
    rebuildRepo(store, repo);
    expect(entryRow(repo, "hand")).toMatchObject({ id: "file:hand", status: "draft" });
    const call = () => writeEntry(store, WORKSPACE, change({ slug: "hand" }), person());
    expect(codeOf(call)).toBe("invalid");
    expect(thrown(call).message).toContain("id is missing");
    expect(thrown(call).message).toContain("knowledge adopt");
  });

  test("editor and Finder files do not make a write dirty", () => {
    const repo = ensureRepo(store, WORKSPACE);
    writeFileSync(join(repo.path, ".DS_Store"), "x");
    writeFileSync(join(repo.path, "entries", ".DS_Store"), "x");
    mkdirSync(join(repo.path, ".obsidian"));
    writeFileSync(join(repo.path, ".obsidian", "workspace.json"), "{}");
    expect(written(writeEntry(store, WORKSPACE, change(), person())).version).toBe(1);
    expect(
      written(writeEntry(store, WORKSPACE, change({ slug: SLUG, baseVersion: 1 }), person()))
        .version,
    ).toBe(2);
  });

  test("with no git the write is refused before any folder is created", () => {
    const without = fx.store({ env: { PATH: fx.emptyBin() } });
    const call = () => writeEntry(without, WORKSPACE, change(), personAuthor(without));
    expect(codeOf(call)).toBe("git");
    expect(thrown(call).message).toBe(
      "git 2.32 or newer is needed to version knowledge; found nothing",
    );
    expect(existsSync(join(fx.dataDir, "knowledge"))).toBe(false);
  });

  test("a lease another live owner holds refuses the write; a dead owner's is taken over", async () => {
    writeEntry(store, WORKSPACE, change(), person());
    const key = leaseKey("knowledge/workspace");
    setMeta(fx.db, key, JSON.stringify({ owner: `${process.pid}-other`, until: clock + 60_000 }));
    const call = () =>
      writeEntry(store, WORKSPACE, change({ slug: SLUG, baseVersion: 1 }), person());
    expect(codeOf(call)).toBe("locked");
    expect(entryRow(workspace())?.version).toBe(1);

    const gone = Bun.spawn(["true"], { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
    await gone.exited;
    setMeta(fx.db, key, JSON.stringify({ owner: `${gone.pid}-x`, until: clock + 60_000 }));
    expect(written(call()).version).toBe(2);
  });

  test("a git that does not return is killed and the write refused", () => {
    ensureRepo(store, WORKSPACE);
    const slow = fx.store({
      gitTimeoutMs: 50,
      env: { PATH: fx.pathWith(stubGit(join(fx.dir, "slow-git"), { sleepMs: 2000 })) },
    });
    const call = () => writeEntry(slow, WORKSPACE, change(), personAuthor(slow));
    expect(codeOf(call)).toBe("git");
    expect(thrown(call).message).toContain("timed out");
  }, 30_000);

  test("a failed commit of a change puts the file back to HEAD and leaves the index alone", () => {
    writeEntry(store, WORKSPACE, change(), person());
    const repo = workspace();
    const text = readFileSync(entryFile(repo), "utf8");
    const before = snapshot(repo);
    const broken = failingCommit("failing-update");
    expect(
      codeOf(() =>
        writeEntry(
          broken,
          WORKSPACE,
          change({ slug: SLUG, body: "Lost.", baseVersion: 1 }),
          person(),
        ),
      ),
    ).toBe("git");
    expect(readFileSync(entryFile(repo), "utf8")).toBe(text);
    expect(status(repo)).toBe("");
    expect(readIntent(repo)).toBeNull();
    expect(snapshot(repo)).toEqual(before);
  });

  test("a failed commit of a new entry leaves no file and no row", () => {
    const repo = ensureRepo(store, WORKSPACE);
    rebuildRepo(store, repo);
    const before = snapshot(repo);
    const broken = failingCommit("failing-create");
    expect(codeOf(() => writeEntry(broken, WORKSPACE, change(), person()))).toBe("git");
    expect(existsSync(entryFile(repo))).toBe(false);
    expect(readdirSync(join(repo.path, "entries"))).toEqual([]);
    expect(status(repo)).toBe("");
    expect(readIntent(repo)).toBeNull();
    expect(snapshot(repo)).toEqual(before);
    // The same write then goes through.
    expect(written(writeEntry(broken, WORKSPACE, change(), person())).version).toBe(1);
  });

  test("tables newer than this binary's are left alone", () => {
    writeEntry(store, WORKSPACE, change(), person());
    fx.db.run(
      "INSERT INTO module_migrations (module, version, name, applied_at) VALUES ('knowledge', 7, 'x', 0)",
    );
    expect(() => writeEntry(store, WORKSPACE, change({ title: "Other" }), person())).toThrow(
      ModuleSchemaTooNewError,
    );
    expect(() => readEntry(store, WORKSPACE, SLUG)).toThrow(ModuleSchemaTooNewError);
    expect(codeOf(() => readEntry(store, WORKSPACE, SLUG))).toBe("too-new");
  });

  test("readEntry is null for a slug that does not exist, and for a repository that does not", () => {
    expect(readEntry(store, WORKSPACE, SLUG)).toBeNull();
    const entry = written(writeEntry(store, WORKSPACE, change(), person()));
    expect(readEntry(store, WORKSPACE, SLUG)).toEqual(entry);
    expect(readEntry(store, WORKSPACE, "ghost")).toBeNull();
    expect(readEntry(store, { scope: "shared" }, SLUG)).toBeNull();
  });
});

describe("an agent's write", () => {
  test("is a proposal file committed by the agent; the entry is untouched", () => {
    const entry = written(writeEntry(store, WORKSPACE, change(), person()));
    writeEntry(store, WORKSPACE, change({ slug: SLUG, baseVersion: 1 }), person());
    const repo = workspace();
    const text = readFileSync(entryFile(repo), "utf8");
    clock += 5_000;
    const proposal = proposed(
      writeEntry(store, WORKSPACE, change({ slug: SLUG, body: "The agent's body." }), agent),
    );
    expect(readFileSync(entryFile(repo), "utf8")).toBe(text);
    expect(entryRow(repo)?.version).toBe(2);
    expect(proposal.id).toMatch(UUID);
    expect(proposal).toMatchObject({
      entryId: entry.id,
      slug: SLUG,
      baseVersion: 2,
      baseHash: fileHash(readFileSync(entryFile(repo))),
      proposedBy: "agent:claude-code",
      proposedAt: nowIso(clock),
      body: "The agent's body.",
      decision: null,
      problem: null,
    });
    const file = readFileSync(openFile(repo, proposal.id), "utf8");
    expect(parseProposal(file, `${proposal.id}.md`, null)).toEqual(proposal);
    expect(realGit(repo.path, "log", "-1", "--format=%an|%ae|%s").trim()).toBe(
      `agent:claude-code|claude-code@agents.wizardingcode.invalid|knowledge: propose ${proposal.id} for ${SLUG}`,
    );
    expect(realGit(repo.path, "show", "--name-only", "--format=", "HEAD").trim()).toBe(
      `proposals/open/${proposal.id}.md`,
    );
    expect(proposalRow(repo, proposal.id)).toMatchObject({
      state: "open",
      entry_id: entry.id,
      slug: SLUG,
      base_version: 2,
      proposed_by: "agent:claude-code",
      body: "The agent's body.",
      path: `proposals/open/${proposal.id}.md`,
    });
    expect(status(repo)).toBe("");
    expect(readIntent(repo)).toBeNull();
  });

  test("a base version that is not the target's is stale; a new slug that exists is refused", () => {
    writeEntry(store, WORKSPACE, change(), person());
    expect(
      codeOf(() => writeEntry(store, WORKSPACE, change({ slug: SLUG, baseVersion: 3 }), agent)),
    ).toBe("stale");
    expect(codeOf(() => writeEntry(store, WORKSPACE, change({ baseVersion: 0 }), agent))).toBe(
      "exists",
    );
    expect(
      codeOf(() => writeEntry(store, WORKSPACE, change({ slug: "ghost", baseVersion: 1 }), agent)),
    ).toBe("missing");
  });

  test("a new entry is proposed with base version 0, a fresh entry id and a slug from the title", () => {
    const proposal = proposed(
      writeEntry(store, WORKSPACE, change({ title: "Pricing rules for agencies" }), agent),
    );
    expect(proposal).toMatchObject({
      slug: "pricing-rules-for-agencies",
      baseVersion: 0,
      baseHash: "",
      status: "active",
    });
    expect(proposal.entryId).toMatch(UUID);
    expect(proposal.entryId).not.toBe(proposal.id);
    expect(existsSync(entryFile(workspace(), "pricing-rules-for-agencies"))).toBe(false);
  });

  test("an update keeps the caller's slug and takes the target's version", () => {
    writeEntry(store, WORKSPACE, change(), person());
    const proposal = proposed(
      writeEntry(
        store,
        WORKSPACE,
        change({ slug: SLUG, title: "A new title", baseVersion: 1 }),
        agent,
      ),
    );
    expect(proposal).toMatchObject({ slug: SLUG, title: "A new title", baseVersion: 1 });
  });

  test("secrets in an agent's text are redacted before the proposal is written", () => {
    const key = `sk-ant-api03-${"a".repeat(40)}`;
    const aws = fakeAwsKey();
    const body = `Use the key ${key} when calling.`;
    const context = `account ${aws}`;
    const proposal = proposed(writeEntry(store, WORKSPACE, change({ body, context }), agent));
    const expectedBody = redact(body, { env: store.env });
    const expectedContext = redact(context, { env: store.env });
    expect(expectedBody).not.toContain(key);
    expect(expectedContext).not.toContain(aws);
    expect(proposal.body).toBe(expectedBody);
    expect(proposal.context).toBe(expectedContext);
    const repo = workspace();
    const file = readFileSync(openFile(repo, proposal.id), "utf8");
    expect(file).not.toContain(key);
    expect(file).not.toContain(aws);
    expect(proposalRow(repo, proposal.id)).toMatchObject({
      body: expectedBody,
      context: expectedContext,
    });
    // A person's write is deliberate and stays as written.
    expect(
      written(writeEntry(store, WORKSPACE, change({ title: "Mine", body }), person())).body,
    ).toBe(body);
  });

  test("a secret in an agent's title or subject is redacted too, and the slug comes from the redacted title", () => {
    const key = `sk-ant-api03-${"a".repeat(40)}`;
    const title = `Rotate ${key} monthly`;
    const subject = `the key ${fakeAwsKey()}`;
    const proposal = proposed(writeEntry(store, WORKSPACE, change({ title, subject }), agent));
    const cleanTitle = redact(title, { env: store.env });
    const cleanSubject = redact(subject, { env: store.env });
    expect(cleanTitle).not.toContain(key);
    expect(cleanSubject).not.toContain(fakeAwsKey());
    expect(proposal.title).toBe(cleanTitle);
    expect(proposal.subject).toBe(cleanSubject);
    expect(proposal.slug).toBe(slugify(cleanTitle));
    expect(proposal.slug).not.toContain("aaaaaaaa");
    const repo = workspace();
    const file = readFileSync(openFile(repo, proposal.id), "utf8");
    expect(file).not.toContain(key);
    expect(file).not.toContain(fakeAwsKey());
    expect(realGit(repo.path, "log", "-1", "--format=%s")).not.toContain("aaaaaaaa");
  });

  test("a caller cannot set an entry's id, as a person or as an agent", () => {
    const theirs = "11111111-1111-4111-8111-111111111111";
    // The type has no id; a caller that passes one anyway is not obeyed.
    const withId = (over: Partial<EntryChange>) =>
      ({ ...change(over), id: theirs, entryId: theirs }) as EntryChange;

    const entry = written(writeEntry(store, WORKSPACE, withId({}), person()));
    expect(entry.id).toMatch(UUID);
    expect(entry.id).not.toBe(theirs);
    const next = written(
      writeEntry(store, WORKSPACE, withId({ slug: SLUG, baseVersion: 1 }), person()),
    );
    expect(next.id).toBe(entry.id);

    const proposal = proposed(writeEntry(store, WORKSPACE, withId({ title: "Another" }), agent));
    expect(proposal.id).not.toBe(theirs);
    expect(proposal.entryId).not.toBe(theirs);
    const repo = workspace();
    expect(readFileSync(entryFile(repo), "utf8")).not.toContain(theirs);
    expect(readFileSync(openFile(repo, proposal.id), "utf8")).not.toContain(theirs);
    expect(JSON.stringify(snapshot(repo))).not.toContain(theirs);
  });

  test("a slug redaction would change, and a field redaction makes too long, are refused", () => {
    const slug = `sk-${"a".repeat(24)}`;
    const bySlug = () => writeEntry(store, WORKSPACE, change({ slug }), agent);
    expect(codeOf(bySlug)).toBe("invalid");
    expect(thrown(bySlug).message).toContain("slug");

    const context = `${"c".repeat(96)} ${fakeAwsKey()}`;
    expect(context.length).toBeLessThanOrEqual(120);
    expect(redact(context, { env: store.env }).length).toBeGreaterThan(120);
    const byContext = () => writeEntry(store, WORKSPACE, change({ context }), agent);
    expect(codeOf(byContext)).toBe("invalid");
    expect(thrown(byContext).message).toContain("context");
  });

  test("a sixth open proposal for one entry is refused, and a sixth for one new slug", () => {
    writeEntry(store, WORKSPACE, change(), person());
    const update = (n: number) =>
      writeEntry(store, WORKSPACE, change({ slug: SLUG, body: `Version ${n}.` }), agent);
    for (let n = 1; n <= 5; n++) update(n);
    expect(codeOf(() => update(6))).toBe("quota");
    expect(thrown(() => update(6)).message).toBe(
      `there are already 5 open proposals for ${SLUG}; a person decides them first`,
    );

    const fresh = (n: number) =>
      writeEntry(store, WORKSPACE, change({ title: "A new idea", body: `Idea ${n}.` }), agent);
    for (let n = 1; n <= 5; n++) fresh(n);
    expect(codeOf(() => fresh(6))).toBe("quota");
    expect(thrown(() => fresh(6)).message).toContain("5 open proposals for a-new-idea");
  });

  test("the repository holds at most 200 open proposals", () => {
    writeEntry(store, WORKSPACE, change(), person());
    const repo = workspace();
    const insert = fx.db.prepare(
      `INSERT INTO knowledge_proposals
         (repo_id, id, path, state, entry_id, slug, base_version, proposed_by, title, kind, area, status, hash)
       VALUES (?, ?, ?, 'open', ?, ?, 0, 'agent:x', 't', 'knowledge', 'sales', 'active', '')`,
    );
    for (let n = 0; n < 200; n++) {
      insert.run(repo.id, `p-${n}`, `proposals/open/p-${n}.md`, `e-${n}`, `slug-${n}`);
    }
    const call = () => writeEntry(store, WORKSPACE, change({ title: "One more" }), agent);
    expect(codeOf(call)).toBe("quota");
    expect(thrown(call).message).toBe("the repository has 200 open proposals waiting for a person");
  });
});

describe("deciding a proposal", () => {
  /** An entry at version 1 and an agent's open proposal to change it. */
  function withProposal(): { repo: Repo; entry: KnowledgeEntry; proposal: KnowledgeProposal } {
    const entry = written(writeEntry(store, WORKSPACE, change(), person()));
    const proposal = proposed(
      writeEntry(
        store,
        WORKSPACE,
        change({ slug: SLUG, title: "A sharper script", body: "The agent's body." }),
        agent,
      ),
    );
    return { repo: workspace(), entry, proposal };
  }

  test("accept writes the entry, moves the proposal to decided, in one commit by the person", () => {
    const { repo, entry, proposal } = withProposal();
    const before = commits(repo);
    clock += 60_000;
    const accepted = acceptProposal(store, WORKSPACE, proposal.id, person());
    expect(accepted).toMatchObject({
      id: entry.id,
      slug: SLUG,
      title: "A sharper script",
      body: "The agent's body.",
      version: 2,
      author: "Zoë",
      created: entry.created,
      updated: nowIso(clock),
    });
    expect(parseEntry(readFileSync(entryFile(repo), "utf8"), SLUG, null)).toEqual(accepted);
    expect(existsSync(openFile(repo, proposal.id))).toBe(false);
    const decided = parseProposal(
      readFileSync(decidedFile(repo, proposal.id), "utf8"),
      `${proposal.id}.md`,
      null,
    );
    expect(decided).toMatchObject({
      id: proposal.id,
      decision: "accepted",
      decidedBy: "Zoë",
      decidedAt: nowIso(clock),
      decidedVersion: 2,
      body: "The agent's body.",
      problem: null,
    });
    expect(commits(repo)).toBe(before + 1);
    expect(realGit(repo.path, "log", "-1", "--format=%an|%s").trim()).toBe(
      `Zoë|knowledge: accept ${proposal.id} into ${SLUG} (v2)`,
    );
    expect(realGit(repo.path, "log", "-1", "--format=%b")).toContain(
      "Proposed by agent:claude-code.",
    );
    expect(
      realGit(repo.path, "show", "--name-only", "--no-renames", "--format=", "HEAD")
        .trim()
        .split("\n")
        .sort(),
    ).toEqual(
      [
        `entries/${SLUG}.md`,
        `proposals/decided/${proposal.id}.md`,
        `proposals/open/${proposal.id}.md`,
      ].sort(),
    );
    expect(entryRow(repo)).toMatchObject({ version: 2, title: "A sharper script" });
    expect(proposalRow(repo, proposal.id)).toMatchObject({
      state: "accepted",
      body: "",
      decided_by: "Zoë",
      decided_version: 2,
      path: `proposals/decided/${proposal.id}.md`,
    });
    expect(status(repo)).toBe("");
    expect(readIntent(repo)).toBeNull();
    expect(repoRow(repo)?.head).toBe(headOf(repo.path));
  });

  test("accepting a new-entry proposal creates the entry with the proposal's entry id", () => {
    const proposal = proposed(
      writeEntry(store, WORKSPACE, change({ title: "Pricing rules" }), agent),
    );
    const accepted = acceptProposal(store, WORKSPACE, proposal.id, person());
    expect(accepted).toMatchObject({ id: proposal.entryId, slug: "pricing-rules", version: 1 });
    expect(realGit(workspace().path, "log", "-1", "--format=%s").trim()).toBe(
      `knowledge: accept ${proposal.id} into pricing-rules (v1)`,
    );
  });

  test("reject moves the proposal with its decision, in a commit by the person", () => {
    const { repo, proposal } = withProposal();
    const text = readFileSync(entryFile(repo), "utf8");
    const rejected = rejectProposal(store, WORKSPACE, proposal.id, person());
    expect(rejected).toMatchObject({
      id: proposal.id,
      decision: "rejected",
      decidedBy: "Zoë",
      decidedVersion: null,
    });
    expect(existsSync(openFile(repo, proposal.id))).toBe(false);
    expect(readFileSync(decidedFile(repo, proposal.id), "utf8")).toContain("decision: rejected");
    expect(readFileSync(entryFile(repo), "utf8")).toBe(text);
    expect(realGit(repo.path, "log", "-1", "--format=%an|%s").trim()).toBe(
      `Zoë|knowledge: reject ${proposal.id}`,
    );
    expect(proposalRow(repo, proposal.id)).toMatchObject({ state: "rejected", body: "" });
    expect(status(repo)).toBe("");
    // Decided once: a second decision finds nothing open.
    expect(codeOf(() => rejectProposal(store, WORKSPACE, proposal.id, person()))).toBe("missing");
    expect(codeOf(() => acceptProposal(store, WORKSPACE, proposal.id, person()))).toBe("missing");
  });

  test("a target that moved makes the accept stale, and the proposal stays open", () => {
    const { repo, proposal } = withProposal();
    writeEntry(
      store,
      WORKSPACE,
      change({ slug: SLUG, body: "The person's.", baseVersion: 1 }),
      person(),
    );
    const call = () => acceptProposal(store, WORKSPACE, proposal.id, person());
    expect(codeOf(call)).toBe("stale");
    expect(thrown(call).message).toContain("version 2");
    expect(thrown(call).message).toContain("version 1");
    expect(existsSync(openFile(repo, proposal.id))).toBe(true);
    expect(existsSync(decidedFile(repo, proposal.id))).toBe(false);
    expect(proposalRow(repo, proposal.id)?.state).toBe("open");
  });

  test("a new-entry proposal whose slug now exists is for a person to decide", () => {
    const proposal = proposed(
      writeEntry(store, WORKSPACE, change({ title: "Pricing rules" }), agent),
    );
    writeEntry(store, WORKSPACE, change({ title: "Pricing rules", body: "Mine." }), person());
    const call = () => acceptProposal(store, WORKSPACE, proposal.id, person());
    expect(codeOf(call)).toBe("exists");
    expect(thrown(call).message).toBe(
      "a proposal for a new entry pricing-rules, but the entry now exists at version 1; a person decides between them",
    );
    expect(proposalRow(workspace(), proposal.id)?.state).toBe("open");
  });

  test("a proposal file edited by hand is not accepted until it is adopted", () => {
    const { repo, proposal } = withProposal();
    writeFileSync(
      openFile(repo, proposal.id),
      `${readFileSync(openFile(repo, proposal.id), "utf8")}Edited by hand.\n`,
    );
    const call = () => acceptProposal(store, WORKSPACE, proposal.id, person());
    expect(codeOf(call)).toBe("dirty");
    expect(thrown(call).message).toContain("knowledge adopt");
    expect(codeOf(() => rejectProposal(store, WORKSPACE, proposal.id, person()))).toBe("dirty");
  });

  test("a committed proposal with an area outside the taxonomy is refused and stays open", () => {
    const { repo, proposal } = withProposal();
    const path = `proposals/open/${proposal.id}.md`;
    writeFileSync(
      openFile(repo, proposal.id),
      readFileSync(openFile(repo, proposal.id), "utf8").replace("area: sales", "area: legal"),
    );
    commitByHand(repo, path);
    const call = () => acceptProposal(store, WORKSPACE, proposal.id, person());
    expect(codeOf(call)).toBe("invalid");
    expect(thrown(call).message).toContain("area");
    expect(existsSync(openFile(repo, proposal.id))).toBe(true);
    expect(entryRow(repo)?.version).toBe(1);
  });

  test("a proposal pointed by hand at another entry's id is refused, naming that entry", () => {
    const { repo, proposal } = withProposal();
    const other = written(
      writeEntry(store, WORKSPACE, change({ title: "Another entry" }), person()),
    );
    const path = `proposals/open/${proposal.id}.md`;
    writeFileSync(
      openFile(repo, proposal.id),
      readFileSync(openFile(repo, proposal.id), "utf8").replace(
        /^entry: .*$/m,
        `entry: ${other.id}`,
      ),
    );
    commitByHand(repo, path);
    const call = () => acceptProposal(store, WORKSPACE, proposal.id, person());
    expect(codeOf(call)).toBe("invalid");
    expect(thrown(call).message).toContain("another-entry");
    expect(entryRow(repo)?.version).toBe(1);
  });

  test("an id that is not a UUID is refused before any path is built", () => {
    const { repo, proposal } = withProposal();
    const before = commits(repo);
    for (const id of ["../x", "a/b", "", "NOT-A-UUID"]) {
      expect(codeOf(() => acceptProposal(store, WORKSPACE, id, person()))).toBe("invalid");
      expect(codeOf(() => rejectProposal(store, WORKSPACE, id, person()))).toBe("invalid");
    }
    const path = `proposals/open/${proposal.id}.md`;
    writeFileSync(
      openFile(repo, proposal.id),
      readFileSync(openFile(repo, proposal.id), "utf8").replace(/^entry: .*$/m, "entry: ../y"),
    );
    commitByHand(repo, path);
    const call = () => acceptProposal(store, WORKSPACE, proposal.id, person());
    expect(codeOf(call)).toBe("invalid");
    expect(thrown(call).message).toContain("entry");
    expect(readdirSync(join(repo.path, "proposals", "decided"))).toEqual([]);
    expect(commits(repo)).toBe(before + 1);
    expect(existsSync(join(repo.path, "y.md"))).toBe(false);
  });

  test("a failed commit of an accept leaves the proposal open and the entry as it was", () => {
    const { repo, proposal } = withProposal();
    const entryText = readFileSync(entryFile(repo), "utf8");
    const proposalText = readFileSync(openFile(repo, proposal.id), "utf8");
    const before = snapshot(repo);
    const broken = failingCommit("failing-accept");
    expect(codeOf(() => acceptProposal(broken, WORKSPACE, proposal.id, person()))).toBe("git");
    expect(readFileSync(openFile(repo, proposal.id), "utf8")).toBe(proposalText);
    expect(readdirSync(join(repo.path, "proposals", "decided"))).toEqual([]);
    expect(readFileSync(entryFile(repo), "utf8")).toBe(entryText);
    expect(status(repo)).toBe("");
    expect(readIntent(repo)).toBeNull();
    expect(snapshot(repo)).toEqual(before);
    // And then it goes through.
    expect(acceptProposal(broken, WORKSPACE, proposal.id, person()).version).toBe(2);
  });

  test("a failed commit of a reject leaves the proposal open", () => {
    const { repo, proposal } = withProposal();
    const proposalText = readFileSync(openFile(repo, proposal.id), "utf8");
    const before = snapshot(repo);
    const broken = failingCommit("failing-reject");
    expect(codeOf(() => rejectProposal(broken, WORKSPACE, proposal.id, person()))).toBe("git");
    expect(readFileSync(openFile(repo, proposal.id), "utf8")).toBe(proposalText);
    expect(readdirSync(join(repo.path, "proposals", "decided"))).toEqual([]);
    expect(status(repo)).toBe("");
    expect(readIntent(repo)).toBeNull();
    expect(snapshot(repo)).toEqual(before);
  });

  test("an agent cannot decide: the decision is always a person's", () => {
    const { proposal } = withProposal();
    const asAgent = agent as unknown as ReturnType<typeof person>;
    expect(codeOf(() => acceptProposal(store, WORKSPACE, proposal.id, asAgent))).toBe("invalid");
    expect(codeOf(() => rejectProposal(store, WORKSPACE, proposal.id, asAgent))).toBe("invalid");
    expect(identityOf(agent).name).toBe("agent:claude-code");
  });
});
