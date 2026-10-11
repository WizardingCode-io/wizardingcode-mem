import { type Db, withWrite } from "../store/db.ts";

// Distilled history and claude-mem's imports describe the same sessions. On request,
// once a project's history is distilled, its imports from the period that history
// covers step aside: archived, never deleted, and listed so that the undo touches only
// them. An import that history confirmed (reinforced, or kept over a history memory)
// stays.

export interface Replacement {
  archived: number;
  /** Imports inside the span left active because history confirmed them. */
  spared: number;
}

/** Projects whose history turns are all finished, at least one of them distilled. */
export function projectsReadyForReplacement(db: Db): number[] {
  return db
    .query<{ id: number }, []>(
      `SELECT project_id AS id FROM turns
        WHERE origin = 'history'
        GROUP BY project_id
       HAVING SUM(state IN ('open','pending','processing')) = 0 AND SUM(state = 'done') > 0
        ORDER BY project_id`,
    )
    .all()
    .map((row) => row.id);
}

// History confirmed the import: one of its turns reinforced it, or a memory distilled
// from history stepped aside for it. Not correlated, so it is computed once per query
// (superseded_by has no index; a per-row lookup scanned every memory for every import).
const CONFIRMED = `m.id IN (SELECT s.memory_id FROM memory_sources s JOIN turns t ON t.id = s.turn_id
                               WHERE t.origin = 'history'
                              UNION
                              SELECT h.superseded_by FROM memories h JOIN turns t ON t.id = h.source_turn_id
                               WHERE t.origin = 'history' AND h.superseded_by IS NOT NULL)`;

/**
 * The project's active imports created inside the period its history covers (earliest
 * start to latest end of its history turns, computed afresh each time), split into those
 * to archive and those history confirmed. The one selection that replacing and its
 * preview share.
 */
function selectImports(db: Db, projectId: number): { archive: number[]; spared: number } {
  const span = db
    .query<{ first: number | null; last: number | null }, [number]>(
      `SELECT MIN(started_at) AS first, MAX(COALESCE(ended_at, started_at)) AS last
         FROM turns WHERE project_id = ? AND origin = 'history'`,
    )
    .get(projectId);
  if (span?.first == null || span.last == null) return { archive: [], spared: 0 };
  const rows = db
    .query<{ id: number; confirmed: number }, [number, number, number]>(
      `SELECT m.id, ${CONFIRMED} AS confirmed FROM memories m
        WHERE m.project_id = ? AND m.origin = 'imported' AND m.status = 'active'
          AND m.created_at BETWEEN ? AND ?`,
    )
    .all(projectId, span.first, span.last);
  const archive = rows.filter((row) => !row.confirmed).map((row) => row.id);
  return { archive, spared: rows.length - archive.length };
}

/**
 * Archives the project's active imports created inside the period its history covers,
 * except those history confirmed. Imports from periods whose transcripts were never read
 * stay. Idempotent: what is archived is no longer active.
 */
export function replaceImports(db: Db, projectId: number, options: { now: number }): Replacement {
  return withWrite(db, () => {
    const { archive, spared } = selectImports(db, projectId);
    for (const id of archive) {
      // Status only: the memory itself did not change.
      db.run("UPDATE memories SET status = 'archived' WHERE id = ?", [id]);
      db.run(
        "INSERT OR REPLACE INTO history_replacements (memory_id, project_id, run_at) VALUES (?, ?, ?)",
        [id, projectId, options.now],
      );
    }
    return { archived: archive.length, spared };
  });
}

/** How many imports `replaceAllImports` would archive now. Writes nothing. */
export function previewReplaceImports(db: Db): number {
  let total = 0;
  for (const projectId of projectsReadyForReplacement(db)) {
    total += selectImports(db, projectId).archive.length;
  }
  return total;
}

/** Replaces the imports of every ready project. */
export function replaceAllImports(
  db: Db,
  options: { now: number },
): Replacement & { projects: number } {
  const total = { projects: 0, archived: 0, spared: 0 };
  for (const projectId of projectsReadyForReplacement(db)) {
    const replaced = replaceImports(db, projectId, options);
    total.projects++;
    total.archived += replaced.archived;
    total.spared += replaced.spared;
  }
  return total;
}

/** Reactivates what replacement archived and is still archived, then forgets the list. */
export function restoreImports(db: Db): number {
  return withWrite(db, () => {
    const restored = db.run(
      `UPDATE memories SET status = 'active'
        WHERE status = 'archived' AND id IN (SELECT memory_id FROM history_replacements)`,
    ).changes;
    db.run("DELETE FROM history_replacements");
    return restored;
  });
}
