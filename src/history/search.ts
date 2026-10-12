import type { Database } from "bun:sqlite";
import type { Model } from "../embed/model.ts";
import { explicitMatch } from "../retrieve/query.ts";
import { fuseRanks, SEMANTIC_POOL } from "../retrieve/semantic.ts";
import { semanticTurns } from "./vectors.ts";

export interface HistoryHit {
  /** The turn's row in the index: stable until the index is rebuilt. */
  id: number;
  project: string;
  agent: string;
  sessionId: string;
  cwd: string;
  startedAt: number;
  endedAt: number;
  prompt: string;
  answer: string | null;
}

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;
const RECENT_LIMIT = 50;
const RECENT_MAX = 100;
const CLIP = 600;

const COLUMNS = `t.id, t.project_name AS project, t.agent, t.session_id AS sessionId, t.cwd,
              t.started_at AS startedAt, t.ended_at AS endedAt, t.prompt, t.final_text AS answer`;

/**
 * Best matches first. `projectId` or `projectName` limits to one project. With a `model`, the
 * ranking by words is fused (RRF) with the ranking by meaning, which also brings in turns
 * that share no word with the query; without one, the result is the words' alone.
 */
export function searchHistory(
  hdb: Database,
  args: {
    query: string;
    projectId?: number;
    projectName?: string;
    limit?: number;
    model?: Model | null;
  },
): HistoryHit[] {
  const model = args.model ?? null;
  const match = explicitMatch(args.query);
  if (match === null && model === null) return [];
  const limit = Math.min(MAX_LIMIT, Math.max(1, Math.trunc(args.limit ?? DEFAULT_LIMIT)));
  const id = args.projectId ?? null;
  const name = args.projectName ?? null;
  const lexical = (n: number): HistoryHit[] =>
    match === null
      ? []
      : hdb
          .query<
            HistoryHit,
            [string, number | null, number | null, string | null, string | null, number]
          >(
            `SELECT ${COLUMNS}
               FROM turns_fts JOIN turns t ON t.id = turns_fts.rowid
              WHERE turns_fts MATCH ? AND (? IS NULL OR t.project_id = ?) AND (? IS NULL OR t.project_name = ?)
              ORDER BY bm25(turns_fts), t.ended_at DESC
              LIMIT ?`,
          )
          .all(match, id, id, name, name, n);
  if (model === null) return lexical(limit);
  // A project name is not in the vector index: take a wider pool, then keep that project's.
  const pool = name === null ? SEMANTIC_POOL : SEMANTIC_POOL * 10;
  let meaning = semanticTurns(hdb, model, args.query, { projectId: id, limit: pool }).map(
    (hit) => hit.id,
  );
  if (meaning.length === 0) return lexical(limit);
  if (name !== null) {
    const ofProject = new Set(
      hdb
        .query<{ id: number }, [string, string]>(
          "SELECT id FROM turns WHERE project_name = ? AND id IN (SELECT value FROM json_each(?))",
        )
        .all(name, JSON.stringify(meaning))
        .map((row) => row.id),
    );
    meaning = meaning.filter((turn) => ofProject.has(turn)).slice(0, SEMANTIC_POOL);
  }
  const words = lexical(Math.max(limit, SEMANTIC_POOL));
  const byId = new Map(words.map((hit) => [hit.id, hit]));
  const order = fuseRanks([words.map((hit) => hit.id), meaning]).slice(0, limit);
  const missing = order.filter((turn) => !byId.has(turn));
  if (missing.length > 0) {
    const rows = hdb
      .query<HistoryHit, [string]>(
        `SELECT ${COLUMNS} FROM turns t WHERE t.id IN (SELECT value FROM json_each(?))`,
      )
      .all(JSON.stringify(missing));
    for (const row of rows) byId.set(row.id, row);
  }
  return order.flatMap((turn) => byId.get(turn) ?? []);
}

/** The latest turns, newest first: what a viewer shows before anything is searched for. */
export function recentHistory(
  hdb: Database,
  args: { projectId?: number; limit?: number },
): HistoryHit[] {
  const limit = Math.min(RECENT_MAX, Math.max(1, Math.trunc(args.limit ?? RECENT_LIMIT)));
  const id = args.projectId ?? null;
  return hdb
    .query<HistoryHit, [number | null, number | null, number]>(
      `SELECT ${COLUMNS} FROM turns t
        WHERE (? IS NULL OR t.project_id = ?)
        ORDER BY t.ended_at DESC, t.id DESC
        LIMIT ?`,
    )
    .all(id, id, limit);
}

const clip = (text: string) => (text.length > CLIP ? `${text.slice(0, CLIP)}…` : text);

/** Hits as plain text for a person or a model: one block per turn, text clipped per side. */
export function renderHits(
  hits: Pick<HistoryHit, "project" | "agent" | "sessionId" | "endedAt" | "prompt" | "answer">[],
): string {
  return hits
    .map((hit) => {
      const date = new Date(hit.endedAt).toISOString().slice(0, 10);
      const answer = hit.answer === null ? "" : `\nanswer: ${clip(hit.answer)}`;
      return `[${date}] ${hit.project} (${hit.agent}, session ${hit.sessionId})\nprompt: ${clip(hit.prompt)}${answer}`;
    })
    .join("\n\n");
}

/**
 * What to tell a person or a model when the index could not be opened or read: busy is
 * passing; anything else (a damaged or foreign file) needs a rebuild.
 */
export function historyReadFailure(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && code.startsWith("SQLITE_BUSY")
    ? "The history index is busy; try again in a moment."
    : "The history index could not be read. The user can rebuild it: wizardingcode-mem history forget, then wizardingcode-mem history index";
}
