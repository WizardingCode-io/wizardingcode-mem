import { rmSync } from "node:fs";
import type { Db } from "../store/db.ts";
import { claimLease, HISTORY_LEASE, releaseLease, setMeta } from "../store/meta.ts";
import { logError } from "../util/log.ts";
import { historyDbPath } from "./path.ts";
import {
  IMPORT_FINISHED_AT,
  IMPORT_STARTED_AT,
  IMPORT_STATE,
  RUN_FINISHED_AT,
  RUN_KIND,
  RUN_REPORT,
  RUN_STARTED_AT,
  RUN_STATE,
  type RunKind,
} from "./status.ts";

const LEASE_MS = 120_000;
const RENEW_EVERY_MS = 30_000;
/** The work may call `renew` per turn: the lease is written at most this often. */
const RENEW_THROTTLE_MS = 10_000;

const isBusy = (error: unknown): boolean =>
  error instanceof Error &&
  ((error as { code?: unknown }).code === "SQLITE_BUSY" ||
    /database is locked/i.test(error.message));

/**
 * Runs `work` as the one history run: it holds `history.lease` (renewed while it works),
 * records `running` and its `kind`, then `done` with the report, or `failed`. An import
 * also records its state under `history.import.*`, which an index run leaves alone. Returns null, without
 * running, when another live run holds the lease. `renew` is for the work's own loops
 * (at most one write every ten seconds); a timer renews too, for the stretches where it
 * awaits. A renewal that meets a busy database is logged and tried again later: the lease
 * lasts two minutes. Only a lease really held by another owner stops the run.
 */
export async function withHistoryRun<T extends object>(
  db: Db,
  now: () => number,
  kind: RunKind,
  work: (renew: () => void) => Promise<T> | T,
): Promise<{ report: T } | null> {
  const owner = `${process.pid}-${crypto.randomUUID()}`;
  if (!claimLease(db, HISTORY_LEASE, owner, now(), LEASE_MS)) return null;
  let lost = false;
  let renewedAt = now();
  const renew = () => {
    if (lost) throw new Error("history lease lost: another run took over");
    const at = now();
    if (at - renewedAt < RENEW_THROTTLE_MS) return;
    let held: boolean;
    try {
      held = claimLease(db, HISTORY_LEASE, owner, at, LEASE_MS);
    } catch (error) {
      if (!isBusy(error)) throw error;
      logError("history-lease", error);
      return;
    }
    if (!held) {
      lost = true;
      logError("history-lease", new Error("the history lease was taken by another run"));
      throw new Error("history lease lost: another run took over");
    }
    renewedAt = at;
  };
  const timer = setInterval(() => {
    try {
      renew();
    } catch (error) {
      // A lost lease is logged where it is found; the work's next renew() (or its end) stops the run.
      if (!lost) logError("history-lease", error);
    }
  }, RENEW_EVERY_MS);
  timer.unref?.();
  try {
    // A new run starts from a clean slate: `last` never shows the previous one.
    for (const key of [RUN_REPORT, RUN_FINISHED_AT])
      db.run("DELETE FROM meta WHERE key = ?", [key]);
    setMeta(db, RUN_STATE, "running");
    setMeta(db, RUN_KIND, kind);
    setMeta(db, RUN_STARTED_AT, String(now()));
    if (kind === "import") {
      db.run("DELETE FROM meta WHERE key = ?", [IMPORT_FINISHED_AT]);
      setMeta(db, IMPORT_STATE, "running");
      setMeta(db, IMPORT_STARTED_AT, String(now()));
    }
    const report = await work(renew);
    if (lost) throw new Error("history lease lost: another run took over");
    setMeta(db, RUN_REPORT, JSON.stringify(report));
    setMeta(db, RUN_STATE, "done");
    if (kind === "import") setMeta(db, IMPORT_STATE, "done");
    return { report };
  } catch (error) {
    // A run that lost the lease must not overwrite the state of the one that has it.
    if (!lost) {
      try {
        setMeta(
          db,
          RUN_REPORT,
          JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
        );
        setMeta(db, RUN_STATE, "failed");
        if (kind === "import") setMeta(db, IMPORT_STATE, "failed");
      } catch (recording) {
        logError("history-run-state", recording);
      }
    }
    throw error;
  } finally {
    clearInterval(timer);
    if (!lost) {
      try {
        const at = String(now());
        setMeta(db, RUN_FINISHED_AT, at);
        if (kind === "import") setMeta(db, IMPORT_FINISHED_AT, at);
      } catch (recording) {
        logError("history-run-state", recording);
      }
    }
    try {
      releaseLease(db, HISTORY_LEASE, owner);
    } catch (releasing) {
      // Never in place of the run's own outcome; the lease runs out by itself.
      logError("history-lease", releasing);
    }
  }
}

/** Deletes the history index and its sidecars. */
export function forgetHistoryIndex(storeDir: string): void {
  const path = historyDbPath(storeDir);
  for (const suffix of ["", "-wal", "-shm"]) rmSync(path + suffix, { force: true });
}
