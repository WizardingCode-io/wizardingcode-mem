// What the host's tool is handed (ADR 0033): the runner, the network, the clock, the writer,
// the environment and the target. src/host/ imports nothing of the server, so the lease's
// length arrives here too. Tests and the scenarios pass their own; the command passes these.
import { BOUNDS, type Bounds } from "./bounds.ts";
import { realWriter, type Writer } from "./files.ts";
import { type Run, realRun } from "./run.ts";
import { COSIGN_IMAGE, IMAGE, verifyArgs } from "./signature.ts";

/** The repository a host follows, where its registry answers, and how a signature is checked. */
export interface Target {
  image: string;
  registry: string;
  cosignImage: string;
  verifyArgs: (reference: string) => string[];
}

export interface Deps {
  run: Run;
  fetch: typeof fetch;
  now: () => number;
  sleep: (ms: number) => void;
  writer: Writer;
  env: Record<string, string | undefined>;
  /** How long a server's lease lasts after an unclean stop. */
  leaseMs: number;
  bounds: Bounds;
  target: Target;
  out: (line: string) => void;
  err: (line: string) => void;
  /** The tool's own version, for `status` to print. It decides nothing. */
  version: string;
}

/** The one target the shipped command has: the constants of signature.ts and nothing else. */
export const realTarget: Target = {
  image: IMAGE,
  registry: `https://${IMAGE.slice(0, IMAGE.indexOf("/"))}`,
  cosignImage: COSIGN_IMAGE,
  verifyArgs,
};

export function realDeps(given: {
  leaseMs: number;
  version: string;
  env: Record<string, string | undefined>;
  bounds?: Bounds;
  target?: Target;
}): Deps {
  return {
    run: realRun,
    fetch: globalThis.fetch,
    now: Date.now,
    sleep: (ms) => Bun.sleepSync(ms),
    writer: realWriter,
    env: given.env,
    leaseMs: given.leaseMs,
    bounds: given.bounds ?? BOUNDS,
    target: given.target ?? realTarget,
    out: (line) => {
      process.stdout.write(`${line}\n`);
    },
    err: (line) => {
      process.stderr.write(`${line}\n`);
    },
    version: given.version,
  };
}
