// The decisions of the release's distribution (.github/workflows/distribute.yml), as pure
// functions the command files beside this one call: what may be distributed, what each
// target writes, and every line the run's summary carries. docs/runbooks/release.md is the
// author's side of it; docs/adr/0029-release-distribution.md says why it has this shape.
import { appendFileSync } from "node:fs";
import { highestVersion, isVersion, olderThan } from "../../src/util/version.ts";
import { TARGETS } from "../build.ts";

/** A refusal or a failure a person reads: one sentence, printed and written to the summary. */
export class ReleaseError extends Error {}

// --- Running programs and writing to the run ----------------------------------------------

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}
export type Runner = (
  cmd: string[],
  options?: { env?: Record<string, string | undefined>; cwd?: string },
) => RunResult;

/** Runs a program and gives its exit code and output; a program that cannot be started is code 127. */
export const run: Runner = (cmd, options = {}) => {
  try {
    const out = Bun.spawnSync(cmd, {
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      ...(options.env === undefined ? {} : { env: options.env }),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    return {
      code: out.exitCode ?? 1,
      stdout: out.stdout.toString(),
      stderr: out.stderr.toString(),
    };
  } catch (error) {
    return {
      code: 127,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
    };
  }
};

/** A line of the run's summary: printed, and appended to the summary file when there is one. */
export function summary(line: string): void {
  process.stdout.write(`${line}\n`);
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (file !== undefined && file !== "") appendFileSync(file, `${line}\n`);
}

// Text a program or a file gave, on its way to a terminal or the summary. The same rule as
// src/team/restore.ts has, copied on purpose: scripts/release/ imports nothing of the server.
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it finds
const UNPRINTABLE = /[\u0000-\u001f\u007f-\u009f\p{Cf}]/gu;

/** `text` with every control and format character replaced by `?`, then cut to `max` characters. */
export function clean(text: string, max: number): string {
  return text.replace(UNPRINTABLE, "?").slice(0, max);
}

/** The last line of `text` that is not blank, as it is; empty when there is none. */
export function lastLine(text: string): string {
  return (
    text
      .split("\n")
      .filter((line) => line.trim() !== "")
      .at(-1) ?? ""
  );
}

/** An output of the step, for the jobs that need it. */
export function output(name: string, value: string): void {
  const file = process.env.GITHUB_OUTPUT;
  if (file !== undefined && file !== "") appendFileSync(file, `${name}=${value}\n`);
}

/** Runs a command's body; a failure is said once on standard error and in the summary, exit 1. */
export function command(target: Target, body: () => void): void {
  try {
    body();
  } catch (error) {
    const sentence = error instanceof Error ? error.message : String(error);
    process.stderr.write(`release: ${sentence}\n`);
    summary(
      summaryLine(
        target,
        target === "plan" ? { kind: "refused", sentence } : { kind: "failed", sentence },
      ),
    );
    process.exit(1);
  }
}

// --- The summary ---------------------------------------------------------------------------

export type Target = "plan" | "npm" | "tap" | "marketplace" | "latest" | "token";

export type Outcome =
  | { kind: "published"; name: string; version: string; tag: string }
  | { kind: "already-published"; name: string; version: string }
  | { kind: "would-publish"; name: string; version: string }
  | { kind: "written"; version: string }
  | { kind: "already-at"; version: string }
  | { kind: "left-alone"; higher: string }
  | { kind: "would-write"; version: string }
  | { kind: "skipped-prerelease" }
  | { kind: "signed"; digest: string }
  | { kind: "already-signed"; digest: string }
  | { kind: "would-sign"; digest: string }
  | { kind: "no-digest" }
  | { kind: "unreadable"; version: string; said: string }
  | { kind: "tag-moved"; version: string; built: string }
  | { kind: "unverified"; digest: string; said: string }
  | { kind: "moved"; version: string }
  | { kind: "would-move"; version: string }
  | { kind: "held-contract"; tag: string; accepts: number; previous: string; speaks: number }
  | { kind: "held-unreadable"; read: string }
  | { kind: "moved-by-hand"; version: string }
  | { kind: "token-ok"; date: string; days: number }
  | { kind: "token-renew"; date: string; days: number }
  | { kind: "token-unknown" }
  | { kind: "failed"; sentence: string }
  | { kind: "refused"; sentence: string };

/** Which outcomes a target has: the summary table of the spec, one row per target. */
const OUTCOMES: Record<Target, ReadonlyArray<Outcome["kind"]>> = {
  plan: ["refused"],
  npm: ["published", "already-published", "would-publish", "failed"],
  tap: ["written", "already-at", "would-write", "skipped-prerelease", "failed"],
  marketplace: [
    "written",
    "already-at",
    "left-alone",
    "would-write",
    "skipped-prerelease",
    "failed",
  ],
  latest: [
    "signed",
    "already-signed",
    "would-sign",
    "no-digest",
    "unreadable",
    "tag-moved",
    "unverified",
    "moved",
    "would-move",
    "held-contract",
    "held-unreadable",
    "moved-by-hand",
    "skipped-prerelease",
    "failed",
  ],
  token: ["token-ok", "token-renew", "token-unknown", "failed"],
};

/** The one place the summary's texts are written: a target's line for what it did. */
export function summaryLine(target: Target, outcome: Outcome): string {
  if (!OUTCOMES[target].includes(outcome.kind))
    throw new Error(`the summary has no line for ${target} ${outcome.kind}`);
  switch (outcome.kind) {
    case "published":
      return `${outcome.name} ${outcome.version}: published (dist-tag ${outcome.tag})`;
    case "already-published":
      return `${outcome.name} ${outcome.version}: already published`;
    case "would-publish":
      return `${outcome.name} ${outcome.version}: would publish (dry run)`;
    case "written":
      return `${target}: written, ${outcome.version}`;
    case "already-at":
      return `${target}: already at ${outcome.version}`;
    case "left-alone":
      return `${target}: left alone, the manifest names ${outcome.higher}`;
    case "would-write":
      return `${target}: would write ${outcome.version} (dry run)`;
    case "skipped-prerelease":
      return `${target}: skipped: pre-release`;
    case "signed":
      return `latest: signed ${outcome.digest}; check it with: ${verifyCommand(`${IMAGE}@${outcome.digest}`)}`;
    case "already-signed":
      return `latest: already signed ${outcome.digest}; check it with: ${verifyCommand(`${IMAGE}@${outcome.digest}`)}`;
    case "would-sign":
      return `latest: would sign ${outcome.digest} (dry run); a signed image is checked with: ${verifyCommand(`${IMAGE}@${outcome.digest}`)}`;
    case "no-digest":
      return "latest: not signed: this release's build recorded no image digest; latest is not moved";
    case "unreadable":
      return `latest: not signed: the registry did not say which image the tag ${outcome.version} names: ${outcome.said}`;
    case "tag-moved":
      return `latest: not signed: the tag ${outcome.version} no longer names the image the release built (${outcome.built}); nothing is signed`;
    case "unverified":
      return `latest: not moved: the signature of ${outcome.digest} did not verify: ${outcome.said}`;
    case "moved":
      return `latest: moved to ${outcome.version}`;
    case "would-move":
      return `latest: would move to ${outcome.version} (dry run)`;
    case "held-contract":
      return `latest: held: ${outcome.tag} accepts contract ${outcome.accepts} and up; ${outcome.previous} speaks ${outcome.speaks}`;
    case "held-unreadable":
      return `latest: held: ${outcome.read}`;
    case "moved-by-hand":
      return `latest: moved to ${outcome.version}, the hold released by hand`;
    case "token-ok":
      return `MARKETPLACE_TOKEN expires on ${outcome.date} (${outcome.days} days)`;
    case "token-renew":
      return `renew it: MARKETPLACE_TOKEN expires on ${outcome.date} (${outcome.days} days)`;
    case "token-unknown":
      return "MARKETPLACE_TOKEN: expiry unknown (no expiration header); check the date noted when it was created";
    case "failed":
      return `${target}: failed: ${outcome.sentence}`;
    case "refused":
      return `distribute: refused: ${outcome.sentence}`;
  }
}

/** The lines plan writes: those of the targets it causes to be skipped or held, which write nothing. */
export function planSummary(input: { prerelease: boolean; hold: Outcome | null }): string[] {
  if (input.prerelease)
    return (["tap", "marketplace", "latest"] as const).map((target) =>
      summaryLine(target, { kind: "skipped-prerelease" }),
    );
  return input.hold === null ? [] : [summaryLine("latest", input.hold)];
}

/** The latest job's line for a run in which it moves the tag, or would. */
export function latestLine(input: { version: string; dryRun: boolean; byHand: boolean }): string {
  if (input.dryRun) return summaryLine("latest", { kind: "would-move", version: input.version });
  return summaryLine(
    "latest",
    input.byHand
      ? { kind: "moved-by-hand", version: input.version }
      : { kind: "moved", version: input.version },
  );
}

// --- The Homebrew formula ------------------------------------------------------------------

/** checksums.txt as file name → sha256. */
export function parseChecksums(text: string): Map<string, string> {
  const sums = new Map<string, string>();
  for (const line of text.split("\n")) {
    const match = /^([0-9a-f]{64})\s+(\S+)$/.exec(line.trim());
    if (match !== null) sums.set(match[2] as string, match[1] as string);
  }
  return sums;
}

const FORMULA_MARKS: ReadonlyArray<[mark: string, file: string]> = [
  ["@SHA256_DARWIN_ARM64@", "wizardingcode-mem-darwin-arm64"],
  ["@SHA256_DARWIN_X64@", "wizardingcode-mem-darwin-x64"],
  ["@SHA256_LINUX_ARM64@", "wizardingcode-mem-linux-arm64"],
  ["@SHA256_LINUX_X64@", "wizardingcode-mem-linux-x64"],
];

/** The formula for a version, from the template and the release's checksums. */
export function renderFormula(
  template: string,
  version: string,
  checksums: Map<string, string>,
): string {
  let formula = template.replaceAll("@VERSION@", version);
  for (const [mark, file] of FORMULA_MARKS) {
    const sum = checksums.get(file);
    if (sum === undefined) throw new ReleaseError(`checksums.txt has no ${file}`);
    formula = formula.replaceAll(mark, sum);
  }
  const left = /@[A-Z0-9_]+@/.exec(formula);
  if (left !== null) throw new ReleaseError(`the formula template still holds ${left[0]}`);
  return formula;
}

// --- The marketplace's manifests -----------------------------------------------------------

const PLUGIN = "wizardingcode-mem";

/**
 * Walks a JSON text's structure: `visit` gets each brace and each string's opening quote, with
 * its index, and never a character inside a string. It stops when `visit` returns true.
 */
function walkStructure(
  text: string,
  visit: (char: string, index: number) => boolean | undefined,
): void {
  for (let i = 0; i < text.length; i++) {
    const char = text[i] as string;
    if (char !== '"' && char !== "{" && char !== "}") continue;
    if (visit(char, i) === true) return;
    if (char !== '"') continue;
    // Skip the string: an escaped character never closes it.
    for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === "\\") i++;
  }
}

/** Where the plugin's entry lies in a manifest's text: from its opening brace to the matching one. */
function entrySpan(text: string): { start: number; end: number } | null {
  const name = new RegExp(`"name"\\s*:\\s*"${PLUGIN}"`).exec(text);
  if (name === null) return null;
  const open: number[] = [];
  let span: { start: number; end: number } | null = null;
  let entry = -1;
  walkStructure(text, (char, index) => {
    // The name is a key of the innermost object open where it stands.
    if (entry === -1 && index >= name.index) entry = open.at(-1) ?? -1;
    if (char === "{") open.push(index);
    else if (char === "}" && open.pop() === entry && entry !== -1) {
      span = { start: entry, end: index + 1 };
      return true;
    }
    return undefined;
  });
  return span as { start: number; end: number } | null;
}

/** The value of a key at the top level of an entry's text: where it is, and what it holds. */
function topLevelValue(
  entry: string,
  key: string,
): { start: number; end: number; value: string } | null {
  const pattern = new RegExp(`^"${key}"\\s*:\\s*"([^"]*)"`);
  let depth = 0;
  let found: { start: number; end: number; value: string } | null = null;
  walkStructure(entry, (char, index) => {
    if (char === "{") depth++;
    else if (char === "}") depth--;
    else if (depth === 1) {
      const match = pattern.exec(entry.slice(index));
      if (match !== null) {
        const value = match[1] as string;
        const end = index + match[0].length - 1;
        found = { start: end - value.length, end, value };
        return true;
      }
    }
    return undefined;
  });
  return found as { start: number; end: number; value: string } | null;
}

export interface ManifestEdit {
  text: string;
  outcome: "written" | "already-at" | "left-alone";
  higher?: string;
}

/**
 * A manifest's text with the plugin's entry at `version`: only the values of its `ref` and,
 * in Claude's manifest, of its own `version` change, so every other byte stays as it was.
 * An entry already at a higher version, set by a person, is left alone.
 */
export function editManifest(
  text: string,
  kind: "claude" | "agents",
  version: string,
): ManifestEdit {
  const span = entrySpan(text);
  if (span === null) throw new ReleaseError(`the ${kind} manifest has no ${PLUGIN} entry`);
  let entry = text.slice(span.start, span.end);
  const ref = /"ref"\s*:\s*"([^"]*)"/.exec(entry);
  const refVersion = ref?.[1]?.startsWith("v") ? ref[1].slice(1) : null;
  if (ref === null || refVersion === null || !isVersion(refVersion))
    throw new ReleaseError(`the ${kind} manifest's ${PLUGIN} entry's ref is not a version tag`);
  const own = kind === "claude" ? topLevelValue(entry, "version") : null;
  if (kind === "claude" && own === null)
    throw new ReleaseError(`the ${kind} manifest's ${PLUGIN} entry has no version`);
  const current = own === null ? refVersion : own.value;
  if (olderThan(version, current)) return { text, outcome: "left-alone", higher: current };
  if (current === version && refVersion === version) return { text, outcome: "already-at" };
  if (own !== null) entry = `${entry.slice(0, own.start)}${version}${entry.slice(own.end)}`;
  entry = entry.replace(/("ref"\s*:\s*")[^"]*(")/, `$1v${version}$2`);
  return {
    text: `${text.slice(0, span.start)}${entry}${text.slice(span.end)}`,
    outcome: "written",
  };
}

/** Both manifests at `version`; when either is at a higher one, neither is written. */
export function editManifests(
  claude: string,
  agents: string,
  version: string,
): { claude: string; agents: string; outcome: ManifestEdit["outcome"]; higher?: string } {
  const edits = [editManifest(claude, "claude", version), editManifest(agents, "agents", version)];
  const higher = highestVersion(
    edits.map((edit) => edit.higher).filter((each): each is string => each !== undefined),
  );
  if (higher !== undefined) return { claude, agents, outcome: "left-alone", higher };
  const [first, second] = edits as [ManifestEdit, ManifestEdit];
  const written = first.outcome === "written" || second.outcome === "written";
  return { claude: first.text, agents: second.text, outcome: written ? "written" : "already-at" };
}

// --- What may be distributed ---------------------------------------------------------------

/** The assets a release must hold before it is distributed: the build's binaries and their checksums. */
export const REQUIRED_ASSETS: readonly string[] = [
  ...TARGETS.map((target) => target.file),
  "checksums.txt",
];

export interface Environment {
  exists: boolean;
  policy: { protected_branches: boolean; custom_branch_policies: boolean } | null;
  branches: Array<{ name: string; type: string }>;
  /** How many of its protection rules require a reviewer and name at least one. */
  reviewers: number;
  /** Whether an administrator may bypass its rules. */
  adminsBypass: boolean;
}

/**
 * An environment: ready only when its deployment rule is exactly the branch main and, for
 * the one that signs (`needsReviewer`), when it has a required reviewer. A reading that
 * lacks the count is no reviewer, never a pass.
 */
export function environmentState(
  environment: Environment,
  needsReviewer = false,
): "ready" | "missing" | "unruled" | "unreviewed" {
  if (!environment.exists) return "missing";
  const { policy, branches } = environment;
  const selected = policy?.protected_branches === false && policy.custom_branch_policies === true;
  const [only] = branches;
  if (!(selected && branches.length === 1 && only?.name === "main" && only.type === "branch"))
    return "unruled";
  return needsReviewer && !(environment.reviewers >= 1) ? "unreviewed" : "ready";
}

export interface PlanFacts {
  /** The ref the run is on. */
  ref: string;
  tag: string;
  /** The v* tags merged into main; those that are not version tags are ignored. */
  tags: string[];
  /** The commit the tag names, or null when the tag does not exist. */
  tagSha: string | null;
  onMain: boolean;
  /** The version of package.json at the tag's commit. */
  packageVersion: string | null;
  hasDistribute: boolean;
  release: { isDraft: boolean; assets: string[] } | null;
  /** `release`: where npm, the tap and the marketplace are written. */
  environment: Environment;
  /** `release-sign`: where the image is signed and latest moved, behind a reviewer (ADR 0032). */
  signEnvironment: Environment;
}

/** A release's tag: `v` and a version. */
export const isVersionTag = (tag: string): boolean =>
  tag.startsWith("v") && isVersion(tag.slice(1));
const isPrerelease = (tag: string): boolean => tag.includes("-");
/** The highest of some version tags, or null for none. */
const highestTag = (tags: string[]): string | null => {
  const highest = highestVersion(tags.map((tag) => tag.slice(1)));
  return highest === undefined ? null : `v${highest}`;
};

/** Facts with which every refusal passes: the command fills them in one by one, in the refusals' order. */
export function passingFacts(ref: string, tag: string): PlanFacts {
  return {
    ref,
    tag,
    tags: [],
    tagSha: "",
    onMain: true,
    packageVersion: tag.slice(1),
    hasDistribute: true,
    release: { isDraft: false, assets: [...REQUIRED_ASSETS] },
    environment: {
      exists: true,
      policy: { protected_branches: false, custom_branch_policies: true },
      branches: [{ name: "main", type: "branch" }],
      reviewers: 0,
      adminsBypass: false,
    },
    signEnvironment: {
      exists: true,
      policy: { protected_branches: false, custom_branch_policies: true },
      branches: [{ name: "main", type: "branch" }],
      reviewers: 1,
      adminsBypass: false,
    },
  };
}

/**
 * Whether a tag may be distributed: the first refusal that applies, in a fixed order, or the
 * version and the commit that every later job works from.
 */
export function decidePlan(
  facts: PlanFacts,
):
  | { ok: true; version: string; sha: string; prerelease: boolean }
  | { ok: false; sentence: string } {
  const { tag } = facts;
  const no = (sentence: string) => ({ ok: false as const, sentence });
  if (facts.ref !== "refs/heads/main")
    return no(`distribute runs from main only; this run is on ${facts.ref}`);
  if (!isVersionTag(tag))
    return no(
      `${tag} is not a version tag (v<major>.<minor>.<patch>, with an optional pre-release)`,
    );
  const version = tag.slice(1);
  if (facts.tagSha === null) return no(`the tag ${tag} does not exist`);
  if (!facts.onMain)
    return no(
      `${tag} is not on main; only a commit that reached main by a pull request is distributed`,
    );
  if (facts.packageVersion !== version)
    return no(
      `${tag} does not match its commit's package.json (${facts.packageVersion ?? "unreadable"})`,
    );
  if (!facts.hasDistribute)
    return no(
      `${tag} was cut before the release distributed itself (its tree has no .github/workflows/distribute.yml)`,
    );
  // A plain release must be the highest plain one; a pre-release, the highest of all: so no
  // target ever moves to a lower version, and a fix release survives a later pre-release tag.
  const rivals = facts.tags.filter(
    (other) => isVersionTag(other) && (isPrerelease(tag) || !isPrerelease(other)),
  );
  const highest = highestTag(rivals);
  if (highest !== null && olderThan(version, highest.slice(1)))
    return no(
      `${tag} is not the highest release (${highest} exists); an older release is never distributed`,
    );
  if (facts.release === null) return no(`the GitHub release ${tag} does not exist`);
  if (facts.release.isDraft) return no(`the GitHub release ${tag} is a draft`);
  const assets = facts.release.assets;
  const missing = REQUIRED_ASSETS.filter((name) => !assets.includes(name));
  if (missing.length > 0) return no(`the GitHub release ${tag} lacks: ${missing.join(", ")}`);
  const environment = environmentState(facts.environment);
  if (environment === "missing")
    return no(
      "the environment release does not exist; create it with its rule first (docs/runbooks/release.md)",
    );
  if (environment === "unruled")
    return no("the environment release must allow the branch main only (docs/runbooks/release.md)");
  // The job that signs waits for a person: without that, whoever can start this workflow on
  // main gets an image signed (ADR 0032).
  const sign = environmentState(facts.signEnvironment, true);
  if (sign === "missing")
    return no(
      "the environment release-sign does not exist; create it with its rule and its reviewer first (docs/runbooks/release.md)",
    );
  if (sign === "unruled")
    return no(
      "the environment release-sign must allow the branch main only (docs/runbooks/release.md)",
    );
  if (sign === "unreviewed")
    return no(
      "the environment release-sign has no required reviewer; add one first (docs/runbooks/release.md)",
    );
  return { ok: true, version, sha: facts.tagSha, prerelease: isPrerelease(tag) };
}

// --- The image's signature (ADR 0032) ------------------------------------------------------

export const IMAGE = "ghcr.io/wizardingcode-io/wizardingcode-mem";
/** cosign's version: what distribute.yml installs, and the release COSIGN_IMAGE is. */
export const COSIGN_VERSION = "v3.1.4";
/** cosign's own image at that version, by its index digest: a host verifies with it and installs nothing. */
export const COSIGN_IMAGE =
  "ghcr.io/sigstore/cosign/cosign@sha256:0f06154836d2de34f887a5c273506d52ca43edaa1d9e53e6510fa78a48f69c2d";
/**
 * What a signature made by a job of distribute.yml in a run on main carries. It is a contract
 * with every host that verifies: a rename of the workflow file or of the default branch makes
 * every host refuse every new image.
 */
export const SIGNER_IDENTITY =
  "https://github.com/WizardingCode-io/wizardingcode-mem/.github/workflows/distribute.yml@refs/heads/main";
export const OIDC_ISSUER = "https://token.actions.githubusercontent.com";
export const DIGEST = /^sha256:[0-9a-f]{64}$/;

/** cosign's arguments to check that `reference` was signed by distribute.yml at main: the one form, here and in the runbook. */
export function verifyArgs(reference: string): string[] {
  return [
    "verify",
    reference,
    "--certificate-identity",
    SIGNER_IDENTITY,
    "--certificate-oidc-issuer",
    OIDC_ISSUER,
  ];
}

export const verifyCommand = (reference: string): string =>
  ["cosign", ...verifyArgs(reference)].join(" ");

/** One run of release.yml for a tag: whether its docker job built the image, and what it recorded. */
export interface BuildRun {
  url: string;
  createdAt: string;
  /** The conclusion of the job `docker`; null when it could not be read or is not there. */
  docker: string | null;
  /** The text of the artifact `image-digest`; null when there is none. */
  artifact: string | null;
}

export type Built = { digest: string; run: string } | { digest: null; reason: string };

/**
 * The newest run whose docker job succeeded, or none. The one rule for which run's record
 * counts: readBuild downloads that run's artifact and builtDigest reads it.
 */
export function newestBuilt(runs: BuildRun[]): BuildRun | undefined {
  return runs
    .filter((run) => run.docker === "success")
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))[0];
}

/**
 * The digest a release's own build recorded: that of the newest run whose docker job
 * succeeded (a tag deleted and pushed again leaves two). The job that signs compares it with
 * what the tag names, so a wrong choice here signs nothing.
 */
export function builtDigest(runs: BuildRun[]): Built {
  if (runs.length === 0)
    return { digest: null, reason: "no run of release.yml for this tag's commit" };
  const newest = newestBuilt(runs);
  if (newest === undefined)
    return { digest: null, reason: "no run of release.yml built the image" };
  if (newest.artifact === null)
    return { digest: null, reason: `the release run ${newest.url} recorded no image digest` };
  const text = newest.artifact.endsWith("\n") ? newest.artifact.slice(0, -1) : newest.artifact;
  if (!DIGEST.test(text))
    return {
      digest: null,
      reason: `the release run ${newest.url} recorded ${clean(text, 80)}, which is not a digest`,
    };
  return { digest: text, run: newest.url };
}

/** plan's line of the summary: which image this distribution may sign, and where that was read. */
export function imageLine(tag: string, built: Built): string {
  return built.digest === null
    ? `image: no digest: ${built.reason}; latest is not moved`
    : `image: ${tag} built by ${built.run} as ${built.digest}`;
}

export const BYPASS_LINE =
  "environment release-sign: administrators can bypass its rules; forbid it (docs/runbooks/release.md)";

/** What the job that signs does. A decision, named apart from the summary's outcomes: `sign` is to do, `signed` is done. */
export type SignDecision =
  | "no-digest"
  | "unreadable"
  | "tag-moved"
  | "would-sign"
  | "already-signed"
  | "sign";

/** The first row that applies: nothing is signed unless the tag still names the image the release built. */
export function decideSign(facts: {
  /** The digest plan read from the release's run; empty when it read none. */
  built: string;
  /** The digest the version tag names now; null when the registry did not say. */
  tagged: string | null;
  signed: boolean;
  dryRun: boolean;
}): SignDecision {
  if (facts.built === "") return "no-digest";
  if (facts.tagged === null) return "unreadable";
  if (facts.tagged !== facts.built) return "tag-moved";
  if (facts.dryRun) return "would-sign";
  return facts.signed ? "already-signed" : "sign";
}

// --- The hold of latest --------------------------------------------------------------------

export const CONTRACT_FILE = "src/team/contract.ts";

/** The two constants of src/team/contract.ts, read from its text as they are declared. */
export function parseContract(source: string): { contract: number; accepted: number[] } | null {
  const contract = /^export const CONTRACT = (\d+);/m.exec(source);
  const list = /^export const ACCEPTED_CONTRACTS: readonly number\[\] = \[([^\]]*)\];/m.exec(
    source,
  );
  if (contract === null || list === null) return null;
  const items = (list[1] as string)
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");
  if (items.length === 0 || items.some((item) => !/^\d+$/.test(item))) return null;
  return { contract: Number(contract[1]), accepted: items.map(Number) };
}

/** The highest plain version tag below `tag`: the release whose members the hold protects. */
export function previousPlain(tag: string, tags: string[]): string | null {
  return highestTag(
    tags
      .filter((other) => isVersionTag(other) && !isPrerelease(other))
      .filter((other) => olderThan(other.slice(1), tag.slice(1))),
  );
}

/**
 * Whether latest is held: when the tag's server would refuse the members still on the previous
 * plain release (its lowest accepted contract is above the contract that release speaks). A
 * read that fails holds it: the rule fails closed. `releaseHold` is the author's release.
 */
export function decideHold(input: {
  tag: string;
  /** The contract file's text at the tag, or null when it could not be read. */
  atTag: string | null;
  previous: string | null;
  /** The file's text at the previous plain release, or why there is none. */
  atPrevious: "missing" | "unreadable" | string;
  releaseHold: boolean;
}): { held: boolean; byHand: boolean; outcome: Outcome | null } {
  const hold = (outcome: Outcome) =>
    input.releaseHold
      ? { held: false, byHand: true, outcome: null }
      : { held: true, byHand: false, outcome };
  const free = { held: false, byHand: false, outcome: null };
  const mine = input.atTag === null ? null : parseContract(input.atTag);
  if (mine === null)
    return hold({ kind: "held-unreadable", read: `${CONTRACT_FILE} at ${input.tag}` });
  // No previous release, or one with no contract: no member of it syncs.
  if (input.previous === null || input.atPrevious === "missing") return free;
  const theirs = input.atPrevious === "unreadable" ? null : parseContract(input.atPrevious);
  if (theirs === null)
    return hold({ kind: "held-unreadable", read: `${CONTRACT_FILE} at ${input.previous}` });
  const accepts = Math.min(...mine.accepted);
  return accepts > theirs.contract
    ? hold({
        kind: "held-contract",
        tag: input.tag,
        accepts,
        previous: input.previous,
        speaks: theirs.contract,
      })
    : free;
}

// --- npm -----------------------------------------------------------------------------------

/** A sentence when the package in the tag's tree is not at the tag's version. */
export function checkPackageVersion(
  pkg: { name: string; version: string },
  version: string,
): string | null {
  return pkg.version === version
    ? null
    : `${pkg.name} is at ${pkg.version} in the tag's tree, not ${version}`;
}

/** What `npm view <name>@<version> version` said: a registry error is never read as "absent". */
export function decideNpmView(result: RunResult): "published" | "absent" | { error: string } {
  if (result.code === 0) return result.stdout.trim() === "" ? "absent" : "published";
  if (result.stderr.includes("E404")) return "absent";
  return { error: result.stderr.trim() };
}

/** The publish command: no lifecycle script of the tag's tree runs where the publish right is. */
export function publishArgs(options: { prerelease: boolean; dryRun: boolean }): string[] {
  return [
    "publish",
    "--access",
    "public",
    "--ignore-scripts",
    ...(options.prerelease ? ["--tag", "next"] : []),
    ...(options.dryRun ? ["--dry-run"] : []),
  ];
}

const PUBLISHER_HINT =
  "The trusted publisher for this package may not be registered for the workflow distribute.yml and the environment release (docs/runbooks/release.md).";

/** A failed publish: the version already there (which is success), or what to tell the author. */
export function publishFailure(stderr: string): "conflict" | { message: string } {
  if (stderr.includes("cannot publish over") || stderr.includes("EPUBLISHCONFLICT"))
    return "conflict";
  const text = stderr.trim();
  return /ENEEDAUTH|E401|E403|E404/.test(text)
    ? { message: `${text}\n${PUBLISHER_HINT}` }
    : { message: text };
}

// --- The marketplace token -----------------------------------------------------------------

const DAY_MS = 86_400_000;
const RENEW_UNDER_DAYS = 30;

/** GitHub's expiration header as a date: "2027-11-12 10:00:00 UTC", or ISO 8601. */
function expiryOf(header: string | null): Date | null {
  if (header === null) return null;
  const date = new Date(header.trim().replace(/ UTC$/, "Z").replace(" ", "T"));
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * The token's state from one read of a repository it must write: a failure with its sentence,
 * or a pass, with a warning when it expires within thirty days or says no expiry at all.
 * Only the level "error" fails the step.
 */
export function decideToken(input: {
  token: boolean;
  /** The HTTP status, or null when the request could not be made. */
  status: number | null;
  error: string | null;
  /** The repository's `permissions.push` as answered; only a false is a failure. */
  push: boolean | null;
  expiration: string | null;
  now: Date;
  repo: string;
}): { level: "ok" | "warning" | "error"; message: string } {
  const fail = (message: string) => ({ level: "error" as const, message });
  const { repo } = input;
  if (!input.token)
    return fail("the secret MARKETPLACE_TOKEN is not set in the environment release");
  if (input.status === null)
    return fail(`could not reach api.github.com for ${repo}: ${input.error ?? ""}`);
  if (input.status === 401) return fail(`MARKETPLACE_TOKEN is invalid or expired (${repo})`);
  if (input.status === 403 || input.status === 404)
    return fail(
      `MARKETPLACE_TOKEN is not granted to ${repo}, or the organisation has not approved it`,
    );
  if (input.status !== 200) return fail(`${repo} answered ${input.status}`);
  if (input.push === false) return fail(`MARKETPLACE_TOKEN cannot push to ${repo}`);
  const expiry = expiryOf(input.expiration);
  if (expiry === null)
    return { level: "warning", message: summaryLine("token", { kind: "token-unknown" }) };
  const days = Math.floor((expiry.getTime() - input.now.getTime()) / DAY_MS);
  const date = expiry.toISOString().slice(0, 10);
  return days >= RENEW_UNDER_DAYS
    ? { level: "ok", message: summaryLine("token", { kind: "token-ok", date, days }) }
    : {
        level: "warning",
        message: summaryLine("token", { kind: "token-renew", date, days }),
      };
}
