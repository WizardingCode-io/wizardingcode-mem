import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { REQUIRED_ASSETS, type Runner, type RunResult, run } from "../../scripts/release/lib.ts";
import {
  commitAndPush,
  editMarketplace,
  editTap,
  encodedCredential,
  gitEnv,
  type PushOptions,
  redact,
  tagNames,
} from "../../scripts/release/push.ts";

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
/** A bare repository with one commit holding these files, and a clone of it to work in. */
function repository(name: string, files: Record<string, string>): { bare: string; work: string } {
  const bare = join(base, `${name}.git`);
  const work = join(base, `${name}-work`);
  mkdirSync(bare);
  git(bare, "init", "--quiet", "--bare", "-b", "main");
  git(base, "clone", "--quiet", bare, work);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(work, path)), { recursive: true });
    writeFileSync(join(work, path), content);
  }
  git(work, "add", "-A");
  git(work, "commit", "--quiet", "-m", "first");
  git(work, "push", "--quiet", "origin", "HEAD:main");
  return { bare, work };
}
const head = (bare: string) => git(bare, "rev-parse", "main");
const messages = (bare: string) => git(bare, "log", "--format=%s", "main").split("\n");

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "wizardingcode-mem-push-")));
  other = repository("other", { "a.txt": "one\n" }).bare;
  const judged = repository("origin", { "package.json": "one\n" });
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
  edit: PushOptions["edit"],
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

const ENCODED = encodedCredential("secret");
/** What a git that quotes its authorization header would say. */
const QUOTED = `fatal: unable to access: Authorization: Basic ${ENCODED}`;
type Step = { on: string; nth: number } & (
  | { answer: Partial<RunResult> }
  | { add: { stdout?: string; stderr?: string } }
);
/**
 * A runner that follows a script: the nth call of a git subcommand is answered without running
 * git, or runs and has text added to what git said. Every other call is git's own.
 */
function scripted(steps: Step[]): Runner {
  const seen = new Map<string, number>();
  return (cmd, more) => {
    const name = cmd[1] ?? "";
    const nth = (seen.get(name) ?? 0) + 1;
    seen.set(name, nth);
    const step = steps.find((entry) => entry.on === name && entry.nth === nth);
    if (step === undefined) return run(cmd, more);
    if ("answer" in step) return { code: 1, stdout: "", stderr: "", ...step.answer };
    const real = run(cmd, more);
    return {
      code: real.code,
      stdout: real.stdout + (step.add.stdout ?? ""),
      stderr: real.stderr + (step.add.stderr ?? ""),
    };
  };
}
const REJECTED = " ! [rejected]        HEAD -> main (fetch first)";

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
    const outcome = commitAndPush(options(() => ({ kind: "left-alone", higher: "9.9.9" })));
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

  // GitHub's two refusals by a rule: a protected branch (GH006) and a ruleset (GH013).
  test.each([
    ["a protected branch", "GH006: Protected branch update failed for refs/heads/main."],
    ["a ruleset", "GH013: Repository rule violations found for refs/heads/main."],
  ])("a push refused by %s says so, and is not retried as a race", (_rule, refusal) => {
    // The other repository refuses every push, in GitHub's words.
    const hook = join(other, "hooks", "pre-receive");
    writeFileSync(hook, `#!/bin/sh\necho '${refusal}' >&2\nexit 1\n`);
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

  test("a push that fails for another reason is said as git said it, with no second try", () => {
    const calls: string[][] = [];
    const runner: Runner = (cmd, more) => {
      calls.push(cmd);
      return run(cmd, more);
    };
    expect(() =>
      commitAndPush(
        options(
          (dir) => {
            change(dir);
            // The repository goes away between the clone and the push, as a network would.
            rmSync(other, { recursive: true, force: true });
            return null;
          },
          { runner },
        ),
      ),
    ).toThrow(new RegExp(`^the push to ${other.replaceAll(".", "\\.")} failed: .+`));
    expect(calls.filter((cmd) => cmd[1] === "pull")).toHaveLength(0);
    expect(calls.filter((cmd) => cmd[1] === "push")).toHaveLength(1);
  });

  // git's texts reach a failure's sentence and a dry run's lines: none may carry the header's
  // encoded credential, whichever call quoted it.
  test.each<[string, Step[]]>([
    ["the tag read", [{ on: "ls-remote", nth: 1, answer: { stderr: QUOTED } }]],
    ["the clone", [{ on: "clone", nth: 1, answer: { code: 128, stderr: QUOTED } }]],
    ["the push", [{ on: "push", nth: 1, answer: { stderr: QUOTED } }]],
    [
      "the rebase",
      [
        { on: "push", nth: 1, answer: { stderr: REJECTED } },
        { on: "pull", nth: 1, answer: { stderr: QUOTED } },
      ],
    ],
    [
      "the second push",
      [
        { on: "push", nth: 1, answer: { stderr: REJECTED } },
        { on: "push", nth: 2, answer: { stderr: QUOTED } },
      ],
    ],
  ])("a failure of %s that quotes the header is said without the credential", (_site, steps) => {
    let message = "";
    try {
      commitAndPush(options(change, { token: "secret", runner: scripted(steps) }));
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("Authorization: Basic ***");
    expect(message).not.toContain(ENCODED);
  });

  test("a dry run's lines carry no credential either", () => {
    const logged: string[] = [];
    const outcome = commitAndPush(
      options(change, {
        token: "secret",
        dryRun: true,
        log: (line) => logged.push(line),
        runner: scripted([
          { on: "status", nth: 2, add: { stdout: `${QUOTED}\n` } },
          { on: "diff", nth: 1, add: { stdout: `${QUOTED}\n` } },
        ]),
      }),
    );
    expect(outcome.kind).toBe("would-write");
    const lines = logged.join("\n");
    expect(lines).toContain("+two");
    expect(lines.match(/Authorization: Basic \*\*\*/g)).toHaveLength(2);
    expect(lines).not.toContain(ENCODED);
  });

  test("a text without the credential is said byte for byte, and with no token nothing is replaced", () => {
    // What git really says when the repository is gone, with a token set.
    let said = "";
    const recording: Runner = (cmd, more) => {
      const out = run(cmd, more);
      if (cmd[1] === "push") said = out.stderr.trim();
      return out;
    };
    let message = "";
    try {
      commitAndPush(
        options(
          (dir) => {
            change(dir);
            rmSync(other, { recursive: true, force: true });
            return null;
          },
          { token: "secret", runner: recording },
        ),
      );
    } catch (error) {
      message = (error as Error).message;
    }
    expect(said).not.toBe("");
    expect(message).toBe(`the push to ${other} failed: ${said}`);

    const steps: Step[] = [{ on: "clone", nth: 1, answer: { code: 128, stderr: QUOTED } }];
    expect(() => commitAndPush(options(change, { token: null, runner: scripted(steps) }))).toThrow(
      `git clone failed in ${other}: ${QUOTED}`,
    );
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
    expect(holds("ls-remote").length).toBeGreaterThan(0);
    for (const call of holds("ls-remote")) expect(call.env?.GIT_CONFIG_VALUE_0).toBeUndefined();
  });
});

describe("the two edits", () => {
  const show = (bare: string, path: string) => git(bare, "show", `main:${path}`);

  test("the tap gets the formula rendered from the template and the release's checksums, once", () => {
    const tap = repository("tap", { "README.md": "the tap\n" }).bare;
    const checksums = join(base, "checksums.txt");
    writeFileSync(
      checksums,
      REQUIRED_ASSETS.filter((name) => name !== "checksums.txt")
        .map((name, index) => `${String(index + 1).repeat(64)}  ${name}`)
        .join("\n"),
    );
    const write = () =>
      commitAndPush(options(editTap("9.9.9", checksums), { remote: tap, version: "9.9.9" }));
    expect(write()).toEqual({ kind: "written", version: "9.9.9" });
    const formula = show(tap, "Formula/wizardingcode-mem.rb");
    expect(formula).toContain('version "9.9.9"');
    expect(formula).not.toMatch(/@[A-Z0-9_]+@/);
    expect(write()).toEqual({ kind: "already-at", version: "9.9.9" });
    expect(messages(tap)).toEqual(["wizardingcode-mem 9.9.9", "first"]);
  });

  test("the marketplace gets the plugin's entry in both manifests, and a higher version is left alone", () => {
    const fixture = (name: string) =>
      readFileSync(new URL(`../fixtures/release/${name}`, import.meta.url), "utf8");
    const market = repository("market", {
      ".claude-plugin/marketplace.json": fixture("marketplace.claude.json"),
      ".agents/plugins/marketplace.json": fixture("marketplace.agents.json"),
    }).bare;
    expect(
      commitAndPush(options(editMarketplace("9.9.9"), { remote: market, version: "9.9.9" })),
    ).toEqual({ kind: "written", version: "9.9.9" });
    expect(show(market, ".claude-plugin/marketplace.json")).toContain("9.9.9");
    expect(show(market, ".agents/plugins/marketplace.json")).toContain('"ref": "v9.9.9"');
    const before = head(market);
    expect(
      commitAndPush(options(editMarketplace("9.9.8"), { remote: market, version: "9.9.8" })),
    ).toEqual({ kind: "left-alone", higher: "9.9.9" });
    expect(head(market)).toBe(before);
  });
});

describe("gitEnv and tagNames", () => {
  test("the credential is replaced wherever it occurs, by its exact text", () => {
    // A token whose encoding holds a character a pattern would read as an operator.
    const token = ["a>?", "~~~", "x?>y"].find((candidate) =>
      /[+/]/.test(encodedCredential(candidate)),
    ) as string;
    const encoded = encodedCredential(token);
    expect(encoded).toMatch(/[+/]/);
    expect(encoded).toBe(Buffer.from(`x-access-token:${token}`).toString("base64"));
    expect(redact(`a ${encoded} b ${encoded}`, token)).toBe("a *** b ***");
    expect(redact("nothing here\n", token)).toBe("nothing here\n");
    expect(redact(`a ${encoded}`, null)).toBe(`a ${encoded}`);
  });

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
