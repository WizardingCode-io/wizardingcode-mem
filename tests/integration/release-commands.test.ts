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
import { REQUIRED_ASSETS } from "../../scripts/release/lib.ts";

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
    options: {
      onMain?: boolean;
      environment?: string;
      signEnvironment?: string;
      accepted?: string;
    } = {},
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
        options.signEnvironment ??
          `  "api repos/o/r/environments/release-sign") echo '{"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true},"can_admins_bypass":false,"protection_rules":[{"id":1,"type":"required_reviewers","reviewers":[{"type":"User","reviewer":{"login":"someone"}}]}]}' ;;`,
        `  "api repos/o/r/environments/release-sign/deployment-branch-policies") echo '{"total_count":1,"branch_policies":[{"id":2,"name":"main","type":"branch"}]}' ;;`,
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

  test("an environment that signs with no required reviewer is refused", async () => {
    for (const rules of [
      "",
      `,"protection_rules":[{"id":1,"type":"required_reviewers","reviewers":[]}]`,
      `,"protection_rules":[{"id":1,"type":"wait_timer","wait_timer":5}]`,
    ]) {
      world({
        signEnvironment: `  "api repos/o/r/environments/release-sign") echo '{"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}${rules}}' ;;`,
      });
      const result = await script("plan.ts", [], env("v0.9.0", { PKG: "0.9.0" }));
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe(
        "release: the environment release-sign has no required reviewer; add one first (docs/runbooks/release.md)\n",
      );
      expect(result.output).toBe("");
    }
  });

  test("a missing environment that signs is its own refusal", async () => {
    world({
      signEnvironment: `  "api repos/o/r/environments/release-sign") echo 'gh: Not Found (HTTP 404)' >&2; exit 1 ;;`,
    });
    const result = await script("plan.ts", [], env("v0.9.0", { PKG: "0.9.0" }));
    expect(result.stderr).toBe(
      "release: the environment release-sign does not exist; create it with its rule and its reviewer first (docs/runbooks/release.md)\n",
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
  const TAP = "https://github.com/WizardingCode-io/homebrew-wizardingcode.git";
  const MARKET = "https://github.com/WizardingCode-io/wizardingcode-plugins.git";
  const fixtures = join(ROOT, "tests/fixtures/release");
  /** What the marketplace's clone holds: the two manifests, as the real repository has them. */
  const MANIFESTS = [
    "mkdir -p .claude-plugin .agents/plugins",
    `cp "${fixtures}/marketplace.claude.json" .claude-plugin/marketplace.json`,
    `cp "${fixtures}/marketplace.agents.json" .agents/plugins/marketplace.json`,
  ].join(" && ");
  // The header as a git that quotes it would print it. The clone carries it in its own
  // environment, so the value printed there is the one push.ts built.
  // (The shell reads the expansion, not JavaScript: the value after the header's last space.)
  const HEADER = `Authorization: Basic $${"{GIT_CONFIG_VALUE_0##* }"}`;

  /**
   * A git that reaches nothing: it answers the tag read with `sha`, runs `clone` in the clone
   * folder, says the tree changed, and keeps what was committed where the test can read it.
   * `quote` makes the clone fail quoting its header; `leak` is a line the status and the diff
   * of a dry run also print (those calls carry no header of their own).
   */
  function gitStub(options: { sha?: string; clone?: string; quote?: "clone"; leak?: string } = {}) {
    const quoted = options.leak === undefined ? "" : `; echo "${options.leak}"`;
    stub(
      "git",
      [
        `  "ls-remote "*) printf '%s\\trefs/tags/v9.9.9\\n' "${options.sha ?? SHA}" ;;`,
        options.quote === "clone"
          ? `  "clone "*) echo "fatal: unable to access: ${HEADER}" >&2; exit 128 ;;`
          : `  "clone "*) ${options.clone ?? ":"} ;;`,
        '  "config "*|"add "*|"push "*) : ;;',
        '  "status --porcelain") echo " M x" ;;',
        `  "status --short") echo " M x"${quoted} ;;`,
        `  "diff") echo "+two"${quoted} ;;`,
        `  "commit "*) if [ -f .agents/plugins/marketplace.json ]; then cp .agents/plugins/marketplace.json "${base}/committed.json"; fi ;;`,
      ].join("\n"),
    );
  }
  const env = (more: Record<string, string> = {}) => ({
    TAG: "v9.9.9",
    SHA,
    VERSION: "9.9.9",
    DRY_RUN: "false",
    GITHUB_REPOSITORY: "o/r",
    CHECKSUMS: checksums(),
    ...more,
  });
  function checksums(): string {
    const file = join(base, "checksums.txt");
    writeFileSync(
      file,
      REQUIRED_ASSETS.filter((name) => name !== "checksums.txt")
        .map((name, index) => `${String(index + 1).repeat(64)}  ${name}`)
        .join("\n"),
    );
    return file;
  }

  test("--target tap writes the formula into the clone and says so in the summary", async () => {
    gitStub();
    const result = await script("push.ts", ["--target", "tap"], env());
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(result.summary).toBe("tap: written, 9.9.9\n");
    expect(log("git")).toContain("commit --quiet -m wizardingcode-mem 9.9.9");
  });

  test("--target marketplace edits the two manifests of the clone", async () => {
    gitStub({ clone: MANIFESTS });
    const result = await script("push.ts", ["--target", "marketplace"], env());
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(result.summary).toBe("marketplace: written, 9.9.9\n");
    expect(readFileSync(join(base, "committed.json"), "utf8")).toContain('"ref": "v9.9.9"');
  });

  test("a tag moved since it was judged stops the write, and the summary says so", async () => {
    gitStub({ sha: OLD });
    const result = await script("push.ts", ["--target", "tap"], env());
    expect(result.exitCode).toBe(1);
    expect(result.summary).toStartWith(
      "tap: failed: v9.9.9 no longer names the commit that was judged",
    );
    expect(log("git")).not.toContain("clone");
  });

  // No variable of the environment names where the token's writer goes.
  test.each([
    ["tap", TAP, "off a runner", {}],
    ["tap", TAP, "on a runner", { GITHUB_ACTIONS: "true" }],
    ["marketplace", MARKET, "off a runner", {}],
    ["marketplace", MARKET, "on a runner", { GITHUB_ACTIONS: "true" }],
  ] as const)("--target %s asks git for %s only, %s", async (target, remote, _where, runner) => {
    gitStub({ clone: target === "marketplace" ? MANIFESTS : ":" });
    const elsewhere = join(base, "elsewhere.git");
    const result = await script(
      "push.ts",
      ["--target", target],
      env({ PUSH_REMOTE: elsewhere, PUSH_ORIGIN: elsewhere, ...runner }),
    );
    expect(result.exitCode).toBe(0);
    const asked = log("git");
    expect(asked).toContain("ls-remote --tags https://github.com/o/r.git refs/tags/v9.9.9");
    expect(asked).toContain(`clone --quiet ${remote} .`);
    expect(asked).not.toContain("elsewhere.git");
  });

  describe("with a token, when git quotes its authorization header", () => {
    // A token whose encoding holds a "/", which a pattern would not match literally.
    const token = "a>?";
    const encoded = Buffer.from(`x-access-token:${token}`).toString("base64");

    test("a failure is said without the credential, in every place it is said", async () => {
      expect(encoded).toContain("/");
      gitStub({ quote: "clone" });
      const result = await script(
        "push.ts",
        ["--target", "tap"],
        env({ MARKETPLACE_TOKEN: token }),
      );
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Authorization: Basic ***");
      expect(result.summary).toStartWith("tap: failed: git clone failed in");
      expect(result.summary).toContain("Authorization: Basic ***");
      for (const text of [result.stdout, result.stderr, result.summary])
        expect(text).not.toContain(encoded);
    });

    test("a dry run prints git's lines without it", async () => {
      gitStub({ leak: `Authorization: Basic ${encoded}` });
      const result = await script(
        "push.ts",
        ["--target", "tap"],
        env({ MARKETPLACE_TOKEN: token, DRY_RUN: "true" }),
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("+two");
      expect(result.stdout.match(/Authorization: Basic \*\*\*/g)).toHaveLength(2);
      expect(result.summary).toBe("tap: would write 9.9.9 (dry run)\n");
      for (const text of [result.stdout, result.stderr, result.summary])
        expect(text).not.toContain(encoded);
    });
  });
});
