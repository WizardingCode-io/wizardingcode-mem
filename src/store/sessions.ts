import type { AgentId } from "../core/types.ts";
import type { Db } from "./db.ts";

export interface Session {
  id: number;
  /** The project the session started in. */
  projectId: number;
  contextEpoch: number;
}

/** Creates the session on first sight; afterwards records that it is still alive. */
export function touchSession(
  db: Db,
  session: {
    agent: AgentId;
    agentSessionId: string;
    projectId: number;
    cwd: string;
    branch: string | null;
    now: number;
  },
): Session {
  const row = db
    .query<Session, [string, string, number, string, string | null, number, number]>(
      `INSERT INTO sessions (agent, agent_session_id, project_id, cwd, branch, started_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (agent, agent_session_id) DO UPDATE SET
         last_seen_at = excluded.last_seen_at, cwd = excluded.cwd, branch = excluded.branch, ended_at = NULL
       RETURNING id, project_id AS projectId, context_epoch AS contextEpoch`,
    )
    .get(
      session.agent,
      session.agentSessionId,
      session.projectId,
      session.cwd,
      session.branch,
      session.now,
      session.now,
    );
  if (row === null) throw new Error("session upsert returned no row");
  return row;
}

/**
 * A session seen in an agent's history: created as it was then (started, last seen and
 * ended with the turn), or returned unchanged if it is already known. History never
 * moves a session's clock, so it cannot rewind a live one.
 */
export function ensureSession(
  db: Db,
  session: {
    agent: AgentId;
    agentSessionId: string;
    projectId: number;
    cwd: string;
    branch: string | null;
    startedAt: number;
    endedAt: number;
  },
): Session {
  db.run(
    `INSERT INTO sessions (agent, agent_session_id, project_id, cwd, branch, started_at, last_seen_at, ended_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (agent, agent_session_id) DO NOTHING`,
    [
      session.agent,
      session.agentSessionId,
      session.projectId,
      session.cwd,
      session.branch,
      session.startedAt,
      session.endedAt,
      session.endedAt,
    ],
  );
  const row = db
    .query<Session, [string, string]>(
      `SELECT id, project_id AS projectId, context_epoch AS contextEpoch
         FROM sessions WHERE agent = ? AND agent_session_id = ?`,
    )
    .get(session.agent, session.agentSessionId);
  if (row === null) throw new Error("session lookup returned no row");
  return row;
}

export function endSession(db: Db, sessionId: number, now: number): void {
  db.run("UPDATE sessions SET ended_at = ? WHERE id = ?", [now, sessionId]);
}

/** The host wiped its context: whatever was injected before is no longer in front of the model. */
export function advanceEpoch(db: Db, sessionId: number): number {
  const row = db
    .query<{ contextEpoch: number }, [number]>(
      "UPDATE sessions SET context_epoch = context_epoch + 1 WHERE id = ? RETURNING context_epoch AS contextEpoch",
    )
    .get(sessionId);
  return row?.contextEpoch ?? 0;
}
