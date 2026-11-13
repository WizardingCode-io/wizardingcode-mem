// The time bounds of the host's tool (ADR 0033), in milliseconds, and the numbers a test
// holds against the unit's start timeout and the Dockerfile's health check.

export interface Bounds {
  /** Each request to the registry. */
  registry: number;
  verifier: number;
  pull: number;
  /** ps, inspect, exec, version, image inspect, ls and rm, logs, each confined run. */
  quick: number;
  stop: number;
  /** Compose's own wait for health, unattended and attended. */
  waitUnattended: number;
  waitAttended: number;
  /** What the runner allows `up` beyond Compose's wait, so that Compose reports first. */
  upMargin: number;
  /** How long a cut run's container may read `starting` before it counts as failed. */
  intentStarting: number;
  /** Added to the lease's length before the second wait. */
  leaseMargin: number;
}

export const BOUNDS: Bounds = {
  registry: 60_000,
  verifier: 180_000,
  pull: 600_000,
  quick: 30_000,
  stop: 60_000,
  waitUnattended: 300_000,
  waitAttended: 1_800_000,
  upMargin: 120_000,
  intentStarting: 900_000,
  leaseMargin: 5_000,
};

/** The launcher's own Docker calls: six at 30 s (ps twice, inspect, the removal of an earlier labelled container, create, rm) and the copy at 120 s. */
export const LAUNCHER_MS = 30_000 * 6 + 120_000;
/** A conservative floor, not the first release with `up --wait-timeout`. */
export const MIN_COMPOSE = "2.20.0";
/** Free space on the data volume under which nothing is pulled or applied. */
export const FLOOR_BYTES = 500 * 1024 * 1024;

/** The longest an unattended run can take: every call at its bound, an apply and a way back that each wait twice. */
export function worstUnattendedMs(bounds: Bounds, leaseMs: number): number {
  const start = 2 * (bounds.waitUnattended + bounds.upMargin) + leaseMs + bounds.leaseMargin;
  const facts = 7 * bounds.quick + 3 * bounds.registry + bounds.verifier;
  const candidate = bounds.pull + 2 * bounds.quick + 3 * bounds.quick;
  const apply = start + bounds.quick;
  const failed = bounds.quick + bounds.stop + bounds.quick + start + bounds.quick;
  return LAUNCHER_MS + facts + candidate + apply + failed;
}
