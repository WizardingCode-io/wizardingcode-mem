import { rmSync } from "node:fs";
import type { Db } from "../store/db.ts";
import { claimLease, HISTORY_LEASE, releaseLease, setMeta } from "../store/meta.ts";
import { logError } from "../util/log.ts";
import { historyDbPath } from "./path.ts";
import { RUN_FINISHED_AT, RUN_REPORT, RUN_STARTED_AT, RUN_STATE } from "./status.ts";

const LEASE_MS = 120_000;
const RENEW_EVERY_MS = 30_000;

/**
 * Runs `work` as the one history run: it holds `history.lease` (renewed while it works),
 * records `running`, then `done` with the report, or `failed`. Returns null, without
 * running, when another live run holds the lease. `renew` is for the work's own loops;
 * a timer renews too, for the stretches where it awaits.
 */
export async function withHistoryRun<T extends object>(
  db: Db,
  now: () => number,
  work: (renew: () => void) => Promise<T> | T,
): Promise<{ report: T } | null> {
  const owner = `${process.pid}-${crypto.randomUUID()}`;
  if (!claimLease(db, HISTORY_LEASE, owner, now(), LEASE_MS)) return null;
  const renew = () => {
    try {
      claimLease(db, HISTORY_LEASE, owner, now(), LEASE_MS);
    } catch (error) {
      logError("history-lease", error);
    }
  };
  const timer = setInterval(renew, RENEW_EVERY_MS);
  timer.unref?.();
  setMeta(db, RUN_STATE, "running");
  setMeta(db, RUN_STARTED_AT, String(now()));
  try {
    const report = await work(renew);
    setMeta(db, RUN_REPORT, JSON.stringify(report));
    setMeta(db, RUN_STATE, "done");
    return { report };
  } catch (error) {
    setMeta(
      db,
      RUN_REPORT,
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
    );
    setMeta(db, RUN_STATE, "failed");
    throw error;
  } finally {
    clearInterval(timer);
    setMeta(db, RUN_FINISHED_AT, String(now()));
    releaseLease(db, HISTORY_LEASE, owner);
  }
}

/** Deletes the history index and its sidecars. */
export function forgetHistoryIndex(storeDir: string): void {
  const path = historyDbPath(storeDir);
  for (const suffix of ["", "-wal", "-shm"]) rmSync(path + suffix, { force: true });
}
