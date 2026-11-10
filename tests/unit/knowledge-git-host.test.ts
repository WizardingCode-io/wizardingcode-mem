import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  commitPaths,
  ensureRepo,
  type GitHost,
  gitEnv,
  knowledgeRoot,
  runGit,
} from "../../src/modules/knowledge/repo.ts";
import { type Fixture, knowledgeFixture, thrown } from "../helpers/knowledge.ts";
import { realGit, stubGit } from "../helpers/stub-git.ts";

const WORKSPACE = { scope: "workspace" } as const;
const author = { name: "Ana Lopes", email: "ana@members.wizardingcode.invalid" };
const server = { name: "wizardingcode-mem serve", email: "server@team.wizardingcode.invalid" };

let fx: Fixture;
beforeEach(() => {
  fx = knowledgeFixture("git-host");
});
afterEach(() => fx.close());

describe("the git runner's host", () => {
  test("a committer apart from the author, and the store's root by default", () => {
    const store = fx.store();
    const env = gitEnv(store, { identity: author, committer: server });
    expect(env.GIT_AUTHOR_NAME).toBe(author.name);
    expect(env.GIT_AUTHOR_EMAIL).toBe(author.email);
    expect(env.GIT_COMMITTER_NAME).toBe(server.name);
    expect(env.GIT_COMMITTER_EMAIL).toBe(server.email);
    expect(env.GIT_CEILING_DIRECTORIES).toBe(knowledgeRoot(store.dataDir));
    const alone = gitEnv(store, { identity: author });
    expect(alone.GIT_COMMITTER_NAME).toBe(author.name);
  });

  test("a host with its own root puts the ceiling there", () => {
    const host: GitHost = { ...fx.store(), root: join(fx.dir, "repos") };
    expect(gitEnv(host, {}).GIT_CEILING_DIRECTORIES).toBe(join(fx.dir, "repos"));
  });

  test("a per-call timeout beats the host's, and the host's applies otherwise", () => {
    const repo = ensureRepo(fx.store(), WORKSPACE);
    const slow = stubGit(join(fx.dir, "slow-git"), { sleepMs: 300 });
    const host = fx.store({ env: { PATH: fx.pathWith(slow) }, gitTimeoutMs: 50 });
    const byHost = thrown(() => runGit(host, repo.path, ["status", "--porcelain"], { operation: "test", readOnly: true }));
    expect(byHost.message).toContain("timed out after 50 ms");
    const answer = runGit(host, repo.path, ["status", "--porcelain"], {
      operation: "test",
      readOnly: true,
      timeoutMs: 5000,
    });
    expect(answer.exitCode).toBe(0);
  });

  test("a host's extra configuration comes after the runner's own, and the fail path still names the subcommand", () => {
    const repo = ensureRepo(fx.store(), WORKSPACE);
    const record = join(fx.dir, "git-args.jsonl");
    const recording = stubGit(join(fx.dir, "recording-git"), { recordArgsTo: record });
    const host: GitHost = {
      ...fx.store({ env: { PATH: fx.pathWith(recording) } }),
      extraConfig: ["-c", "safe.directory=*"],
    };
    runGit(host, repo.path, ["status", "--porcelain"], { operation: "test", readOnly: true });
    const calls = readFileSync(record, "utf8")
      .trim()
      .split("\n")
      .map((line) => line.split("\t").filter((arg) => arg !== ""));
    const args = calls.at(-1) as string[];
    expect(args.indexOf("safe.directory=*")).toBeGreaterThan(args.indexOf("core.pager=cat"));
    expect(args.indexOf("safe.directory=*")).toBeLessThan(args.indexOf("status"));

    const failing = stubGit(join(fx.dir, "failing-git"), { fail: "status", stderr: "fatal: boom" });
    const broken: GitHost = {
      ...fx.store({ env: { PATH: fx.pathWith(failing) } }),
      extraConfig: ["-c", "safe.directory=*"],
    };
    const error = thrown(() => runGit(broken, repo.path, ["status"], { operation: "test" }));
    expect(error.message).toBe(`git status in ${repo.path} failed: fatal: boom`);
  });

  test("commitPaths takes a repository path and a committer", () => {
    const store = fx.store();
    const repo = ensureRepo(store, WORKSPACE);
    writeFileSync(join(repo.path, "entries", "a.md"), "one\n");
    runGit(store, repo.path, ["add", "--", "entries/a.md"], { operation: "test" });
    commitPaths(store, { path: repo.path }, ["entries/a.md"], "team: send x", author, "test", server);
    expect(realGit(repo.path, "log", "-1", "--format=%an|%ae|%cn|%ce").trim()).toBe(
      `${author.name}|${author.email}|${server.name}|${server.email}`,
    );
  });
});
