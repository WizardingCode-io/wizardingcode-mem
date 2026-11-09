import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { identityOf, personAuthor } from "../../src/modules/knowledge/author.ts";
import { DEFAULT_AREAS } from "../../src/modules/knowledge/entry.ts";
import {
  checkRepoConfig,
  clearIntent,
  commitPaths,
  ensureRepo,
  ensureSupportFolders,
  fingerprintOf,
  GIT_MIN_VERSION,
  GIT_TIMEOUT_MS,
  headOf,
  KNOWLEDGE_LEASE_MS,
  knowledgeRoot,
  leaseKey,
  openRepo,
  parseGitVersion,
  projectFolderName,
  readIntent,
  readManifest,
  removePaths,
  repoFolder,
  requireGit,
  resetGitCaches,
  rootOf,
  runGit,
  stagePaths,
  statusOf,
  supportPaths,
  taxonomyFor,
  undoStaged,
  unstage,
  withRepoLeases,
  writeIntent,
} from "../../src/modules/knowledge/repo.ts";
import type { KnowledgeStore, Repo } from "../../src/modules/knowledge/types.ts";
import { anyLeaseActive, getMeta, leaseActive, setMeta } from "../../src/store/meta.ts";
import { codeOf, type Fixture, knowledgeFixture, thrown } from "../helpers/knowledge.ts";
import { realGit, stubGit } from "../helpers/stub-git.ts";

const WORKSPACE = { scope: "workspace" } as const;
const SHARED = { scope: "shared" } as const;
const unix = process.platform !== "win32";
const mode = (path: string) => statSync(path).mode & 0o777;

let fx: Fixture;
beforeEach(() => {
  fx = knowledgeFixture("knowledge-repo");
});
afterEach(() => {
  fx.close();
});

/** Writes a file and commits it by path, as the store does. */
function commitFile(store: KnowledgeStore, repo: Repo, path: string, text: string): void {
  writeFileSync(join(repo.path, path), text);
  stagePaths(store, repo, [path], "write");
  commitPaths(store, repo, [path], `test: ${path}`, identityOf(personAuthor(store)), "write");
}

describe("names and versions", () => {
  test("the constants", () => {
    expect(GIT_TIMEOUT_MS).toBe(15000);
    expect(KNOWLEDGE_LEASE_MS).toBe(60000);
    expect(GIT_MIN_VERSION).toEqual([2, 32, 0]);
    expect(leaseKey("knowledge/workspace")).toBe("knowledge.lease:knowledge/workspace");
    expect(knowledgeRoot("/d")).toBe(join("/d", "knowledge"));
    expect(rootOf(SHARED)).toEqual(SHARED);
    expect(rootOf(WORKSPACE)).toEqual(WORKSPACE);
    expect(rootOf({ scope: "project", projectId: 3 })).toEqual(WORKSPACE);
  });

  test("each scope has its folder under knowledge/", () => {
    expect(repoFolder(WORKSPACE)).toBe("knowledge/workspace");
    expect(repoFolder(SHARED)).toBe("knowledge/shared");
    expect(repoFolder({ scope: "project", projectId: 1 }, "abc")).toBe("knowledge/projects/abc");
  });

  test("a project folder is named by 16 hex of its alias", () => {
    const one = projectFolderName("remote:github.com/x/y");
    expect(one).toMatch(/^[0-9a-f]{16}$/);
    expect(projectFolderName("remote:github.com/x/z")).not.toBe(one);
    expect(projectFolderName("remote:github.com/x/y")).toBe(one);
  });

  test("parseGitVersion", () => {
    expect(parseGitVersion("git version 2.54.0 (Apple Git-157)")).toEqual([2, 54, 0]);
    expect(parseGitVersion("git version 2.39.5\n")).toEqual([2, 39, 5]);
    expect(parseGitVersion("nonsense")).toBeNull();
  });

  test("an old git is refused with the version it found", () => {
    const stub = stubGit(join(fx.dir, "old-git"), { version: "2.31.0" });
    resetGitCaches();
    const error = thrown(() => requireGit(fx.store({ env: { PATH: fx.pathWith(stub) } })));
    expect(codeOf(() => requireGit(fx.store({ env: { PATH: fx.pathWith(stub) } })))).toBe("git");
    expect(error.message).toBe("git 2.32 or newer is needed to version knowledge; found 2.31.0");
  });

  test("no git is refused, saying it found nothing", () => {
    const error = thrown(() => requireGit(fx.store({ env: { PATH: fx.emptyBin() } })));
    expect(error.message).toBe("git 2.32 or newer is needed to version knowledge; found nothing");
  });

  test("the git on this machine is accepted, once per PATH", () => {
    const version = requireGit(fx.store());
    expect(version.length).toBe(3);
    expect(requireGit(fx.store())).toBe(version);
  });
});

describe("the support folders", () => {
  test("an empty template, a folder with no hooks and an empty configuration", () => {
    ensureSupportFolders(fx.dataDir);
    const paths = supportPaths(fx.dataDir);
    expect(paths).toEqual({
      template: join(fx.dataDir, "knowledge", ".template"),
      noHooks: join(fx.dataDir, "knowledge", ".no-hooks"),
      emptyConfig: join(fx.dataDir, "knowledge", ".gitconfig-empty"),
    });
    expect(statSync(paths.template).isDirectory()).toBe(true);
    expect(statSync(paths.noHooks).isDirectory()).toBe(true);
    expect(readFileSync(paths.emptyConfig, "utf8")).toBe("");
    if (unix) {
      expect(mode(join(fx.dataDir, "knowledge"))).toBe(0o700);
      expect(mode(paths.template)).toBe(0o700);
      expect(mode(paths.noHooks)).toBe(0o700);
      expect(mode(paths.emptyConfig)).toBe(0o600);
    }
  });
});

describe("ensureRepo", () => {
  test("creates the workspace repository with its files, its folders and one commit by the person", () => {
    const store = fx.store({ env: { WIZARDINGCODE_MEM_AUTHOR: "André Agro" } });
    const repo = ensureRepo(store, WORKSPACE);
    expect(repo.relative).toBe("knowledge/workspace");
    expect(repo.path).toBe(join(fx.dataDir, "knowledge", "workspace"));
    expect(repo.ref).toEqual(WORKSPACE);
    expect(statSync(join(repo.path, ".git")).isDirectory()).toBe(true);
    expect(readManifest(repo.path)).toMatchObject({ format: 1, scope: "workspace" });
    expect(readFileSync(join(repo.path, ".gitignore"), "utf8").trim().split("\n")).toEqual([
      ".DS_Store",
      "Thumbs.db",
      ".obsidian/",
      "*.swp",
      "*~",
      "*.tmp",
      ".*.md.tmp",
    ]);
    for (const folder of ["entries", "proposals/open", "proposals/decided"]) {
      expect(statSync(join(repo.path, folder)).isDirectory()).toBe(true);
    }
    expect(taxonomyFor(store, WORKSPACE)?.areas).toEqual(DEFAULT_AREAS);
    expect(realGit(repo.path, "branch", "--show-current").trim()).toBe("main");
    expect(realGit(repo.path, "rev-list", "--count", "HEAD").trim()).toBe("1");
    const identity = identityOf(personAuthor(store));
    expect(realGit(repo.path, "log", "-1", "--format=%an|%ae|%cn|%ce|%s").trim()).toBe(
      `André Agro|${identity.email}|André Agro|${identity.email}|knowledge: repository (format 1)`,
    );
    expect(realGit(repo.path, "status", "--porcelain")).toBe("");
    if (unix) expect(mode(repo.path)).toBe(0o700);
    expect(
      fx.db
        .query<{ scope: string; project_id: number; path: string }, []>(
          "SELECT scope, project_id, path FROM knowledge_repos",
        )
        .all(),
    ).toEqual([{ scope: "workspace", project_id: 0, path: "knowledge/workspace" }]);

    const head = headOf(repo.path);
    expect(head).toBe(realGit(repo.path, "rev-parse", "HEAD").trim());
    expect(ensureRepo(store, WORKSPACE).id).toBe(repo.id);
    expect(headOf(repo.path)).toBe(head);
  });

  test("the shared repository has its own taxonomy; a project's has none and reads the workspace's", () => {
    const store = fx.store();
    const shared = ensureRepo(store, SHARED);
    expect(existsSync(join(shared.path, "taxonomy.md"))).toBe(true);
    expect(taxonomyFor(store, SHARED)?.areas).toEqual(DEFAULT_AREAS);

    const projectId = fx.addProject("gitdir:/x/.git", "path:/x");
    const ref = { scope: "project", projectId } as const;
    expect(taxonomyFor(store, ref)).toBeNull();
    const project = ensureRepo(store, ref);
    expect(project.relative).toMatch(/^knowledge\/projects\/[0-9a-f]{16}$/);
    expect(existsSync(join(project.path, "taxonomy.md"))).toBe(false);
    expect(readManifest(project.path)).toMatchObject({
      format: 1,
      scope: "project",
      project: { aliases: ["gitdir:/x/.git", "path:/x"] },
    });
    // The root came first.
    expect(statSync(join(fx.dataDir, "knowledge", "workspace", ".git")).isDirectory()).toBe(true);
    expect(taxonomyFor(store, ref)?.areas).toEqual(DEFAULT_AREAS);
    expect(realGit(project.path, "rev-list", "--count", "HEAD").trim()).toBe("1");
  });

  test("openRepo is null for a repository that does not exist and does not create it", () => {
    const store = fx.store();
    expect(openRepo(store, WORKSPACE)).toBeNull();
    expect(existsSync(join(fx.dataDir, "knowledge", "workspace"))).toBe(false);
    ensureRepo(store, WORKSPACE);
    expect(openRepo(store, WORKSPACE)?.relative).toBe("knowledge/workspace");
  });

  test("the person's git hooks and signing never run", () => {
    const marker = join(fx.dir, "hook-ran");
    const hooks = join(fx.home, "hooks");
    mkdirSync(hooks);
    writeFileSync(join(hooks, "pre-commit"), `#!/bin/sh\n: > '${marker}'\n`);
    chmodSync(join(hooks, "pre-commit"), 0o755);
    writeFileSync(
      join(fx.home, ".gitconfig"),
      `[user]\n\tname = Ana Lopes\n[core]\n\thooksPath = ${hooks}\n[commit]\n\tgpgsign = true\n`,
    );
    const store = fx.store();
    const repo = ensureRepo(store, WORKSPACE);
    commitFile(store, repo, "entries/a.md", "one\n");
    expect(realGit(repo.path, "rev-list", "--count", "HEAD").trim()).toBe("2");
    expect(existsSync(marker)).toBe(false);
    expect(realGit(repo.path, "log", "-1", "--format=%an").trim()).toBe("Ana Lopes");
  });

  test("a data directory inside a parent repository never commits into the parent", () => {
    const parent = join(fx.dir, "parent");
    mkdirSync(parent);
    realGit(parent, "init", "-q", "-b", "main");
    writeFileSync(join(parent, ".gitignore"), "data/\n");
    realGit(parent, "add", ".gitignore");
    realGit(
      parent,
      "-c",
      "user.name=T",
      "-c",
      "user.email=t@example.invalid",
      "commit",
      "-q",
      "-m",
      "init",
    );
    const dataDir = join(parent, "data");
    mkdirSync(dataDir);
    const store = fx.store({ dataDir });
    const repoPath = join(dataDir, "knowledge", "workspace");

    expect(headOf(repoPath)).toBeNull();
    mkdirSync(repoPath, { recursive: true });
    // A folder with no .git of its own is not the parent's repository.
    expect(headOf(repoPath)).toBeNull();

    const repo = ensureRepo(store, WORKSPACE);
    commitFile(store, repo, "entries/a.md", "one\n");
    expect(headOf(repo.path)).toBe(realGit(repo.path, "rev-parse", "HEAD").trim());
    realGit(repo.path, "pack-refs", "--all");
    expect(headOf(repo.path)).toBe(realGit(repo.path, "rev-parse", "HEAD").trim());
    expect(realGit(parent, "status", "--porcelain")).toBe("");
    expect(realGit(parent, "rev-list", "--count", "HEAD").trim()).toBe("1");
  });
});

describe("a repository's own git configuration", () => {
  const BASE = "[core]\n\trepositoryformatversion = 0\n\tfilemode = true\n\tbare = false\n";

  test("a local fsmonitor never runs, and the repository is refused", () => {
    const store = fx.store();
    const repo = ensureRepo(store, WORKSPACE);
    const marker = join(fx.dir, "fsmonitor-ran");
    const script = join(fx.dir, "fsmonitor.sh");
    writeFileSync(script, `#!/bin/sh\n: > '${marker}'\n`);
    chmodSync(script, 0o755);
    writeFileSync(join(repo.path, ".git", "config"), `${BASE}\tfsmonitor = ${script}\n`);

    const status = runGit(store, repo.path, ["status", "--porcelain"], {
      operation: "test",
      readOnly: true,
    });
    expect(status.exitCode).toBe(0);
    expect(existsSync(marker)).toBe(false);
    expect(codeOf(() => checkRepoConfig(repo.path))).toBe("invalid");
    expect(thrown(() => checkRepoConfig(repo.path)).message).toContain("fsmonitor");
    expect(codeOf(() => openRepo(store, WORKSPACE))).toBe("invalid");
  });

  test("includes, filters, hooksPath and sshCommand are refused; plain core settings pass", () => {
    const store = fx.store();
    const repo = ensureRepo(store, WORKSPACE);
    const config = join(repo.path, ".git", "config");
    const refused: [string, string][] = [
      [`${BASE}[include]\n\tpath = /tmp/x\n`, "include"],
      [`${BASE}[includeIf "gitdir:/"]\n\tpath = /tmp/x\n`, "includeIf"],
      [`${BASE}[filter "x"]\n\tclean = cat\n`, "filter"],
      [`${BASE}\thooksPath = /tmp/hooks\n`, "hooksPath"],
      [`${BASE}\tsshCommand = /tmp/ssh\n`, "sshCommand"],
      ["[CORE]\n\tHooksPath = /tmp/hooks\n", "hooksPath"],
      ["[core] fsmonitor = true\n", "fsmonitor"],
    ];
    for (const [text, name] of refused) {
      writeFileSync(config, text);
      expect(codeOf(() => checkRepoConfig(repo.path))).toBe("invalid");
      expect(thrown(() => checkRepoConfig(repo.path)).message.toLowerCase()).toContain(
        name.toLowerCase(),
      );
    }
    writeFileSync(config, `${BASE}\tignorecase = true\n# hooksPath = commented\n`);
    expect(codeOf(() => checkRepoConfig(repo.path))).toBeNull();
  });
});

describe("the runner", () => {
  test("no git on PATH is a git error that names git", () => {
    const store = fx.store();
    const repo = ensureRepo(store, WORKSPACE);
    const without = fx.store({ env: { PATH: fx.emptyBin() } });
    const error = thrown(() =>
      runGit(without, repo.path, ["status", "--porcelain"], { operation: "test", readOnly: true }),
    );
    expect(codeOf(() => runGit(without, repo.path, ["status"], { operation: "test" }))).toBe("git");
    expect(error.message).toContain("git");
  });

  test("a call that does not return in time is killed", () => {
    const repo = ensureRepo(fx.store(), WORKSPACE);
    const slow = stubGit(join(fx.dir, "slow-git"), { sleepMs: 2000 });
    const env = { PATH: fx.pathWith(slow) };
    const withOption = thrown(() =>
      runGit(fx.store({ env }), repo.path, ["status", "--porcelain"], {
        operation: "test",
        readOnly: true,
        timeoutMs: 50,
      }),
    );
    expect(withOption.message).toContain("timed out");
    const store = fx.store({ env, gitTimeoutMs: 50 });
    expect(codeOf(() => runGit(store, repo.path, ["status"], { operation: "test" }))).toBe("git");
    expect(
      thrown(() => runGit(store, repo.path, ["status"], { operation: "test" })).message,
    ).toContain("timed out");
  }, 30_000);

  test("a refused call names the subcommand, the repository and git's words, and is logged", () => {
    const store = fx.store();
    const repo = ensureRepo(store, WORKSPACE);
    writeFileSync(join(repo.path, "entries", "a.md"), "one\n");
    stagePaths(store, repo, ["entries/a.md"], "write");
    const failing = stubGit(join(fx.dir, "failing-git"), { fail: "commit", stderr: "fatal: boom" });
    const broken = fx.store({ env: { PATH: fx.pathWith(failing) } });
    const error = thrown(() =>
      commitPaths(broken, repo, ["entries/a.md"], "x", identityOf(personAuthor(broken)), "write"),
    );
    expect(error.message).toBe(`git commit in ${repo.path} failed: fatal: boom`);
    const log = readFileSync(join(fx.dataDir, "logs", "wizardingcode-mem.log"), "utf8")
      .trim()
      .split("\n");
    expect(log).toHaveLength(1);
    expect(log[0]).toContain("knowledge.write");
    expect(log[0]).toContain(repo.path);
    expect(log[0]).toContain("fatal: boom");
  });

  test("git's words are clipped to 300 characters", () => {
    const store = fx.store();
    const repo = ensureRepo(store, WORKSPACE);
    const noisy = stubGit(join(fx.dir, "noisy-git"), { fail: "status", stderr: "x".repeat(1000) });
    const error = thrown(() =>
      runGit(fx.store({ env: { PATH: fx.pathWith(noisy) } }), repo.path, ["status"], {
        operation: "test",
      }),
    );
    const prefix = `git status in ${repo.path} failed: `;
    expect(error.message.startsWith(prefix)).toBe(true);
    expect(error.message.length - prefix.length).toBeLessThanOrEqual(300);
  });

  test("git sees only the environment the store builds", () => {
    const store = fx.store();
    const repo = ensureRepo(store, WORKSPACE);
    const dump = join(fx.dir, "env.txt");
    const spy = fx.store({
      env: { PATH: fx.pathWith(stubGit(join(fx.dir, "spy-git"), { dumpEnvTo: dump })) },
    });
    const seen = () => readFileSync(dump, "utf8").split("\n");
    const root = join(fx.dataDir, "knowledge");

    runGit(spy, repo.path, ["status", "--porcelain"], { operation: "test", readOnly: true });
    expect(seen()).toContain("GIT_OPTIONAL_LOCKS=0");
    expect(seen()).toContain(`GIT_CONFIG_GLOBAL=${join(root, ".gitconfig-empty")}`);
    expect(seen()).toContain("GIT_CONFIG_NOSYSTEM=1");
    expect(seen()).toContain(`GIT_CEILING_DIRECTORIES=${root}`);
    expect(seen()).toContain("GIT_TERMINAL_PROMPT=0");
    expect(seen().some((line) => line.startsWith("HOME="))).toBe(false);

    writeFileSync(join(repo.path, "entries", "a.md"), "one\n");
    stagePaths(spy, repo, ["entries/a.md"], "write");
    expect(seen().some((line) => line.startsWith("GIT_OPTIONAL_LOCKS="))).toBe(false);

    const identity = identityOf(personAuthor(spy));
    commitPaths(spy, repo, ["entries/a.md"], "x", identity, "write");
    expect(seen()).toContain(`GIT_AUTHOR_NAME=${identity.name}`);
    expect(seen()).toContain(`GIT_COMMITTER_EMAIL=${identity.email}`);

    runGit(spy, null, ["config", "--global", "user.name"], {
      operation: "author",
      allowUserConfig: true,
      readOnly: true,
    });
    expect(seen()).toContain(`HOME=${fx.home}`);
    expect(seen().some((line) => line.startsWith("GIT_CONFIG_GLOBAL="))).toBe(false);
    expect(seen().some((line) => line.startsWith("GIT_CONFIG_NOSYSTEM="))).toBe(false);
  });

  test("a global config lookup with no value is not an error", () => {
    expect(
      runGit(fx.store(), null, ["config", "--global", "user.name"], {
        operation: "author",
        allowUserConfig: true,
        readOnly: true,
      }),
    ).toEqual({ stdout: "", exitCode: 1 });
  });
});

describe("staging and undoing", () => {
  test("status, stage, commit by path, and the fingerprint", () => {
    const store = fx.store();
    const repo = ensureRepo(store, WORKSPACE);
    expect(statusOf(store, repo, ["entries"])).toEqual([]);
    expect(fingerprintOf(repo.path)).toMatch(/^0:0:0:\d+$/);
    writeFileSync(join(repo.path, "entries", "a.md"), "one\n");
    writeFileSync(join(repo.path, "entries", "b.md"), "two\n");
    expect(statusOf(store, repo, ["entries"])).toEqual(["?? entries/a.md", "?? entries/b.md"]);
    expect(statusOf(store, repo, ["entries/a.md"])).toEqual(["?? entries/a.md"]);
    expect(fingerprintOf(repo.path)).toMatch(/^2:0:0:\d+$/);

    stagePaths(store, repo, ["entries/a.md", "entries/b.md"], "write");
    commitPaths(
      store,
      repo,
      ["entries/a.md"],
      "one only",
      identityOf(personAuthor(store)),
      "write",
    );
    // Only the named path went into the commit; the other stays staged.
    expect(realGit(repo.path, "show", "--name-only", "--format=", "HEAD").trim()).toBe(
      "entries/a.md",
    );
    expect(statusOf(store, repo, ["entries"])).toEqual(["A  entries/b.md"]);
  });

  test("a change to a path that existed is restored from HEAD; a new path is removed", () => {
    const store = fx.store();
    const repo = ensureRepo(store, WORKSPACE);
    commitFile(store, repo, "entries/a.md", "one\n");
    writeFileSync(join(repo.path, "entries", "a.md"), "changed\n");
    writeFileSync(join(repo.path, "entries", "b.md"), "new\n");
    stagePaths(store, repo, ["entries/a.md", "entries/b.md"], "write");

    undoStaged(store, repo, { existed: ["entries/a.md"], created: ["entries/b.md"] }, "write");
    expect(readFileSync(join(repo.path, "entries", "a.md"), "utf8")).toBe("one\n");
    expect(existsSync(join(repo.path, "entries", "b.md"))).toBe(false);
    expect(statusOf(store, repo, ["entries"])).toEqual([]);
  });

  test("undoing a path that was never staged still leaves it gone", () => {
    const store = fx.store();
    const repo = ensureRepo(store, WORKSPACE);
    writeFileSync(join(repo.path, "entries", "b.md"), "new\n");
    undoStaged(
      store,
      repo,
      { existed: [], created: ["entries/b.md", "entries/never.md"] },
      "write",
    );
    expect(existsSync(join(repo.path, "entries", "b.md"))).toBe(false);
    expect(statusOf(store, repo, ["entries"])).toEqual([]);
  });

  test("unstage keeps the file as it is on disk; a removal is staged with git rm", () => {
    const store = fx.store();
    const repo = ensureRepo(store, WORKSPACE);
    commitFile(store, repo, "entries/a.md", "one\n");
    commitFile(store, repo, "entries/b.md", "two\n");
    writeFileSync(join(repo.path, "entries", "a.md"), "hand edit\n");
    stagePaths(store, repo, ["entries/a.md"], "adopt");
    unstage(store, repo, ["entries/a.md"], "adopt");
    expect(statusOf(store, repo, ["entries"])).toEqual([" M entries/a.md"]);
    expect(readFileSync(join(repo.path, "entries", "a.md"), "utf8")).toBe("hand edit\n");

    removePaths(store, repo, ["entries/b.md"], "adopt");
    expect(statusOf(store, repo, ["entries/b.md"])).toEqual(["D  entries/b.md"]);
  });
});

describe("the leases", () => {
  const until = (key: string) =>
    (JSON.parse(getMeta(fx.db, key) ?? "{}") as { until?: number }).until;

  test("held in order while the work runs, renewed on request, released after", () => {
    let clock = 1_000_000;
    const store = fx.store({ now: () => clock });
    const result = withRepoLeases(store, ["a", "b"], () => {
      expect(leaseActive(fx.db, "knowledge.lease:a", clock)).toBe(true);
      expect(leaseActive(fx.db, "knowledge.lease:b", clock)).toBe(true);
      expect(anyLeaseActive(fx.db, clock)).toBe(true);
      expect(store.renew).not.toBeNull();
      expect(until("knowledge.lease:a")).toBe(clock + KNOWLEDGE_LEASE_MS);
      clock += 10_000;
      store.renew?.();
      expect(until("knowledge.lease:a")).toBe(clock + KNOWLEDGE_LEASE_MS);
      expect(until("knowledge.lease:b")).toBe(clock + KNOWLEDGE_LEASE_MS);
      return "done";
    });
    expect(result).toBe("done");
    expect(store.renew).toBeNull();
    expect(getMeta(fx.db, "knowledge.lease:a")).toBeNull();
    expect(getMeta(fx.db, "knowledge.lease:b")).toBeNull();
    expect(anyLeaseActive(fx.db, clock)).toBe(false);
  });

  test("the leases are released when the work throws", () => {
    const store = fx.store();
    expect(() =>
      withRepoLeases(store, ["a"], () => {
        throw new Error("work failed");
      }),
    ).toThrow("work failed");
    expect(getMeta(fx.db, "knowledge.lease:a")).toBeNull();
    expect(store.renew).toBeNull();
  });

  test("a lease another live owner holds refuses the work, and the first lease is given back", () => {
    const store = fx.store();
    const other = JSON.stringify({ owner: `${process.pid}-other`, until: store.now() + 60_000 });
    setMeta(fx.db, "knowledge.lease:b", other);
    let ran = false;
    const error = thrown(() =>
      withRepoLeases(store, ["a", "b"], () => {
        ran = true;
      }),
    );
    expect(codeOf(() => withRepoLeases(store, ["a", "b"], () => undefined))).toBe("locked");
    expect(error.message).toBe("another write to this repository is in progress; try again");
    expect(ran).toBe(false);
    expect(getMeta(fx.db, "knowledge.lease:a")).toBeNull();
    expect(getMeta(fx.db, "knowledge.lease:b")).toBe(other);
  });

  test("a lease lost during the work stops the next step", () => {
    const store = fx.store();
    withRepoLeases(store, ["a"], () => {
      setMeta(
        fx.db,
        "knowledge.lease:a",
        JSON.stringify({ owner: `${process.pid}-thief`, until: store.now() + 60_000 }),
      );
      expect(codeOf(() => store.renew?.())).toBe("locked");
    });
    // Not ours any more: the release leaves the other owner's lease alone.
    expect(getMeta(fx.db, "knowledge.lease:a")).toContain("thief");
  });

  test("a lease whose owner process is gone is taken over", async () => {
    const gone = Bun.spawn(["true"], { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
    await gone.exited;
    const store = fx.store();
    setMeta(
      fx.db,
      "knowledge.lease:a",
      JSON.stringify({ owner: `${gone.pid}-x`, until: store.now() + 60_000 }),
    );
    expect(withRepoLeases(store, ["a"], () => "ran")).toBe("ran");
  });

  test("nested leases renew together", () => {
    let clock = 5_000_000;
    const store = fx.store({ now: () => clock });
    withRepoLeases(store, ["a"], () => {
      withRepoLeases(store, ["b"], () => {
        clock += 1_000;
        store.renew?.();
        expect(until("knowledge.lease:a")).toBe(clock + KNOWLEDGE_LEASE_MS);
        expect(until("knowledge.lease:b")).toBe(clock + KNOWLEDGE_LEASE_MS);
      });
      expect(getMeta(fx.db, "knowledge.lease:b")).toBeNull();
      expect(store.renew).not.toBeNull();
    });
    expect(store.renew).toBeNull();
  });

  test("the runner renews before it spawns git", () => {
    const store = fx.store();
    const repo = ensureRepo(store, WORKSPACE);
    withRepoLeases(store, [repo.relative], () => {
      setMeta(
        fx.db,
        leaseKey(repo.relative),
        JSON.stringify({ owner: `${process.pid}-thief`, until: store.now() + 60_000 }),
      );
      writeFileSync(join(repo.path, "entries", "a.md"), "one\n");
      expect(codeOf(() => stagePaths(store, repo, ["entries/a.md"], "write"))).toBe("locked");
    });
    // The call was refused before git ran: nothing was staged.
    expect(realGit(repo.path, "status", "--porcelain", "--untracked-files=all").trim()).toBe(
      "?? entries/a.md",
    );
  });
});

describe("an interrupted operation", () => {
  const person = { kind: "person", name: "you", source: "default" } as const;

  test("the intent record round-trips", () => {
    const repo = ensureRepo(fx.store(), WORKSPACE);
    expect(readIntent(repo)).toBeNull();
    const intent = {
      operation: "accept",
      writer: person,
      existed: ["entries/a.md"],
      created: ["proposals/decided/x.md"],
      proposalId: "x",
    };
    writeIntent(repo, intent);
    expect(existsSync(join(repo.path, ".git", "wizardingcode-op.json"))).toBe(true);
    expect(readIntent(repo)).toEqual(intent);
    clearIntent(repo);
    expect(readIntent(repo)).toBeNull();
    clearIntent(repo);
  });

  test("openRepo removes a new file an interrupted write left", () => {
    const store = fx.store();
    const repo = ensureRepo(store, WORKSPACE);
    writeFileSync(join(repo.path, "entries", "new.md"), "half written\n");
    stagePaths(store, repo, ["entries/new.md"], "write");
    writeIntent(repo, {
      operation: "write",
      writer: person,
      existed: [],
      created: ["entries/new.md"],
    });

    expect(openRepo(store, WORKSPACE)?.id).toBe(repo.id);
    expect(existsSync(join(repo.path, "entries", "new.md"))).toBe(false);
    expect(realGit(repo.path, "status", "--porcelain")).toBe("");
    expect(readIntent(repo)).toBeNull();
  });

  test("openRepo puts an existing entry back to what HEAD holds", () => {
    const store = fx.store();
    const repo = ensureRepo(store, WORKSPACE);
    commitFile(store, repo, "entries/a.md", "version one\n");
    writeFileSync(join(repo.path, "entries", "a.md"), "version two, never committed\n");
    writeIntent(repo, {
      operation: "write",
      writer: person,
      existed: ["entries/a.md"],
      created: [],
    });

    openRepo(store, WORKSPACE);
    expect(readFileSync(join(repo.path, "entries", "a.md"), "utf8")).toBe("version one\n");
    expect(realGit(repo.path, "status", "--porcelain")).toBe("");
    expect(readIntent(repo)).toBeNull();
  });

  test("an operation whose commit landed is only forgotten", () => {
    const store = fx.store();
    const repo = ensureRepo(store, WORKSPACE);
    commitFile(store, repo, "entries/new.md", "committed\n");
    // The process died after the commit and before it removed its record.
    writeIntent(repo, {
      operation: "write",
      writer: person,
      existed: [],
      created: ["entries/new.md"],
    });

    openRepo(store, WORKSPACE);
    expect(readFileSync(join(repo.path, "entries", "new.md"), "utf8")).toBe("committed\n");
    expect(realGit(repo.path, "status", "--porcelain")).toBe("");
    expect(readIntent(repo)).toBeNull();
  });
});
