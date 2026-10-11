import { type Redacted, redact } from "../core/redact.ts";
import { refreshStaleness } from "../retrieve/staleness.ts";
import { type Db, withWrite } from "../store/db.ts";
import { claimDrain, releaseDrain } from "../store/meta.ts";
import { clip } from "../util/text.ts";
import { type DistillDeps, distillTurn, type QueuedTurn } from "./pipeline.ts";

export type { DistillDeps } from "./pipeline.ts";

const MAX_ATTEMPTS = 3;
/** Long enough for one turn's judgments; short enough that a dead process is soon replaced. */
const TURN_LEASE_MS = 60_000;
const DRAIN_LEASE_MS = 120_000;
const HOOK_RUNS_KEPT = 2000;

export interface DrainReport {
  claimed: number;
  done: number;
  skipped: number;
  failed: number;
}

interface ClaimRow {
  id: number;
  sessionId: number;
  projectId: number;
  agent: string;
  cwd: string;
  agentTurnId: string | null;
  prompt: string;
  finalText: string | null;
  transcriptPath: string | null;
  branch: string | null;
  commit: string | null;
  attempts: number;
  origin: "live" | "history";
  endedAt: number | null;
}

/**
 * Takes the oldest turn that is waiting, or whose previous worker went silent. A turn
 * abandoned too many times is given up on here, so that it cannot block the queue.
 */
function claimNextTurn(db: Db, owner: string, now: number): QueuedTurn | null {
  return withWrite(db, () => {
    for (;;) {
      const row = db
        .query<ClaimRow, [number]>(
          `SELECT t.id, t.session_id AS sessionId, t.project_id AS projectId, s.agent, s.cwd,
                  t.agent_turn_id AS agentTurnId,
                  t.prompt, t.final_text AS finalText, t.transcript_path AS transcriptPath,
                  t.branch, t.commit_sha AS "commit", t.attempts,
                  t.origin, t.ended_at AS endedAt
             FROM turns t JOIN sessions s ON s.id = t.session_id
            WHERE t.state = 'pending' OR (t.state = 'processing' AND t.lease_until < ?)
            ORDER BY t.origin = 'history', t.id LIMIT 1`,
        )
        .get(now);
      if (row === null) return null;
      if (row.attempts >= MAX_ATTEMPTS) {
        db.run(
          "UPDATE turns SET state = 'failed', lease_owner = NULL, lease_until = NULL, last_error = COALESCE(last_error, 'abandoned by its worker') WHERE id = ?",
          [row.id],
        );
        continue;
      }
      db.run(
        "UPDATE turns SET state = 'processing', attempts = attempts + 1, lease_owner = ?, lease_until = ? WHERE id = ?",
        [owner, now + TURN_LEASE_MS, row.id],
      );
      return {
        ...row,
        prompt: row.prompt as Redacted,
        finalText: row.finalText as Redacted | null,
        attempts: row.attempts + 1,
      };
    }
  });
}

/** Puts a turn whose distillation threw back in the queue, or gives up on it. */
function releaseTurn(db: Db, turn: QueuedTurn, error: unknown): "retry" | "failed" {
  const outcome = turn.attempts >= MAX_ATTEMPTS ? "failed" : "retry";
  const name = error instanceof Error ? error.name : "Error";
  const message = error instanceof Error ? error.message : String(error);
  db.run(
    "UPDATE turns SET state = ?, lease_owner = NULL, lease_until = NULL, last_error = ? WHERE id = ?",
    [
      outcome === "failed" ? "failed" : "pending",
      clip(redact(`${name}: ${message.replace(/\s+/g, " ")}`), 300, "…"),
      turn.id,
    ],
  );
  return outcome;
}

/**
 * Distils queued turns until the queue is empty or a limit is reached. Only one
 * process drains at a time; a second one returns at once with an empty report.
 */
export async function drainQueue(
  deps: DistillDeps,
  options: { owner: string; maxTurns: number; maxMs: number },
): Promise<DrainReport> {
  const { db } = deps;
  const report: DrainReport = { claimed: 0, done: 0, skipped: 0, failed: 0 };
  if (!claimDrain(db, options.owner, deps.now(), DRAIN_LEASE_MS)) return report;

  const started = performance.now();
  const projects = new Set<number>();
  try {
    while (report.claimed < options.maxTurns && performance.now() - started < options.maxMs) {
      const turn = claimNextTurn(db, options.owner, deps.now());
      if (turn === null) break;
      report.claimed++;
      projects.add(turn.projectId);
      claimDrain(db, options.owner, deps.now(), DRAIN_LEASE_MS);
      try {
        report[await distillTurn(deps, turn)]++;
      } catch (error) {
        if (releaseTurn(db, turn, error) === "failed") report.failed++;
      }
    }
    // Upkeep rides along with the drain, so no hook ever pays for it.
    for (const projectId of projects) refreshStaleness(db, projectId);
    db.run("DELETE FROM hook_runs WHERE id <= (SELECT max(id) - ? FROM hook_runs)", [
      HOOK_RUNS_KEPT,
    ]);
  } finally {
    releaseDrain(db, options.owner);
  }
  return report;
}
