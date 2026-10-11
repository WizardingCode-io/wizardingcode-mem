import { statSync } from "node:fs";
import { DEFAULTS } from "../settings/settings.ts";
import { type Db, withWrite } from "./db.ts";
import { anyLeaseActive } from "./meta.ts";

// Keeps the database to what still serves a purpose. Memories are never touched here:
// what to keep or archive is the user's call, in the viewer. What goes is the record of
// how they came to be, once it is old: turns no memory points at, sessions left empty,
// the long tail of hook timings. Turns read back from history stay while they are inside
// the history window: they are what tells a later import that they are already known.

export const RETENTION_DAYS = 90;
export const KEEP_HOOK_RUNS = 5000;
export const HISTORY_DAYS = DEFAULTS.historyDays;
const DAY_MS = 86_400_000;
const FINISHED = "('done', 'skipped', 'failed')";

export interface CompactReport {
  turns: number;
  sessions: number;
  hookRuns: number;
  bytesBefore: number;
  bytesAfter: number;
  dryRun: boolean;
}

export interface CompactOptions {
  now: number;
  dryRun?: boolean;
  /** Reclaim the space in the file afterwards; needs a moment of exclusive access. */
  vacuum?: boolean;
  retentionDays?: number;
  /** How far back `history import` reads; history turns this recent are kept. */
  historyDays?: number;
}

/** Background work (a history run, a drain, a backup) holds the database: compact waits. */
export class CompactBusyError extends Error {
  constructor() {
    super("background work is running (a history run, a drain or a backup); compact when it ends");
  }
}

function fileSize(db: Db): number {
  const file = db.filename;
  try {
    return file === "" || file === ":memory:" ? 0 : statSync(file).size;
  } catch {
    return 0;
  }
}

export function compact(db: Db, options: CompactOptions): CompactReport {
  const cutoff = options.now - (options.retentionDays ?? RETENTION_DAYS) * DAY_MS;
  const historyCutoff = options.now - (options.historyDays ?? HISTORY_DAYS) * DAY_MS;
  const dryRun = options.dryRun === true;
  // The deletes and the VACUUM hold the write lock for seconds: not under a running job.
  if (!dryRun && anyLeaseActive(db, options.now)) throw new CompactBusyError();
  const n = (sql: string, params: (number | string)[]) =>
    db.query<{ n: number }, (number | string)[]>(sql).get(...params)?.n ?? 0;

  const goes = `t.state IN ${FINISHED} AND t.started_at < ?
     AND NOT (t.origin = 'history' AND t.started_at >= ?)
     AND NOT EXISTS (SELECT 1 FROM memories m WHERE m.source_turn_id = t.id)`;
  const turnParams = [cutoff, historyCutoff];
  const oldTurns = `FROM turns t WHERE ${goes}`;
  // A session goes when nothing of it stays: no turn that is kept, and not seen lately.
  const emptySessions = `FROM sessions s WHERE s.last_seen_at < ?
     AND NOT EXISTS (SELECT 1 FROM turns t WHERE t.session_id = s.id AND NOT (${goes}))`;
  const extraRuns = `FROM hook_runs WHERE id NOT IN (SELECT id FROM hook_runs ORDER BY id DESC LIMIT ?)`;

  const bytesBefore = fileSize(db);
  const report: CompactReport = {
    turns: 0,
    sessions: 0,
    hookRuns: 0,
    bytesBefore,
    bytesAfter: bytesBefore,
    dryRun,
  };

  withWrite(db, () => {
    report.turns = n(`SELECT count(*) AS n ${oldTurns}`, turnParams);
    if (!dryRun) {
      db.run(`DELETE ${oldTurns.replace("FROM turns t", "FROM turns AS t")}`, turnParams);
    }
    // Sessions are counted after their turns went: that is what leaves them empty.
    report.sessions = n(`SELECT count(*) AS n ${emptySessions}`, [cutoff, ...turnParams]);
    if (!dryRun) {
      db.run(`DELETE ${emptySessions.replace("FROM sessions s", "FROM sessions AS s")}`, [
        cutoff,
        ...turnParams,
      ]);
    }
    report.hookRuns = n(`SELECT count(*) AS n ${extraRuns}`, [KEEP_HOOK_RUNS]);
    if (!dryRun) db.run(`DELETE ${extraRuns}`, [KEEP_HOOK_RUNS]);
  });

  if (!dryRun && options.vacuum !== false) {
    db.run("VACUUM");
    // The file itself only shrinks once the log is folded back into it.
    db.run("PRAGMA wal_checkpoint(TRUNCATE)");
    report.bytesAfter = fileSize(db);
  }
  return report;
}
