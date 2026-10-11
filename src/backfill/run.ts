import {
  listClaudeCodeTranscripts,
  readClaudeCodeHistory,
} from "../adapters/claude-code/history.ts";
import { listCodexTranscripts, readCodexHistory } from "../adapters/codex/history.ts";
import { ADAPTERS } from "../adapters/index.ts";
import type { ProjectRef } from "../core/project.ts";
import { drainQueue } from "../distill/queue.ts";
import type { Judge } from "../judge/types.ts";
import type { Db } from "../store/db.ts";
import { enqueueHistory } from "./enqueue.ts";
import { projectsReadyForReplacement, replaceImports } from "./replace.ts";

const DAY = 86_400_000;
const BATCH = 50;

export interface BackfillReport {
  transcripts: number;
  queued: number;
  known: number;
  skipped: number;
  skippedBy: { window: number; host: number; disabled: number; unresolved: number };
  distilled: number;
  replaced: number;
  /** History turns still waiting; a later run continues with them. */
  remaining: number;
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
 * distils for at most `maxMs`, then replaces the imports of every project whose history
 * is done. Idempotent: running it again continues where it stopped.
 */
export async function runBackfill(
  deps: { db: Db; judge: Judge; now: () => number; roots: { claudeCode: string; codex: string } },
  options: { days: number; maxMs: number; agents: (keyof typeof READERS)[] },
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
    replaced: 0,
    remaining: 0,
  };

  // One map for the whole run: each working directory is resolved (git) once.
  const projects = new Map<string, ProjectRef>();
  for (const agent of options.agents) {
    const reader = READERS[agent];
    for (const path of reader.list(deps.roots[reader.root], sinceMs)) {
      report.transcripts++;
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
    const drained = await drainQueue(
      { db: deps.db, judge: deps.judge, adapters: ADAPTERS, now: deps.now },
      { owner, maxTurns: BATCH, maxMs: Math.max(1000, options.maxMs - (deps.now() - started)) },
    );
    report.distilled += drained.done + drained.skipped;
    // Nothing claimed: the queue is empty, or another process holds the drain; either way a later run continues.
    if (drained.claimed === 0) break;
  }

  for (const projectId of projectsReadyForReplacement(deps.db)) {
    report.replaced += replaceImports(deps.db, projectId, { now: deps.now() });
  }
  report.remaining =
    deps.db
      .query<{ n: number }, []>(
        "SELECT count(*) AS n FROM turns WHERE origin = 'history' AND state IN ('pending','processing')",
      )
      .get()?.n ?? 0;
  return report;
}
