import { statSync } from "node:fs";
import { KNOWLEDGE_MODULE, KNOWLEDGE_SCHEMA_VERSION } from "../modules/knowledge/migrations.ts";
import { DEFAULTS } from "../settings/settings.ts";
import { type Clock, realClock, realTimers, type Timers } from "../util/clock.ts";
import { type Db, moduleSchemaState, withWrite } from "./db.ts";
import { anyLeaseActive, clearSyncStop, stopSync } from "./meta.ts";

// Keeps the database to what still serves a purpose. Memories are never touched here:
// what to keep or archive is the user's call, in the viewer. What goes is the record of
// how they came to be, once it is old: turns no memory points at, sessions left empty,
// the long tail of hook timings. Turns read back from history stay while they are inside
// the history window: they are what tells a later import that they are already known.
// What a context was shown of the team's knowledge goes once its session or its
// repository is gone: SQLite may give a deleted highest id to a new row, and a row keyed by
// a reused session id would keep that session from being shown those entries.

export const RETENTION_DAYS = 90;
export const KEEP_HOOK_RUNS = 5000;
export const HISTORY_DAYS = DEFAULTS.historyDays;
const DAY_MS = 86_400_000;
const FINISHED = "('done', 'skipped', 'failed')";

export interface CompactReport {
  turns: number;
  sessions: number;
  hookRuns: number;
  /** `knowledge_shown` rows whose session or repository is gone; 0 without the table. */
  knowledgeShown: number;
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
  /** The clock and timers the stop of the sync waits on; the real ones unless a test gives its own. */
  clock?: Clock;
  timers?: Timers;
}

/** Background work (a history run, a drain, a backup) holds the database: compact waits. */
export class CompactBusyError extends Error {
  constructor(detail?: string) {
    super(
      detail ??
        "background work is running (a history run, a drain or a backup); compact when it ends",
    );
  }
}

/** Whether the store has the received table (knowledge v8), whose shown rows are kept. */
function hasReceivedTable(db: Db): boolean {
  return (
    db.query<unknown, []>("SELECT 1 FROM sqlite_master WHERE name = 'knowledge_received'").get() !==
    null
  );
}

/** Whether the store has the tables the shown rows are pruned by: the knowledge module's. */
function hasShownTables(db: Db): boolean {
  const tables = ["knowledge_shown", "knowledge_repos"];
  const n = db
    .query<{ n: number }, string[]>(
      "SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name IN (?, ?)",
    )
    .get(...tables)?.n;
  return n === tables.length;
}

function fileSize(db: Db): number {
  const file = db.filename;
  try {
    return file === "" || file === ":memory:" ? 0 : statSync(file).size;
  } catch {
    return 0;
  }
}

/**
 * Removes old records no memory depends on and gives the space back. The deletes and the
 * VACUUM hold the write lock for seconds: not under a running job, and not under the sync,
 * which is asked to leave through its flag first (ADR 0027; its own busy error when it has
 * not left within 30 s). A dry run reads only and waits for nothing.
 */
export async function compact(db: Db, options: CompactOptions): Promise<CompactReport> {
  if (options.dryRun === true) return compactNow(db, options);
  const left = await stopSync(db, {
    who: "compact",
    clock: options.clock ?? realClock,
    timers: options.timers ?? realTimers,
  });
  try {
    if (!left) {
      throw new CompactBusyError(
        "the sync is running and did not stop within 30 s; run `wizardingcode-mem sync stop` first",
      );
    }
    if (anyLeaseActive(db, options.now)) throw new CompactBusyError();
    return compactNow(db, options);
  } finally {
    clearSyncStop(db);
  }
}

function compactNow(db: Db, options: CompactOptions): CompactReport {
  const cutoff = options.now - (options.retentionDays ?? RETENTION_DAYS) * DAY_MS;
  const historyCutoff = options.now - (options.historyDays ?? HISTORY_DAYS) * DAY_MS;
  const dryRun = options.dryRun === true;
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
  // The shown rows that go: the repository is gone, or the session is gone or about to go.
  // One condition joined by OR, so a row that meets both counts once, and the count taken
  // before the sessions go is the number the delete after them removes.
  // A shown row of repository 0 names a received entry (ADR 0027): it stays while that entry does.
  const hasReceived = hasReceivedTable(db);
  const receivedKept = hasReceived
    ? `AND NOT (k.repo_id = 0 AND EXISTS (SELECT 1 FROM knowledge_received x WHERE x.server_id || '|' || x.uid = k.entry_id))`
    : "";
  const orphanShown = `FROM knowledge_shown AS k
     WHERE (NOT EXISTS (SELECT 1 FROM knowledge_repos r WHERE r.id = k.repo_id) ${receivedKept})
        OR NOT EXISTS (SELECT 1 FROM sessions s WHERE s.id = k.session_id)
        OR k.session_id IN (SELECT s.id ${emptySessions})`;
  const extraRuns = `FROM hook_runs WHERE id NOT IN (SELECT id FROM hook_runs ORDER BY id DESC LIMIT ?)`;

  const bytesBefore = fileSize(db);
  const report: CompactReport = {
    turns: 0,
    sessions: 0,
    hookRuns: 0,
    knowledgeShown: 0,
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
    // The module's rule: a knowledge schema this binary does not know (too new, or behind)
    // is left alone, rows included; the sessions still go.
    const shownTables =
      hasShownTables(db) &&
      moduleSchemaState(db, KNOWLEDGE_MODULE, KNOWLEDGE_SCHEMA_VERSION) === "current";
    if (shownTables) {
      report.knowledgeShown = n(`SELECT count(*) AS n ${orphanShown}`, [cutoff, ...turnParams]);
    }
    if (!dryRun) {
      db.run(`DELETE ${emptySessions.replace("FROM sessions s", "FROM sessions AS s")}`, [
        cutoff,
        ...turnParams,
      ]);
      // In the same transaction as the sessions: no new session can take a freed id first.
      if (shownTables) {
        db.run(`DELETE FROM knowledge_shown WHERE rowid IN (SELECT k.rowid ${orphanShown})`, [
          cutoff,
          ...turnParams,
        ]);
      }
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
