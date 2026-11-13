// What plan reads from GitHub, as functions that take the runner: nothing here has an effect
// when the file is imported, so tests script gh's answers and start no program.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type BuildRun,
  clean,
  type Environment,
  lastLine,
  newestBuilt,
  ReleaseError,
  type Runner,
} from "./lib.ts";

/** An environment, its deployment branch rule, its reviewers and the administrators' bypass, as the API gives them. */
export function readEnvironment(run: Runner, repo: string, name: string): Environment {
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

/**
 * The runs of release.yml for a tag's commit, with what each one's docker job concluded and
 * the digest the newest one that built recorded. Nothing here throws: a reading that fails
 * leaves latest where it is, and never refuses a distribution.
 */
export function readBuild(
  run: Runner,
  repo: string,
  tag: string,
  sha: string,
  dir: string,
): BuildRun[] | { unreadable: string } {
  const unlisted = (why: string) => ({
    unreadable: `the runs of release.yml could not be listed: ${clean(why, 200)}`,
  });
  const listed = run([
    "gh",
    "run",
    "list",
    "--repo",
    repo,
    "--workflow",
    "release.yml",
    "--event",
    "push",
    "--branch",
    tag,
    "--json",
    "databaseId,headSha,headBranch,createdAt,url",
    "--limit",
    "50",
  ]);
  const notList = "an answer that is not a list";
  if (listed.code !== 0) return unlisted(lastLine(listed.stderr) || notList);
  const rows = parsed(listed.stdout);
  if (!Array.isArray(rows)) return unlisted(notList);
  const ids = new Map<BuildRun, string>();
  const runs = rows
    .filter(
      (row): row is { databaseId: number; createdAt: string; url: string } =>
        typeof row === "object" &&
        row !== null &&
        row.headSha === sha &&
        row.headBranch === tag &&
        Number.isInteger(row.databaseId) &&
        typeof row.createdAt === "string" &&
        typeof row.url === "string",
    )
    .map((row) => {
      const id = String(row.databaseId);
      const build: BuildRun = {
        url: row.url,
        createdAt: row.createdAt,
        docker: dockerConclusion(run, repo, id),
        artifact: null,
      };
      ids.set(build, id);
      return build;
    });
  // The one artifact builtDigest reads, chosen by the same rule.
  const newest = newestBuilt(runs);
  const id = newest === undefined ? undefined : ids.get(newest);
  if (newest !== undefined && id !== undefined) {
    const into = join(dir, id);
    const got = run([
      "gh",
      "run",
      "download",
      id,
      "--repo",
      repo,
      "-n",
      "image-digest",
      "-D",
      into,
    ]);
    const file = join(into, "image-digest.txt");
    if (got.code === 0 && existsSync(file)) {
      try {
        newest.artifact = readFileSync(file, "utf8");
      } catch {
        newest.artifact = null;
      }
    }
  }
  return runs;
}

/** JSON's value, or undefined when the text is not JSON. */
function parsed(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** What a run's job `docker` concluded; null when the run cannot be read or has no such job. */
function dockerConclusion(run: Runner, repo: string, id: string): string | null {
  const viewed = run(["gh", "run", "view", id, "--repo", repo, "--json", "jobs"]);
  if (viewed.code !== 0) return null;
  const jobs = (parsed(viewed.stdout) as { jobs?: unknown } | undefined)?.jobs;
  if (!Array.isArray(jobs)) return null;
  const docker = jobs.find((job) => job?.name === "docker");
  return typeof docker?.conclusion === "string" ? docker.conclusion : null;
}
