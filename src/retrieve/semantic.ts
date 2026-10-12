/**
 * Memories found by meaning, for explicit search only (memory_search, the viewer's list and
 * palette). Never used for injection: ADR 0014 measured that no threshold keeps a prompt about
 * something else silent. Here the user asked, so a floor that keeps most junk out is enough
 * (calibration in ADR 0017, scripts/embed/search-floor.ts).
 */

import type { Model } from "../embed/model.ts";
import { vectorIndex } from "../embed/vectors.ts";
import type { Db } from "../store/db.ts";
import { logError } from "../util/log.ts";

/** The least cosine a memory needs to be offered by meaning alone. Calibrated: ADR 0017. */
export const SEMANTIC_FLOOR = 0.32;

/** The RRF constant every search fuses with. */
export const RRF_K = 60;

/** How many memories found by meaning a search considers before fusing. */
export const SEMANTIC_POOL = 50;

let failureLogged = false;

/**
 * The best memories by meaning above the floor, best first. Empty without a model, for a query
 * with no known token, or on any failure (logged once per process): search falls back to words.
 * `floor` is for calibration only.
 */
export function semanticCandidates(
  db: Db,
  model: Model | null,
  query: string,
  filter: {
    projectId: number | null;
    /** Several projects instead of one (a project and its linked ones); overrides projectId. */
    projectIds?: readonly number[];
    kind?: string | null;
    limit: number;
    floor?: number;
  },
): { id: number; score: number }[] {
  if (model === null || query.trim() === "" || filter.limit <= 0) return [];
  try {
    const q = model.embed(query);
    if (q === null) return [];
    const floor = filter.floor ?? SEMANTIC_FLOOR;
    const index = vectorIndex(db, model);
    if (index.dims !== q.length) return [];
    const project = filter.projectId;
    const several = filter.projectIds === undefined ? null : new Set(filter.projectIds);
    const kind = filter.kind ?? null;
    return rankPacked(q, index, floor, filter.limit, (r) => {
      if (several !== null) {
        if (!several.has(index.projects[r] as number)) return false;
      } else if (project !== null && index.projects[r] !== project) return false;
      return kind === null || index.kinds[r] === kind;
    });
  } catch (error) {
    if (!failureLogged) {
      failureLogged = true;
      logError("semantic", error);
    }
    return [];
  }
}

/** The rows of a packed index, as far as scoring is concerned (memories and past turns alike). */
export interface PackedRows {
  dims: number;
  ids: Int32Array;
  /** 1/‖row‖ of the int8 row: the scale cancels out of the cosine. */
  inverseNorms: Float32Array;
  rows: Int8Array;
}

/**
 * The rows whose cosine with the unit vector `q` reaches `floor`, best first (newer id first
 * on a tie), at most `limit`. The cosine is q·row / ‖row‖, computed on the int8 row itself:
 * the row's scale cancels out, and nothing is copied. `keep` filters by row number.
 */
export function rankPacked(
  q: Float32Array,
  index: PackedRows,
  floor: number,
  limit: number,
  keep: (row: number) => boolean,
): { id: number; score: number }[] {
  const { dims, rows, ids, inverseNorms } = index;
  let norm = 0;
  for (let i = 0; i < dims; i++) norm += (q[i] as number) * (q[i] as number);
  const inverseQuery = norm > 0 ? 1 / Math.sqrt(norm) : 0;
  const found: { id: number; score: number }[] = [];
  for (let r = 0, offset = 0; r < ids.length; r++, offset += dims) {
    if (!keep(r)) continue;
    const score = dotInt8(q, rows, offset, dims) * (inverseNorms[r] as number) * inverseQuery;
    if (score >= floor) found.push({ id: ids[r] as number, score });
  }
  return found.sort((a, b) => b.score - a.score || b.id - a.id).slice(0, limit);
}

/** q · rows[offset, offset + dims), four lanes at a time (the hot loop of every search). */
function dotInt8(q: Float32Array, rows: Int8Array, offset: number, dims: number): number {
  let a = 0;
  let b = 0;
  let c = 0;
  let d = 0;
  let i = 0;
  for (; i + 3 < dims; i += 4) {
    a += (q[i] as number) * (rows[offset + i] as number);
    b += (q[i + 1] as number) * (rows[offset + i + 1] as number);
    c += (q[i + 2] as number) * (rows[offset + i + 2] as number);
    d += (q[i + 3] as number) * (rows[offset + i + 3] as number);
  }
  for (; i < dims; i++) a += (q[i] as number) * (rows[offset + i] as number);
  return a + b + c + d;
}

/**
 * Reciprocal-rank fusion of rankings given as ids, best first: each list adds 1/(k + rank).
 * Ties keep the newer memory first, as every search here does.
 */
export function fuseRanks(lists: readonly (readonly number[])[]): number[] {
  const score = new Map<number, number>();
  for (const list of lists) {
    list.forEach((id, index) => {
      score.set(id, (score.get(id) ?? 0) + 1 / (RRF_K + index + 1));
    });
  }
  return [...score.keys()].sort((a, b) => (score.get(b) ?? 0) - (score.get(a) ?? 0) || b - a);
}
