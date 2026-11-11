import type { Clock, Timers } from "../util/clock.ts";
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
export const EMBED_LEASE = "embed.lease";
/** Held by `embed download` while it fetches the model: one download at a time. */
export const EMBED_DOWNLOAD_LEASE = "embed.download.lease";
/** Held by `sync --auto` (owner `sync-<pid>-<version>`): one sync per data directory. */
export const SYNC_LEASE = "sync.lease";
/** The sync's lease length; `sync --auto` renews it every `SYNC_RENEW_MS`. */
export const SYNC_LEASE_MS = 60_000;
export const SYNC_RENEW_MS = 20_000;
/** Set by whoever needs the sync out of the way; the sync leaves within five seconds of it. */
export const SYNC_STOP = "sync.stop";
/** A flag nobody cleared (its setter died) is stale after this and cleared by the next spawn. */
export const SYNC_STOP_STALE_MS = 10 * 60_000;
/** Written by a `sync --auto` that failed before its loop: the spawn backs off from it. */
export const SYNC_LAST_FAILED_START = "sync.last_failed_start";
/** The `meta` key of a server's uncommitted-path count, from the last sweep that looked. */
export const dirtyKey = (serverId: string): string => `sync.dirty:${serverId}`;

/** A server's held withdrawal (a restore, or a bulk withdrawal); `share server resume` clears it. */
export const restoreHoldKey = (serverId: string): string => `sharing.restore_hold:${serverId}`;

interface Lease {
  owner: string;
  until: number;
}

/** A lease's stored value read back; null for nothing or anything that is not a lease. */
export function parseLease(raw: string | null): Lease | null {
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

function readLease(db: Db, key: string): Lease | null {
  return parseLease(getMeta(db, key));
}

/** The process an owner names (`<pid>-<uuid>`, `ui-<pid>`, `sync-<pid>-<version>`), or null. */
export function pidOfOwner(owner: string): number | null {
  const pid = Number(/^(?:ui-|sync-)?(\d+)/.exec(owner)?.[1]);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

/**
 * Owners name their process (`<pid>-<uuid>`, `ui-<pid>`, `sync-<pid>-<version>`): a lease
 * whose process is gone (killed mid-work) is not worth waiting for. An owner that names no
 * process is trusted until the lease expires.
 */
function ownerAlive(owner: string): boolean {
  const pid = pidOfOwner(owner);
  return pid === null || processAlive(pid);
}

/** Whether a process is there: one `kill(pid, 0)`; a process we may not signal is there too. */
export function processAlive(pid: number): boolean {
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

/** The lease as held now (its owner and its end), null when nobody live holds it. */
export function liveLease(db: Db, key: string, now: number): Lease | null {
  const lease = readLease(db, key);
  return holds(lease, now) ? lease : null;
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

/** True while `owner` holds the lease: the check every guarded write of the sync runs first. */
export function leaseOwned(db: Db, key: string, owner: string): boolean {
  return readLease(db, key)?.owner === owner;
}

/** The `<version>` of a `sync-<pid>-<version>` owner, null for any other owner. */
function syncVersionOf(owner: string): string | null {
  return /^sync-\d+-(.+)$/.exec(owner)?.[1] ?? null;
}

/**
 * Takes the lease as `claimLease` does, and also from a live holder whose owner carries a
 * lower version than `owner` (a newer binary replaces an older sync; the holder sees the
 * lease lost at its next renewal). False when a holder of the same or a newer version is live.
 */
export function takeOverLease(
  db: Db,
  key: string,
  owner: string,
  now: number,
  leaseMs: number = SYNC_LEASE_MS,
): boolean {
  return withWrite(db, () => {
    const lease = readLease(db, key);
    if (holds(lease, now) && lease.owner !== owner) {
      const mine = syncVersionOf(owner);
      const theirs = syncVersionOf(lease.owner);
      if (mine === null || theirs === null || Bun.semver.order(mine, theirs) <= 0) return false;
    }
    setMeta(db, key, JSON.stringify({ owner, until: now + leaseMs }));
    return true;
  });
}

// --- The sync's stop flag ----------------------------------------------------------------

interface StopFlag {
  who: string;
  at: number;
}

export function readSyncStop(db: Db): StopFlag | null {
  return parseStopFlag(getMeta(db, SYNC_STOP));
}

export function parseStopFlag(raw: string | null): StopFlag | null {
  if (raw === null) return null;
  try {
    const flag = JSON.parse(raw) as Partial<StopFlag>;
    return typeof flag.who === "string" && typeof flag.at === "number"
      ? { who: flag.who, at: flag.at }
      : { who: "", at: 0 };
  } catch {
    // A flag that cannot be read is as old as any: stale, and cleared by the next spawn.
    return { who: "", at: 0 };
  }
}

/** How long a restore, a move, a compact or a removal waits for the sync to leave once asked, and how often it looks. */
export const SYNC_STOP_WAIT_MS = 30_000;
export const SYNC_STOP_POLL_MS = 250;

/**
 * Sets the stop flag for `who` and waits, polling every `SYNC_STOP_POLL_MS` on the injected
 * timers, for the sync's lease to be released. True once it is, false when `SYNC_STOP_WAIT_MS`
 * passed first; the flag stays set either way, for the caller to clear at its end
 * (`clearSyncStop`).
 */
export function stopSync(
  db: Db,
  options: { who: string; clock: Clock; timers: Timers },
): Promise<boolean> {
  const { who, clock, timers } = options;
  const started = clock.now;
  setMeta(db, SYNC_STOP, JSON.stringify({ who, at: started }));
  return new Promise((resolve) => {
    const poll = () => {
      if (!leaseActive(db, SYNC_LEASE, clock.now)) return resolve(true);
      if (clock.now - started >= SYNC_STOP_WAIT_MS) return resolve(false);
      timers.setTimeout(poll, SYNC_STOP_POLL_MS);
    };
    poll();
  });
}

export function clearSyncStop(db: Db): void {
  db.run("DELETE FROM meta WHERE key = ?", [SYNC_STOP]);
}

/** True when a stop flag is set and older than ten minutes, or cannot be read. */
export function staleStopFlag(db: Db, now: number): boolean {
  const flag = readSyncStop(db);
  return flag !== null && now - flag.at > SYNC_STOP_STALE_MS;
}

// --- The sync's failed-start mark ----------------------------------------------------------

export interface FailedStart {
  at: number;
  reason: string;
  /** Consecutive failed starts: the backoff doubles with it. */
  failures: number;
}

export function readFailedStart(db: Db): FailedStart | null {
  return parseFailedStart(getMeta(db, SYNC_LAST_FAILED_START));
}

export function parseFailedStart(raw: string | null): FailedStart | null {
  if (raw === null) return null;
  try {
    const mark = JSON.parse(raw) as Partial<FailedStart>;
    return typeof mark.at === "number"
      ? {
          at: mark.at,
          reason: typeof mark.reason === "string" ? mark.reason : "",
          failures:
            typeof mark.failures === "number" && mark.failures >= 1 ? Math.floor(mark.failures) : 1,
        }
      : { at: 0, reason: "", failures: 1 };
  } catch {
    return { at: 0, reason: "", failures: 1 };
  }
}

/** Written by a start that failed before its loop; the count continues the previous mark's. */
export function writeFailedStart(db: Db, at: number, reason: string): FailedStart {
  const mark = { at, reason, failures: (readFailedStart(db)?.failures ?? 0) + 1 };
  setMeta(db, SYNC_LAST_FAILED_START, JSON.stringify(mark));
  return mark;
}

export function clearFailedStart(db: Db): void {
  db.run("DELETE FROM meta WHERE key = ?", [SYNC_LAST_FAILED_START]);
}

/** Five minutes after the first failed start, doubling per failure, capped at an hour. */
export function failedStartBackoffMs(failures: number): number {
  return Math.min(5 * 60_000 * 2 ** Math.max(0, failures - 1), 60 * 60_000);
}

/**
 * Passes work from one lease to the next in a single write: `to` is claimed for `owner`
 * before `from` is released, so no reader ever sees neither held. False when another process
 * holds `to` (`from` is released all the same).
 */
export function handOverLease(
  db: Db,
  from: string,
  to: string,
  owner: string,
  now: number,
  leaseMs: number,
): boolean {
  return withWrite(db, () => {
    const claimed = claimLease(db, to, owner, now, leaseMs);
    releaseLease(db, from, owner);
    return claimed;
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
    leaseActive(db, HISTORY_LEASE, now) ||
    leaseActive(db, EMBED_LEASE, now) ||
    // A download ends in a backfill on this store: moving it mid-download would leave the
    // backfill a stale path.
    leaseActive(db, EMBED_DOWNLOAD_LEASE, now) ||
    leaseActive(db, SYNC_LEASE, now) ||
    knowledgeLeaseActive(db, now)
  );
}

/** One lease per knowledge repository being written: `knowledge.lease:<repository path>`. */
export const KNOWLEDGE_LEASE_PREFIX = "knowledge.lease:";

/** The first key after every key with the prefix: the prefix with its last character raised by one. */
const KNOWLEDGE_LEASE_END = "knowledge.lease;";

/** True while a write to any knowledge repository is under way. */
function knowledgeLeaseActive(db: Db, now: number): boolean {
  // A range on the primary key, which a pattern match could not use.
  const keys = db
    .query<{ key: string }, [string, string]>("SELECT key FROM meta WHERE key >= ? AND key < ?")
    .all(KNOWLEDGE_LEASE_PREFIX, KNOWLEDGE_LEASE_END);
  return keys.some((row) => leaseActive(db, row.key, now));
}
