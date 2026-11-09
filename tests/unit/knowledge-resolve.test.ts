import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  ensureRepo,
  leaseKey,
  openRepo,
  projectFolderName,
  readManifest,
  repoPath,
  writeManifest,
} from "../../src/modules/knowledge/repo.ts";
import { listRepos, resolveRepo } from "../../src/modules/knowledge/resolve.ts";
import type { Manifest } from "../../src/modules/knowledge/types.ts";
import { setMeta } from "../../src/store/meta.ts";
import { codeOf, type Fixture, knowledgeFixture, thrown } from "../helpers/knowledge.ts";
import { realGit, stubGit } from "../helpers/stub-git.ts";

const person = { kind: "person", name: "you", source: "default" } as const;

let fx: Fixture;
beforeEach(() => {
  fx = knowledgeFixture("knowledge-resolve");
});
afterEach(() => {
  fx.close();
});

const project = (projectId: number) => ({ scope: "project", projectId }) as const;

const rows = () =>
  fx.db
    .query<{ scope: string; project_id: number; path: string }, []>(
      "SELECT scope, project_id, path FROM knowledge_repos ORDER BY path",
    )
    .all();

/** A project folder with a manifest, as another machine or an older store would have left it. */
function folderWith(name: string, aliases: string[], createdAt: string): string {
  const relative = `knowledge/projects/${name}`;
  mkdirSync(repoPath(fx.dataDir, relative), { recursive: true });
  const manifest: Manifest = { format: 1, scope: "project", project: { aliases }, createdAt };
  writeManifest(repoPath(fx.dataDir, relative), manifest);
  return relative;
}

describe("resolveRepo", () => {
  test("no repository and no create is null, and nothing is written", () => {
    const store = fx.store();
    const id = fx.addProject("gitdir:/x/.git", "path:/x");
    expect(resolveRepo(store, { scope: "workspace" }, {})).toBeNull();
    expect(resolveRepo(store, { scope: "shared" }, {})).toBeNull();
    expect(resolveRepo(store, project(id), {})).toBeNull();
    expect(existsSync(join(fx.dataDir, "knowledge"))).toBe(false);
    expect(rows()).toEqual([]);
  });

  test("a project with no remote gets a folder named from its key, a manifest and a row", () => {
    const store = fx.store();
    const id = fx.addProject("gitdir:/x/.git", "path:/x");
    const repo = resolveRepo(store, project(id), { create: person });
    const relative = `knowledge/projects/${projectFolderName("gitdir:/x/.git")}`;
    expect(repo).toMatchObject({ ref: project(id), relative });
    expect(repo?.path).toBe(repoPath(fx.dataDir, relative));
    expect(readManifest(repo?.path as string)).toMatchObject({
      format: 1,
      scope: "project",
      project: { aliases: ["gitdir:/x/.git", "path:/x"] },
    });
    expect(rows()).toEqual([{ scope: "project", project_id: id, path: relative }]);
  });

  test("a project with a remote gets a folder named from the remote", () => {
    const store = fx.store();
    const id = fx.addProject("gitdir:/x/.git", "remote:github.com/x/y", "path:/x");
    const repo = resolveRepo(store, project(id), { create: person });
    expect(repo?.relative).toBe(`knowledge/projects/${projectFolderName("remote:github.com/x/y")}`);
    expect(readManifest(repo?.path as string)?.project?.aliases).toEqual([
      "remote:github.com/x/y",
      "gitdir:/x/.git",
      "path:/x",
    ]);
  });

  test("a project that gains a remote keeps its folder", () => {
    const store = fx.store();
    const id = fx.addProject("gitdir:/x/.git", "path:/x");
    const first = resolveRepo(store, project(id), { create: person });
    fx.db.run(
      "INSERT INTO project_aliases (alias, project_id) VALUES ('remote:github.com/x/y', ?)",
      [id],
    );
    const second = resolveRepo(store, project(id), { create: person });
    expect(second?.relative).toBe(first?.relative as string);
    expect(second?.id).toBe(first?.id as number);
    // Resolving writes no file of an existing repository: the manifest is as it was.
    expect(readManifest(second?.path as string)?.project?.aliases).toEqual([
      "gitdir:/x/.git",
      "path:/x",
    ]);
  });

  test("the manifest learns a gained remote at the next write, in a commit of its own", () => {
    const store = fx.store({ env: { WIZARDINGCODE_MEM_AUTHOR: "Writer" } });
    const id = fx.addProject("gitdir:/x/.git", "path:/x");
    const first = ensureRepo(store, project(id));
    const commits = () => Number(realGit(first.path, "rev-list", "--count", "HEAD").trim());
    expect(commits()).toBe(1);
    fx.db.run(
      "INSERT INTO project_aliases (alias, project_id) VALUES ('remote:github.com/x/y', ?)",
      [id],
    );

    // Reading does not teach it: only a write path does.
    expect(openRepo(store, project(id))?.relative).toBe(first.relative);
    expect(commits()).toBe(1);

    const second = ensureRepo(store, project(id));
    expect(second.relative).toBe(first.relative);
    expect(readManifest(second.path)?.project?.aliases).toEqual([
      "gitdir:/x/.git",
      "path:/x",
      "remote:github.com/x/y",
    ]);
    expect(commits()).toBe(2);
    expect(realGit(first.path, "log", "-1", "--format=%an|%s").trim()).toBe(
      "Writer|knowledge: manifest learns an alias of its project",
    );
    expect(realGit(first.path, "show", "--name-only", "--format=", "HEAD").trim()).toBe(
      "knowledge.json",
    );
    // Nothing is left for adopt to credit to the person.
    expect(realGit(first.path, "status", "--porcelain")).toBe("");
    ensureRepo(store, project(id));
    expect(commits()).toBe(2);
  });

  test("the manifest's commit waits while another process holds the repository", () => {
    const store = fx.store({ env: { WIZARDINGCODE_MEM_AUTHOR: "Writer" } });
    const id = fx.addProject("gitdir:/x/.git", "path:/x");
    const first = ensureRepo(store, project(id));
    const commits = () => Number(realGit(first.path, "rev-list", "--count", "HEAD").trim());
    fx.db.run(
      "INSERT INTO project_aliases (alias, project_id) VALUES ('remote:github.com/x/y', ?)",
      [id],
    );
    // Another live process is working in the project's repository.
    const key = leaseKey(first.relative);
    setMeta(
      fx.db,
      key,
      JSON.stringify({ owner: `${process.pid}-writer`, until: store.now() + 60_000 }),
    );

    expect(ensureRepo(store, project(id)).relative).toBe(first.relative);
    expect(commits()).toBe(1);
    expect(readManifest(first.path)?.project?.aliases).toEqual(["gitdir:/x/.git", "path:/x"]);
    expect(realGit(first.path, "status", "--porcelain")).toBe("");

    // Once that process is done, the next write teaches the manifest.
    fx.db.run("DELETE FROM meta WHERE key = ?", [key]);
    ensureRepo(store, project(id));
    expect(commits()).toBe(2);
    expect(readManifest(first.path)?.project?.aliases).toContain("remote:github.com/x/y");
  });

  test("a manifest change that stopped midway is put back, never left for adopt", () => {
    const store = fx.store({ env: { WIZARDINGCODE_MEM_AUTHOR: "Writer" } });
    const id = fx.addProject("gitdir:/x/.git", "path:/x");
    const first = ensureRepo(store, project(id));
    const commits = () => Number(realGit(first.path, "rev-list", "--count", "HEAD").trim());
    fx.db.run(
      "INSERT INTO project_aliases (alias, project_id) VALUES ('remote:github.com/x/y', ?)",
      [id],
    );
    // The commit fails, and so does the first attempt to put the manifest back.
    const broken = fx.store({
      env: {
        WIZARDINGCODE_MEM_AUTHOR: "Writer",
        PATH: fx.pathWith(
          stubGit(join(fx.dir, "stopping-git"), {
            fail: "commit",
            failOnce: "restore",
            stderr: "fatal: boom",
          }),
        ),
      },
    });
    const failure = thrown(() => ensureRepo(broken, project(id)));
    expect(
      codeOf(() => {
        throw failure;
      }),
    ).toBe("git");
    // The commit is what failed first, and it is its error the caller sees.
    expect(failure.message).toContain("git commit");
    expect(realGit(first.path, "status", "--porcelain").trim()).toBe("M  knowledge.json");

    // The next write puts the engine's own change back, then makes it again in a commit.
    ensureRepo(store, project(id));
    expect(realGit(first.path, "status", "--porcelain")).toBe("");
    expect(commits()).toBe(2);
    expect(readManifest(first.path)?.project?.aliases).toContain("remote:github.com/x/y");
  });

  test("a manifest the person is editing is left to them", () => {
    const store = fx.store();
    const id = fx.addProject("gitdir:/x/.git", "path:/x");
    const repo = ensureRepo(store, project(id));
    const manifest = readManifest(repo.path) as Manifest;
    writeManifest(repo.path, { ...manifest, createdAt: "edited by hand" });
    fx.db.run(
      "INSERT INTO project_aliases (alias, project_id) VALUES ('remote:github.com/x/y', ?)",
      [id],
    );
    ensureRepo(store, project(id));
    expect(readManifest(repo.path)).toMatchObject({
      createdAt: "edited by hand",
      project: { aliases: ["gitdir:/x/.git", "path:/x"] },
    });
    expect(realGit(repo.path, "rev-list", "--count", "HEAD").trim()).toBe("1");
  });

  test("with the rows lost, the folder is found through the manifest and the row rewritten", () => {
    const store = fx.store();
    const id = fx.addProject("gitdir:/x/.git", "path:/x");
    const first = resolveRepo(store, project(id), { create: person });
    fx.db.run("DELETE FROM knowledge_repos");
    const again = resolveRepo(store, project(id), {});
    expect(again?.relative).toBe(first?.relative as string);
    expect(rows()).toEqual([{ scope: "project", project_id: id, path: first?.relative as string }]);
  });

  test("a manifest that shares only a path alias is not the project's", () => {
    const store = fx.store();
    const other = folderWith(
      "other",
      ["gitdir:/elsewhere/.git", "path:/x"],
      "2026-01-01T00:00:00.000Z",
    );
    const id = fx.addProject("gitdir:/x/.git", "path:/x");
    expect(resolveRepo(store, project(id), {})).toBeNull();
    const repo = resolveRepo(store, project(id), { create: person });
    expect(repo?.relative).not.toBe(other);
    expect(repo?.relative).toBe(`knowledge/projects/${projectFolderName("gitdir:/x/.git")}`);
  });

  test("of two manifests, the one matched by the remote is taken and the other is ambiguous", () => {
    const store = fx.store();
    const byGitDir = folderWith("aaa", ["gitdir:/x/.git"], "2026-06-01T00:00:00.000Z");
    const byRemote = folderWith("bbb", ["remote:github.com/x/y"], "2026-01-01T00:00:00.000Z");
    const id = fx.addProject("remote:github.com/x/y", "gitdir:/x/.git", "path:/x");
    expect(resolveRepo(store, project(id), {})?.relative).toBe(byRemote);
    const listed = listRepos(store);
    expect(listed.ambiguous).toEqual([{ projectId: id, taken: byRemote, others: [byGitDir] }]);
    expect(listed.orphans).toEqual([]);
    expect(listed.repos.map((repo) => repo.relative)).toEqual([byRemote]);
  });

  test("of two manifests matched the same way, the newest is taken", () => {
    const store = fx.store();
    folderWith("aaa", ["gitdir:/x/.git"], "2026-01-01T00:00:00.000Z");
    const newest = folderWith("bbb", ["gitdir:/x/.git"], "2026-06-01T00:00:00.000Z");
    const id = fx.addProject("gitdir:/x/.git", "path:/x");
    expect(resolveRepo(store, project(id), {})?.relative).toBe(newest);
  });

  test("a manifest mapped to one project is never taken by a second, and is reported", () => {
    const store = fx.store();
    const folder = folderWith("aaa", ["gitdir:/x/.git"], "2026-01-01T00:00:00.000Z");
    const first = fx.addProject("gitdir:/x/.git");
    expect(resolveRepo(store, project(first), {})?.relative).toBe(folder);
    // The git directory now belongs to another project (a folder reused by a new repository).
    const second = fx.addProject("remote:github.com/new/repo");
    fx.db.run("UPDATE project_aliases SET project_id = ? WHERE alias = 'gitdir:/x/.git'", [second]);

    expect(resolveRepo(store, project(second), {})).toBeNull();
    const created = resolveRepo(store, project(second), { create: person });
    expect(created?.relative).not.toBe(folder);
    expect(listRepos(store).claimed).toEqual([
      { path: folder, byProjectId: first, wantedBy: second },
    ]);
    expect(resolveRepo(store, project(first), {})?.relative).toBe(folder);
  });

  test("a second project whose folder name collides gets a numbered folder", () => {
    const store = fx.store();
    const one = fx.addProject("gitdir:/one/.git");
    const two = fx.addProject("gitdir:/two/.git");
    const three = fx.addProject("gitdir:/three/.git");
    const options = { create: person, folderName: () => "same" };
    expect(resolveRepo(store, project(one), options)?.relative).toBe("knowledge/projects/same");
    expect(resolveRepo(store, project(two), options)?.relative).toBe("knowledge/projects/same-2");
    expect(resolveRepo(store, project(three), options)?.relative).toBe("knowledge/projects/same-3");
    expect(resolveRepo(store, project(one), options)?.relative).toBe("knowledge/projects/same");
  });

  test("a project that does not exist is refused", () => {
    expect(codeOf(() => resolveRepo(fx.store(), project(99), { create: person }))).toBe("missing");
  });
});

describe("listRepos", () => {
  test("lists the three scopes' repositories, and a folder with no manifest as an orphan", () => {
    const store = fx.store();
    const id = fx.addProject("gitdir:/x/.git", "path:/x");
    ensureRepo(store, { scope: "shared" });
    const mine = ensureRepo(store, project(id));
    mkdirSync(repoPath(fx.dataDir, "knowledge/projects/stray"));
    const unknown = folderWith("unknown", ["gitdir:/nobody/.git"], "2026-01-01T00:00:00.000Z");

    const listed = listRepos(store);
    expect(listed.repos.map((repo) => [repo.ref.scope, repo.relative])).toEqual([
      ["workspace", "knowledge/workspace"],
      ["shared", "knowledge/shared"],
      ["project", mine.relative],
    ]);
    expect(listed.orphans.sort()).toEqual(["knowledge/projects/stray", unknown].sort());
    expect(listed.ambiguous).toEqual([]);
    expect(listed.claimed).toEqual([]);
    // An orphan gets no row.
    expect(rows().map((row) => row.path)).toEqual(
      [mine.relative, "knowledge/shared", "knowledge/workspace"].sort(),
    );
  });

  test("nothing at all is an empty answer", () => {
    expect(listRepos(fx.store())).toEqual({ repos: [], orphans: [], ambiguous: [], claimed: [] });
  });
});
