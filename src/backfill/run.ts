import {
  listClaudeCodeTranscripts,
  readClaudeCodeHistory,
} from "../adapters/claude-code/history.ts";
import { listCodexTranscripts, readCodexHistory } from "../adapters/codex/history.ts";
import { ADAPTERS } from "../adapters/index.ts";
import type { ProjectRef } from "../core/project.ts";
import { drainQueue } from "../distill/queue.ts";
import type { Model } from "../embed/model.ts";
import type { Judge } from "../judge/types.ts";
import type { Db } from "../store/db.ts";
import { enqueueHistory } from "./enqueue.ts";
import { projectsReadyForReplacement } from "./replace.ts";

const DAY = 86_400_000;
const BATCH = 50;
/** How long to wait, each time, for another process's drain to let go. */
const HELD_WAIT_MS = 2000;

export interface BackfillReport {
  transcripts: number;
  queued: number;
  known: number;
  skipped: number;
  skippedBy: { window: number; host: number; disabled: number; unresolved: number };
  distilled: number;
  /** Projects whose history is done; `history replace-imports` acts on them. */
  ready: number;
  /** History turns still waiting; a later run continues with them. */
  remaining: number;
  /** True when the run ended waiting for another process's drain, not for want of turns. */
  drainHeld: boolean;
}

/** The line `history import` prints. */
export function backfillLine(report: BackfillReport): string {
  const remaining =
    report.drainHeld && report.remaining > 0
      ? `${report.remaining} remaining because another process was distilling; run it again to continue`
      : `${report.remaining} remaining`;
  return `history: ${report.transcripts} transcripts, ${report.queued} queued, ${report.known} known, ${report.skipped} skipped (window ${report.skippedBy.window}, host ${report.skippedBy.host}, disabled ${report.skippedBy.disabled}, unresolved ${report.skippedBy.unresolved}), ${report.distilled} distilled, ${remaining}, ${report.ready} projects ready for replace-imports\n`;
}

const READERS = {
  "claude-code": {
    list: listClaudeCodeTranscripts,
    read: readClaudeCodeHistory,
    root: "claudeCode",
  },
  codex: { list: listCodexTranscripts, read: readCodexHistory, root: "codex" },
} as const;

/**
 * Reads the agents' transcripts from the last `days`, queues their finished turns,
 * distils for at most `maxMs`, then counts the projects whose history is done. It never
 * archives anything: replacing imports is a separate, explicit step. Idempotent: running
 * it again continues where it stopped.
 */
export async function runBackfill(
  deps: {
    db: Db;
    judge: Judge;
    now: () => number;
    roots: { claudeCode: string; codex: string };
    /**
     * The semantic model, when present: history memories get their vector as they are written.
     * A getter is asked once per batch, so a model that arrives mid-run (a download that finishes
     * after the import started) is used from the next batch on.
     */
    model?: Model | null | (() => Model | null);
    /** Waits while another process holds the drain; Bun.sleep by default. */
    sleep?: (ms: number) => Promise<void>;
  },
  options: {
    days: number;
    maxMs: number;
    agents: (keyof typeof READERS)[];
    /** Called between transcripts and batches, so a caller can renew its lease. */
    onProgress?: () => void;
  },
): Promise<BackfillReport> {
  const started = deps.now();
  const sinceMs = started - options.days * DAY;
  const report: BackfillReport = {
    transcripts: 0,
    queued: 0,
    known: 0,
    skipped: 0,
    skippedBy: { window: 0, host: 0, disabled: 0, unresolved: 0 },
    distilled: 0,
    ready: 0,
    remaining: 0,
    drainHeld: false,
  };
  const sleep = deps.sleep ?? ((ms: number) => Bun.sleep(ms));

  // One map for the whole run: each working directory is resolved (git) once.
  const projects = new Map<string, ProjectRef>();
  for (const agent of options.agents) {
    const reader = READERS[agent];
    for (const path of reader.list(deps.roots[reader.root], sinceMs)) {
      report.transcripts++;
      options.onProgress?.();
      const queued = enqueueHistory(deps.db, reader.read(path), {
        sinceMs,
        now: deps.now(),
        projects,
      });
      report.queued += queued.queued;
      report.known += queued.known;
      report.skipped += queued.skipped;
      for (const reason of Object.keys(queued.skippedBy) as (keyof typeof queued.skippedBy)[]) {
        report.skippedBy[reason] += queued.skippedBy[reason];
      }
    }
  }

  const owner = `history-${process.pid}-${crypto.randomUUID()}`;
  while (deps.now() - started < options.maxMs) {
    options.onProgress?.();
    const drained = await drainQueue(
      {
        db: deps.db,
        judge: deps.judge,
        adapters: ADAPTERS,
        now: deps.now,
        model: typeof deps.model === "function" ? deps.model() : (deps.model ?? null),
      },
      { owner, maxTurns: BATCH, maxMs: Math.max(1000, options.maxMs - (deps.now() - started)) },
    );
    report.distilled += drained.done + drained.skipped;
    report.drainHeld = drained.held;
    if (drained.held) {
      // Another process is draining the same queue, history turns included: wait for it to
      // let go, within this run's time, rather than give up on the turns it has not reached.
      const left = options.maxMs - (deps.now() - started);
      if (left <= 0) break;
      await sleep(Math.min(HELD_WAIT_MS, left));
      continue;
    }
    // Nothing claimed: the queue is empty.
    if (drained.claimed === 0) break;
  }

  report.ready = projectsReadyForReplacement(deps.db).length;
  report.remaining =
    deps.db
      .query<{ n: number }, []>(
        "SELECT count(*) AS n FROM turns WHERE origin = 'history' AND state IN ('pending','processing')",
      )
      .get()?.n ?? 0;
  return report;
}
