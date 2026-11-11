// Received memories in retrieval (ADR 0027): which of a project's rows are teammates' copies,
// from which server, and whether an agent may see them now, by the retrieval's own SQL over
// the sharing tables. Nothing is read when the tables are absent, so a store that never ran
// the sharing schema retrieves as before, byte for byte.
import { agentName } from "../core/agent-name.ts";
import type { Db } from "../store/db.ts";

/** The share of a brief's budget, and of a prompt's notes, received memories may take, after the person's own. */
export const RECEIVED_SHARE = 1 / 3;

export interface ReceivedMark {
  /** The server's name, for the `(team: <name>)` marker; empty when the server is gone. */
  server: string;
  /** Listed, confirmed and unmuted server, unmuted member, and the project still bound to it. */
  visible: boolean;
}

const tablesKnown = new WeakMap<Db, boolean>();
function hasTables(db: Db): boolean {
  let known = tablesKnown.get(db);
  if (known === undefined) {
    known =
      (db
        .query<{ n: number }, []>(
          `SELECT count(*) AS n FROM sqlite_master
            WHERE name IN ('sharing_received_memories', 'sharing_servers', 'sharing_muted_members', 'sharing_levels')`,
        )
        .get()?.n ?? 0) === 4;
    tablesKnown.set(db, known);
  }
  return known;
}

/**
 * The received memories of a project, by memory id: a row of a muted server or member, of a
 * server with no row, or of a project no longer bound to the server reads as not visible and
 * is left out of every brief and prompt. Empty without the sharing schema.
 */
export function receivedMarks(db: Db, projectId: number): Map<number, ReceivedMark> {
  if (!hasTables(db)) return new Map();
  const rows = db
    .query<{ id: number; server: string; visible: number }, [number]>(
      `SELECT r.memory_id AS id, COALESCE(s.name, '') AS server,
              (s.server_id IS NOT NULL AND s.confirmed_at IS NOT NULL AND s.muted = 0
               AND NOT EXISTS (SELECT 1 FROM sharing_muted_members mm
                                WHERE mm.server_id = r.server_id AND mm.member_id = r.member_id)
               AND EXISTS (SELECT 1 FROM sharing_levels l
                            JOIN project_aliases a ON a.project_id = l.project_id AND a.alias = l.bound_alias
                           WHERE l.destination = r.server_id AND l.level != 'local'
                             AND l.project_id = m.project_id)) AS visible
         FROM sharing_received_memories r
         JOIN memories m ON m.id = r.memory_id
         LEFT JOIN sharing_servers s ON s.server_id = r.server_id
        WHERE m.project_id = ?`,
    )
    .all(projectId);
  return new Map(rows.map((row) => [row.id, { server: row.server, visible: row.visible === 1 }]));
}

/** The origin a received note carries: `team: <server name>`, through the agent-safe rendering. */
export function teamOrigin(mark: ReceivedMark): string {
  return `team: ${agentName(mark.server)}`;
}
