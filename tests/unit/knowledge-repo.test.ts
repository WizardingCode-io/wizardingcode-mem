import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { identityOf, personAuthor } from "../../src/modules/knowledge/author.ts";
import { DEFAULT_AREAS } from "../../src/modules/knowledge/entry.ts";
import {
  checkRepoConfig,
  clearIntent,
  commitPaths,
  ensureRepo,
  fingerprintOf,
  GIT_MIN_VERSION,
  GIT_TIMEOUT_MS,
  hashOf,
  headOf,
  type Intent,
  KNOWLEDGE_LEASE_MS,
  keepBytes,
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
  restoreKept,
  rootOf,
  runGit,
  stagePaths,
  statusOf,
  taxonomyFor,
  undoStaged,
  unstage,
  withRepoLeases,
  writeFileAtomic,
  writeIntent,
} from "../../src/modules/knowledge/repo.ts";
import { listRepos } from "../../src/modules/knowledge/resolve.ts";
import { writeEntry } from "../../src/modules/knowledge/store.ts";
import type { KnowledgeStore, Repo } from "../../src/modules/knowledge/types.ts";
import { DB_FILE } from "../../src/store/db.ts";
import { anyLeaseActive, getMeta, leaseActive, setMeta } from "../../src/store/meta.ts";
import { moveStore } from "../../src/store/move.ts";
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

/** A program that leaves a marker when git runs it. */
function trap(name: string): { script: string; marker: string } {
  const marker = join(fx.dir, `${name}-ran`);
  const script = join(fx.dir, `${name}.sh`);
  writeFileSync(script, `#!/bin/sh\n: > '${marker}'\ncat\n`);
  chmodSync(script, 0o755);
  return { script, marker };
}

const AN_ENTRY = {
  title: "An entry",
  kind: "knowledge",
  area: "code",
  context: "",
  subject: "",
  body: "x",
} as const;

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

describe("nothing of the store's own sits beside the repositories", () => {
  test("the store keeps no file or folder under knowledge/ but the repositories", () => {
    const repo = ensureRepo(fx.store(), WORKSPACE);
    const root = join(fx.dataDir, "knowledge");
    expect(readdirSync(root)).toEqual(["workspace"]);
    if (unix) expect(mode(root)).toBe(0o700);
    // And git copied no template into the new repository: not its own, not anyone's.
    for (const name of ["hooks", "info", "description"]) {
      expect(existsSync(join(repo.path, ".git", name))).toBe(false);
    }
  });

  /** A first write into a data directory where `prepare` has already put files. */
  function firstWrite(name: string, prepare: (root: string, script: string) => void) {
    const { script, marker } = trap(name);
    const root = join(fx.dataDir, "knowledge");
    mkdirSync(root, { recursive: true });
    prepare(root, script);
    const store = fx.store({ env: { WIZARDINGCODE_MEM_AUTHOR: "Writer" } });
    const result = writeEntry(store, WORKSPACE, AN_ENTRY, personAuthor(store));
    expect(result.kind).toBe("written");
    expect(existsSync(marker)).toBe(false);
    const repo = openRepo(store, WORKSPACE) as Repo;
    expect(realGit(repo.path, "rev-list", "--count", "HEAD").trim()).toBe("2");
    return repo;
  }

  test("a hook someone left in a folder beside the repositories never runs", () => {
    firstWrite("beside-hook", (root, script) => {
      mkdirSync(join(root, ".no-hooks"));
      writeFileSync(join(root, ".no-hooks", "pre-commit"), `#!/bin/sh\n${script} < /dev/null\n`);
      chmodSync(join(root, ".no-hooks", "pre-commit"), 0o755);
    });
  });

  test("a configuration someone left beside the repositories is never read", () => {
    firstWrite("beside-config", (root, script) => {
      const attributes = join(fx.dir, "attributes");
      writeFileSync(attributes, "* filter=x\n");
      writeFileSync(
        join(root, ".gitconfig-empty"),
        `[core]\n\tattributesFile = ${attributes}\n[filter "x"]\n\tclean = ${script}\n`,
      );
    });
  });

  test("a template someone left beside the repositories is never copied", () => {
    const repo = firstWrite("beside-template", (root, script) => {
      mkdirSync(join(root, ".template", "info"), { recursive: true });
      writeFileSync(join(root, ".template", "config"), `[filter "x"]\n\tclean = ${script}\n`);
      writeFileSync(join(root, ".template", "info", "attributes"), "* filter=x\n");
    });
    expect(readFileSync(join(repo.path, ".git", "config"), "utf8")).not.toContain("filter");
    expect(existsSync(join(repo.path, ".git", "info", "attributes"))).toBe(false);
  });

  test("a hook in the repository's own hooks folder never runs", () => {
    const store = fx.store();
    const repo = ensureRepo(store, WORKSPACE);
    const { script, marker } = trap("own-hook");
    mkdirSync(join(repo.path, ".git", "hooks"), { recursive: true });
    for (const name of ["pre-commit", "post-commit", "reference-transaction"]) {
      writeFileSync(join(repo.path, ".git", "hooks", name), `#!/bin/sh\n${script} < /dev/null\n`);
      chmodSync(join(repo.path, ".git", "hooks", name), 0o755);
    }
    commitFile(store, repo, "entries/a.md", "one\n");
    expect(realGit(repo.path, "rev-list", "--count", "HEAD").trim()).toBe("2");
    expect(existsSync(marker)).toBe(false);
  });
});

describe("ensureRepo", () => {
  test("creates the workspace repository with its files, its folders and one commit by the person", () => {
    const store = fx.store({ env: { WIZARDINGCODE_MEM_AUTHOR: "Zoë Writer" } });
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
      `Zoë Writer|${identity.email}|Zoë Writer|${identity.email}|knowledge: repository (format 1)`,
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
      `[user]\n\tname = First Writer\n[core]\n\thooksPath = ${hooks}\n[commit]\n\tgpgsign = true\n`,
    );
    const store = fx.store();
    const repo = ensureRepo(store, WORKSPACE);
    commitFile(store, repo, "entries/a.md", "one\n");
    expect(realGit(repo.path, "rev-list", "--count", "HEAD").trim()).toBe("2");
    expect(existsSync(marker)).toBe(false);
    expect(realGit(repo.path, "log", "-1", "--format=%an").trim()).toBe("First Writer");
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

  test("a second section on a header's line is read as git reads it, and its program never runs", () => {
    const store = fx.store({ env: { WIZARDINGCODE_MEM_AUTHOR: "Writer" } });
    const repo = ensureRepo(store, WORKSPACE);
    const { script, marker } = trap("second-header");
    writeFileSync(
      join(repo.path, ".git", "config"),
      `${BASE}[core][filter "x"]\n\tclean = ${script}\n`,
    );
    writeFileSync(join(repo.path, ".gitattributes"), "* filter=x\n");
    // git itself reads that line as a filter section.
    expect(realGit(repo.path, "config", "--local", "--list")).toContain("filter.x.clean=");

    expect(codeOf(() => checkRepoConfig(repo.path))).toBe("invalid");
    expect(thrown(() => checkRepoConfig(repo.path)).message).toContain("filter.x.clean");
    expect(codeOf(() => openRepo(store, WORKSPACE))).toBe("invalid");
    expect(codeOf(() => writeEntry(store, WORKSPACE, AN_ENTRY, personAuthor(store)))).toBe(
      "invalid",
    );
    expect(existsSync(marker)).toBe(false);
    expect(existsSync(join(repo.path, "entries", "an-entry.md"))).toBe(false);
  });

  test("only the settings git init writes are allowed, each line read as git reads it", () => {
    const store = fx.store();
    const repo = ensureRepo(store, WORKSPACE);
    const config = join(repo.path, ".git", "config");
    const messageFor = (text: string) => {
      writeFileSync(config, text);
      expect(codeOf(() => checkRepoConfig(repo.path))).toBe("invalid");
      return thrown(() => checkRepoConfig(repo.path)).message;
    };

    const refused: [string, string][] = [
      [`${BASE}[remote "origin"]\n\turl = ext::sh -c x\n`, "remote.origin.url"],
      [`${BASE}[protocol "ext"]\n\tallow = always\n`, "protocol.ext.allow"],
      [`${BASE}[alias]\n\tst = !sh -c x\n`, "alias.st"],
      [`${BASE}[credential]\n\thelper = /tmp/x\n`, "credential.helper"],
      [`${BASE}[submodule]\n\trecurse = true\n`, "submodule.recurse"],
      [`${BASE}[extensions]\n\tpartialClone = origin\n`, "extensions.partialClone"],
      [`${BASE}\tworktree = /tmp/elsewhere\n`, "core.worktree"],
      [`${BASE}\tattributesFile = /tmp/x\n`, "core.attributesFile"],
      [`${BASE}\tpager = /tmp/x\n`, "core.pager"],
      // A lone carriage return is white space to git, not the end of a line.
      ['[core]\r[filter "x"]\n\tclean = /tmp/x\n', "filter.x.clean"],
      // The old spelling of a subsection.
      ["[filter.x]\n\tclean = /tmp/x\n", "filter.x.clean"],
      ['[core] [diff "x"] textconv = /tmp/x\n', "diff.x.textconv"],
      // A value that goes on to the next line: every line is still read as a line.
      [`${BASE}\tbare = \\\n[filter "x"]\n\tclean = /tmp/x\n`, "filter.x.clean"],
    ];
    for (const [text, name] of refused) expect(messageFor(text)).toContain(name);

    // A line git would not take, or would take another way, is refused by its number.
    const unread: [string, number][] = [
      ["bare = false\n", 1],
      [`${BASE}!!\n`, 5],
      [`${BASE}[core\n`, 5],
      [`${BASE}[core "x" y]\n`, 5],
      [`${BASE}\tbare false\n`, 5],
      [`${BASE}[ core]\n`, 5],
    ];
    for (const [text, line] of unread) expect(messageFor(text)).toContain(`line ${line}`);

    const allowed = [
      BASE,
      `${String.fromCharCode(0xfeff)}${BASE}`,
      BASE.replaceAll("\n", "\r\n"),
      "[CORE]\n\tRepositoryFormatVersion = 0\n\tFileMode = true\n\tBARE = false\n\tlogallrefupdates = true\n\tignorecase = true\n\tprecomposeunicode = true\n\tsymlinks = false\n",
      "[core] bare = false\n",
      `${BASE}; a comment\n# another\n\n\t  \n`,
      `${BASE}[core]\n\tbare\n`,
      '[core "any"]\n',
    ];
    for (const text of allowed) {
      writeFileSync(config, text);
      expect(codeOf(() => checkRepoConfig(repo.path))).toBeNull();
    }
  });

  test("the repository git init makes on this machine passes the check", () => {
    const repo = ensureRepo(fx.store(), WORKSPACE);
    expect(readFileSync(join(repo.path, ".git", "config"), "utf8")).toContain("[core]");
    expect(codeOf(() => checkRepoConfig(repo.path))).toBeNull();
  });

  test("a new repository keeps the formats the store reads, whatever git defaults to", () => {
    // A git whose own defaults are the other formats: its settings come ahead of the store's.
    const later = stubGit(join(fx.dir, "later-git"), {
      prepend: ["-c", "init.defaultObjectFormat=sha256", "-c", "init.defaultRefFormat=reftable"],
    });
    const store = fx.store({ env: { PATH: fx.pathWith(later) } });
    const repo = ensureRepo(store, WORKSPACE);
    expect(readFileSync(join(repo.path, ".git", "config"), "utf8")).not.toContain("extensions");
    expect(openRepo(store, WORKSPACE)?.id).toBe(repo.id);
    expect(realGit(repo.path, "rev-list", "--count", "HEAD").trim()).toBe("1");
  });

  test("a configuration that is a link, or too large to be one git init wrote, is refused", () => {
    const store = fx.store();
    const repo = ensureRepo(store, WORKSPACE);
    const config = join(repo.path, ".git", "config");
    const outside = join(fx.dir, "outside-config");
    writeFileSync(outside, BASE);
    rmSync(config);
    symlinkSync(outside, config);
    expect(codeOf(() => checkRepoConfig(repo.path))).toBe("invalid");
    expect(thrown(() => checkRepoConfig(repo.path)).message).toContain("not a regular file");
    expect(codeOf(() => openRepo(store, WORKSPACE))).toBe("invalid");

    rmSync(config);
    writeFileSync(config, `${BASE}${"# padding\n".repeat(30_000)}`);
    expect(codeOf(() => checkRepoConfig(repo.path))).toBe("invalid");
    expect(thrown(() => checkRepoConfig(repo.path)).message).toContain("256 KiB");
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
    expect(seen()).toContain("GIT_CONFIG_GLOBAL=/dev/null");
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

  test("a store move is refused while a knowledge write holds its lease", async () => {
    const now = Date.now();
    const key = leaseKey("knowledge/workspace");
    setMeta(fx.db, key, JSON.stringify({ owner: `${process.pid}-writer`, until: now + 60_000 }));
    const move = () =>
      moveStore({ dataDir: fx.dataDir, from: fx.dataDir, to: join(fx.dir, "moved"), now });
    expect(await move()).toMatchObject({ ok: false, reason: "busy" });
    expect(existsSync(join(fx.dataDir, DB_FILE))).toBe(true);
    fx.db.run("DELETE FROM meta WHERE key = ?", [key]);
    expect(anyLeaseActive(fx.db, now)).toBe(false);
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

  const hash = (text: string) => hashOf(Buffer.from(text));
  const status = (repo: Repo) =>
    realGit(repo.path, "status", "--porcelain", "--untracked-files=all").trimEnd();
  /** A store that keeps what the engine tells the person. */
  function reporting(): { store: KnowledgeStore; said: string[] } {
    const said: string[] = [];
    const store = fx.store();
    store.report = (message) => said.push(message);
    return { store, said };
  }

  test("the intent record round-trips", () => {
    const repo = ensureRepo(fx.store(), WORKSPACE);
    expect(readIntent(repo)).toBeNull();
    const intent: Intent = {
      operation: "accept",
      writer: person,
      existed: ["entries/a.md"],
      created: ["proposals/decided/x.md"],
      written: { "entries/a.md": "0123456789abcdef", "proposals/open/x.md": null },
      proposalId: "x",
    };
    writeIntent(repo, intent);
    expect(existsSync(join(repo.path, ".git", "wizardingcode-op.json"))).toBe(true);
    expect(readIntent(repo)).toEqual(intent);
    clearIntent(repo);
    expect(readIntent(repo)).toBeNull();
    clearIntent(repo);
  });

  test("openRepo removes a new file an interrupted write left, and says so", () => {
    const { store, said } = reporting();
    const repo = ensureRepo(store, WORKSPACE);
    writeFileSync(join(repo.path, "entries", "new.md"), "half written\n");
    stagePaths(store, repo, ["entries/new.md"], "write");
    writeIntent(repo, {
      operation: "write",
      writer: person,
      existed: [],
      created: ["entries/new.md"],
      written: { "entries/new.md": hash("half written\n") },
    });

    expect(openRepo(store, WORKSPACE)?.id).toBe(repo.id);
    expect(existsSync(join(repo.path, "entries", "new.md"))).toBe(false);
    expect(status(repo)).toBe("");
    expect(readIntent(repo)).toBeNull();
    expect(said).toHaveLength(1);
    expect(said[0]).toContain("entries/new.md");
    expect(said[0]).toContain("interrupted");
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
      written: { "entries/a.md": hash("version two, never committed\n") },
    });

    openRepo(store, WORKSPACE);
    expect(readFileSync(join(repo.path, "entries", "a.md"), "utf8")).toBe("version one\n");
    expect(status(repo)).toBe("");
    expect(readIntent(repo)).toBeNull();
  });

  test("an operation whose commit landed is only forgotten", () => {
    const { store, said } = reporting();
    const repo = ensureRepo(store, WORKSPACE);
    commitFile(store, repo, "entries/new.md", "committed\n");
    // The process died after the commit and before it removed its record.
    writeIntent(repo, {
      operation: "write",
      writer: person,
      existed: [],
      created: ["entries/new.md"],
      written: { "entries/new.md": hash("committed\n") },
    });

    openRepo(store, WORKSPACE);
    expect(readFileSync(join(repo.path, "entries", "new.md"), "utf8")).toBe("committed\n");
    expect(status(repo)).toBe("");
    expect(readIntent(repo)).toBeNull();
    expect(said).toEqual([]);
  });

  test("a file the person edited after the interruption is never touched", () => {
    const { store, said } = reporting();
    const repo = ensureRepo(store, WORKSPACE);
    commitFile(store, repo, "entries/a.md", "version one\n");
    // The engine wrote and staged the next version of one entry and a new one, then died.
    writeFileSync(join(repo.path, "entries", "a.md"), "version two\n");
    writeFileSync(join(repo.path, "entries", "new.md"), "a new entry\n");
    stagePaths(store, repo, ["entries/a.md", "entries/new.md"], "write");
    writeIntent(repo, {
      operation: "write",
      writer: person,
      existed: ["entries/a.md"],
      created: ["entries/new.md"],
      written: { "entries/a.md": hash("version two\n"), "entries/new.md": hash("a new entry\n") },
    });
    // Before the next command, the person works on both files in an editor.
    writeFileSync(join(repo.path, "entries", "a.md"), "version two\nand my own words\n");
    writeFileSync(join(repo.path, "entries", "new.md"), "a new entry, rewritten by me\n");

    openRepo(store, WORKSPACE);
    expect(readFileSync(join(repo.path, "entries", "a.md"), "utf8")).toBe(
      "version two\nand my own words\n",
    );
    expect(readFileSync(join(repo.path, "entries", "new.md"), "utf8")).toBe(
      "a new entry, rewritten by me\n",
    );
    // Nothing is staged: both are the person's own work now, for adopt to commit.
    expect(status(repo).split("\n")).toEqual([" M entries/a.md", "?? entries/new.md"]);
    expect(readIntent(repo)).toBeNull();
    expect(said).toHaveLength(1);
    expect(said[0]).toContain("entries/a.md");
    expect(said[0]).toContain("entries/new.md");
    expect(said[0]).toContain("knowledge adopt");
  });

  test("of two paths, the untouched one is undone and the edited one is kept", () => {
    const { store, said } = reporting();
    const repo = ensureRepo(store, WORKSPACE);
    writeFileSync(join(repo.path, "entries", "one.md"), "written by the engine\n");
    writeFileSync(join(repo.path, "entries", "two.md"), "written by the engine\n");
    stagePaths(store, repo, ["entries/one.md", "entries/two.md"], "write");
    writeIntent(repo, {
      operation: "write",
      writer: person,
      existed: [],
      created: ["entries/one.md", "entries/two.md"],
      written: {
        "entries/one.md": hash("written by the engine\n"),
        "entries/two.md": hash("written by the engine\n"),
      },
    });
    writeFileSync(join(repo.path, "entries", "two.md"), "edited by the person\n");

    openRepo(store, WORKSPACE);
    expect(existsSync(join(repo.path, "entries", "one.md"))).toBe(false);
    expect(readFileSync(join(repo.path, "entries", "two.md"), "utf8")).toBe(
      "edited by the person\n",
    );
    expect(status(repo)).toBe("?? entries/two.md");
    expect(said).toHaveLength(2);
  });

  test("a record that does not say what was written undoes nothing", () => {
    const { store, said } = reporting();
    const repo = ensureRepo(store, WORKSPACE);
    commitFile(store, repo, "entries/a.md", "version one\n");
    writeFileSync(join(repo.path, "entries", "a.md"), "whose words are these\n");
    stagePaths(store, repo, ["entries/a.md"], "write");
    writeIntent(repo, {
      operation: "write",
      writer: person,
      existed: ["entries/a.md"],
      created: [],
    });

    openRepo(store, WORKSPACE);
    expect(readFileSync(join(repo.path, "entries", "a.md"), "utf8")).toBe(
      "whose words are these\n",
    );
    expect(status(repo)).toBe(" M entries/a.md");
    expect(readIntent(repo)).toBeNull();
    expect(said).toHaveLength(1);
  });

  test("an interrupted adopt gives the person's bytes back only where they did not go on working", () => {
    const { store, said } = reporting();
    const repo = ensureRepo(store, WORKSPACE);
    commitFile(store, repo, "entries/a.md", "version one\n");
    commitFile(store, repo, "entries/b.md", "version one\n");
    // The person's hand edits, as adopt kept them before rewriting.
    const kept = keepBytes(
      repo,
      new Map([
        ["entries/a.md", Buffer.from("a, edited by hand\n")],
        ["entries/b.md", Buffer.from("b, edited by hand\n")],
      ]),
    );
    // Adopt rewrote and staged both, then died.
    writeFileSync(join(repo.path, "entries", "a.md"), "a, edited by hand, stamped\n");
    writeFileSync(join(repo.path, "entries", "b.md"), "b, edited by hand, stamped\n");
    stagePaths(store, repo, ["entries/a.md", "entries/b.md"], "adopt");
    writeIntent(repo, {
      operation: "adopt",
      writer: person,
      existed: ["entries/a.md", "entries/b.md"],
      created: [],
      written: {
        "entries/a.md": hash("a, edited by hand, stamped\n"),
        "entries/b.md": hash("b, edited by hand, stamped\n"),
      },
      keptBytesFile: kept,
    });
    // The person goes on working on b before the next command.
    writeFileSync(join(repo.path, "entries", "b.md"), "b, edited again\n");

    openRepo(store, WORKSPACE);
    expect(readFileSync(join(repo.path, "entries", "a.md"), "utf8")).toBe("a, edited by hand\n");
    expect(readFileSync(join(repo.path, "entries", "b.md"), "utf8")).toBe("b, edited again\n");
    expect(status(repo).split("\n")).toEqual([" M entries/a.md", " M entries/b.md"]);
    expect(readIntent(repo)).toBeNull();
    expect(existsSync(join(repo.path, ".git", kept))).toBe(false);
    expect(said.join("\n")).toContain("entries/b.md");
  });

  test("a path the operation never reached is neither touched nor reported", () => {
    const { store, said } = reporting();
    const repo = ensureRepo(store, WORKSPACE);
    // The operation wrote and staged the first of its two files, then died.
    writeFileSync(join(repo.path, "entries", "one.md"), "written\n");
    stagePaths(store, repo, ["entries/one.md"], "write");
    writeIntent(repo, {
      operation: "write",
      writer: person,
      existed: [],
      created: ["entries/one.md", "entries/two.md"],
      written: { "entries/one.md": hash("written\n"), "entries/two.md": hash("never written\n") },
    });

    openRepo(store, WORKSPACE);
    expect(status(repo)).toBe("");
    expect(readIntent(repo)).toBeNull();
    expect(said).toHaveLength(1);
    expect(said[0]).toContain("entries/one.md");
    expect(said[0]).not.toContain("entries/two.md");
  });

  test("an adopt whose commit landed is not undone for the files the person left alone", () => {
    const { store, said } = reporting();
    const repo = ensureRepo(store, WORKSPACE);
    // The adopt committed its rewrite of both files, then died before removing its record.
    commitFile(store, repo, "entries/a.md", "a, stamped\n");
    commitFile(store, repo, "entries/b.md", "b, stamped\n");
    const kept = keepBytes(
      repo,
      new Map([
        ["entries/a.md", Buffer.from("a, by hand\n")],
        ["entries/b.md", Buffer.from("b, by hand\n")],
      ]),
    );
    writeIntent(repo, {
      operation: "adopt",
      writer: person,
      existed: [],
      created: ["entries/a.md", "entries/b.md"],
      written: { "entries/a.md": hash("a, stamped\n"), "entries/b.md": hash("b, stamped\n") },
      keptBytesFile: kept,
    });
    // The person goes on working on a before the next command.
    writeFileSync(join(repo.path, "entries", "a.md"), "a, edited again\n");

    openRepo(store, WORKSPACE);
    expect(readFileSync(join(repo.path, "entries", "b.md"), "utf8")).toBe("b, stamped\n");
    expect(readFileSync(join(repo.path, "entries", "a.md"), "utf8")).toBe("a, edited again\n");
    expect(status(repo)).toBe(" M entries/a.md");
    expect(readIntent(repo)).toBeNull();
    expect(existsSync(join(repo.path, ".git", kept))).toBe(false);
    expect(said).toHaveLength(1);
    expect(said[0]).toContain("entries/a.md");
    expect(said[0]).not.toContain("entries/b.md");
  });

  /**
   * What a dropped folder could carry: `entries/sub` a link to a folder of the person's, an
   * index entry beyond it that `stage` makes, and a record that names the file as written.
   */
  function linkedOutside(stage: (repo: Repo) => void): { repo: Repo; victim: string } {
    const repo = ensureRepo(fx.store(), WORKSPACE);
    const outside = join(fx.dir, "the-persons-folder");
    mkdirSync(outside);
    const victim = join(outside, "victim.txt");
    writeFileSync(victim, "the person's file\n");
    // The index is prepared while the folder is a real one, which is then made a link.
    const sub = join(repo.path, "entries", "sub");
    mkdirSync(sub);
    writeFileSync(join(sub, "victim.txt"), "the person's file\n");
    stage(repo);
    rmSync(sub, { recursive: true });
    symlinkSync(outside, sub);
    writeFileSync(
      join(repo.path, ".git", "wizardingcode-op.json"),
      JSON.stringify({
        operation: "write",
        writer: person,
        existed: [],
        created: ["entries/sub/victim.txt"],
        written: { "entries/sub/victim.txt": hash("the person's file\n") },
      }),
    );
    return { repo, victim };
  }

  test("a file reached through a link inside the repository is never removed", () => {
    const { store, said } = reporting();
    const { repo, victim } = linkedOutside((made) => {
      realGit(made.path, "add", "-N", "--", "entries/sub/victim.txt");
    });
    expect(openRepo(store, WORKSPACE)?.id).toBe(repo.id);
    expect(readFileSync(victim, "utf8")).toBe("the person's file\n");
    expect(readIntent(repo)).toBeNull();
    expect(existsSync(join(repo.path, ".git", "wizardingcode-op.json"))).toBe(false);
    expect(said).toHaveLength(1);
    expect(said[0]).toContain("entries/sub/victim.txt");
    expect(said[0]).not.toContain("was undone");
  });

  test("a regular index entry beyond a link does not leave the repository refusing every command", () => {
    const { store } = reporting();
    const { repo, victim } = linkedOutside((made) => {
      realGit(made.path, "add", "--", "entries/sub/victim.txt");
    });
    expect(openRepo(store, WORKSPACE)?.id).toBe(repo.id);
    expect(readFileSync(victim, "utf8")).toBe("the person's file\n");
    expect(readIntent(repo)).toBeNull();
    expect(openRepo(store, WORKSPACE)?.id).toBe(repo.id);
  });

  test("undoing refuses a path whose folder is a link", () => {
    const store = fx.store();
    const repo = ensureRepo(store, WORKSPACE);
    const outside = join(fx.dir, "the-persons-folder");
    mkdirSync(outside);
    writeFileSync(join(outside, "victim.txt"), "the person's file\n");
    symlinkSync(outside, join(repo.path, "entries", "sub"));
    const call = () =>
      undoStaged(store, repo, { existed: [], created: ["entries/sub/victim.txt"] }, "write");
    expect(codeOf(call)).toBe("invalid");
    expect(thrown(call).message).toContain("entries/sub");
    expect(existsSync(join(outside, "victim.txt"))).toBe(true);
  });

  test("a record that is a link, or not a file, is never read", () => {
    const store = fx.store();
    const repo = ensureRepo(store, WORKSPACE);
    const record = join(repo.path, ".git", "wizardingcode-op.json");
    const elsewhere = join(fx.dir, "elsewhere.json");
    writeFileSync(
      elsewhere,
      JSON.stringify({ operation: "write", writer: person, existed: [], created: [] }),
    );
    symlinkSync(elsewhere, record);
    expect(readIntent(repo)).toBeNull();
    // A link inside .git refuses the repository, like any other; its target is untouched.
    expect(codeOf(() => openRepo(store, WORKSPACE))).toBe("invalid");
    expect(thrown(() => openRepo(store, WORKSPACE)).message).toContain(record);
    expect(existsSync(elsewhere)).toBe(true);
    rmSync(record);

    // A folder at the record's path is removed like any record the store cannot act on.
    mkdirSync(record);
    writeFileSync(join(record, "inside"), "x\n");
    expect(readIntent(repo)).toBeNull();
    expect(openRepo(store, WORKSPACE)?.id).toBe(repo.id);
    expect(existsSync(record)).toBe(false);
  });

  test("a record the store cannot act on waits while another process holds the repository", () => {
    const { store, said } = reporting();
    const repo = ensureRepo(store, WORKSPACE);
    const record = join(repo.path, ".git", "wizardingcode-op.json");
    writeFileSync(
      record,
      JSON.stringify({ operation: "write", writer: person, existed: ["../x.md"], created: [] }),
    );
    const key = leaseKey(repo.relative);
    setMeta(
      fx.db,
      key,
      JSON.stringify({ owner: `${process.pid}-writer`, until: store.now() + 60_000 }),
    );
    // That process may be the one writing the record: it is left alone, and nothing is said.
    openRepo(store, WORKSPACE);
    expect(existsSync(record)).toBe(true);
    expect(said).toEqual([]);

    fx.db.run("DELETE FROM meta WHERE key = ?", [key]);
    openRepo(store, WORKSPACE);
    expect(existsSync(record)).toBe(false);
    expect(said).toHaveLength(1);
  });

  test("a folder left at a kept-bytes name does not stop the repository from opening", () => {
    const store = fx.store();
    const repo = ensureRepo(store, WORKSPACE);
    const kept = "wizardingcode-kept-00000000-0000-4000-8000-000000000000.json";
    mkdirSync(join(repo.path, ".git", kept));
    writeFileSync(join(repo.path, ".git", kept, "inside"), "x\n");
    writeFileSync(
      join(repo.path, ".git", "wizardingcode-op.json"),
      JSON.stringify({
        operation: "adopt",
        writer: person,
        existed: ["../x.md"],
        created: [],
        keptBytesFile: kept,
      }),
    );
    expect(openRepo(store, WORKSPACE)?.id).toBe(repo.id);
    expect(existsSync(join(repo.path, ".git", kept))).toBe(false);
  });

  test("a record the store did not write is removed with its kept bytes, and said", () => {
    const { store, said } = reporting();
    const repo = ensureRepo(store, WORKSPACE);
    const kept = keepBytes(repo, new Map([["entries/a.md", Buffer.from("kept\n")]]));
    writeFileSync(
      join(repo.path, ".git", "wizardingcode-op.json"),
      JSON.stringify({
        operation: "adopt",
        writer: person,
        existed: ["../outside.md"],
        created: [],
        keptBytesFile: kept,
      }),
    );
    openRepo(store, WORKSPACE);
    expect(existsSync(join(repo.path, ".git", "wizardingcode-op.json"))).toBe(false);
    expect(existsSync(join(repo.path, ".git", kept))).toBe(false);
    expect(existsSync(join(repo.path, "entries", "a.md"))).toBe(false);
    expect(said).toHaveLength(1);
    expect(said[0]).toContain("not one this version of the store writes");
  });

  test("a record that names a path outside the knowledge folders is not acted on", () => {
    const store = fx.store();
    const repo = ensureRepo(store, WORKSPACE);
    const config = join(repo.path, ".git", "config");
    const before = readFileSync(config, "utf8");
    // What a dropped folder could carry: a record and kept bytes that name the configuration.
    const kept = keepBytes(
      repo,
      new Map([[".git/config", Buffer.from(`${before}[filter "x"]\n\tclean = /tmp/x\n`)]]),
    );
    writeFileSync(join(repo.path, "entries", "x.md"), "untracked\n");
    writeFileSync(
      join(repo.path, ".git", "wizardingcode-op.json"),
      JSON.stringify({
        operation: "adopt",
        writer: person,
        existed: [".git/config", "entries/x.md"],
        created: [],
        written: { ".git/config": hash(before) },
        keptBytesFile: kept,
      }),
    );

    expect(readIntent(repo)).toBeNull();
    expect(openRepo(store, WORKSPACE)?.id).toBe(repo.id);
    expect(readFileSync(config, "utf8")).toBe(before);
    expect(existsSync(join(repo.path, ".git", "wizardingcode-op.json"))).toBe(false);
    expect(readFileSync(join(repo.path, "entries", "x.md"), "utf8")).toBe("untracked\n");
  });

  test("a record is read only when every path is one the store writes", () => {
    const repo = ensureRepo(fx.store(), WORKSPACE);
    const file = join(repo.path, ".git", "wizardingcode-op.json");
    const read = (fields: Record<string, unknown>) => {
      writeFileSync(
        file,
        JSON.stringify({ operation: "write", writer: person, existed: [], created: [], ...fields }),
      );
      return readIntent(repo);
    };
    const outside = [
      ".git/config",
      ".GIT/config",
      "../outside.md",
      "entries/../.git/config",
      "entries/.git/config",
      "entries//a.md",
      "entries/",
      "entries",
      "/etc/hosts",
      "README.md",
      ".gitignore",
    ];
    for (const path of outside) {
      expect(read({ existed: [path] })).toBeNull();
      expect(read({ created: [path] })).toBeNull();
      expect(read({ written: { [path]: null } })).toBeNull();
    }
    expect(read({ operation: "something else" })).toBeNull();
    expect(read({ keptBytesFile: "../config" })).toBeNull();
    expect(read({ written: ["entries/a.md"] })).toBeNull();

    const own = [
      "knowledge.json",
      "taxonomy.md",
      "entries/a.md",
      "entries/assets/a.png",
      "proposals/open/x.md",
      "proposals/decided/x.md",
    ];
    for (const path of own) {
      expect(read({ existed: [path], written: { [path]: "0123456789abcdef" } })).not.toBeNull();
    }
    for (const operation of ["write", "accept", "reject", "adopt", "taxonomy"] as const) {
      expect(read({ operation })?.operation).toBe(operation);
    }
  });

  test("kept bytes are written back only as entry files", () => {
    const repo = ensureRepo(fx.store(), WORKSPACE);
    const config = join(repo.path, ".git", "config");
    const before = readFileSync(config, "utf8");
    // A folder under entries/ that leads out of the repository.
    const outside = join(fx.dir, "outside-kept");
    mkdirSync(outside);
    symlinkSync(outside, join(repo.path, "entries", "linked"));
    const kept = keepBytes(
      repo,
      new Map([
        [".git/config", Buffer.from("replaced\n")],
        ["entries/linked/a.md", Buffer.from("through a link\n")],
        ["entries/deeper/a.md", Buffer.from("in a folder\n")],
        ["taxonomy.md", Buffer.from("replaced\n")],
        ["entries/a.md", Buffer.from("kept\n")],
      ]),
    );
    const taxonomy = readFileSync(join(repo.path, "taxonomy.md"), "utf8");
    restoreKept(repo, kept);
    expect(readFileSync(config, "utf8")).toBe(before);
    expect(readdirSync(outside)).toEqual([]);
    expect(existsSync(join(repo.path, "entries", "deeper"))).toBe(false);
    expect(readFileSync(join(repo.path, "taxonomy.md"), "utf8")).toBe(taxonomy);
    expect(readFileSync(join(repo.path, "entries", "a.md"), "utf8")).toBe("kept\n");
    expect(existsSync(join(repo.path, ".git", kept))).toBe(false);
  });

  test("undoing never removes a file outside the knowledge folders", () => {
    const store = fx.store();
    const repo = ensureRepo(store, WORKSPACE);
    const call = () => undoStaged(store, repo, { existed: [], created: [".git/config"] }, "write");
    expect(codeOf(call)).toBe("invalid");
    expect(existsSync(join(repo.path, ".git", "config"))).toBe(true);
  });

  test("the revert waits while another process holds the repository", () => {
    const store = fx.store();
    const repo = ensureRepo(store, WORKSPACE);
    writeFileSync(join(repo.path, "entries", "new.md"), "in progress\n");
    writeIntent(repo, {
      operation: "write",
      writer: person,
      existed: [],
      created: ["entries/new.md"],
      written: { "entries/new.md": hash("in progress\n") },
    });
    setMeta(
      fx.db,
      leaseKey(repo.relative),
      JSON.stringify({ owner: `${process.pid}-writer`, until: store.now() + 60_000 }),
    );
    // That operation is running, not interrupted: its file and its record stay.
    openRepo(store, WORKSPACE);
    expect(existsSync(join(repo.path, "entries", "new.md"))).toBe(true);
    expect(readIntent(repo)).not.toBeNull();
  });
});

describe("a folder that is not the store's own repository", () => {
  const BASE = "[core]\n\trepositoryformatversion = 0\n\tfilemode = true\n\tbare = false\n";

  test("a configuration git would read from somewhere else is refused", () => {
    const store = fx.store();
    const repo = ensureRepo(store, WORKSPACE);
    const gitDir = join(repo.path, ".git");
    const refused = (name: string) => {
      expect(codeOf(() => checkRepoConfig(repo.path))).toBe("invalid");
      expect(thrown(() => checkRepoConfig(repo.path)).message).toContain(name);
      expect(codeOf(() => openRepo(store, WORKSPACE))).toBe("invalid");
    };

    writeFileSync(join(gitDir, "commondir"), "../elsewhere\n");
    refused("commondir");
    rmSync(join(gitDir, "commondir"));

    writeFileSync(join(gitDir, "config.worktree"), "[core]\n\tbare = false\n");
    refused("config.worktree");
    rmSync(join(gitDir, "config.worktree"));

    // Objects read from another repository on the disk.
    mkdirSync(join(gitDir, "objects", "info"), { recursive: true });
    writeFileSync(join(gitDir, "objects", "info", "alternates"), "/somewhere/else/objects\n");
    refused("alternates");
    rmSync(join(gitDir, "objects", "info", "alternates"));

    writeFileSync(join(gitDir, "config"), `${BASE}[extensions]\n\tworktreeConfig = true\n`);
    refused("worktreeConfig");

    writeFileSync(join(gitDir, "config"), `${BASE}[diff "x"]\n\ttextconv = /tmp/x\n`);
    refused("textconv");
    writeFileSync(join(gitDir, "config"), `${BASE}[merge "x"]\n\tdriver = /tmp/x\n`);
    refused("driver");

    writeFileSync(join(gitDir, "config"), BASE);
    expect(codeOf(() => checkRepoConfig(repo.path))).toBeNull();
    expect(openRepo(store, WORKSPACE)?.id).toBe(repo.id);
  });

  test("a filter reached through a worktree configuration never runs", () => {
    const store = fx.store({ env: { WIZARDINGCODE_MEM_AUTHOR: "Writer" } });
    const repo = ensureRepo(store, WORKSPACE);
    const { script, marker } = trap("filter");
    const gitDir = join(repo.path, ".git");
    writeFileSync(join(gitDir, "config"), `${BASE}[extensions]\n\tworktreeConfig = true\n`);
    writeFileSync(join(gitDir, "config.worktree"), `[filter "x"]\n\tclean = ${script}\n`);
    writeFileSync(join(repo.path, ".gitattributes"), "* filter=x\n");

    const call = () =>
      writeEntry(
        store,
        WORKSPACE,
        { title: "An entry", kind: "knowledge", area: "code", context: "", subject: "", body: "x" },
        personAuthor(store),
      );
    expect(codeOf(call)).toBe("invalid");
    expect(existsSync(marker)).toBe(false);
    expect(existsSync(join(repo.path, "entries", "an-entry.md"))).toBe(false);
  });

  test("a .git that is a file or a link is refused before git runs, and the repository it names is untouched", () => {
    const outside = join(fx.dir, "outside");
    mkdirSync(outside);
    realGit(outside, "init", "-q", "-b", "main");
    writeFileSync(join(outside, "theirs.txt"), "theirs\n");
    realGit(outside, "add", "theirs.txt");
    realGit(
      outside,
      "-c",
      "user.name=T",
      "-c",
      "user.email=t@example.invalid",
      "commit",
      "-q",
      "-m",
      "theirs",
    );
    const head = realGit(outside, "rev-parse", "HEAD").trim();
    const store = fx.store();
    const folder = join(fx.dataDir, "knowledge", "workspace");
    const untouched = () => {
      expect(realGit(outside, "rev-parse", "HEAD").trim()).toBe(head);
      expect(realGit(outside, "status", "--porcelain")).toBe("");
      expect(realGit(outside, "rev-list", "--count", "HEAD").trim()).toBe("1");
    };

    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, ".git"), `gitdir: ${join(outside, ".git")}\n`);
    expect(codeOf(() => ensureRepo(store, WORKSPACE))).toBe("invalid");
    expect(thrown(() => ensureRepo(store, WORKSPACE)).message).toContain(".git");
    expect(codeOf(() => openRepo(store, WORKSPACE))).toBe("invalid");
    untouched();

    rmSync(join(folder, ".git"));
    symlinkSync(join(outside, ".git"), join(folder, ".git"));
    expect(codeOf(() => ensureRepo(store, WORKSPACE))).toBe("invalid");
    untouched();
  });

  test("a repository folder that is a link is refused, and nothing is written through it", () => {
    const outside = join(fx.dir, "outside-folder");
    mkdirSync(outside);
    mkdirSync(join(fx.dataDir, "knowledge"), { recursive: true });
    symlinkSync(outside, join(fx.dataDir, "knowledge", "workspace"));
    const store = fx.store();
    expect(codeOf(() => ensureRepo(store, WORKSPACE))).toBe("invalid");
    expect(readdirSync(outside)).toEqual([]);
  });

  test("a linked folder inside the repository is refused, and nothing is written through it", () => {
    const store = fx.store({ env: { WIZARDINGCODE_MEM_AUTHOR: "Writer" } });
    const repo = ensureRepo(store, WORKSPACE);
    const outside = join(fx.dir, "outside-entries");
    mkdirSync(outside);
    rmSync(join(repo.path, "entries"), { recursive: true });
    symlinkSync(outside, join(repo.path, "entries"));

    const call = () =>
      writeEntry(
        store,
        WORKSPACE,
        { title: "An entry", kind: "knowledge", area: "code", context: "", subject: "", body: "x" },
        personAuthor(store),
      );
    expect(codeOf(call)).toBe("invalid");
    expect(thrown(call).message).toContain("entries");
    expect(readdirSync(outside)).toEqual([]);
  });

  test("a link where the store keeps a file of its own is refused, and nothing is written through it", () => {
    const outside = join(fx.dir, "the-persons-file.txt");
    writeFileSync(outside, "the person's file\n");
    const folder = join(fx.dataDir, "knowledge", "workspace");
    mkdirSync(folder, { recursive: true });
    for (const name of [".gitignore", "taxonomy.md", "knowledge.json"]) {
      symlinkSync(outside, join(folder, name));
      const call = () => ensureRepo(fx.store(), WORKSPACE);
      expect(codeOf(call)).toBe("invalid");
      expect(thrown(call).message).toContain(name);
      expect(readFileSync(outside, "utf8")).toBe("the person's file\n");
      expect(existsSync(join(folder, ".git"))).toBe(false);
      rmSync(join(folder, name));
    }
    // A link to nothing is a link all the same: its target is never created.
    symlinkSync(join(fx.dir, "not-there.md"), join(folder, "taxonomy.md"));
    expect(codeOf(() => ensureRepo(fx.store(), WORKSPACE))).toBe("invalid");
    expect(existsSync(join(fx.dir, "not-there.md"))).toBe(false);
  });

  test("git never runs in a repository nested in the store's", () => {
    const store = fx.store();
    const repo = ensureRepo(store, WORKSPACE);
    const { script, marker } = trap("nested");
    const nested = join(repo.path, "entries", "sub");
    mkdirSync(nested);
    realGit(nested, "init", "-q", "-b", "main");
    writeFileSync(join(nested, "f.txt"), "one\n");
    realGit(nested, "add", "f.txt");
    realGit(
      nested,
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@example.invalid",
      "commit",
      "-qm",
      "x",
    );
    const head = realGit(nested, "rev-parse", "HEAD").trim();
    // The nested repository's own configuration is one the store never reads.
    appendFileSync(join(nested, ".git", "config"), `[filter "x"]\n\tclean = ${script}\n`);
    writeFileSync(join(nested, ".gitattributes"), "* filter=x\n");
    const later = new Date(Date.now() + 60_000);
    utimesSync(join(nested, "f.txt"), later, later);
    // The index a dropped folder could carry: an entry that points at the nested repository.
    realGit(repo.path, "update-index", "--add", "--cacheinfo", `160000,${head},entries/sub`);

    expect(openRepo(store, WORKSPACE)?.id).toBe(repo.id);
    expect(statusOf(store, repo, [])).toEqual([]);
    expect(existsSync(marker)).toBe(false);

    // A .gitmodules that tells git to look into it, appearing after the repository was
    // opened: the setting the runner passes gives way to it, the flag statusOf adds does not.
    writeFileSync(
      join(repo.path, ".gitmodules"),
      '[submodule "x"]\n\tpath = entries/sub\n\turl = ./entries/sub\n\tignore = none\n',
    );
    const evenLater = new Date(Date.now() + 120_000);
    utimesSync(join(nested, "f.txt"), evenLater, evenLater);
    expect(statusOf(store, repo, ["entries"])).toEqual([]);
    expect(existsSync(marker)).toBe(false);
    rmSync(join(repo.path, ".gitmodules"));

    // The trap is live: git without the store's flag does run it.
    realGit(repo.path, "status", "--porcelain");
    expect(existsSync(marker)).toBe(true);
  });

  test("a .gitmodules file is refused: the store keeps no nested repositories", () => {
    const store = fx.store();
    const repo = ensureRepo(store, WORKSPACE);
    writeFileSync(
      join(repo.path, ".gitmodules"),
      '[submodule "x"]\n\tpath = entries/sub\n\tignore = none\n',
    );
    expect(codeOf(() => openRepo(store, WORKSPACE))).toBe("invalid");
    expect(thrown(() => openRepo(store, WORKSPACE)).message).toContain(".gitmodules");
  });

  test("a link anywhere inside .git is refused before git runs, and nothing is written through it", () => {
    const store = fx.store({ env: { WIZARDINGCODE_MEM_AUTHOR: "Writer" } });
    const repo = ensureRepo(store, WORKSPACE);
    const gitDir = join(repo.path, ".git");
    const victim = join(fx.dir, "the-persons-file");
    const elsewhere = join(fx.dir, "the-persons-folder");
    mkdirSync(elsewhere);
    const aside = join(fx.dir, "kept-aside");
    const write = () => writeEntry(store, WORKSPACE, AN_ENTRY, personAuthor(store));

    /** Puts a link at a name inside .git, sees the write refused, and puts things back. */
    const refusedWith = (name: string, target: string) => {
      const path = join(gitDir, ...name.split("/"));
      const had = existsSync(path);
      if (had) renameSync(path, aside);
      else mkdirSync(dirname(path), { recursive: true });
      symlinkSync(target, path);
      writeFileSync(victim, "the person's own lines\n");

      expect(codeOf(write)).toBe("invalid");
      expect(thrown(write).message).toContain(path);
      expect(readFileSync(victim, "utf8")).toBe("the person's own lines\n");
      expect(readdirSync(elsewhere)).toEqual([]);

      rmSync(path);
      if (had) renameSync(aside, path);
    };
    // git writes its commit message there, in place.
    refusedWith("COMMIT_EDITMSG", victim);
    // git appends a line with the writer's name there.
    refusedWith("logs/HEAD", victim);
    refusedWith("logs", elsewhere);
    // git moves a branch and writes objects there.
    refusedWith("refs", elsewhere);
    refusedWith("refs/heads/main", victim);
    refusedWith("objects", elsewhere);
    refusedWith("objects/pack", elsewhere);
    refusedWith("HEAD", victim);
    refusedWith("info", elsewhere);
    refusedWith("anything-else", victim);

    // Put back as the store made it, the repository takes the write.
    expect(write().kind).toBe("written");
    expect(existsSync(join(repo.path, "entries", "an-entry.md"))).toBe(true);
  });

  test("a repository is refused before git is run in it", () => {
    const dump = join(fx.dir, "git-was-run.txt");
    const store = fx.store({
      env: {
        WIZARDINGCODE_MEM_AUTHOR: "Writer",
        PATH: fx.pathWith(stubGit(join(fx.dir, "watched-git"), { dumpEnvTo: dump })),
      },
    });
    const repo = ensureRepo(store, WORKSPACE);
    rmSync(join(repo.path, ".git", "COMMIT_EDITMSG"));
    symlinkSync(join(fx.dir, "the-persons-file"), join(repo.path, ".git", "COMMIT_EDITMSG"));
    // The version of this git is known by now: any call from here on is one in the repository.
    rmSync(dump);

    const write = () => writeEntry(store, WORKSPACE, AN_ENTRY, personAuthor(store));
    expect(codeOf(write)).toBe("invalid");
    expect(existsSync(dump)).toBe(false);
  });

  test("a folder inside .git that cannot be listed refuses the repository", () => {
    if (!unix || process.getuid?.() === 0) return;
    const store = fx.store({ env: { WIZARDINGCODE_MEM_AUTHOR: "Writer" } });
    const repo = ensureRepo(store, WORKSPACE);
    const gitDir = join(repo.path, ".git");
    const victim = join(fx.dir, "the-persons-file");
    const write = () => writeEntry(store, WORKSPACE, AN_ENTRY, personAuthor(store));
    /** A link inside a folder that can be searched and not listed, as an archive can carry it. */
    const refusedWith = (name: string, folder: string, modeBits: number) => {
      const path = join(gitDir, ...name.split("/"));
      rmSync(path, { force: true });
      symlinkSync(victim, path);
      writeFileSync(victim, "the person's own lines\n");
      chmodSync(folder, modeBits);
      try {
        expect(codeOf(write)).toBe("invalid");
        expect(thrown(write).message).toContain(folder);
        expect(readFileSync(victim, "utf8")).toBe("the person's own lines\n");
      } finally {
        chmodSync(folder, 0o700);
      }
      rmSync(path);
    };
    refusedWith("COMMIT_EDITMSG", gitDir, 0o300);
    refusedWith("logs/HEAD", join(gitDir, "logs"), 0o100);
    expect(write().kind).toBe("written");
  });

  test("the socket a person's own git leaves in .git is let through, and no other", async () => {
    if (!unix) return;
    const store = fx.store();
    const repo = ensureRepo(store, WORKSPACE);
    // A socket's path is short on some systems, so it is made at a short path and moved in.
    const made = join(fx.dir, "s");
    const listener = Bun.listen({ unix: made, socket: { data() {} } });
    try {
      renameSync(made, join(repo.path, ".git", "fsmonitor--daemon.ipc"));
      expect(openRepo(store, WORKSPACE)?.id).toBe(repo.id);

      renameSync(
        join(repo.path, ".git", "fsmonitor--daemon.ipc"),
        join(repo.path, ".git", "another.ipc"),
      );
      expect(codeOf(() => openRepo(store, WORKSPACE))).toBe("invalid");
      expect(thrown(() => openRepo(store, WORKSPACE)).message).toContain("another.ipc");

      // The right name is not enough anywhere but at the top of .git.
      const deeper = join(repo.path, ".git", "refs", "fsmonitor--daemon.ipc");
      renameSync(join(repo.path, ".git", "another.ipc"), deeper);
      expect(codeOf(() => openRepo(store, WORKSPACE))).toBe("invalid");
      rmSync(deeper);
      // And at the top, only a socket has it: a link of that name is a link.
      const named = join(repo.path, ".git", "fsmonitor--daemon.ipc");
      symlinkSync(join(fx.dir, "the-persons-file"), named);
      expect(codeOf(() => openRepo(store, WORKSPACE))).toBe("invalid");
      expect(thrown(() => openRepo(store, WORKSPACE)).message).toContain("a link");
      rmSync(named);
      expect(openRepo(store, WORKSPACE)?.id).toBe(repo.id);
    } finally {
      listener.stop(true);
    }
  });

  test("a data directory that is itself a link is the person's, and works", () => {
    // What is refused is a link inside the data directory, not the directory itself.
    const linked = join(fx.dir, "data-by-another-name");
    symlinkSync(fx.dataDir, linked);
    const store = fx.store({ dataDir: linked, env: { WIZARDINGCODE_MEM_AUTHOR: "Writer" } });
    expect(writeEntry(store, WORKSPACE, AN_ENTRY, personAuthor(store)).kind).toBe("written");
    expect(existsSync(join(fx.dataDir, "knowledge", "workspace", "entries", "an-entry.md"))).toBe(
      true,
    );
  });

  test("HEAD is followed only to a ref of the repository's own", () => {
    const store = fx.store();
    const repo = ensureRepo(store, WORKSPACE);
    const head = join(repo.path, ".git", "HEAD");
    const real = headOf(repo.path);
    expect(real).toMatch(/^[0-9a-f]{40}$/);
    writeFileSync(join(fx.dir, "an-outside-file"), "0123456789abcdef0123456789abcdef01234567\n");
    const climbing = join("..", "..", "..", "..", "an-outside-file");
    // A file inside the git directory that holds a hash, and is no ref.
    writeFileSync(join(repo.path, ".git", "not-a-ref"), `${real}\n`);
    mkdirSync(join(repo.path, ".git", "refs", "heads", "a:b"), { recursive: true });
    const refused = [
      climbing,
      `refs/../${climbing}`,
      // Inside the git directory, and not under refs/.
      "not-a-ref",
      // What another system reads as a way out, or as a drive.
      "refs\\heads\\main",
      "refs/heads/..\\..\\..\\not-a-ref",
      "refs/heads/a:b",
    ];
    for (const ref of refused) {
      writeFileSync(head, `ref: ${ref}\n`);
      expect(headOf(repo.path)).toBeNull();
    }
    writeFileSync(head, "ref: refs/heads/main\n");
    expect(headOf(repo.path)).toBe(real);
  });

  test("a link where the repositories' folders go is refused, and nothing is made through it", () => {
    const outside = join(fx.dir, "the-persons-folder");
    mkdirSync(outside);
    const store = fx.store({ env: { WIZARDINGCODE_MEM_AUTHOR: "Writer" } });
    const id = fx.addProject("gitdir:/x/.git", "path:/x");
    const project = { scope: "project", projectId: id } as const;
    const write = () => writeEntry(store, project, AN_ENTRY, personAuthor(store));

    // The folder every project's repository goes under.
    ensureRepo(store, WORKSPACE);
    const projects = join(fx.dataDir, "knowledge", "projects");
    symlinkSync(outside, projects);
    expect(codeOf(write)).toBe("invalid");
    expect(thrown(write).message).toContain(projects);
    expect(codeOf(() => listRepos(store))).toBe("invalid");
    expect(readdirSync(outside)).toEqual([]);
    rmSync(projects);
    expect(write().kind).toBe("written");

    // The knowledge folder itself.
    const root = join(fx.dataDir, "knowledge");
    renameSync(root, join(fx.dir, "kept-aside"));
    symlinkSync(outside, root);
    for (const call of [write, () => ensureRepo(store, WORKSPACE), () => listRepos(store)]) {
      expect(codeOf(call)).toBe("invalid");
      expect(thrown(call).message).toContain(root);
    }
    expect(readdirSync(outside)).toEqual([]);
  });

  test("a temporary file name that is already a link is not written through", () => {
    const outside = join(fx.dir, "victim.txt");
    writeFileSync(outside, "untouched\n");
    const target = join(fx.dir, "target.md");
    symlinkSync(outside, join(fx.dir, ".target.md.tmp"));
    writeFileAtomic(target, "the new text\n");
    expect(readFileSync(target, "utf8")).toBe("the new text\n");
    expect(readFileSync(outside, "utf8")).toBe("untouched\n");
  });
});
