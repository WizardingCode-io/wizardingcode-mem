/**
 * Memories found by meaning, for explicit search only (memory_search, the viewer's list and
 * palette). Never used for injection: ADR 0014 measured that no threshold keeps a prompt about
 * something else silent. Here the user asked, so a floor that keeps most junk out is enough
 * (calibration in ADR 0017, scripts/embed/search-floor.ts).
 */

import { cosine } from "../embed/embed.ts";
import type { Model } from "../embed/model.ts";
import { memoryVectors } from "../embed/vectors.ts";
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
  filter: { projectId: number | null; kind?: string | null; limit: number; floor?: number },
): { id: number; score: number }[] {
  if (model === null || query.trim() === "" || filter.limit <= 0) return [];
  try {
    const q = model.embed(query);
    if (q === null) return [];
    const floor = filter.floor ?? SEMANTIC_FLOOR;
    const found: { id: number; score: number }[] = [];
    const kinds = filter.kind ? [filter.kind] : undefined;
    for (const row of memoryVectors(db, model, { projectId: filter.projectId, kinds })) {
      const score = cosine(q, row.vec);
      if (score >= floor) found.push({ id: row.id, score });
    }
    return found.sort((a, b) => b.score - a.score || b.id - a.id).slice(0, filter.limit);
  } catch (error) {
    if (!failureLogged) {
      failureLogged = true;
      logError("semantic", error);
    }
    return [];
  }
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
