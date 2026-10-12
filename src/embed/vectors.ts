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

/**
 * Every active memory's vector of one model, packed for scoring: the int8 rows side by side,
 * with each row's 1/‖q‖. Kept per connection and rebuilt when the database changed (another
 * connection's commit moves `data_version`; this connection's writes move `total_changes()`),
 * so a search reads no BLOB and copies nothing when nothing was written.
 */
export interface VectorIndex {
  model: string;
  dims: number;
  ids: Int32Array;
  projects: Int32Array;
  kinds: string[];
  /** 1/‖row‖ of the int8 row: the scale cancels out of the cosine. */
  inverseNorms: Float32Array;
  rows: Int8Array;
}

interface CachedIndex {
  index: VectorIndex;
  version: number;
  changes: number;
}

const indexes = new WeakMap<Db, CachedIndex>();

/** What a packed index is valid for: this connection's view of the file, and its own writes. */
export function stamp(db: Db): { version: number; changes: number } {
  const version =
    db.query<{ data_version: number }, []>("PRAGMA data_version").get()?.data_version ?? 0;
  const changes = db.query<{ n: number }, []>("SELECT total_changes() AS n").get()?.n ?? 0;
  return { version, changes };
}

export function vectorIndex(db: Db, model: Model): VectorIndex {
  // Read before the build's queries, not after: a commit by another connection while they run
  // moves the stamp on, so the next call rebuilds instead of trusting a half-old index.
  const now = stamp(db);
  const cached = indexes.get(db);
  if (
    cached !== undefined &&
    cached.index.model === model.id &&
    cached.version === now.version &&
    cached.changes === now.changes
  ) {
    return cached.index;
  }
  // Two plain scans merged by id: a join here costs twice as much as both together.
  const vectors = db
    .query<[number, Uint8Array], [string]>(
      "SELECT memory_id, vec FROM memory_vectors WHERE model = ? AND length(vec) > 0 ORDER BY memory_id",
    )
    .values(model.id) as [number, Uint8Array][];
  const active = db
    .query<[number, number, string], []>(
      "SELECT id, project_id, kind FROM memories WHERE status = 'active' ORDER BY id",
    )
    .values() as [number, number, string][];
  const first = vectors[0];
  const width = model.pack?.header?.dims ?? (first === undefined ? 0 : first[1].byteLength);
  const capacity = Math.min(vectors.length, active.length);
  const ids = new Int32Array(capacity);
  const projects = new Int32Array(capacity);
  const kinds = new Array<string>(capacity);
  const inverseNorms = new Float32Array(capacity);
  const rows = new Int8Array(capacity * width);
  let n = 0;
  for (let v = 0, m = 0; v < vectors.length && m < active.length; ) {
    const [vectorId, vec] = vectors[v] as [number, Uint8Array];
    const [memoryId, projectId, kind] = active[m] as [number, number, string];
    if (vectorId < memoryId) v++;
    else if (memoryId < vectorId) m++;
    else {
      v++;
      m++;
      if (vec.byteLength !== width) continue;
      const q = new Int8Array(vec.buffer, vec.byteOffset, width);
      const offset = n * width;
      let sum = 0;
      for (let i = 0; i < width; i++) {
        const x = q[i] as number;
        rows[offset + i] = x;
        sum += x * x;
      }
      ids[n] = memoryId;
      projects[n] = projectId;
      kinds[n] = kind;
      inverseNorms[n] = sum > 0 ? 1 / Math.sqrt(sum) : 0;
      n++;
    }
  }
  const index: VectorIndex = {
    model: model.id,
    dims: width,
    ids: ids.subarray(0, n),
    projects: projects.subarray(0, n),
    kinds: kinds.slice(0, n),
    inverseNorms: inverseNorms.subarray(0, n),
    rows: rows.subarray(0, n * width),
  };
  indexes.set(db, { index, ...now });
  return index;
}
