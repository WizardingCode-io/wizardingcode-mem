import { type Db, withWrite } from "./db.ts";

export function getMeta(db: Db, key: string): string | null {
  return (
    db.query<{ value: string }, [string]>("SELECT value FROM meta WHERE key = ?").get(key)?.value ??
    null
  );
}

export function setMeta(db: Db, key: string, value: string): void {
  db.run(
    "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
    [key, value],
  );
}

// --- Leases ---------------------------------------------------------------------
// A lease is a meta row `{owner, until}`: whoever holds an unexpired one owns some
// background work. Every turn-end starts a `distill`; the drain lease lets one of them
// drain the queue while the rest leave at once, and lets hooks skip starting more. The
// backup lease does the same for copies, and a move of the store waits for both.

export const DRAIN_LEASE = "drain.lease";
export const BACKUP_LEASE = "backup.lease";
export const HISTORY_LEASE = "history.lease";

interface Lease {
  owner: string;
  until: number;
}

function readLease(db: Db, key: string): Lease | null {
  const raw = getMeta(db, key);
  if (raw === null) return null;
  try {
    const lease = JSON.parse(raw) as Partial<Lease>;
    return typeof lease.owner === "string" && typeof lease.until === "number"
      ? { owner: lease.owner, until: lease.until }
      : null;
  } catch {
    return null;
  }
}

/**
 * Owners name their process (`<pid>-<uuid>`, `ui-<pid>`): a lease whose process is gone
 * (killed mid-work) is not worth waiting for. An owner that names no process is trusted
 * until the lease expires.
 */
function ownerAlive(owner: string): boolean {
  const pid = Number(/^(?:ui-)?(\d+)/.exec(owner)?.[1]);
  if (!Number.isInteger(pid) || pid <= 0) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

const holds = (lease: Lease | null, now: number): lease is Lease =>
  lease !== null && lease.until > now && ownerAlive(lease.owner);

/** True while some live process holds an unexpired lease. */
export function leaseActive(db: Db, key: string, now: number): boolean {
  return holds(readLease(db, key), now);
}

/** Takes or extends the lease. False when another process holds it. */
export function claimLease(
  db: Db,
  key: string,
  owner: string,
  now: number,
  leaseMs: number,
): boolean {
  return withWrite(db, () => {
    const lease = readLease(db, key);
    if (holds(lease, now) && lease.owner !== owner) return false;
    setMeta(db, key, JSON.stringify({ owner, until: now + leaseMs }));
    return true;
  });
}

export function releaseLease(db: Db, key: string, owner: string): void {
  withWrite(db, () => {
    if (readLease(db, key)?.owner === owner) db.run("DELETE FROM meta WHERE key = ?", [key]);
  });
}

export const drainActive = (db: Db, now: number): boolean => leaseActive(db, DRAIN_LEASE, now);
export const claimDrain = (db: Db, owner: string, now: number, leaseMs: number): boolean =>
  claimLease(db, DRAIN_LEASE, owner, now, leaseMs);
export const releaseDrain = (db: Db, owner: string): void => releaseLease(db, DRAIN_LEASE, owner);

/** True while any background work that must not meet a move or a restore is under way. */
export function anyLeaseActive(db: Db, now: number): boolean {
  return (
    leaseActive(db, DRAIN_LEASE, now) ||
    leaseActive(db, BACKUP_LEASE, now) ||
    leaseActive(db, HISTORY_LEASE, now)
  );
}
