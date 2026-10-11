/**
 * One vector per memory, kept in the main database (memory_vectors, migration 6) so that it
 * travels in backups (ADR 0017). A vector belongs to the model that made it: rows of another
 * model are ignored here and rewritten by the backfill. Nothing here ever throws into the
 * memory's own write: a failure leaves the memory without a vector, which the backfill fills.
 */

import type { Db } from "../store/db.ts";
import { logError } from "../util/log.ts";
import { dequantize, quantize } from "./embed.ts";
import type { Model } from "./model.ts";

/** The text a memory is embedded from. Title and body are stored redacted. */
export const vectorText = (title: string, body: string): string => `${title}\n${body}`;

const EMPTY = new Uint8Array(0);

/** No-op without a model; otherwise replaces the memory's row. True when the row was written. */
export function writeMemoryVector(
  db: Db,
  model: Model | null,
  memoryId: number,
  title: string,
  body: string,
): boolean {
  if (model === null) return false;
  try {
    const v = model.embed(vectorText(title, body));
    const { scale, q } = v === null ? { scale: 0, q: null } : quantize(v);
    // Nothing to embed still gets a row, empty, so the backfill does not offer it again;
    // an empty vector is never a candidate.
    const vec =
      q === null || scale === 0 ? EMPTY : new Uint8Array(q.buffer, q.byteOffset, q.byteLength);
    db.run(
      `INSERT INTO memory_vectors (memory_id, model, scale, vec) VALUES (?, ?, ?, ?)
       ON CONFLICT (memory_id) DO UPDATE SET model = excluded.model, scale = excluded.scale, vec = excluded.vec`,
      [memoryId, model.id, scale, vec],
    );
    return true;
  } catch (error) {
    logError("vectors", error);
    return false;
  }
}

/**
 * The memory's text changed: rewrite its vector, or, without a model or when the new one
 * cannot be made, drop the stale one so that a search never matches the old text and the
 * backfill writes it again.
 */
export function refreshMemoryVector(db: Db, model: Model | null, memoryId: number): void {
  const row =
    model === null
      ? null
      : db
          .query<{ title: string; body: string }, [number]>(
            "SELECT title, body FROM memories WHERE id = ?",
          )
          .get(memoryId);
  if (row !== null && writeMemoryVector(db, model, memoryId, row.title, row.body)) return;
  db.run("DELETE FROM memory_vectors WHERE memory_id = ?", [memoryId]);
}

/** Every vector, of every model: for when the model is deleted. */
export function dropMemoryVectors(db: Db): void {
  db.run("DELETE FROM memory_vectors");
}

/** The vectors of active memories, of this model only, optionally of one project and some kinds. */
export function memoryVectors(
  db: Db,
  model: Model,
  filter: { projectId: number | null; kinds?: readonly string[] },
): { id: number; vec: Float32Array }[] {
  const kinds = filter.kinds;
  if (kinds !== undefined && kinds.length === 0) return [];
  const kindClause =
    kinds === undefined ? "" : `AND m.kind IN (${kinds.map(() => "?").join(", ")})`;
  const rows = db
    .query<{ id: number; scale: number; vec: Uint8Array }, (string | number | null)[]>(
      `SELECT m.id, v.scale, v.vec
         FROM memory_vectors v JOIN memories m ON m.id = v.memory_id
        WHERE v.model = ? AND m.status = 'active' AND length(v.vec) > 0
          AND (? IS NULL OR m.project_id = ?) ${kindClause}
        ORDER BY m.id`,
    )
    .all(model.id, filter.projectId, filter.projectId, ...(kinds ?? []));
  return rows.map((row) => ({
    id: row.id,
    vec: dequantize(
      row.scale,
      new Int8Array(row.vec.buffer, row.vec.byteOffset, row.vec.byteLength),
    ),
  }));
}
