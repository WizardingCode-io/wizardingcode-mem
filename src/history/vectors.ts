/**
 * One vector per past turn, kept in history.db (turn_vectors) beside the turns, so that
 * `history forget`, a vanished transcript or a disabled project take them out with the turns
 * (ON DELETE CASCADE). The index is rebuildable, so there is no migration: the table is made
 * with the schema, and in an older file by the first writer that has a model. A vector
 * belongs to the model that made it; rows of another model are ignored in search and
 * rewritten by the fill. Nothing here throws into the index pass.
 */

import type { Database } from "bun:sqlite";
import { quantize } from "../embed/embed.ts";
import type { Model } from "../embed/model.ts";
import { stamp } from "../embed/vectors.ts";
import { type PackedRows, rankPacked, SEMANTIC_FLOOR } from "../retrieve/semantic.ts";
import { logError } from "../util/log.ts";
import { TURN_VECTORS_DDL } from "./db.ts";

/** Past turns embedded per write transaction. */
export const FILL_BATCH = 100;
/** Past turns one index pass fills at most (the rest waits for the next pass). */
export const FILL_MAX = 2000;
/** Turns of its own transcript the session-end path embeds at most. */
export const TRANSCRIPT_EMBED_MAX = 300;

const EMPTY = new Uint8Array(0);

/** The text a turn is embedded from: prompt and final answer, as stored (redacted). */
export const turnText = (prompt: string, finalText: string | null): string =>
  `${prompt}\n${finalText ?? ""}`;

/** Makes the table in an index created before it existed; a no-op when it is there. */
export function ensureTurnVectors(hdb: Database): void {
  const there = hdb
    .query<{ n: number }, []>(
      "SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'turn_vectors'",
    )
    .get();
  if ((there?.n ?? 0) === 0) hdb.run(TURN_VECTORS_DDL);
}

/** The quantized vector of a text; empty (scale 0) when it has no known token. */
export function turnVector(model: Model, text: string): { scale: number; vec: Uint8Array } {
  const v = model.embed(text);
  if (v === null) return { scale: 0, vec: EMPTY };
  const { scale, q } = quantize(v);
  if (scale === 0) return { scale: 0, vec: EMPTY };
  return { scale, vec: new Uint8Array(q.buffer, q.byteOffset, q.byteLength) };
}

const UPSERT = `INSERT INTO turn_vectors (turn_id, model, scale, vec) VALUES (?, ?, ?, ?)
  ON CONFLICT (turn_id) DO UPDATE SET model = excluded.model, scale = excluded.scale, vec = excluded.vec`;

export function putTurnVector(
  hdb: Database,
  model: Model,
  turnId: number,
  vector: { scale: number; vec: Uint8Array },
): void {
  hdb.run(UPSERT, [turnId, model.id, vector.scale, vector.vec]);
}

/**
 * Embeds the turns that have no vector of this model, newest first, in batches of
 * FILL_BATCH (one short write transaction each), up to `max` turns and `deadline`.
 * Returns how many were written. Failures are logged and leave the turns for the next pass.
 */
export function fillTurnVectors(
  hdb: Database,
  model: Model | null,
  options: { max?: number; deadline: number; onProgress?: () => void },
): number {
  if (model === null) return 0;
  let written = 0;
  const max = options.max ?? FILL_MAX;
  try {
    ensureTurnVectors(hdb);
    while (written < max && Date.now() < options.deadline) {
      const batch = hdb
        .query<{ id: number; prompt: string; final_text: string | null }, [string, number]>(
          `SELECT t.id, t.prompt, t.final_text FROM turns t
             LEFT JOIN turn_vectors v ON v.turn_id = t.id
            WHERE v.turn_id IS NULL OR v.model != ?
            ORDER BY t.ended_at DESC, t.id DESC LIMIT ?`,
        )
        .all(model.id, Math.min(FILL_BATCH, max - written));
      if (batch.length === 0) break;
      const vectors = batch.map((row) => ({
        id: row.id,
        vector: turnVector(model, turnText(row.prompt, row.final_text)),
      }));
      hdb
        .transaction(() => {
          for (const { id, vector } of vectors) putTurnVector(hdb, model, id, vector);
        })
        .immediate();
      written += batch.length;
      options.onProgress?.();
    }
  } catch (error) {
    logError("history-vectors", error);
  }
  return written;
}

interface TurnIndex extends PackedRows {
  model: string;
  projects: Int32Array;
}

const indexes = new WeakMap<Database, { index: TurnIndex; version: number; changes: number }>();

/** Every turn's vector of one model, packed for scoring; rebuilt when the file changed. */
function turnIndex(hdb: Database, model: Model): TurnIndex {
  const now = stamp(hdb);
  const cached = indexes.get(hdb);
  if (
    cached !== undefined &&
    cached.index.model === model.id &&
    cached.version === now.version &&
    cached.changes === now.changes
  ) {
    return cached.index;
  }
  const found = hdb
    .query<[number, number | null, Uint8Array], [string]>(
      `SELECT v.turn_id, t.project_id, v.vec
         FROM turn_vectors v JOIN turns t ON t.id = v.turn_id
        WHERE v.model = ? AND length(v.vec) > 0 ORDER BY v.turn_id`,
    )
    .values(model.id) as [number, number | null, Uint8Array][];
  const width = model.pack?.header?.dims ?? found[0]?.[2].byteLength ?? 0;
  const ids = new Int32Array(found.length);
  const projects = new Int32Array(found.length);
  const inverseNorms = new Float32Array(found.length);
  const rows = new Int8Array(found.length * width);
  let n = 0;
  for (const [turnId, projectId, vec] of found) {
    if (vec.byteLength !== width) continue;
    const q = new Int8Array(vec.buffer, vec.byteOffset, width);
    const offset = n * width;
    let sum = 0;
    for (let i = 0; i < width; i++) {
      const x = q[i] as number;
      rows[offset + i] = x;
      sum += x * x;
    }
    ids[n] = turnId;
    projects[n] = projectId ?? -1;
    inverseNorms[n] = sum > 0 ? 1 / Math.sqrt(sum) : 0;
    n++;
  }
  const index: TurnIndex = {
    model: model.id,
    dims: width,
    ids: ids.subarray(0, n),
    projects: projects.subarray(0, n),
    inverseNorms: inverseNorms.subarray(0, n),
    rows: rows.subarray(0, n * width),
  };
  indexes.set(hdb, { index, ...now });
  return index;
}

let failureLogged = false;

/**
 * The turns closest in meaning to the query above the floor, best first. Empty without a
 * model, for a query with no known token, in an index without the table, or on any failure
 * (logged once per process): search falls back to words.
 */
export function semanticTurns(
  hdb: Database,
  model: Model | null,
  query: string,
  filter: { projectId: number | null; limit: number },
): { id: number; score: number }[] {
  if (model === null || query.trim() === "" || filter.limit <= 0) return [];
  try {
    const q = model.embed(query);
    if (q === null) return [];
    const index = turnIndex(hdb, model);
    if (index.dims !== q.length) return [];
    const project = filter.projectId;
    return rankPacked(q, index, SEMANTIC_FLOOR, filter.limit, (r) =>
      project === null ? true : index.projects[r] === project,
    );
  } catch (error) {
    // An index made before the table existed has none: that is not a failure.
    if (!/no such table/i.test(String((error as Error)?.message)) && !failureLogged) {
      failureLogged = true;
      logError("history-semantic", error);
    }
    return [];
  }
}
