// The first job of the distribution: whether this tag may be distributed, and what the other
// jobs work from. Exits 1 with one sentence on a refusal.
//
//   bun scripts/release/plan.ts
//
// Environment: TAG, RELEASE_HOLD, DRY_RUN, GITHUB_REF, GITHUB_REPOSITORY, GH_TOKEN (for gh).
//
// It reads git's tags and trees, the tag's GitHub release, the environments release and
// release-sign, and, for a release that is not a pre-release, the run of release.yml that
// built the tag's image: the digest that run recorded is the only one the job latest may sign.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type Built,
  BYPASS_LINE,
  builtDigest,
  CONTRACT_FILE,
  command,
  decideHold,
  decidePlan,
  imageLine,
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
import { readBuild, readEnvironment } from "./read.ts";

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

/** The contract file's text at a commit; "missing" when the tree has none, "unreadable" when it cannot be shown. */
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
  facts.environment = readEnvironment(run, repo, "release");
  facts.signEnvironment = readEnvironment(run, repo, "release-sign");
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
  // No failure of this reading refuses a distribution: with no digest, latest is not moved.
  let built: Built | null = null;
  if (!plan.prerelease) {
    const dir = mkdtempSync(join(tmpdir(), "wcm-build-"));
    try {
      const read = readBuild(run, repo, tag, plan.sha, dir);
      built = Array.isArray(read) ? builtDigest(read) : { digest: null, reason: read.unreadable };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  const signable = built !== null && built.digest !== null ? built : null;
  output("image_digest", signable?.digest ?? "");
  output("image_run", signable?.run ?? "");
  for (const line of planSummary({ prerelease: plan.prerelease, hold: hold.outcome }))
    summary(line);
  if (built !== null) summary(imageLine(tag, built));
  if (facts.signEnvironment.adminsBypass) summary(BYPASS_LINE);
});
