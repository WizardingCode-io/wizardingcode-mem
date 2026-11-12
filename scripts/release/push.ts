// The one writer to another repository: the Homebrew tap's formula and the marketplace's two
// manifests. A clone, an edit, a commit only when the tree changed, a push.
//
//   bun scripts/release/push.ts --target tap|marketplace
//
// Environment: TAG, SHA (the commit plan judged), VERSION, DRY_RUN, MARKETPLACE_TOKEN,
// CHECKSUMS (the path of the release's checksums.txt; tap only), GITHUB_REPOSITORY.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  command,
  editManifests,
  type Outcome,
  parseChecksums,
  ReleaseError,
  type Runner,
  renderFormula,
  run,
  summary,
  summaryLine,
} from "./lib.ts";

const BOT = {
  name: "github-actions[bot]",
  email: "41898282+github-actions[bot]@users.noreply.github.com",
};

/**
 * The environment of a git call to github.com: the token as an authorization header, so it is
 * never in a remote's URL, in an argument or in a file of the clone.
 */
export function gitEnv(
  token: string | null,
  base: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const env = { ...base, GIT_TERMINAL_PROMPT: "0" };
  if (token === null) return env;
  return {
    ...env,
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`,
  };
}

/** The commit a tag names in `git ls-remote`'s answer: the peeled line for an annotated tag. */
export function tagNames(lsRemote: string, tag: string): string | null {
  const commitOf = (ref: string): string | null => {
    for (const line of lsRemote.split("\n")) {
      const [sha, name] = line.trim().split(/\s+/);
      if (name === ref && sha !== undefined) return sha;
    }
    return null;
  };
  return commitOf(`refs/tags/${tag}^{}`) ?? commitOf(`refs/tags/${tag}`);
}

export interface PushOptions {
  /** The repository written to. */
  remote: string;
  /** This repository, where the tag lives. */
  origin: string;
  tag: string;
  /** The commit plan judged the tag to name. */
  sha: string;
  version: string;
  dryRun: boolean;
  token: string | null;
  /** Changes the clone; an outcome returned is the answer as it is, with nothing written. */
  edit: (dir: string) => Outcome | null;
  log: (line: string) => void;
  runner?: Runner;
}

/** Writes the edit to the other repository's default branch, or says why nothing was written. */
export function commitAndPush(options: PushOptions): Outcome {
  const { remote, origin, tag, sha, version, token } = options;
  const exec = options.runner ?? run;
  // The values written name the tag: a tag moved since plan judged it stops here. This reads
  // this repository, so it never carries the other repositories' token.
  const refs = exec([
    "git",
    "ls-remote",
    "--tags",
    origin,
    `refs/tags/${tag}`,
    `refs/tags/${tag}^{}`,
  ]);
  if (refs.code !== 0)
    throw new ReleaseError(`could not read the tag ${tag}: ${refs.stderr.trim()}`);
  if (tagNames(refs.stdout, tag) !== sha)
    throw new ReleaseError(
      `${tag} no longer names the commit that was judged (${sha}); nothing was written`,
    );

  const dir = mkdtempSync(join(tmpdir(), "wcm-release-"));
  const authed = gitEnv(token, process.env);
  const git = (args: string[], env?: Record<string, string | undefined>) =>
    exec(["git", ...args], env === undefined ? { cwd: dir } : { cwd: dir, env });
  const must = (args: string[], env?: Record<string, string | undefined>) => {
    const out = git(args, env);
    if (out.code !== 0)
      throw new ReleaseError(`git ${args[0]} failed in ${remote}: ${out.stderr.trim()}`);
    return out.stdout;
  };
  try {
    must(["clone", "--quiet", remote, "."], authed);
    // Local to the clone, so the commit and a rebase both have an identity.
    must(["config", "user.name", BOT.name]);
    must(["config", "user.email", BOT.email]);

    const early = options.edit(dir);
    if (early !== null) return early;
    if (must(["status", "--porcelain"]).trim() === "") return { kind: "already-at", version };
    if (options.dryRun) {
      options.log(must(["status", "--short"]));
      must(["add", "-N", "."]);
      options.log(must(["diff"]));
      return { kind: "would-write", version };
    }
    must(["add", "-A"]);
    must(["commit", "--quiet", "-m", `wizardingcode-mem ${version}`]);
    const first = git(["push", "--quiet", "origin", "HEAD"], authed);
    if (first.code !== 0) {
      if (/GH006|protected branch/i.test(first.stderr))
        throw new ReleaseError(
          `the push to ${remote} was refused by a rule on its branch: it must accept a direct push from the token's owner`,
        );
      if (/\b403\b|[Pp]ermission/.test(first.stderr))
        throw new ReleaseError(
          `the push to ${remote} was refused: MARKETPLACE_TOKEN may lack contents write there`,
        );
      // Someone else pushed meanwhile: replay this one commit over theirs, once.
      if (git(["pull", "--rebase", "--quiet"], authed).code !== 0) {
        git(["rebase", "--abort"]);
        throw new ReleaseError(`the push to ${remote} was refused and the rebase failed`);
      }
      if (git(["push", "--quiet", "origin", "HEAD"], authed).code !== 0)
        throw new ReleaseError(`the push to ${remote} was refused twice`);
    }
    return { kind: "written", version };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const REMOTES = {
  tap: "https://github.com/WizardingCode-io/homebrew-wizardingcode.git",
  marketplace: "https://github.com/WizardingCode-io/wizardingcode-plugins.git",
};
const FORMULA = "Formula/wizardingcode-mem.rb";
const MANIFESTS = {
  claude: ".claude-plugin/marketplace.json",
  agents: ".agents/plugins/marketplace.json",
};

/** The formula for this release, rendered from the template beside this script's repository. */
function editTap(version: string, checksumsPath: string): PushOptions["edit"] {
  return (dir) => {
    const root = new URL("../../", import.meta.url).pathname;
    const template = readFileSync(
      join(root, "packaging/homebrew/wizardingcode-mem.rb.template"),
      "utf8",
    );
    const checksums = parseChecksums(readFileSync(checksumsPath, "utf8"));
    mkdirSync(dirname(join(dir, FORMULA)), { recursive: true });
    writeFileSync(join(dir, FORMULA), renderFormula(template, version, checksums));
    return null;
  };
}

/** The plugin's entry in the two manifests; neither is written when either is at a higher version. */
function editMarketplace(version: string): PushOptions["edit"] {
  return (dir) => {
    const claude = join(dir, MANIFESTS.claude);
    const agents = join(dir, MANIFESTS.agents);
    const edited = editManifests(
      readFileSync(claude, "utf8"),
      readFileSync(agents, "utf8"),
      version,
    );
    if (edited.outcome === "left-alone")
      return { kind: "left-alone", higher: edited.higher as string };
    writeFileSync(claude, edited.claude);
    writeFileSync(agents, edited.agents);
    return null;
  };
}

function need(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new ReleaseError(`${name} is not set`);
  return value;
}

if (import.meta.main) {
  const flag = process.argv.indexOf("--target");
  const target = process.argv[flag + 1];
  if (flag === -1 || (target !== "tap" && target !== "marketplace")) {
    process.stderr.write("usage: bun scripts/release/push.ts --target tap|marketplace\n");
    process.exit(1);
  }
  command(target, () => {
    const version = need("VERSION");
    const outcome = commitAndPush({
      // The two overrides exist for the command's test, which writes to local repositories.
      remote: process.env.PUSH_REMOTE || REMOTES[target],
      origin: process.env.PUSH_ORIGIN || `https://github.com/${need("GITHUB_REPOSITORY")}.git`,
      tag: need("TAG"),
      sha: need("SHA"),
      version,
      dryRun: process.env.DRY_RUN === "true",
      token: process.env.MARKETPLACE_TOKEN || null,
      edit: target === "tap" ? editTap(version, need("CHECKSUMS")) : editMarketplace(version),
      log: (line) => process.stdout.write(line.endsWith("\n") ? line : `${line}\n`),
    });
    summary(summaryLine(target, outcome));
  });
}
