import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REQUIRED_ASSETS, run } from "../../scripts/release/lib.ts";

// The release's command files, run the way the workflow runs them, with stand-ins for git,
// gh and npm first on PATH: each answers fixed texts by its arguments and logs how it was called.

const ROOT = new URL("../../", import.meta.url).pathname;
const SHA = "a".repeat(40);
const OLD = "b".repeat(40);

let base: string;
let bin: string;

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "wizardingcode-mem-release-")));
  bin = join(base, "bin");
  mkdirSync(bin);
});
afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

/** A program on PATH: a shell `case` over its arguments, joined by spaces. */
function stub(name: string, cases: string): void {
  const file = join(bin, name);
  writeFileSync(
    file,
    `#!/bin/sh\necho "$*" >> "${base}/${name}.log"\ncase "$*" in\n${cases}\n  *) echo "unexpected ${name} $*" >&2; exit 64 ;;\nesac\n`,
  );
  chmodSync(file, 0o755);
}
const log = (name: string) =>
  existsSync(join(base, `${name}.log`)) ? readFileSync(join(base, `${name}.log`), "utf8") : "";

async function script(name: string, args: string[], env: Record<string, string>) {
  const proc = Bun.spawn([process.execPath, join(ROOT, "scripts/release", name), ...args], {
    env: {
      PATH: `${bin}:${process.env.PATH}`,
      GITHUB_OUTPUT: join(base, "output"),
      GITHUB_STEP_SUMMARY: join(base, "summary"),
      ...env,
    },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  const file = (path: string) =>
    existsSync(join(base, path)) ? readFileSync(join(base, path), "utf8") : "";
  return { stdout, stderr, exitCode, output: file("output"), summary: file("summary") };
}

describe("plan.ts", () => {
  const contract = (contract: number, accepted: string) =>
    `export const CONTRACT = ${contract};\\nexport const ACCEPTED_CONTRACTS: readonly number[] = [${accepted}];\\n`;
  const assets = JSON.stringify({
    isDraft: false,
    assets: REQUIRED_ASSETS.map((name) => ({ name })),
  });
  const env = (tag: string, more: Record<string, string> = {}) => ({
    TAG: tag,
    GITHUB_REF: "refs/heads/main",
    GITHUB_REPOSITORY: "o/r",
    RELEASE_HOLD: "false",
    DRY_RUN: "false",
    ...more,
  });
  /** A repository where v0.9.0 follows v0.8.0, both on main, and the environment is ready. */
  function world(
    options: { onMain?: boolean; environment?: string; accepted?: string } = {},
  ): void {
    stub(
      "git",
      [
        `  "rev-parse --verify --quiet refs/tags/v0.9.0^{commit}") echo ${SHA} ;;`,
        `  "rev-parse --verify --quiet refs/tags/v0.8.0^{commit}") echo ${OLD} ;;`,
        `  "rev-parse --verify --quiet refs/tags/v0.10.0-rc.1^{commit}") echo ${SHA} ;;`,
        `  "merge-base --is-ancestor ${SHA} origin/main") exit ${options.onMain === false ? 1 : 0} ;;`,
        `  "show ${SHA}:package.json") echo '{"version":"'"$PKG"'"}' ;;`,
        `  "cat-file -e ${SHA}:.github/workflows/distribute.yml") exit 0 ;;`,
        `  "tag --merged origin/main --list v*") printf 'v0.8.0\\nv0.9.0\\nvnext\\n'"$EXTRA_TAGS" ;;`,
        `  "cat-file -e ${SHA}:src/team/contract.ts") exit 0 ;;`,
        `  "cat-file -e ${OLD}:src/team/contract.ts") exit 0 ;;`,
        `  "show ${SHA}:src/team/contract.ts") printf '${contract(3, options.accepted ?? "2, 3")}' ;;`,
        `  "show ${OLD}:src/team/contract.ts") printf '${contract(2, "1, 2")}' ;;`,
      ].join("\n"),
    );
    stub(
      "gh",
      [
        `  "release view "*" --json isDraft,assets") echo '${assets}' ;;`,
        options.environment ??
          `  "api repos/o/r/environments/release") echo '{"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}' ;;`,
        `  "api repos/o/r/environments/release/deployment-branch-policies") echo '{"total_count":1,"branch_policies":[{"id":1,"name":"main","type":"branch"}]}' ;;`,
      ].join("\n"),
    );
  }

  test("an accepted plain release gives its version, its commit and the latest job's line", async () => {
    world();
    const result = await script("plan.ts", [], env("v0.9.0", { PKG: "0.9.0" }));
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(result.output).toBe(
      `version=0.9.0\nsha=${SHA}\nprerelease=false\nheld=false\nlatest_line=latest: moved to 0.9.0\n`,
    );
    expect(result.summary).toBe("");
  });

  test("a dry run's line says it would move", async () => {
    world();
    const result = await script("plan.ts", [], env("v0.9.0", { PKG: "0.9.0", DRY_RUN: "true" }));
    expect(result.output).toContain("latest_line=latest: would move to 0.9.0 (dry run)\n");
  });

  test("a tag that is not on main is refused, and nothing after that check is read", async () => {
    world({ onMain: false });
    const result = await script("plan.ts", [], env("v0.9.0", { PKG: "0.9.0" }));
    expect(result.exitCode).toBe(1);
    const sentence =
      "v0.9.0 is not on main; only a commit that reached main by a pull request is distributed";
    expect(result.stderr).toBe(`release: ${sentence}\n`);
    expect(result.summary).toBe(`distribute: refused: ${sentence}\n`);
    expect(result.output).toBe("");
    expect(log("gh")).toBe("");
    expect(log("git")).not.toContain("package.json");
  });

  test("a malformed tag reaches no program", async () => {
    world();
    const result = await script("plan.ts", [], env("v0.9.0; echo x", { PKG: "0.9.0" }));
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("is not a version tag");
    expect(log("git")).toBe("");
    expect(log("gh")).toBe("");
  });

  test("a tag whose commit is at another version is refused", async () => {
    world();
    const result = await script("plan.ts", [], env("v0.9.0", { PKG: "0.8.0" }));
    expect(result.stderr).toBe(
      "release: v0.9.0 does not match its commit's package.json (0.8.0)\n",
    );
  });

  test("a pre-release writes the three skipped lines, and no hold is computed", async () => {
    world();
    const result = await script(
      "plan.ts",
      [],
      env("v0.10.0-rc.1", { PKG: "0.10.0-rc.1", EXTRA_TAGS: "v0.10.0-rc.1\\n" }),
    );
    expect(result.stderr).toBe("");
    expect(result.output).toBe(
      `version=0.10.0-rc.1\nsha=${SHA}\nprerelease=true\nheld=false\nlatest_line=\n`,
    );
    expect(result.summary).toBe(
      "tap: skipped: pre-release\nmarketplace: skipped: pre-release\nlatest: skipped: pre-release\n",
    );
    expect(log("git")).not.toContain("src/team/contract.ts");
  });

  test("a release that would refuse the previous release's members holds latest, until released by hand", async () => {
    world({ accepted: "3" });
    const held = await script("plan.ts", [], env("v0.9.0", { PKG: "0.9.0" }));
    expect(held.output).toContain("held=true\nlatest_line=\n");
    expect(held.summary).toBe("latest: held: v0.9.0 accepts contract 3 and up; v0.8.0 speaks 2\n");
    rmSync(join(base, "output"));
    const released = await script(
      "plan.ts",
      [],
      env("v0.9.0", { PKG: "0.9.0", RELEASE_HOLD: "true" }),
    );
    expect(released.output).toContain(
      "held=false\nlatest_line=latest: moved to 0.9.0, the hold released by hand\n",
    );
  });

  test("a missing environment is the refusal that points to the runbook", async () => {
    world({
      environment: `  "api repos/o/r/environments/release") echo 'gh: Not Found (HTTP 404)' >&2; exit 1 ;;`,
    });
    const result = await script("plan.ts", [], env("v0.9.0", { PKG: "0.9.0" }));
    expect(result.stderr).toBe(
      "release: the environment release does not exist; create it with its rule first (docs/runbooks/release.md)\n",
    );
  });

  test("an environment that cannot be read is said as that, never as a refusal with a guessed cause", async () => {
    world({
      environment: `  "api repos/o/r/environments/release") echo 'gh: Forbidden (HTTP 403)' >&2; exit 1 ;;`,
    });
    const result = await script("plan.ts", [], env("v0.9.0", { PKG: "0.9.0" }));
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe(
      "release: could not read the environment release: gh: Forbidden (HTTP 403)\n",
    );
  });
});

describe("npm.ts", () => {
  let folder: string;
  beforeEach(() => {
    folder = join(base, "pkg");
    mkdirSync(folder);
    writeFileSync(
      join(folder, "package.json"),
      JSON.stringify({ name: "wizardingcode-mem", version: "0.9.0" }),
    );
  });
  const env = (more: Record<string, string> = {}) => ({
    VERSION: "0.9.0",
    PRERELEASE: "false",
    DRY_RUN: "false",
    ...more,
  });
  const VIEW = `  "view wizardingcode-mem@0.9.0 version")`;

  test("a version the registry does not hold is published, with no lifecycle script", async () => {
    stub("npm", `${VIEW} exit 0 ;;\n  publish*) echo "+ wizardingcode-mem@0.9.0" ;;`);
    const result = await script("npm.ts", [folder], env());
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(log("npm")).toBe(
      "view wizardingcode-mem@0.9.0 version\npublish --access public --ignore-scripts\n",
    );
    expect(result.summary).toBe("wizardingcode-mem 0.9.0: published (dist-tag latest)\n");
  });

  test("a pre-release goes under next, and a dry run publishes nothing", async () => {
    stub("npm", `${VIEW} exit 0 ;;\n  publish*) exit 0 ;;`);
    const pre = await script("npm.ts", [folder], env({ PRERELEASE: "true" }));
    expect(pre.summary).toBe("wizardingcode-mem 0.9.0: published (dist-tag next)\n");
    rmSync(join(base, "summary"));
    const dry = await script("npm.ts", [folder], env({ DRY_RUN: "true" }));
    expect(dry.summary).toBe("wizardingcode-mem 0.9.0: would publish (dry run)\n");
    expect(log("npm")).toContain("publish --access public --ignore-scripts --tag next\n");
    expect(log("npm")).toContain("publish --access public --ignore-scripts --dry-run\n");
  });

  test("a version already on the registry is not published again", async () => {
    stub("npm", `${VIEW} echo 0.9.0 ;;`);
    const result = await script("npm.ts", [folder], env());
    expect(result.exitCode).toBe(0);
    expect(log("npm")).toBe("view wizardingcode-mem@0.9.0 version\n");
    expect(result.summary).toBe("wizardingcode-mem 0.9.0: already published\n");
  });

  test("a publish refused because the version exists is success", async () => {
    stub(
      "npm",
      `${VIEW} echo "npm error code E404" >&2; exit 1 ;;\n  publish*) echo "npm error 403 You cannot publish over the previously published versions: 0.9.0." >&2; exit 1 ;;`,
    );
    const result = await script("npm.ts", [folder], env());
    expect(result.exitCode).toBe(0);
    expect(result.summary).toBe("wizardingcode-mem 0.9.0: already published\n");
  });

  test("a registry error stops it: it is never read as 'not published'", async () => {
    stub("npm", `${VIEW} echo "npm error code ETIMEDOUT" >&2; exit 1 ;;`);
    const result = await script("npm.ts", [folder], env());
    expect(result.exitCode).toBe(1);
    expect(log("npm")).not.toContain("publish");
    expect(result.summary).toStartWith(
      "npm: failed: could not ask npm about wizardingcode-mem@0.9.0",
    );
  });

  test("a package at another version than the tag is refused before npm is asked", async () => {
    stub("npm", "");
    const result = await script("npm.ts", [folder], env({ VERSION: "0.9.1" }));
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe(
      "release: wizardingcode-mem is at 0.9.0 in the tag's tree, not 0.9.1\n",
    );
    expect(log("npm")).toBe("");
  });

  test("an unregistered publisher gets the sentence that names it", async () => {
    stub("npm", `${VIEW} exit 0 ;;\n  publish*) echo "npm error code ENEEDAUTH" >&2; exit 1 ;;`);
    const result = await script("npm.ts", [folder], env());
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("The trusted publisher for this package may not be registered");
  });
});

describe("token.ts", () => {
  const answer = (status: string, headers: string, body: string) =>
    `  "api -i repos/o/r") printf 'HTTP/2.0 ${status}\\r\\n${headers}\\r\\n\\r\\n${body}' ;;`;

  test("without the secret it fails, and asks nothing", async () => {
    stub("gh", "");
    const result = await script("token.ts", ["o/r"], {});
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe(
      "release: the secret MARKETPLACE_TOKEN is not set in the environment release\n",
    );
    expect(result.summary).toBe(
      "token: failed: the secret MARKETPLACE_TOKEN is not set in the environment release\n",
    );
    expect(log("gh")).toBe("");
  });

  test("a token that can push and says no expiry passes with a warning", async () => {
    stub("gh", answer("200 OK", "Content-Type: application/json", '{"permissions":{"push":true}}'));
    const result = await script("token.ts", ["o/r"], { MARKETPLACE_TOKEN: "t0ken" });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("::warning::MARKETPLACE_TOKEN: expiry unknown");
    // The token is in gh's environment, never in an argument.
    expect(log("gh")).toBe("api -i repos/o/r\n");
  });

  test("a far expiry is said plainly", async () => {
    stub(
      "gh",
      answer(
        "200 OK",
        "GitHub-Authentication-Token-Expiration: 2099-01-01 00:00:00 UTC",
        '{"permissions":{"push":true}}',
      ),
    );
    const result = await script("token.ts", ["o/r"], { MARKETPLACE_TOKEN: "t0ken" });
    expect(result.exitCode).toBe(0);
    expect(result.summary).toStartWith("MARKETPLACE_TOKEN expires on 2099-01-01 (");
    expect(result.stdout).not.toContain("::warning::");
  });

  test("a token that cannot push, and one the repository does not know, fail with their sentences", async () => {
    stub("gh", answer("200 OK", "X: y", '{"permissions":{"push":false}}'));
    const noPush = await script("token.ts", ["o/r"], { MARKETPLACE_TOKEN: "t0ken" });
    expect(noPush.stderr).toBe("release: MARKETPLACE_TOKEN cannot push to o/r\n");
    stub(
      "gh",
      `${answer("404 Not Found", "X: y", '{"message":"Not Found"}').replace(" ;;", "")}; exit 1 ;;`,
    );
    const unknown = await script("token.ts", ["o/r"], { MARKETPLACE_TOKEN: "t0ken" });
    expect(unknown.exitCode).toBe(1);
    expect(unknown.stderr).toBe(
      "release: MARKETPLACE_TOKEN is not granted to o/r, or the organisation has not approved it\n",
    );
  });
});

describe("push.ts", () => {
  const IDENTITY = {
    GIT_AUTHOR_NAME: "Test",
    GIT_AUTHOR_EMAIL: "test@example.invalid",
    GIT_COMMITTER_NAME: "Test",
    GIT_COMMITTER_EMAIL: "test@example.invalid",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
  };
  const git = (cwd: string, ...args: string[]) => {
    const out = run(["git", ...args], { cwd, env: { ...process.env, ...IDENTITY } });
    if (out.code !== 0) throw new Error(`git ${args.join(" ")}: ${out.stderr}`);
    return out.stdout.trim();
  };
  /** A bare repository holding these files, and the commit of its main. */
  function repository(
    name: string,
    files: Record<string, string>,
  ): { bare: string; sha: string; work: string } {
    const bare = join(base, `${name}.git`);
    const work = join(base, `${name}-work`);
    mkdirSync(bare);
    git(bare, "init", "--quiet", "--bare", "-b", "main");
    git(base, "clone", "--quiet", bare, work);
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(join(work, path, ".."), { recursive: true });
      writeFileSync(join(work, path), content);
    }
    git(work, "add", "-A");
    git(work, "commit", "--quiet", "-m", "first");
    git(work, "push", "--quiet", "origin", "HEAD:main");
    return { bare, sha: git(work, "rev-parse", "HEAD"), work };
  }
  const env = (
    origin: { bare: string; sha: string },
    remote: string,
    more: Record<string, string> = {},
  ) => ({
    ...IDENTITY,
    TAG: "v9.9.9",
    SHA: origin.sha,
    VERSION: "9.9.9",
    DRY_RUN: "false",
    GITHUB_REPOSITORY: "o/r",
    PUSH_ORIGIN: origin.bare,
    PUSH_REMOTE: remote,
    ...more,
  });
  function tagged(): { bare: string; sha: string } {
    const origin = repository("origin", { "package.json": "{}" });
    git(origin.work, "tag", "v9.9.9");
    git(origin.work, "push", "--quiet", "origin", "v9.9.9");
    return origin;
  }

  test("the tap gets the formula rendered from the template and the release's checksums", async () => {
    const origin = tagged();
    const tap = repository("tap", { "README.md": "the tap\n" });
    const checksums = join(base, "checksums.txt");
    writeFileSync(
      checksums,
      REQUIRED_ASSETS.filter((name) => name !== "checksums.txt")
        .map((name, index) => `${String(index + 1).repeat(64)}  ${name}`)
        .join("\n"),
    );
    const result = await script(
      "push.ts",
      ["--target", "tap"],
      env(origin, tap.bare, { CHECKSUMS: checksums }),
    );
    expect(result.stderr).toBe("");
    expect(result.summary).toBe("tap: written, 9.9.9\n");
    const formula = git(tap.bare, "show", "main:Formula/wizardingcode-mem.rb");
    expect(formula).toContain('version "9.9.9"');
    expect(formula).not.toMatch(/@[A-Z0-9_]+@/);
    const again = await script(
      "push.ts",
      ["--target", "tap"],
      env(origin, tap.bare, { CHECKSUMS: checksums }),
    );
    expect(again.summary).toBe("tap: written, 9.9.9\ntap: already at 9.9.9\n");
    expect(git(tap.bare, "log", "--format=%s", "main").split("\n")).toEqual([
      "wizardingcode-mem 9.9.9",
      "first",
    ]);
  });

  test("the marketplace gets the plugin's entry, and a manifest at a higher version is left alone", async () => {
    const origin = tagged();
    const manifests = {
      ".claude-plugin/marketplace.json": readFileSync(
        join(ROOT, "tests/fixtures/release/marketplace.claude.json"),
        "utf8",
      ),
      ".agents/plugins/marketplace.json": readFileSync(
        join(ROOT, "tests/fixtures/release/marketplace.agents.json"),
        "utf8",
      ),
    };
    const market = repository("market", manifests);
    const written = await script("push.ts", ["--target", "marketplace"], env(origin, market.bare));
    expect(written.stderr).toBe("");
    expect(written.summary).toBe("marketplace: written, 9.9.9\n");
    expect(git(market.bare, "show", "main:.agents/plugins/marketplace.json")).toContain(
      '"ref": "v9.9.9"',
    );
    rmSync(join(base, "summary"));
    const lower = await script(
      "push.ts",
      ["--target", "marketplace"],
      env(origin, market.bare, { VERSION: "9.9.8" }),
    );
    expect(lower.exitCode).toBe(0);
    expect(lower.summary).toBe("marketplace: left alone, the manifest names 9.9.9\n");
  });

  test("on a runner the two test overrides are ignored: the command writes only where it is meant to", async () => {
    // A git that reaches nothing and records what it was asked.
    stub("git", "");
    const result = await script("push.ts", ["--target", "marketplace"], {
      TAG: "v9.9.9",
      SHA: "a".repeat(40),
      VERSION: "9.9.9",
      DRY_RUN: "false",
      GITHUB_REPOSITORY: "o/r",
      GITHUB_ACTIONS: "true",
      PUSH_ORIGIN: join(base, "elsewhere.git"),
      PUSH_REMOTE: join(base, "elsewhere.git"),
    });
    expect(result.exitCode).toBe(1);
    expect(log("git")).toContain("ls-remote --tags https://github.com/o/r.git");
    expect(log("git")).not.toContain("elsewhere.git");
  });

  test("a tag moved since it was judged stops the write, and the summary says so", async () => {
    const origin = tagged();
    const tap = repository("tap", { "README.md": "the tap\n" });
    const result = await script(
      "push.ts",
      ["--target", "tap"],
      env({ ...origin, sha: "0".repeat(40) }, tap.bare, { CHECKSUMS: join(base, "none") }),
    );
    expect(result.exitCode).toBe(1);
    expect(result.summary).toStartWith(
      "tap: failed: v9.9.9 no longer names the commit that was judged",
    );
    expect(git(tap.bare, "log", "--format=%s", "main")).toBe("first");
  });
});
