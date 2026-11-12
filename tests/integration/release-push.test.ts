import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Runner, run } from "../../scripts/release/lib.ts";
import { commitAndPush, gitEnv, tagNames } from "../../scripts/release/push.ts";

// The one writer to another repository (the tap, the marketplace), against local bare
// repositories: "other" is the repository written to, "origin" the one whose tag was judged.

const IDENTITY = {
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.invalid",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.invalid",
};
// No git configuration of the person running the tests reaches them, or the code under test.
const saved = { global: process.env.GIT_CONFIG_GLOBAL, system: process.env.GIT_CONFIG_NOSYSTEM };
beforeAll(() => {
  process.env.GIT_CONFIG_GLOBAL = "/dev/null";
  process.env.GIT_CONFIG_NOSYSTEM = "1";
});
afterAll(() => {
  if (saved.global === undefined) delete process.env.GIT_CONFIG_GLOBAL;
  else process.env.GIT_CONFIG_GLOBAL = saved.global;
  if (saved.system === undefined) delete process.env.GIT_CONFIG_NOSYSTEM;
  else process.env.GIT_CONFIG_NOSYSTEM = saved.system;
});

let base: string;
let other: string;
let origin: string;
let sha: string;

function git(cwd: string, ...args: string[]): string {
  const out = run(["git", ...args], { cwd, env: { ...process.env, ...IDENTITY } });
  if (out.code !== 0) throw new Error(`git ${args.join(" ")}: ${out.stderr}`);
  return out.stdout.trim();
}
/** A bare repository with one commit holding `file`, and a clone of it to work in. */
function repository(name: string, file: string): { bare: string; work: string } {
  const bare = join(base, `${name}.git`);
  const work = join(base, `${name}-work`);
  mkdirSync(bare);
  git(bare, "init", "--quiet", "--bare", "-b", "main");
  git(base, "clone", "--quiet", bare, work);
  writeFileSync(join(work, file), "one\n");
  git(work, "add", "-A");
  git(work, "commit", "--quiet", "-m", "first");
  git(work, "push", "--quiet", "origin", "HEAD:main");
  return { bare, work };
}
const head = (bare: string) => git(bare, "rev-parse", "main");
const messages = (bare: string) => git(bare, "log", "--format=%s", "main").split("\n");

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "wizardingcode-mem-push-")));
  other = repository("other", "a.txt").bare;
  const judged = repository("origin", "package.json");
  origin = judged.bare;
  sha = git(judged.work, "rev-parse", "HEAD");
  git(judged.work, "tag", "v1.0.0");
  git(judged.work, "tag", "-a", "v1.0.1", "-m", "annotated");
  git(judged.work, "push", "--quiet", "origin", "v1.0.0", "v1.0.1");
});
afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

const options = (
  edit: (dir: string) => null,
  more: Partial<Parameters<typeof commitAndPush>[0]> = {},
) => ({
  remote: other,
  origin,
  tag: "v1.0.0",
  sha,
  version: "1.0.0",
  dryRun: false,
  token: null,
  log: () => {},
  edit,
  ...more,
});
const change = (dir: string) => {
  writeFileSync(join(dir, "a.txt"), "two\n");
  return null;
};

describe("the writer to another repository", () => {
  test("an unchanged tree makes no commit and says the repository is already there", () => {
    const before = head(other);
    expect(commitAndPush(options(() => null))).toEqual({ kind: "already-at", version: "1.0.0" });
    expect(head(other)).toBe(before);
  });

  test("a changed tree makes one commit, named after the version, and pushes it", () => {
    expect(commitAndPush(options(change))).toEqual({ kind: "written", version: "1.0.0" });
    expect(messages(other)).toEqual(["wizardingcode-mem 1.0.0", "first"]);
    expect(git(other, "show", "main:a.txt")).toBe("two");
    expect(git(other, "log", "-1", "--format=%an <%ae>", "main")).toBe(
      "github-actions[bot] <41898282+github-actions[bot]@users.noreply.github.com>",
    );
  });

  test("a new file counts as a change", () => {
    const outcome = commitAndPush(
      options((dir) => {
        mkdirSync(join(dir, "Formula"));
        writeFileSync(join(dir, "Formula", "new.rb"), "class New\nend\n");
        return null;
      }),
    );
    expect(outcome.kind).toBe("written");
    expect(git(other, "show", "main:Formula/new.rb")).toContain("class New");
  });

  test("a dry run shows the change and leaves the remote as it was", () => {
    const before = head(other);
    const logged: string[] = [];
    const outcome = commitAndPush(
      options(change, { dryRun: true, log: (line) => logged.push(line) }),
    );
    expect(outcome).toEqual({ kind: "would-write", version: "1.0.0" });
    expect(head(other)).toBe(before);
    expect(logged.join("\n")).toContain("+two");
  });

  test("a push refused because the remote moved succeeds after one rebase", () => {
    const outcome = commitAndPush(
      options((dir) => {
        change(dir);
        // Someone else pushes to the same repository while this run holds its clone.
        const second = join(base, "second");
        git(base, "clone", "--quiet", other, second);
        writeFileSync(join(second, "b.txt"), "theirs\n");
        git(second, "add", "-A");
        git(second, "commit", "--quiet", "-m", "theirs");
        git(second, "push", "--quiet", "origin", "HEAD:main");
        return null;
      }),
    );
    expect(outcome.kind).toBe("written");
    expect(messages(other)).toEqual(["wizardingcode-mem 1.0.0", "theirs", "first"]);
  });

  test("an edit that leaves the repository alone is passed through, and nothing is written", () => {
    const before = head(other);
    const outcome = commitAndPush(
      options(() => ({ kind: "left-alone", higher: "9.9.9" }) as never),
    );
    expect(outcome).toEqual({ kind: "left-alone", higher: "9.9.9" });
    expect(head(other)).toBe(before);
  });

  test("a tag that no longer names the judged commit stops it before any write", () => {
    const before = head(other);
    let edited = false;
    const moved = "0".repeat(40);
    expect(() =>
      commitAndPush(
        options(
          (dir) => {
            edited = true;
            return change(dir);
          },
          { sha: moved },
        ),
      ),
    ).toThrow(`v1.0.0 no longer names the commit that was judged (${moved}); nothing was written`);
    expect(edited).toBe(false);
    expect(head(other)).toBe(before);
  });

  test("an annotated tag is compared by the commit it points at", () => {
    expect(commitAndPush(options(change, { tag: "v1.0.1", version: "1.0.1" })).kind).toBe(
      "written",
    );
    expect(() => commitAndPush(options(change, { tag: "v9.9.9" }))).toThrow("no longer names");
    // The same refusal when the annotated tag exists and names another commit.
    const before = head(other);
    expect(() =>
      commitAndPush(options(change, { tag: "v1.0.1", version: "1.0.1", sha: "0".repeat(40) })),
    ).toThrow("v1.0.1 no longer names the commit that was judged");
    expect(head(other)).toBe(before);
  });

  test("a push refused by a rule on the branch says so, and is not retried as a race", () => {
    // The other repository refuses every push, the way a protected branch does.
    const hook = join(other, "hooks", "pre-receive");
    writeFileSync(
      hook,
      "#!/bin/sh\necho 'GH006: Protected branch update failed for refs/heads/main.' >&2\nexit 1\n",
    );
    chmodSync(hook, 0o755);
    const calls: string[][] = [];
    const runner: Runner = (cmd, more) => {
      calls.push(cmd);
      return run(cmd, more);
    };
    expect(() => commitAndPush(options(change, { runner }))).toThrow(
      `the push to ${other} was refused by a rule on its branch: it must accept a direct push from the token's owner`,
    );
    expect(calls.filter((cmd) => cmd[1] === "pull")).toHaveLength(0);
  });

  test("the token travels in the child's environment only: never in an argument or a URL", () => {
    const calls: Array<{ cmd: string[]; env: Record<string, string | undefined> | undefined }> = [];
    const runner: Runner = (cmd, more) => {
      calls.push({ cmd, env: more?.env });
      return run(cmd, more);
    };
    commitAndPush(options(change, { token: "secret", runner }));
    const encoded = Buffer.from("x-access-token:secret").toString("base64");
    for (const call of calls) {
      for (const argument of call.cmd) {
        expect(argument).not.toContain("secret");
        expect(argument).not.toContain(encoded);
      }
    }
    const holds = (name: string) => calls.filter((call) => call.cmd[1] === name);
    // Every call to the other repository carries it; the read of this repository never does.
    for (const name of ["clone", "push"]) {
      expect(holds(name).length).toBeGreaterThan(0);
      for (const call of holds(name))
        expect(call.env?.GIT_CONFIG_VALUE_0).toBe(`Authorization: Basic ${encoded}`);
    }
    for (const call of holds("ls-remote")) expect(call.env?.GIT_CONFIG_VALUE_0).toBeUndefined();
  });
});

describe("gitEnv and tagNames", () => {
  test("the header is set for github.com only, and prompts are off", () => {
    const env = gitEnv("secret", { PATH: "/bin" });
    expect(env).toEqual({
      PATH: "/bin",
      GIT_TERMINAL_PROMPT: "0",
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
      GIT_CONFIG_VALUE_0: `Authorization: Basic ${Buffer.from("x-access-token:secret").toString("base64")}`,
    });
    expect(gitEnv(null, { PATH: "/bin" })).toEqual({ PATH: "/bin", GIT_TERMINAL_PROMPT: "0" });
  });

  test("a tag's commit is the peeled line when there is one", () => {
    const light = `${"a".repeat(40)}\trefs/tags/v1.0.0\n`;
    const annotated = `${"b".repeat(40)}\trefs/tags/v1.0.1\n${"c".repeat(40)}\trefs/tags/v1.0.1^{}\n`;
    expect(tagNames(light, "v1.0.0")).toBe("a".repeat(40));
    expect(tagNames(annotated, "v1.0.1")).toBe("c".repeat(40));
    expect(tagNames("", "v1.0.0")).toBeNull();
    expect(tagNames(light, "v1.0")).toBeNull();
  });
});
