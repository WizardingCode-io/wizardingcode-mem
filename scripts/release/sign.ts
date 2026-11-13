// The last job of the distribution: signs the image the release's own build recorded, checks
// the signature as a host will, and only then moves the image's latest tag to that digest.
//
//   bun scripts/release/sign.ts
//
// Environment: VERSION, IMAGE_DIGEST (what plan read; may be empty), DRY_RUN. It needs docker
// buildx logged in to the registry, cosign on PATH, and the job's OIDC token: the signature is
// keyless, and what it carries is this workflow's name and the branch main (ADR 0032).
//
// The version tag is read once, to check that it still names the built image, and is never
// what gets signed or retagged: both go by digest.
import {
  clean,
  DIGEST,
  decideSign,
  IMAGE,
  lastLine,
  type Outcome,
  ReleaseError,
  type Runner,
  run,
  summary,
  summaryLine,
  verifyArgs,
} from "./lib.ts";

const NOT_A_DIGEST = "an answer that is not a digest";

/** The digest a tag of the image names, or what the registry said instead. */
function named(run: Runner, tag: string): { digest: string } | { said: string } {
  const out = run([
    "docker",
    "buildx",
    "imagetools",
    "inspect",
    `${IMAGE}:${tag}`,
    "--format",
    "{{json .Manifest.Digest}}",
  ]);
  if (out.code !== 0) return { said: clean(lastLine(out.stderr), 300) };
  try {
    const digest: unknown = JSON.parse(out.stdout);
    if (typeof digest === "string" && DIGEST.test(digest)) return { digest };
  } catch {
    // Not JSON: said below.
  }
  return { said: NOT_A_DIGEST };
}

export function signImage(options: {
  run: Runner;
  version: string;
  /** The digest plan read from the release's run; empty when it read none. */
  built: string;
  dryRun: boolean;
}): Outcome {
  const { run, version, built, dryRun } = options;
  const failed = (sentence: string): Outcome => ({ kind: "failed", sentence });
  const reference = `${IMAGE}@${built}`;
  const verify = () => run(["cosign", ...verifyArgs(reference)]);

  const tag = built === "" ? null : named(run, version);
  const tagged = tag !== null && "digest" in tag ? tag.digest : null;
  const signed = built !== "" && tagged === built && verify().code === 0;
  const decision = decideSign({ built, tagged, signed, dryRun });
  switch (decision) {
    case "no-digest":
      return { kind: "no-digest" };
    case "unreadable":
      return {
        kind: "unreadable",
        version,
        said: tag !== null && "said" in tag ? tag.said : NOT_A_DIGEST,
      };
    case "tag-moved":
      return { kind: "tag-moved", version, built };
    case "would-sign":
      return { kind: "would-sign", digest: built };
    case "sign": {
      const signing = run(["cosign", "sign", "--yes", reference]);
      if (signing.code !== 0)
        return failed(
          `the image's signing did not succeed: ${clean(lastLine(signing.stderr), 300)}`,
        );
      // Checked as a host checks it, before anything follows the signature.
      const check = verify();
      if (check.code !== 0)
        return { kind: "unverified", digest: built, said: clean(lastLine(check.stderr), 300) };
      break;
    }
    case "already-signed":
      break;
  }
  // The manifest list already pushed gets a second tag, by digest; nothing is rebuilt.
  const retag = run([
    "docker",
    "buildx",
    "imagetools",
    "create",
    "-t",
    `${IMAGE}:latest`,
    reference,
  ]);
  if (retag.code !== 0) return failed("the image's retag did not succeed");
  const latest = named(run, "latest");
  const found = "digest" in latest ? latest.digest : "nothing readable";
  if (found !== built) return failed(`latest names ${found} after the retag, not ${built}`);
  return { kind: decision === "sign" ? "signed" : "already-signed", digest: built };
}

function need(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new ReleaseError(`${name} is not set`);
  return value;
}

if (import.meta.main) {
  let outcome: Outcome;
  try {
    outcome = signImage({
      run,
      version: need("VERSION"),
      built: process.env.IMAGE_DIGEST ?? "",
      dryRun: process.env.DRY_RUN === "true",
    });
  } catch (error) {
    outcome = {
      kind: "failed",
      sentence: clean(error instanceof Error ? error.message : String(error), 300),
    };
  }
  summary(summaryLine("latest", outcome));
  const stops = ["no-digest", "unreadable", "tag-moved", "unverified", "failed"];
  process.exit(stops.includes(outcome.kind) ? 1 : 0);
}
