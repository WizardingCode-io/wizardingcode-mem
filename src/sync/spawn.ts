// What the hooks and the viewer call to have the sync running: one statement over
// `sharing_servers` and `meta`, one `process.kill(pid, 0)`, and a detached `sync --auto` when
// there is a server and nothing says no. On a hook path: it imports nothing else of `src/sync/`,
// and every failure fails open (no spawn).
import type { Env } from "../settings/settings.ts";
import type { Db } from "../store/db.ts";
import {
  clearSyncStop,
  failedStartBackoffMs,
  parseFailedStart,
  parseLease,
  parseStopFlag,
  pidOfOwner,
  processAlive,
  SYNC_STOP_STALE_MS,
} from "../store/meta.ts";
import { spawnDetached } from "../util/self.ts";

/** `WIZARDINGCODE_MEM_SYNC=off`: no spawn, and `--auto` exits at once (the tests' switch). */
export const SYNC_SWITCH = "WIZARDINGCODE_MEM_SYNC";

export type StartOutcome =
  | "spawned"
  | "off"
  | "no-schema"
  | "no-server"
  | "running"
  | "stopped"
  | "backoff"
  | "error";

interface Snapshot {
  servers: number;
  lease: string | null;
  stop: string | null;
  failed: string | null;
}

const SNAPSHOT = `SELECT
  (SELECT count(*) FROM sharing_servers WHERE confirmed_at IS NOT NULL AND stopped IS NULL) AS servers,
  (SELECT value FROM meta WHERE key = 'sync.lease') AS lease,
  (SELECT value FROM meta WHERE key = 'sync.stop') AS stop,
  (SELECT value FROM meta WHERE key = 'sync.last_failed_start') AS failed`;

/** Whether the store has the sharing schema, which `sqlite_master` tells once per connection. */
const schemaKnown = new WeakMap<Db, boolean>();
function hasSharingSchema(db: Db): boolean {
  let known = schemaKnown.get(db);
  if (known === undefined) {
    known =
      (db
        .query<{ n: number }, []>(
          "SELECT count(*) AS n FROM sqlite_master WHERE name = 'sharing_servers'",
        )
        .get()?.n ?? 0) > 0;
    schemaKnown.set(db, known);
  }
  return known;
}

/**
 * Spawns `sync --auto` when a confirmed, not stopped server is listed, no live process holds
 * the lease, no stop flag is set (a stale one is cleared) and no young failed-start mark
 * exists. Nothing on a store without the sharing schema. Never throws.
 */
export function startSync(
  db: Db,
  env: Env,
  now: number,
  spawn: (...args: string[]) => void = spawnDetached,
  mode: "--auto" | "--once" = "--auto",
): StartOutcome {
  try {
    if (env[SYNC_SWITCH] === "off") return "off";
    if (!hasSharingSchema(db)) return "no-schema";
    const snapshot = db.query<Snapshot, []>(SNAPSHOT).get();
    if (snapshot === null || snapshot.servers === 0) return "no-server";
    const lease = parseLease(snapshot.lease);
    if (lease !== null && lease.until > now) {
      const pid = pidOfOwner(lease.owner);
      if (pid === null || processAlive(pid)) return "running";
    }
    const stop = parseStopFlag(snapshot.stop);
    if (stop !== null) {
      if (now - stop.at <= SYNC_STOP_STALE_MS) return "stopped";
      clearSyncStop(db);
    }
    // A person's own run (`--once`, the viewer's button) is not held back by a failed start.
    const failed = parseFailedStart(snapshot.failed);
    if (
      mode === "--auto" &&
      failed !== null &&
      now - failed.at < failedStartBackoffMs(failed.failures)
    )
      return "backoff";
    spawn("sync", mode);
    return "spawned";
  } catch {
    return "error";
  }
}
