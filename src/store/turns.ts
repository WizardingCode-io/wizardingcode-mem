import type { Redacted } from "../core/redact.ts";
import type { Db } from "./db.ts";

export interface TurnContext {
  sessionId: number;
  projectId: number;
  /** The host's id for the prompt, when it has one. */
  agentTurnId: string | null;
  transcriptPath: string | null;
  branch: string | null;
  commit: string | null;
  now: number;
}

function insertTurn(
  db: Db,
  turn: TurnContext,
  fields: {
    state: "open" | "pending";
    completeness: "full" | "payload-only";
    prompt: Redacted;
    finalText: Redacted | null;
  },
): number {
  const row = db
    .query<{ id: number }, (string | number | null)[]>(
      `INSERT INTO turns (session_id, project_id, seq, agent_turn_id, state, completeness, prompt, final_text,
                          transcript_path, branch, commit_sha, started_at, ended_at)
       VALUES (?, ?, (SELECT COALESCE(MAX(seq), 0) + 1 FROM turns WHERE session_id = ?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING id`,
    )
    .get(
      turn.sessionId,
      turn.projectId,
      turn.sessionId,
      turn.agentTurnId,
      fields.state,
      fields.completeness,
      fields.prompt,
      fields.finalText,
      turn.transcriptPath,
      turn.branch,
      turn.commit,
      turn.now,
      fields.state === "pending" ? turn.now : null,
    );
  if (row === null) throw new Error("turn insert returned no row");
  return row.id;
}

/** Opens the turn a prompt starts. Delivering the same prompt twice opens it once. */
export function openTurn(db: Db, turn: TurnContext, prompt: Redacted): number {
  if (turn.agentTurnId !== null) {
    const existing = db
      .query<{ id: number }, [number, string]>(
        "SELECT id FROM turns WHERE session_id = ? AND agent_turn_id = ?",
      )
      .get(turn.sessionId, turn.agentTurnId);
    if (existing !== null) return existing.id;
  }
  return insertTurn(db, turn, {
    state: "open",
    completeness: "full",
    prompt,
    finalText: null,
  });
}

/**
 * Queues every turn of the session that is still open. A turn left open never got its
 * turn-end event: the user interrupted it, or the request failed.
 */
export function interruptOpenTurns(
  db: Db,
  sessionId: number,
  now: number,
  exceptAgentTurnId: string | null = null,
): number {
  return db.run(
    `UPDATE turns SET state = 'pending', completeness = 'interrupted', ended_at = ?
      WHERE session_id = ? AND state = 'open' AND (? IS NULL OR agent_turn_id IS NOT ?)`,
    [now, sessionId, exceptAgentTurnId, exceptAgentTurnId],
  ).changes;
}

/**
 * Queues the turn that just ended, with the assistant's final message. A turn whose
 * prompt was never seen (wizardingcode-mem installed mid-session) is captured from this event alone.
 */
/** Whether the session has a turn still waiting for its end. */
export function hasOpenTurn(db: Db, sessionId: number): boolean {
  return (
    db
      .query<{ one: number }, [number]>(
        "SELECT 1 AS one FROM turns WHERE session_id = ? AND state = 'open' LIMIT 1",
      )
      .get(sessionId) !== null
  );
}

export function completeTurn(db: Db, turn: TurnContext, finalText: Redacted | null): void {
  const target =
    turn.agentTurnId === null
      ? db
          .query<{ id: number; state: string; finalText: string | null }, [number]>(
            "SELECT id, state, final_text AS finalText FROM turns WHERE session_id = ? AND state = 'open' ORDER BY seq DESC LIMIT 1",
          )
          .get(turn.sessionId)
      : db
          .query<{ id: number; state: string; finalText: string | null }, [number, string]>(
            "SELECT id, state, final_text AS finalText FROM turns WHERE session_id = ? AND agent_turn_id = ?",
          )
          .get(turn.sessionId, turn.agentTurnId);

  if (target === null) {
    insertTurn(db, turn, {
      state: "pending",
      completeness: "payload-only",
      prompt: "" as Redacted,
      finalText,
    });
  } else if (target.state === "open" || target.state === "pending") {
    // A turn can end more than once: another hook may send the agent back to work, and
    // a turn-end can arrive after the next prompt. The latest ending is the one to keep.
    // A hook completing the turn proves it live, even if history queued it first.
    db.run(
      `UPDATE turns SET state = 'pending', completeness = 'full', origin = 'live',
                        final_text = COALESCE(?, final_text),
                        ended_at = ?, transcript_path = COALESCE(?, transcript_path)
        WHERE id = ?`,
      [finalText, turn.now, turn.transcriptPath, target.id],
    );
  } else if (
    (target.state === "done" || target.state === "skipped") &&
    finalText !== null &&
    finalText !== target.finalText
  ) {
    // Already distilled from an earlier ending: distil it again from this one.
    db.run(
      `UPDATE turns SET state = 'pending', completeness = 'full', origin = 'live', final_text = ?,
                        ended_at = ?, attempts = 0, last_error = NULL,
                        transcript_path = COALESCE(?, transcript_path)
        WHERE id = ?`,
      [finalText, turn.now, turn.transcriptPath, target.id],
    );
  }
  // Being distilled right now, or given up on: left as it is.
}

/**
 * Queues turns that have been open for longer than any turn runs. Their session died
 * without a session end (a killed terminal, a crash), so nothing else will close them.
 */
export function abandonStaleTurns(db: Db, now: number, olderThanMs: number): number {
  return db.run(
    `UPDATE turns SET state = 'pending', completeness = 'interrupted', ended_at = ?
      WHERE state = 'open' AND started_at < ?`,
    [now, now - olderThanMs],
  ).changes;
}

/** True when there is work for a distiller: a waiting turn, or one whose worker went silent. */
export function hasQueuedTurns(db: Db, now: number): boolean {
  return (
    db
      .query(
        "SELECT 1 FROM turns WHERE state = 'pending' OR (state = 'processing' AND lease_until < ?) LIMIT 1",
      )
      .get(now) !== null
  );
}
