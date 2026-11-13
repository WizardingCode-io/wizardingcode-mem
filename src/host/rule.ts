// The host's rule (ADR 0033): what a team server's host does about the image `latest` names.
// A pure function over facts the tool read itself; the first row that applies wins, and a
// fact is asked for only when every earlier row let the run pass, so that a run which ends
// early neither runs the verifier nor downloads an image.
import { olderThan } from "../util/version.ts";

/**
 * The tool's exit codes. 10 to 15 are its own, away from the binary's 1, 2 and 3: the server
 * needs a person now, a release was rejected here, an image did not verify, the tool could
 * not check, something waits for the operator, the disk. 69 is a refusal before anything
 * changed; 75 the lock, which the unit counts as success.
 */
export const EXIT = {
  ok: 0,
  down: 10,
  rejected: 11,
  notVerified: 12,
  cannotCheck: 13,
  waits: 14,
  lowDisk: 15,
  usage: 64,
  unavailable: 69,
  locked: 75,
} as const;

export type Outcome =
  | "cannot-check"
  | "starting"
  | "down"
  | "env-differs"
  | "current"
  | "rejected"
  | "not-verified"
  | "low-disk"
  | "not-higher"
  | "waits-migration"
  | "waits-contract"
  | "apply";

/** The facts, in the order the rule reads them and the tool gathers them. */
export const FACT_ORDER = [
  "docker",
  "container",
  "envMatches",
  "running",
  "candidateDigest",
  "verification",
  "candidate",
] as const;
export type FactName = (typeof FACT_ORDER)[number];

/** What the running server said of itself, and its image's digest in the repository. */
export interface RunningFacts {
  version: string;
  /** The database's schema, from `serve status`. */
  schema: number;
  /** The contracts the running server accepts, from `serve version`. */
  accepts: readonly number[];
  freeBytes: number | null;
  dbBytes: number | null;
  digest: string | null;
}

/** What a verified, pulled candidate said of itself, read strictly. */
export interface CandidateFacts {
  version: string;
  teamSchema: number;
  contract: number;
  accepts: readonly number[];
}

export interface Facts {
  attended: boolean;
  /** The digests that failed to start here. */
  rejected: readonly string[];
  floorBytes: number;
  docker?: "ok" | "silent";
  /** "other": absent, not running, or unhealthy. */
  container?: "starting" | "healthy" | "other";
  envMatches?: boolean;
  running?: "unreadable" | RunningFacts;
  /** null: the registry gave none. */
  candidateDigest?: string | null;
  verification?: "verified" | "could-not" | "not-verified";
  /** null: the pull failed, or the candidate's output did not pass the strict reading. */
  candidate?: CandidateFacts | null;
}

export interface Decision {
  outcome: Outcome;
  exit: number;
  row: number;
}

const at = (row: number, outcome: Outcome, exit: number): Decision => ({ outcome, exit, row });

/** The first row that applies, or the one fact the next row needs. */
export function decide(facts: Facts): Decision | { need: FactName } {
  if (facts.docker === undefined) return { need: "docker" };
  if (facts.docker === "silent") return at(1, "cannot-check", EXIT.cannotCheck);

  if (facts.container === undefined) return { need: "container" };
  if (facts.container === "starting") return at(2, "starting", EXIT.ok);
  if (facts.container === "other") return at(3, "down", EXIT.down);

  if (facts.envMatches === undefined) return { need: "envMatches" };
  if (!facts.envMatches) return at(4, "env-differs", EXIT.waits);

  const running = facts.running;
  if (running === undefined) return { need: "running" };
  if (running === "unreadable") return at(5, "cannot-check", EXIT.cannotCheck);

  const digest = facts.candidateDigest;
  if (digest === undefined) return { need: "candidateDigest" };
  if (digest === null) return at(6, "cannot-check", EXIT.cannotCheck);
  if (digest === running.digest) return at(7, "current", EXIT.ok);
  if (!facts.attended && facts.rejected.includes(digest)) return at(8, "rejected", EXIT.rejected);

  if (facts.verification === undefined) return { need: "verification" };
  if (facts.verification === "could-not") return at(9, "cannot-check", EXIT.cannotCheck);
  if (facts.verification === "not-verified") return at(10, "not-verified", EXIT.notVerified);

  // Before the pull: the pull is what fills a disk.
  const free = running.freeBytes;
  if (free === null || free < facts.floorBytes) return at(11, "low-disk", EXIT.lowDisk);

  const candidate = facts.candidate;
  if (candidate === undefined) return { need: "candidate" };
  if (candidate === null) return at(12, "cannot-check", EXIT.cannotCheck);
  if (!olderThan(running.version, candidate.version)) return at(13, "not-higher", EXIT.ok);

  const migrates = candidate.teamSchema !== running.schema;
  if (!facts.attended && migrates) return at(14, "waits-migration", EXIT.waits);
  if (!facts.attended && running.accepts.some((n) => !candidate.accepts.includes(n)))
    return at(15, "waits-contract", EXIT.waits);
  // The server copies team.db before it migrates: the copy needs the database's size.
  if (migrates && (running.dbBytes === null || free < facts.floorBytes + running.dbBytes))
    return at(16, "low-disk", EXIT.lowDisk);

  return at(17, "apply", EXIT.ok);
}
