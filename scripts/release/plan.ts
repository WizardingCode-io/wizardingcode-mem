// The first job of the distribution: whether this tag may be distributed, and what the other
// jobs work from. Exits 1 with one sentence on a refusal.
//
//   bun scripts/release/plan.ts
//
// Environment: TAG, RELEASE_HOLD, DRY_RUN, GITHUB_REF, GITHUB_REPOSITORY, GH_TOKEN (for gh).
import {
  CONTRACT_FILE,
  command,
  decideHold,
  decidePlan,
  type Environment,
  isVersionTag,
  latestLine,
  output,
  type PlanFacts,
  passingFacts,
  planSummary,
  previousPlain,
  ReleaseError,
  run,
  summary,
} from "./lib.ts";

const git = (...args: string[]) => run(["git", ...args]);

/** The commit a tag names, or null when there is no such tag. */
function commitOf(tag: string): string | null {
  const out = git("rev-parse", "--verify", "--quiet", `refs/tags/${tag}^{commit}`);
  return out.code === 0 ? out.stdout.trim() : null;
}

/** The version of package.json at a commit, or null when it cannot be read. */
function packageVersionAt(sha: string): string | null {
  const out = git("show", `${sha}:package.json`);
  if (out.code !== 0) return null;
  try {
    const version = (JSON.parse(out.stdout) as { version?: unknown }).version;
    return typeof version === "string" ? version : null;
  } catch {
    return null;
  }
}

/** The GitHub release of a tag, or null when there is none. Any other failure is said, not guessed. */
function readRelease(tag: string): PlanFacts["release"] {
  const out = run(["gh", "release", "view", tag, "--json", "isDraft,assets"]);
  if (out.code !== 0) {
    if (out.stderr.includes("release not found")) return null;
    throw new ReleaseError(`could not read the release ${tag}: ${out.stderr.trim()}`);
  }
  const release = JSON.parse(out.stdout) as { isDraft: boolean; assets: Array<{ name: string }> };
  return { isDraft: release.isDraft, assets: release.assets.map((asset) => asset.name) };
}

/** An environment, its deployment branch rule, its reviewers and the administrators' bypass, as the API gives them. */
function readEnvironment(repo: string, name: string): Environment {
  const failed = (stderr: string) =>
    new ReleaseError(`could not read the environment ${name}: ${stderr.trim()}`);
  const environment = run(["gh", "api", `repos/${repo}/environments/${name}`]);
  if (environment.code !== 0) {
    if (environment.stderr.includes("HTTP 404"))
      return { exists: false, policy: null, branches: [], reviewers: 0, adminsBypass: false };
    throw failed(environment.stderr);
  }
  const answer = JSON.parse(environment.stdout) as {
    deployment_branch_policy: Environment["policy"];
    protection_rules?: Array<{ type?: string; reviewers?: unknown[] }>;
    can_admins_bypass?: boolean;
  };
  const policies = run([
    "gh",
    "api",
    `repos/${repo}/environments/${name}/deployment-branch-policies`,
  ]);
  if (policies.code !== 0) throw failed(policies.stderr);
  const branches = (
    JSON.parse(policies.stdout) as { branch_policies: Array<{ name: string; type: string }> }
  ).branch_policies.map(({ name, type }) => ({ name, type }));
  const reviewers = (answer.protection_rules ?? []).filter(
    (rule) =>
      rule.type === "required_reviewers" &&
      Array.isArray(rule.reviewers) &&
      rule.reviewers.length > 0,
  ).length;
  return {
    exists: true,
    policy: answer.deployment_branch_policy,
    branches,
    reviewers,
    adminsBypass: answer.can_admins_bypass === true,
  };
}

function contractAt(sha: string): "missing" | "unreadable" | string {
  if (git("cat-file", "-e", `${sha}:${CONTRACT_FILE}`).code !== 0) return "missing";
  const shown = git("show", `${sha}:${CONTRACT_FILE}`);
  return shown.code === 0 ? shown.stdout : "unreadable";
}

command("plan", () => {
  const tag = process.env.TAG ?? "";
  const repo = process.env.GITHUB_REPOSITORY ?? "";
  const facts = passingFacts(process.env.GITHUB_REF ?? "", tag);
  // Each fact is read only once every earlier refusal has passed, so a later read that fails
  // never hides an earlier refusal; a malformed tag is refused before it reaches any program.
  const check = () => {
    const decision = decidePlan(facts);
    if (!decision.ok) throw new ReleaseError(decision.sentence);
    return decision;
  };
  check();
  facts.tagSha = commitOf(tag);
  const sha = check().sha;
  facts.onMain = git("merge-base", "--is-ancestor", sha, "origin/main").code === 0;
  check();
  facts.packageVersion = packageVersionAt(sha);
  check();
  facts.hasDistribute = git("cat-file", "-e", `${sha}:.github/workflows/distribute.yml`).code === 0;
  check();
  facts.tags = git("tag", "--merged", "origin/main", "--list", "v*")
    .stdout.split("\n")
    .map((line) => line.trim())
    .filter(isVersionTag);
  check();
  facts.release = readRelease(tag);
  check();
  facts.environment = readEnvironment(repo, "release");
  facts.signEnvironment = readEnvironment(repo, "release-sign");
  const plan = check();

  let hold = { held: false, byHand: false, outcome: null } as ReturnType<typeof decideHold>;
  if (!plan.prerelease) {
    const previous = previousPlain(tag, facts.tags);
    const previousSha = previous === null ? null : commitOf(previous);
    const atTag = contractAt(sha);
    hold = decideHold({
      tag,
      atTag: atTag === "missing" || atTag === "unreadable" ? null : atTag,
      previous,
      atPrevious: previousSha === null ? "missing" : contractAt(previousSha),
      releaseHold: process.env.RELEASE_HOLD === "true",
    });
  }
  output("version", plan.version);
  output("sha", plan.sha);
  output("prerelease", String(plan.prerelease));
  output("held", String(hold.held));
  output(
    "latest_line",
    plan.prerelease || hold.held
      ? ""
      : latestLine({
          version: plan.version,
          dryRun: process.env.DRY_RUN === "true",
          byHand: hold.byHand,
        }),
  );
  for (const line of planSummary({ prerelease: plan.prerelease, hold: hold.outcome }))
    summary(line);
});
