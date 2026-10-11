import { statSync } from "node:fs";
import { listClaudeCodeTranscripts } from "../adapters/claude-code/history.ts";
import { listCodexTranscripts } from "../adapters/codex/history.ts";
import { previewReplaceImports, projectsReadyForReplacement } from "../backfill/replace.ts";
import type { Db } from "../store/db.ts";
import { getMeta, HISTORY_LEASE, leaseActive } from "../store/meta.ts";
import { openHistoryDb } from "./db.ts";
import { historyDbPath } from "./path.ts";

export { HISTORY_LEASE };
export const RUN_STATE = "history.run.state";
export const RUN_STARTED_AT = "history.run.started_at";
export const RUN_FINISHED_AT = "history.run.finished_at";
export const RUN_REPORT = "history.run.report";
export const HISTORY_OFFER_DISMISSED = "history.offer.dismissed";

export interface HistoryStatus {
  transcripts: { claudeCode: number; codex: number };
  run: {
    state: "never" | "running" | "done" | "failed";
    startedAt: number | null;
    finishedAt: number | null;
    last: unknown | null;
  };
  queue: { pending: number; done: number; skipped: number; failed: number };
  index: { exists: boolean; files: number; turns: number; bytes: number };
  replace: { projectsReady: number; wouldArchive: number; replaced: number };
  offer: { dismissed: boolean };
}

const number = (raw: string | null): number | null => {
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
};

function runStatus(db: Db, now: number): HistoryStatus["run"] {
  const raw = getMeta(db, RUN_STATE);
  const known = raw === "running" || raw === "done" || raw === "failed";
  // A run that says it is running while no live process holds the lease died on the way.
  const state = !known
    ? "never"
    : raw === "running" && !leaseActive(db, HISTORY_LEASE, now)
      ? "failed"
      : raw;
  let last: unknown | null = null;
  const report = getMeta(db, RUN_REPORT);
  if (report !== null) {
    try {
      last = JSON.parse(report);
    } catch {
      // A report that does not parse is no report.
    }
  }
  return {
    state,
    startedAt: number(getMeta(db, RUN_STARTED_AT)),
    finishedAt: number(getMeta(db, RUN_FINISHED_AT)),
    last,
  };
}

function indexStatus(storeDir: string): HistoryStatus["index"] {
  const none = { exists: false, files: 0, turns: 0, bytes: 0 };
  let hdb: ReturnType<typeof openHistoryDb> = null;
  try {
    hdb = openHistoryDb(storeDir, { create: false });
    if (hdb === null) return none;
    const count = (table: string) =>
      hdb?.query<{ n: number }, []>(`SELECT count(*) AS n FROM ${table}`).get()?.n ?? 0;
    return {
      exists: true,
      files: count("files"),
      turns: count("turns"),
      bytes: statSync(historyDbPath(storeDir)).size,
    };
  } catch {
    // Unreadable (being rebuilt, or damaged): report no index rather than fail the status.
    return none;
  } finally {
    hdb?.close();
  }
}

export function queueStatus(db: Db): HistoryStatus["queue"] {
  const queue = { pending: 0, done: 0, skipped: 0, failed: 0 };
  for (const row of db
    .query<{ state: string; n: number }, []>(
      "SELECT state, count(*) AS n FROM turns WHERE origin = 'history' GROUP BY state",
    )
    .all()) {
    if (row.state === "done") queue.done += row.n;
    else if (row.state === "skipped") queue.skipped += row.n;
    else if (row.state === "failed") queue.failed += row.n;
    else queue.pending += row.n;
  }
  return queue;
}

/** The light view the viewer polls while a run goes: no transcript walk, no index open. */
export function historyProgress(db: Db, now: number): Pick<HistoryStatus, "run" | "queue"> {
  return { run: runStatus(db, now), queue: queueStatus(db) };
}

/** One view of the history import for `status`, the viewer and the install prompt. */
export function historyStatus(
  db: Db,
  storeDir: string,
  roots: { claudeCode: string; codex: string },
  now: number,
): HistoryStatus {
  const queue = queueStatus(db);
  return {
    transcripts: {
      claudeCode: listClaudeCodeTranscripts(roots.claudeCode, 0).length,
      codex: listCodexTranscripts(roots.codex, 0).length,
    },
    run: runStatus(db, now),
    queue,
    index: indexStatus(storeDir),
    replace: {
      projectsReady: projectsReadyForReplacement(db).length,
      wouldArchive: previewReplaceImports(db),
      replaced:
        db.query<{ n: number }, []>("SELECT count(*) AS n FROM history_replacements").get()?.n ?? 0,
    },
    offer: { dismissed: getMeta(db, HISTORY_OFFER_DISMISSED) !== null },
  };
}
