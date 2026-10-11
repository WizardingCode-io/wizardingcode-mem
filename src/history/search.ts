import type { Database } from "bun:sqlite";
import { explicitMatch } from "../retrieve/query.ts";

export interface HistoryHit {
  project: string;
  agent: string;
  sessionId: string;
  endedAt: number;
  prompt: string;
  answer: string | null;
}

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;
const CLIP = 600;

/** Best matches first. `projectId` or `projectName` limits to one project. */
export function searchHistory(
  hdb: Database,
  args: { query: string; projectId?: number; projectName?: string; limit?: number },
): HistoryHit[] {
  const match = explicitMatch(args.query);
  if (match === null) return [];
  const limit = Math.min(MAX_LIMIT, Math.max(1, Math.trunc(args.limit ?? DEFAULT_LIMIT)));
  const id = args.projectId ?? null;
  const name = args.projectName ?? null;
  return hdb
    .query<
      HistoryHit,
      [string, number | null, number | null, string | null, string | null, number]
    >(
      `SELECT t.project_name AS project, t.agent, t.session_id AS sessionId, t.ended_at AS endedAt,
              t.prompt, t.final_text AS answer
         FROM turns_fts JOIN turns t ON t.id = turns_fts.rowid
        WHERE turns_fts MATCH ? AND (? IS NULL OR t.project_id = ?) AND (? IS NULL OR t.project_name = ?)
        ORDER BY bm25(turns_fts), t.ended_at DESC
        LIMIT ?`,
    )
    .all(match, id, id, name, name, limit);
}

const clip = (text: string) => (text.length > CLIP ? `${text.slice(0, CLIP)}…` : text);

/** Hits as plain text for a person or a model: one block per turn, text clipped per side. */
export function renderHits(hits: HistoryHit[]): string {
  return hits
    .map((hit) => {
      const date = new Date(hit.endedAt).toISOString().slice(0, 10);
      const answer = hit.answer === null ? "" : `\nanswer: ${clip(hit.answer)}`;
      return `[${date}] ${hit.project} (${hit.agent}, session ${hit.sessionId})\nprompt: ${clip(hit.prompt)}${answer}`;
    })
    .join("\n\n");
}
