// One running server per data directory, and one mirror run at a time: leases in the team's
// `meta`, with an expiry and an owner that names no pid (D-17).
import type { Db } from "./db.ts";
import { LeaseHeldError, ServerRunningError } from "./errors.ts";
import { newHexId } from "./ids.ts";
import { claimLease, leaseActive, leaseOf, releaseLease } from "./store.ts";

export const SERVE_LEASE = "serve.lease";
export const SERVE_TTL_MS = 30_000;
export const SERVE_RENEW_MS = 10_000;
export const MIRROR_LEASE = "mirror.lease";
export const MIRROR_TTL_MS = 120_000;

export interface HeldLease {
  owner: string;
  /** Claims again with the clock's time; false when another owner took the lease meanwhile. */
  renew(): boolean;
  release(): void;
}

/** Takes the lease or throws `LeaseHeldError` while another owner's lease is fresh. */
export function holdLease(
  db: Db,
  key: string,
  prefix: "serve" | "mirror",
  ttlMs: number,
  now: () => number,
): HeldLease {
  const owner = `${prefix}-${newHexId()}`;
  if (!claimLease(db, key, owner, now(), ttlMs)) {
    throw new LeaseHeldError(key, leaseOf(db, key)?.until ?? now());
  }
  return {
    owner,
    renew: () => claimLease(db, key, owner, now(), ttlMs),
    release: () => releaseLease(db, key, owner),
  };
}

/** For the one subcommand that needs the server stopped: refuses while its lease is fresh. */
export function requireNoServer(db: Db, now: number, sub: string): void {
  if (leaseActive(db, SERVE_LEASE, now)) throw new ServerRunningError(sub);
}
