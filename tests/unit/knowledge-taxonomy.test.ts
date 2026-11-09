import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { agentWriter, personAuthor } from "../../src/modules/knowledge/author.ts";
import { DEFAULT_AREAS } from "../../src/modules/knowledge/entry.ts";
import { ensureRepo, leaseKey, openRepo, taxonomyFor } from "../../src/modules/knowledge/repo.ts";
import { rejectProposal, writeEntry } from "../../src/modules/knowledge/store.ts";
import {
  addArea,
  readTaxonomy,
  removeArea,
  renameArea,
} from "../../src/modules/knowledge/taxonomy.ts";
import type { EntryChange, KnowledgeStore, Repo } from "../../src/modules/knowledge/types.ts";
import { setMeta } from "../../src/store/meta.ts";
import { codeOf, type Fixture, knowledgeFixture, thrown } from "../helpers/knowledge.ts";
import { realGit } from "../helpers/stub-git.ts";

const WORKSPACE = { scope: "workspace" } as const;
const SHARED = { scope: "shared" } as const;
const agent = agentWriter("claude-code");
const NOW = Date.UTC(2026, 10, 9, 8, 0, 0);

let fx: Fixture;
let store: KnowledgeStore;
let clock: number;
beforeEach(() => {
  fx = knowledgeFixture("knowledge-taxonomy");
  clock = NOW;
  store = fx.store({ now: () => clock, env: { WIZARDINGCODE_MEM_AUTHOR: "Zoë" } });
});
afterEach(() => {
  fx.close();
});

const person = () => personAuthor(store);
const change = (over: Partial<EntryChange> = {}): EntryChange => ({
  title: "Discovery call script",
  kind: "strategy",
  area: "sales",
  context: "",
  subject: "",
  body: "The body.",
  ...over,
});
const workspace = (): Repo => openRepo(store, WORKSPACE) as Repo;
const commits = (repo: Repo) => Number(realGit(repo.path, "rev-list", "--count", "HEAD").trim());
const lastCommit = (repo: Repo) => realGit(repo.path, "log", "-1", "--format=%an|%s").trim();
const lastPaths = (repo: Repo) =>
  realGit(repo.path, "show", "--name-only", "--format=", "HEAD").trim();
const ids = (taxonomy: { areas: { id: string }[] }) => taxonomy.areas.map((area) => area.id);

describe("reading the taxonomy", () => {
  test("a fresh workspace repository holds the nine areas at version 1", () => {
    ensureRepo(store, WORKSPACE);
    const taxonomy = readTaxonomy(store, WORKSPACE);
    expect(taxonomy.areas).toEqual(DEFAULT_AREAS);
    expect(taxonomy.version).toBe(1);
    expect(taxonomy.updated).toBe(new Date(NOW).toISOString());
  });

  test("a repository that does not exist has no taxonomy to read", () => {
    expect(codeOf(() => readTaxonomy(store, WORKSPACE))).toBe("missing");
  });

  test("a project reads the workspace's taxonomy; the shared repository reads its own", () => {
    const projectId = fx.addProject("gitdir:/x/.git", "path:/x");
    const project = { scope: "project", projectId } as const;
    expect(taxonomyFor(store, WORKSPACE)).toBeNull();
    expect(taxonomyFor(store, project)).toBeNull();
    expect(taxonomyFor(store, SHARED)).toBeNull();

    addArea(store, WORKSPACE, "legal", "Legal", person());
    expect(
      ids(taxonomyFor(store, project) as NonNullable<ReturnType<typeof taxonomyFor>>),
    ).toContain("legal");
    expect(taxonomyFor(store, SHARED)).toBeNull();
    ensureRepo(store, SHARED);
    expect(taxonomyFor(store, SHARED)?.areas).toEqual(DEFAULT_AREAS);

    // A project entry is checked against the workspace's areas, a shared one against its own.
    expect(writeEntry(store, project, change({ area: "legal" }), person()).kind).toBe("written");
    expect(codeOf(() => writeEntry(store, SHARED, change({ area: "legal" }), person()))).toBe(
      "invalid",
    );
    addArea(store, SHARED, "partners", "Partners", person());
    expect(writeEntry(store, SHARED, change({ area: "partners" }), person()).kind).toBe("written");
    expect(
      codeOf(() =>
        writeEntry(store, project, change({ title: "Other", area: "partners" }), person()),
      ),
    ).toBe("invalid");
  });
});

describe("addArea", () => {
  test("appends the area in one commit that touches only taxonomy.md", () => {
    ensureRepo(store, WORKSPACE);
    const repo = workspace();
    const before = commits(repo);
    clock += 60_000;
    const taxonomy = addArea(store, WORKSPACE, "legal", "Legal", person());
    expect(taxonomy.version).toBe(2);
    expect(taxonomy.updated).toBe(new Date(clock).toISOString());
    expect(taxonomy.areas.at(-1)).toEqual({ id: "legal", label: "Legal" });
    expect(ids(taxonomy)).toHaveLength(10);
    expect(readTaxonomy(store, WORKSPACE)).toEqual(taxonomy);
    expect(commits(repo)).toBe(before + 1);
    expect(lastCommit(repo)).toBe("Zoë|knowledge: taxonomy add legal");
    expect(lastPaths(repo)).toBe("taxonomy.md");
    expect(realGit(repo.path, "status", "--porcelain")).toBe("");
  });

  test("creates the repository when it is the first thing a person does", () => {
    const taxonomy = addArea(store, WORKSPACE, "legal", "Legal", person());
    expect(ids(taxonomy)).toHaveLength(10);
    expect(commits(workspace())).toBe(2);
  });

  test("refuses an id that is present, a bad id, and values over their limits", () => {
    ensureRepo(store, WORKSPACE);
    expect(codeOf(() => addArea(store, WORKSPACE, "code", "Code again", person()))).toBe("exists");
    expect(codeOf(() => addArea(store, WORKSPACE, "Legal!", "Legal", person()))).toBe("invalid");
    expect(codeOf(() => addArea(store, WORKSPACE, "a".repeat(41), "Long", person()))).toBe(
      "invalid",
    );
    expect(codeOf(() => addArea(store, WORKSPACE, "long", "L".repeat(61), person()))).toBe(
      "invalid",
    );
    expect(codeOf(() => addArea(store, WORKSPACE, "empty", "  ", person()))).toBe("invalid");
    expect(codeOf(() => addArea(store, WORKSPACE, "lines", "a\nb", person()))).toBe("invalid");
    expect(ids(addArea(store, WORKSPACE, "a".repeat(40), "L".repeat(60), person()))).toHaveLength(
      10,
    );
    expect(commits(workspace())).toBe(2);
  });

  test("a taxonomy edited by hand is adopted first", () => {
    ensureRepo(store, WORKSPACE);
    const file = join(workspace().path, "taxonomy.md");
    writeFileSync(file, readFileSync(file, "utf8").replace("People", "Team"));
    const call = () => addArea(store, WORKSPACE, "legal", "Legal", person());
    expect(codeOf(call)).toBe("dirty");
    expect(thrown(call).message).toContain("knowledge adopt");
    expect(codeOf(() => renameArea(store, WORKSPACE, "code", "Engineering", person()))).toBe(
      "dirty",
    );
    expect(codeOf(() => removeArea(store, WORKSPACE, "video", person()))).toBe("dirty");
  });

  test("only a person changes the taxonomy", () => {
    const asAgent = agent as unknown as ReturnType<typeof person>;
    expect(codeOf(() => addArea(store, WORKSPACE, "legal", "Legal", asAgent))).toBe("invalid");
    expect(codeOf(() => renameArea(store, WORKSPACE, "code", "Engineering", asAgent))).toBe(
      "invalid",
    );
    expect(codeOf(() => removeArea(store, WORKSPACE, "video", asAgent))).toBe("invalid");
  });
});

describe("renameArea", () => {
  test("changes one label in one commit and no entry", () => {
    writeEntry(store, WORKSPACE, change({ area: "people" }), person());
    const repo = workspace();
    const entryFile = join(repo.path, "entries", "discovery-call-script.md");
    const text = readFileSync(entryFile, "utf8");
    const before = commits(repo);
    const taxonomy = renameArea(store, WORKSPACE, "people", "Team", person());
    expect(taxonomy.areas.at(-1)).toEqual({ id: "people", label: "Team" });
    expect(ids(taxonomy)).toEqual(DEFAULT_AREAS.map((area) => area.id));
    expect(taxonomy.version).toBe(2);
    expect(commits(repo)).toBe(before + 1);
    expect(lastCommit(repo)).toBe("Zoë|knowledge: taxonomy rename people");
    expect(lastPaths(repo)).toBe("taxonomy.md");
    expect(readFileSync(entryFile, "utf8")).toBe(text);
  });

  test("an area that does not exist cannot be renamed", () => {
    ensureRepo(store, WORKSPACE);
    expect(codeOf(() => renameArea(store, WORKSPACE, "legal", "Legal", person()))).toBe("missing");
    expect(codeOf(() => renameArea(store, WORKSPACE, "code", "", person()))).toBe("invalid");
  });
});

describe("removeArea", () => {
  test("is refused while an entry of the workspace or of a project carries the area", () => {
    const projectId = fx.addProject("gitdir:/x/.git", "path:/x");
    const project = { scope: "project", projectId } as const;
    writeEntry(store, project, change({ title: "A sales play", area: "sales" }), person());
    const proposal = writeEntry(
      store,
      WORKSPACE,
      change({ title: "A clip", area: "video" }),
      agent,
    );
    if (proposal.kind !== "proposed") throw new Error("expected a proposal");

    const bySales = () => removeArea(store, WORKSPACE, "sales", person());
    expect(codeOf(bySales)).toBe("invalid");
    expect(thrown(bySales).message).toContain("a-sales-play");
    const byVideo = () => removeArea(store, WORKSPACE, "video", person());
    expect(codeOf(byVideo)).toBe("invalid");
    expect(thrown(byVideo).message).toContain(proposal.proposal.id);

    // A stale index does not hide the entry: the repositories are read again first.
    fx.db.run("DELETE FROM knowledge_entries");
    expect(codeOf(bySales)).toBe("invalid");

    writeEntry(
      store,
      project,
      change({ slug: "a-sales-play", title: "A sales play", area: "marketing", baseVersion: 1 }),
      person(),
    );
    rejectProposal(store, WORKSPACE, proposal.proposal.id, person());
    const repo = workspace();
    const before = commits(repo);
    const afterSales = removeArea(store, WORKSPACE, "sales", person());
    expect(ids(afterSales)).not.toContain("sales");
    expect(lastCommit(repo)).toBe("Zoë|knowledge: taxonomy remove sales");
    expect(lastPaths(repo)).toBe("taxonomy.md");
    const afterVideo = removeArea(store, WORKSPACE, "video", person());
    expect(ids(afterVideo)).toEqual([
      "code",
      "management",
      "marketing",
      "design",
      "operations",
      "finance",
      "people",
    ]);
    expect(afterVideo.version).toBe(3);
    expect(commits(repo)).toBe(before + 2);
    // The area is gone for new writes.
    expect(codeOf(() => writeEntry(store, WORKSPACE, change({ area: "sales" }), person()))).toBe(
      "invalid",
    );
  });

  test("an area that does not exist cannot be removed", () => {
    ensureRepo(store, WORKSPACE);
    expect(codeOf(() => removeArea(store, WORKSPACE, "legal", person()))).toBe("missing");
  });

  test("the shared repository's areas are its own", () => {
    writeEntry(store, WORKSPACE, change({ area: "sales" }), person());
    ensureRepo(store, SHARED);
    expect(ids(removeArea(store, SHARED, "sales", person()))).not.toContain("sales");
    expect(ids(readTaxonomy(store, WORKSPACE))).toContain("sales");
  });

  test("is refused while a project repository is being written", () => {
    const projectId = fx.addProject("gitdir:/x/.git", "path:/x");
    const project = { scope: "project", projectId } as const;
    writeEntry(store, project, change({ area: "code" }), person());
    const repo = openRepo(store, project) as Repo;
    setMeta(
      fx.db,
      leaseKey(repo.relative),
      JSON.stringify({ owner: `${process.pid}-other`, until: clock + 60_000 }),
    );
    expect(codeOf(() => removeArea(store, WORKSPACE, "video", person()))).toBe("locked");
    expect(ids(readTaxonomy(store, WORKSPACE))).toContain("video");
  });
});
