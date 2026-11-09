import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { agentWriter, personAuthor } from "../../src/modules/knowledge/author.ts";
import { parseEntry, parseTaxonomy, UUID } from "../../src/modules/knowledge/entry.ts";
import {
  ensureFresh,
  listEntries,
  listProposals,
  rebuildAll,
  rebuildRepo,
} from "../../src/modules/knowledge/index-store.ts";
import {
  ensureRepo,
  hashOf,
  headOf,
  keepBytes,
  openRepo,
  readIntent,
  readManifest,
  repoPath,
  writeIntent,
  writeManifest,
} from "../../src/modules/knowledge/repo.ts";
import { listRepos } from "../../src/modules/knowledge/resolve.ts";
import { adopt, readEntry, writeEntry } from "../../src/modules/knowledge/store.ts";
import type {
  EntryChange,
  KnowledgeEntry,
  KnowledgeProposal,
  KnowledgeStore,
  Repo,
} from "../../src/modules/knowledge/types.ts";
import { codeOf, type Fixture, knowledgeFixture, thrown } from "../helpers/knowledge.ts";
import { realGit, stubGit } from "../helpers/stub-git.ts";

const WORKSPACE = { scope: "workspace" } as const;
const agent = agentWriter("claude-code");
const NOW = Date.UTC(2026, 10, 9, 8, 0, 0);

let fx: Fixture;
let store: KnowledgeStore;
let clock: number;
beforeEach(() => {
  fx = knowledgeFixture("knowledge-index");
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
const person = () => personAuthor(store);

function written(title: string, over: Partial<EntryChange> = {}, ref = WORKSPACE): KnowledgeEntry {
  const result = writeEntry(store, ref, change({ title, ...over }), person());
  if (result.kind !== "written") throw new Error("expected a written entry");
  return result.entry;
}
function proposed(over: Partial<EntryChange>): KnowledgeProposal {
  const result = writeEntry(store, WORKSPACE, change(over), agent);
  if (result.kind !== "proposed") throw new Error("expected a proposal");
  return result.proposal;
}

const workspace = (): Repo => openRepo(store, WORKSPACE) as Repo;
const entryFile = (repo: Repo, slug: string) => join(repo.path, "entries", `${slug}.md`);
const status = (repo: Repo) =>
  realGit(repo.path, "status", "--porcelain", "--untracked-files=all").trimEnd().split("\n").sort();
const commits = (repo: Repo) => Number(realGit(repo.path, "rev-list", "--count", "HEAD").trim());

const entryRows = () =>
  fx.db.query("SELECT * FROM knowledge_entries ORDER BY repo_id, slug").all() as Record<
    string,
    unknown
  >[];
const proposalRows = () =>
  fx.db.query("SELECT * FROM knowledge_proposals ORDER BY repo_id, id").all() as Record<
    string,
    unknown
  >[];
const repoRow = (repo: Repo) =>
  fx.db
    .query<
      { head: string | null; fingerprint: string | null; over_cap: number; dirty_checked: number },
      [number]
    >("SELECT head, fingerprint, over_cap, dirty_checked FROM knowledge_repos WHERE id = ?")
    .get(repo.id);

interface Row {
  id: string;
  slug: string;
  status: string;
  problem: string | null;
  body: string;
  version: number;
}
const entryRow = (repo: Repo, slug: string) =>
  fx.db
    .query<Row, [number, string]>(
      "SELECT id, slug, status, problem, body, version FROM knowledge_entries WHERE repo_id = ? AND slug = ?",
    )
    .get(repo.id, slug);

/** An entry file as a person would write it in an editor. */
const byHand = (fields: Record<string, string>, body = "A note.") =>
  `---\n${Object.entries(fields)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n")}\n---\n${body}\n`;
const NOTE = { title: "By hand", kind: "knowledge", area: "sales", status: "active", version: "1" };

describe("rebuildRepo", () => {
  test("recreates the rows the writes indexed", () => {
    written("First entry");
    written("Second entry", { status: "draft" });
    const proposal = proposed({ slug: "first-entry", body: "The agent's." });
    const repo = workspace();
    const entries = entryRows();
    const proposals = proposalRows();
    expect(entries).toHaveLength(2);
    expect(proposals).toHaveLength(1);

    expect(rebuildRepo(store, repo)).toEqual({
      entries: 2,
      proposals: 1,
      open: 1,
      problems: 0,
      overCap: 0,
      dirtyChecked: true,
    });
    expect(entryRows()).toEqual(entries);
    expect(proposalRows()).toEqual(proposals);

    fx.db.run("DELETE FROM knowledge_entries");
    fx.db.run("DELETE FROM knowledge_proposals");
    rebuildRepo(store, repo);
    expect(entryRows()).toEqual(entries);
    expect(proposalRows()).toEqual(proposals);
    expect(repoRow(repo)?.head).toBe(headOf(repo.path));
    expect(listEntries(store, repo.id).map((entry) => entry.slug)).toEqual([
      "first-entry",
      "second-entry",
    ]);
    expect(listProposals(store, repo.id, "open").map((p) => p.id)).toEqual([proposal.id]);
    expect(listProposals(store, repo.id, "accepted")).toEqual([]);
  });

  test("a file changed by hand is a draft with a problem that names knowledge adopt", () => {
    written("First entry");
    const repo = workspace();
    writeFileSync(
      entryFile(repo, "first-entry"),
      `${readFileSync(entryFile(repo, "first-entry"), "utf8")}Edited.\n`,
    );
    writeFileSync(entryFile(repo, "untracked"), byHand({ ...NOTE, id: crypto.randomUUID() }));
    const result = rebuildRepo(store, repo);
    expect(result.dirtyChecked).toBe(true);
    expect(result.problems).toBe(2);
    for (const slug of ["first-entry", "untracked"]) {
      expect(entryRow(repo, slug)?.status).toBe("draft");
      expect(entryRow(repo, slug)?.problem).toContain("knowledge adopt");
    }
    expect(repoRow(repo)?.dirty_checked).toBe(1);
  });

  test("with no git the dirty check is skipped and said", () => {
    written("First entry");
    const repo = workspace();
    writeFileSync(
      entryFile(repo, "first-entry"),
      `${readFileSync(entryFile(repo, "first-entry"), "utf8")}Edited.\n`,
    );
    const without = fx.store({ env: { PATH: fx.emptyBin() } });
    const result = rebuildRepo(without, repo);
    expect(result).toMatchObject({ entries: 1, problems: 0, dirtyChecked: false });
    expect(repoRow(repo)?.dirty_checked).toBe(0);
    expect(entryRow(repo, "first-entry")).toMatchObject({ status: "active", problem: null });
  });

  test("missing, malformed and duplicated ids never fail the rebuild", () => {
    const first = written("Alpha");
    const proposal = proposed({ slug: "alpha", body: "The agent's." });
    const repo = workspace();
    writeFileSync(entryFile(repo, "no-id"), byHand(NOTE));
    writeFileSync(entryFile(repo, "bad-id"), byHand({ ...NOTE, id: "not-a-uuid" }));
    // A copy of another entry's file: the later name in byte order loses the id.
    writeFileSync(entryFile(repo, "beta"), readFileSync(entryFile(repo, "alpha")));
    // The same proposal under both folders: the open one keeps the id.
    writeFileSync(
      join(repo.path, "proposals", "decided", `${proposal.id}.md`),
      readFileSync(join(repo.path, "proposals", "open", `${proposal.id}.md`)),
    );
    // A file with no id under each folder, with the same name: two rows, not one.
    writeFileSync(join(repo.path, "proposals", "open", "stray.md"), "---\ntitle: x\n---\n");
    writeFileSync(join(repo.path, "proposals", "decided", "stray.md"), "---\ntitle: y\n---\n");

    const result = rebuildRepo(store, repo);
    expect(result.entries).toBe(4);
    expect(result.proposals).toBe(4);
    const ids = Object.fromEntries(
      fx.db
        .query<{ slug: string; id: string }, []>("SELECT slug, id FROM knowledge_entries")
        .all()
        .map((row) => [row.slug, row.id]),
    );
    expect(ids).toEqual({
      alpha: first.id,
      "bad-id": "file:bad-id",
      beta: "dup:beta",
      "no-id": "file:no-id",
    });
    expect(entryRow(repo, "beta")?.problem).toContain("alpha");
    expect(entryRow(repo, "beta")?.status).toBe("draft");
    expect(entryRow(repo, "no-id")?.problem).toContain("id is missing");
    const proposalIds = fx.db
      .query<{ id: string; path: string; problem: string | null }, []>(
        "SELECT id, path, problem FROM knowledge_proposals ORDER BY path",
      )
      .all();
    // The id of a file with none of its own names its folder: the same file name can sit
    // under both.
    expect(proposalIds.map((row) => [row.path, row.id])).toEqual([
      [`proposals/decided/${proposal.id}.md`, `dup:decided/${proposal.id}.md`],
      ["proposals/decided/stray.md", "file:decided/stray.md"],
      [`proposals/open/${proposal.id}.md`, proposal.id],
      ["proposals/open/stray.md", "file:open/stray.md"],
    ]);
    expect(proposalIds.every((row) => row.path.includes("open/") || row.problem !== null)).toBe(
      true,
    );
    // A file under decided/ that says nothing of its decision is listed with that problem.
    expect(proposalIds[0]?.problem).toContain("no decision");
    // Twice the same answer.
    const again = entryRows();
    rebuildRepo(store, repo);
    expect(entryRows()).toEqual(again);
  });

  test("a symlinked entry is listed with a problem and never read", () => {
    const repo = ensureRepo(store, WORKSPACE);
    const outside = join(fx.dir, "secret.md");
    writeFileSync(outside, byHand({ ...NOTE, id: crypto.randomUUID() }, "A secret outside."));
    symlinkSync(outside, entryFile(repo, "link"));
    mkdirSync(entryFile(repo, "folder"));
    const result = rebuildRepo(store, repo);
    expect(result.entries).toBe(2);
    expect(entryRow(repo, "link")).toMatchObject({ id: "file:link", status: "draft", body: "" });
    expect(entryRow(repo, "link")?.problem).toContain("link");
    expect(entryRow(repo, "folder")?.problem).toContain("regular file");
    expect(JSON.stringify(entryRows())).not.toContain("A secret outside.");
  });

  test("a file over the cap is listed with a problem and its text is not indexed", () => {
    const repo = ensureRepo(store, WORKSPACE);
    writeFileSync(
      entryFile(repo, "huge"),
      byHand({ ...NOTE, id: crypto.randomUUID() }, "x".repeat(262144)),
    );
    rebuildRepo(store, repo);
    expect(entryRow(repo, "huge")?.problem).toContain("256 KiB");
    expect(entryRow(repo, "huge")?.body).toBe("");
  });

  test("a folder keeps its first 5,000 names and counts the rest", () => {
    const repo = ensureRepo(store, WORKSPACE);
    for (let n = 0; n < 5000; n++) {
      const id = `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
      writeFileSync(entryFile(repo, `e-${String(n).padStart(4, "0")}`), byHand({ ...NOTE, id }));
    }
    writeFileSync(entryFile(repo, "zz-last"), byHand({ ...NOTE, id: crypto.randomUUID() }));
    const result = rebuildRepo(store, repo);
    expect(result.entries).toBe(5000);
    expect(result.overCap).toBe(1);
    expect(entryRow(repo, "zz-last")).toBeNull();
    expect(entryRow(repo, "e-4999")).not.toBeNull();
    expect(repoRow(repo)?.over_cap).toBe(1);
  }, 30_000);
});

describe("a file added while the engine works", () => {
  /** Runs `add` once, at the store's next renewal: a hand edit landing mid-operation. */
  function atNextRenewal(add: () => void): void {
    let done = false;
    store.renew = () => {
      if (done) return;
      done = true;
      add();
    };
  }

  test("during a rebuild, it is read at the next refresh instead of staying out of the index", () => {
    written("First entry");
    const repo = workspace();
    // A rebuild renews twice: before git's status, which comes before the files are read,
    // and before its transaction, which comes after. The file appears at the second.
    let renewals = 0;
    store.renew = () => {
      renewals++;
      if (renewals !== 2) return;
      writeFileSync(entryFile(repo, "late"), byHand({ ...NOTE, id: crypto.randomUUID() }));
      utimesSync(join(repo.path, "entries"), new Date(), new Date(Date.now() + 5000));
    };
    rebuildRepo(store, repo);
    store.renew = null;
    expect(renewals).toBe(2);
    expect(entryRow(repo, "late")).toBeNull();

    // The index did not record folders it had not read: the refresh reads them now.
    ensureFresh(store, repo);
    expect(entryRow(repo, "late")).not.toBeNull();
  });

  test("during a write, it is read at the next refresh", () => {
    written("First entry");
    const repo = workspace();
    // A file appears by hand after the write's refresh and before its commit.
    atNextRenewal(() => {
      writeFileSync(entryFile(repo, "late"), byHand({ ...NOTE, id: crypto.randomUUID() }));
      utimesSync(join(repo.path, "entries"), new Date(), new Date(Date.now() + 5000));
    });
    writeEntry(
      store,
      WORKSPACE,
      change({ slug: "first-entry", title: "First entry", baseVersion: 1 }),
      person(),
    );
    store.renew = null;
    expect(existsSync(entryFile(repo, "late"))).toBe(true);
    expect(entryRow(repo, "first-entry")?.version).toBe(2);
    expect(entryRow(repo, "late")).toBeNull();

    expect(readEntry(store, WORKSPACE, "late")?.title).toBe("By hand");
    expect(entryRow(repo, "late")).not.toBeNull();
  });
});

describe("tables a newer version wrote", () => {
  test("are not rewritten by a rebuild, a refresh or a listing", () => {
    written("First entry");
    const repo = workspace();
    fx.db.run("UPDATE knowledge_entries SET title = 'theirs'");
    fx.db.run("UPDATE knowledge_repos SET head = 'theirs'");
    fx.db.run(
      "INSERT INTO module_migrations (module, version, name, applied_at) VALUES ('knowledge', 7, 'x', 0)",
    );
    for (const call of [
      () => rebuildAll(store),
      () => rebuildRepo(store, repo),
      () => ensureFresh(store, repo),
      () => listRepos(store),
      () => openRepo(store, WORKSPACE),
    ]) {
      expect(codeOf(call)).toBe("too-new");
    }
    expect(entryRows().map((row) => row.title)).toEqual(["theirs"]);
    expect(repoRow(repo)?.head).toBe("theirs");
  });
});

describe("ensureFresh", () => {
  test("rebuilds on a new file or a commit made by hand, and not on an edit in place", () => {
    written("First entry");
    const repo = workspace();
    const mark = () => fx.db.run("UPDATE knowledge_entries SET title = 'marked'");
    const marked = () =>
      fx.db
        .query<{ title: string }, []>(
          "SELECT title FROM knowledge_entries WHERE slug = 'first-entry'",
        )
        .get()?.title === "marked";

    mark();
    ensureFresh(store, repo);
    expect(marked()).toBe(true);

    // An edit in place changes neither HEAD nor the folders: the dirty checks catch it.
    const file = entryFile(repo, "first-entry");
    const before = readdirSync(join(repo.path, "entries"));
    writeFileSync(file, `${readFileSync(file, "utf8")}Edited.\n`);
    expect(readdirSync(join(repo.path, "entries"))).toEqual(before);
    ensureFresh(store, repo);
    expect(marked()).toBe(true);

    // A commit by hand moves HEAD.
    realGit(repo.path, "add", "--", "entries/first-entry.md");
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
    );
    ensureFresh(store, repo);
    expect(marked()).toBe(false);
    expect(repoRow(repo)?.head).toBe(headOf(repo.path));

    // A file added by hand changes the fingerprint.
    mark();
    writeFileSync(entryFile(repo, "added"), byHand({ ...NOTE, id: crypto.randomUUID() }));
    // File systems with coarse timestamps: make the folder's change visible.
    utimesSync(join(repo.path, "entries"), new Date(), new Date(Date.now() + 5000));
    ensureFresh(store, repo);
    expect(marked()).toBe(false);
    expect(entryRow(repo, "added")).not.toBeNull();
  });
});

describe("rebuildAll", () => {
  function orphan(name: string): string {
    const relative = `knowledge/projects/${name}`;
    mkdirSync(repoPath(fx.dataDir, relative), { recursive: true });
    writeManifest(repoPath(fx.dataDir, relative), {
      format: 1,
      scope: "project",
      project: { aliases: [`gitdir:/nobody/${name}/.git`] },
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    return relative;
  }

  test("maps a project folder through its manifest, reports orphans, forgets folders that are gone", () => {
    const projectId = fx.addProject("gitdir:/x/.git", "path:/x");
    const ref = { scope: "project", projectId } as const;
    written("In the workspace");
    written("In the project", {}, ref as unknown as typeof WORKSPACE);
    const project = openRepo(store, ref) as Repo;
    const shared = ensureRepo(store, { scope: "shared" });
    const orphans = [orphan("orphan-a"), orphan("orphan-b")];
    rmSync(shared.path, { recursive: true, force: true });
    fx.db.run("DELETE FROM knowledge_entries");
    fx.db.run("DELETE FROM knowledge_repos WHERE scope = 'project'");

    const all = rebuildAll(store);
    expect(all.orphans.sort()).toEqual(orphans);
    expect([...all.results.keys()].sort()).toEqual(
      ["knowledge/workspace", project.relative].sort(),
    );
    expect(all.results.get(project.relative)).toMatchObject({ entries: 1, problems: 0 });
    expect(
      fx.db
        .query<{ scope: string; project_id: number; path: string }, []>(
          "SELECT scope, project_id, path FROM knowledge_repos ORDER BY path",
        )
        .all(),
    ).toEqual(
      [
        { scope: "project", project_id: projectId, path: project.relative },
        { scope: "workspace", project_id: 0, path: "knowledge/workspace" },
      ].sort((a, b) => a.path.localeCompare(b.path)),
    );
    expect(entryRows().map((row) => row.slug)).toEqual(
      expect.arrayContaining(["in-the-workspace", "in-the-project"]),
    );
    expect(entryRows()).toHaveLength(2);
  });

  test("with a scope, only that scope's repositories are touched", () => {
    const projectId = fx.addProject("gitdir:/x/.git", "path:/x");
    const ref = { scope: "project", projectId } as const;
    written("In the workspace");
    written("In the project", {}, ref as unknown as typeof WORKSPACE);
    const project = openRepo(store, ref) as Repo;
    fx.db.run("UPDATE knowledge_entries SET title = 'marked'");
    const only = rebuildAll(store, "project");
    expect([...only.results.keys()]).toEqual([project.relative]);
    expect(
      fx.db
        .query<{ slug: string; title: string }, []>(
          "SELECT slug, title FROM knowledge_entries ORDER BY slug",
        )
        .all(),
    ).toEqual([
      { slug: "in-the-project", title: "In the project" },
      { slug: "in-the-workspace", title: "marked" },
    ]);
    expect(rebuildAll(store, "shared").results.size).toBe(0);
  });
});

describe("adopt", () => {
  /** Three committed entries, then a person works in an editor. */
  function handWork(): { repo: Repo; edited: string; added: string } {
    written("Edited entry");
    written("Deleted entry");
    written("Untouched entry");
    const repo = workspace();
    const edited = readFileSync(entryFile(repo, "edited-entry"), "utf8").replace(
      "The body.",
      "The body, edited by hand.",
    );
    writeFileSync(entryFile(repo, "edited-entry"), edited);
    const added = byHand(NOTE, "Written in an editor.");
    writeFileSync(entryFile(repo, "added-entry"), added);
    rmSync(entryFile(repo, "deleted-entry"));
    return { repo, edited, added };
  }

  test("commits a person's hand edits as the person, in one commit", () => {
    const { repo } = handWork();
    const taxonomyFile = join(repo.path, "taxonomy.md");
    writeFileSync(
      taxonomyFile,
      readFileSync(taxonomyFile, "utf8").replace("  - people: People\n", "  - people: Team\n"),
    );
    const manifest = readManifest(repo.path);
    writeManifest(repo.path, {
      ...(manifest as NonNullable<typeof manifest>),
      createdAt: "edited",
    });
    const before = commits(repo);
    clock += 60_000;

    const result = adopt(store, WORKSPACE, person());
    expect(result).toEqual({ adopted: 5, problems: [] });
    expect(commits(repo)).toBe(before + 1);
    expect(realGit(repo.path, "log", "-1", "--format=%an|%s").trim()).toBe(
      "Zoë|knowledge: adopt 5 changes made outside the engine",
    );
    const body = realGit(repo.path, "log", "-1", "--format=%b");
    const paths = [
      "entries/added-entry.md",
      "entries/deleted-entry.md",
      "entries/edited-entry.md",
      "knowledge.json",
      "taxonomy.md",
    ];
    for (const path of paths) expect(body).toContain(path);
    expect(
      realGit(repo.path, "show", "--name-only", "--no-renames", "--format=", "HEAD")
        .trim()
        .split("\n")
        .sort(),
    ).toEqual(paths);
    expect(status(repo)).toEqual([""]);
    expect(readIntent(repo)).toBeNull();
    expect(
      readdirSync(join(repo.path, ".git")).filter((name) => name.startsWith("wizardingcode-")),
    ).toEqual([]);

    const edited = parseEntry(
      readFileSync(entryFile(repo, "edited-entry"), "utf8"),
      "edited-entry",
      null,
    );
    expect(edited).toMatchObject({
      version: 2,
      author: "Zoë",
      body: "The body, edited by hand.",
      problem: null,
    });
    expect(edited.updated).toBe(new Date(clock).toISOString());
    expect(edited.created).toBe(new Date(NOW).toISOString());
    const added = parseEntry(
      readFileSync(entryFile(repo, "added-entry"), "utf8"),
      "added-entry",
      null,
    );
    expect(added).toMatchObject({
      version: 1,
      author: "Zoë",
      title: "By hand",
      body: "Written in an editor.",
      problem: null,
    });
    expect(added.id).toMatch(UUID);
    expect(existsSync(entryFile(repo, "deleted-entry"))).toBe(false);
    expect(entryRow(repo, "deleted-entry")).toBeNull();
    expect(entryRow(repo, "edited-entry")).toMatchObject({
      version: 2,
      problem: null,
      status: "active",
    });
    expect(entryRow(repo, "added-entry")).toMatchObject({
      id: added.id,
      version: 1,
      problem: null,
    });
    expect(entryRow(repo, "untouched-entry")).toMatchObject({ version: 1, problem: null });
    const taxonomy = parseTaxonomy(readFileSync(taxonomyFile, "utf8"));
    expect("problem" in taxonomy ? [] : taxonomy.areas.at(-1)).toEqual({
      id: "people",
      label: "Team",
    });
    expect(readManifest(repo.path)?.createdAt).toBe("edited");
    expect(adopt(store, WORKSPACE, person())).toEqual({ adopted: 0, problems: [] });
  });

  test("a file that is still not an entry is committed as the person left it, and its problem returned", () => {
    const repo = ensureRepo(store, WORKSPACE);
    const text = byHand({ ...NOTE, kind: "rule" });
    writeFileSync(entryFile(repo, "odd"), text);
    const result = adopt(store, WORKSPACE, person());
    expect(result.adopted).toBe(1);
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]).toContain("entries/odd.md");
    expect(result.problems[0]).toContain("kind");
    expect(readFileSync(entryFile(repo, "odd"), "utf8")).toBe(text);
    expect(status(repo)).toEqual([""]);
    expect(entryRow(repo, "odd")).toMatchObject({ status: "draft" });
    expect(entryRow(repo, "odd")?.problem).toContain("kind");
  });

  test("a version a person lowered by hand still moves forward", () => {
    written("Edited entry");
    writeEntry(
      store,
      WORKSPACE,
      change({ slug: "edited-entry", title: "Edited entry", baseVersion: 1 }),
      person(),
    );
    const repo = workspace();
    const file = entryFile(repo, "edited-entry");
    writeFileSync(file, readFileSync(file, "utf8").replace("version: 2", "version: 1"));
    adopt(store, WORKSPACE, person());
    expect(entryRow(repo, "edited-entry")?.version).toBe(3);
  });

  test("a repository that does not exist has nothing to adopt", () => {
    expect(codeOf(() => adopt(store, { scope: "shared" }, person()))).toBe("missing");
  });

  test("a failed commit leaves the person's work exactly as it was, unstaged", () => {
    const { repo, edited, added } = handWork();
    const entries = entryRows();
    const broken = fx.store({
      now: () => clock,
      env: {
        WIZARDINGCODE_MEM_AUTHOR: "Zoë",
        PATH: fx.pathWith(
          stubGit(join(fx.dir, "failing-adopt"), { failOnce: "commit", stderr: "fatal: boom" }),
        ),
      },
    });
    expect(codeOf(() => adopt(broken, WORKSPACE, person()))).toBe("git");
    expect(status(repo)).toEqual([
      " D entries/deleted-entry.md",
      " M entries/edited-entry.md",
      "?? entries/added-entry.md",
    ]);
    expect(readFileSync(entryFile(repo, "edited-entry"), "utf8")).toBe(edited);
    expect(readFileSync(entryFile(repo, "added-entry"), "utf8")).toBe(added);
    expect(existsSync(entryFile(repo, "deleted-entry"))).toBe(false);
    expect(entryRows()).toEqual(entries);
    expect(readIntent(repo)).toBeNull();
    expect(
      readdirSync(join(repo.path, ".git")).filter((name) => name.startsWith("wizardingcode-")),
    ).toEqual([]);
    // And then it goes through.
    expect(adopt(broken, WORKSPACE, person()).adopted).toBe(3);
  });

  test("a repository a person put inside the knowledge folders is refused, and nothing is committed", () => {
    const { repo } = handWork();
    const nested = join(repo.path, "entries", "notes");
    mkdirSync(nested);
    realGit(nested, "init", "-q", "-b", "main");
    writeFileSync(join(nested, "f.md"), "x\n");
    const before = commits(repo);

    const call = () => adopt(store, WORKSPACE, person());
    expect(codeOf(call)).toBe("invalid");
    expect(thrown(call).message).toContain("entries/notes");
    expect(commits(repo)).toBe(before);
    expect(readIntent(repo)).toBeNull();
    expect(status(repo)).toContain(" M entries/edited-entry.md");
    // Moved out of the knowledge folders, it no longer stops the person's work.
    rmSync(nested, { recursive: true });
    expect(adopt(store, WORKSPACE, person()).adopted).toBe(3);
  });

  test("an adopt that stops midway is undone at every path, each said once", () => {
    const { repo, edited, added } = handWork();
    const taxonomyFile = join(repo.path, "taxonomy.md");
    const taxonomy = readFileSync(taxonomyFile, "utf8").replace("  - people: People\n", "");
    writeFileSync(taxonomyFile, taxonomy);
    writeFileSync(join(repo.path, "entries", "notes.txt"), "not an entry\n");
    const handState = status(repo);
    // The commit fails, and so does the first attempt to take the paths out of the index.
    const broken = fx.store({
      now: () => clock,
      env: {
        WIZARDINGCODE_MEM_AUTHOR: "Zoë",
        PATH: fx.pathWith(
          stubGit(join(fx.dir, "stopping-adopt"), {
            fail: "commit",
            failOnce: "reset",
            stderr: "fatal: boom",
          }),
        ),
      },
    });
    expect(codeOf(() => adopt(broken, WORKSPACE, person()))).toBe("git");

    // The record says what the adopt left at each of its paths, a removal included.
    const record = readIntent(repo);
    expect(Object.keys(record?.written ?? {}).sort()).toEqual([
      "entries/added-entry.md",
      "entries/deleted-entry.md",
      "entries/edited-entry.md",
      "entries/notes.txt",
      "taxonomy.md",
    ]);
    expect(record?.written?.["entries/deleted-entry.md"]).toBeNull();
    expect(record?.written?.["taxonomy.md"]).toBe(hashOf(Buffer.from(taxonomy)));
    expect(record?.written?.["entries/notes.txt"]).toBe(hashOf(Buffer.from("not an entry\n")));

    const said: string[] = [];
    store.report = (message) => said.push(message);
    openRepo(store, WORKSPACE);
    expect(status(repo)).toEqual(handState);
    expect(readFileSync(entryFile(repo, "edited-entry"), "utf8")).toBe(edited);
    expect(readFileSync(entryFile(repo, "added-entry"), "utf8")).toBe(added);
    expect(readFileSync(taxonomyFile, "utf8")).toBe(taxonomy);
    expect(readIntent(repo)).toBeNull();
    expect(said).toHaveLength(1);
    expect(said[0]).toContain("was undone");
    for (const path of Object.keys(record?.written ?? {})) expect(said[0]).toContain(path);
  });

  test("a repository killed mid-adopt gets the person's bytes back at the next open", () => {
    written("Edited entry");
    const repo = workspace();
    const file = entryFile(repo, "edited-entry");
    const hand = readFileSync(file, "utf8").replace("The body.", "The person's own words.");
    const kept = keepBytes(repo, new Map([["entries/edited-entry.md", Buffer.from(hand)]]));
    // The adopt had rewritten and staged the file when the process died.
    const rewritten = hand.replace("version: 1", "version: 2");
    writeFileSync(file, rewritten);
    realGit(repo.path, "add", "--", "entries/edited-entry.md");
    writeIntent(repo, {
      operation: "adopt",
      writer: person(),
      existed: ["entries/edited-entry.md"],
      created: [],
      written: { "entries/edited-entry.md": hashOf(Buffer.from(rewritten)) },
      keptBytesFile: kept,
    });

    openRepo(store, WORKSPACE);
    expect(readFileSync(file, "utf8")).toBe(hand);
    expect(status(repo)).toEqual([" M entries/edited-entry.md"]);
    expect(readIntent(repo)).toBeNull();
    expect(existsSync(join(repo.path, ".git", kept))).toBe(false);
  });
});
