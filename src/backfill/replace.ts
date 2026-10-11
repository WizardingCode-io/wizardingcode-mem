import { type Db, withWrite } from "../store/db.ts";
import { setMeta } from "../store/meta.ts";

// Distilled history and claude-mem's imports describe the same sessions. Once a
// project's history is distilled, its imports from the same window step aside:
// archived, never deleted, and listed so that the undo touches only them.

const replacedKey = (projectId: number) => `history.replaced.${projectId}`;

export function projectsReadyForReplacement(db: Db): number[] {
  return db
    .query<{ id: number }, []>(
      `SELECT t.project_id AS id FROM turns t
        WHERE t.origin = 'history'
          AND NOT EXISTS (SELECT 1 FROM meta WHERE key = 'history.replaced.' || t.project_id)
        GROUP BY t.project_id
       HAVING SUM(t.state IN ('open','pending','processing')) = 0
        ORDER BY t.project_id`,
    )
    .all()
    .map((row) => row.id);
}

export function replaceImports(
  db: Db,
  projectId: number,
  options: { sinceMs: number; now: number },
): number {
  return withWrite(db, () => {
    const ids = db
      .query<{ id: number }, [number, number]>(
        `SELECT id FROM memories
          WHERE project_id = ? AND origin = 'imported' AND status = 'active' AND created_at >= ?`,
      )
      .all(projectId, options.sinceMs)
      .map((row) => row.id);
    for (const id of ids) {
      db.run("UPDATE memories SET status = 'archived', updated_at = ? WHERE id = ?", [
        options.now,
        id,
      ]);
      db.run(
        "INSERT OR IGNORE INTO history_replacements (memory_id, project_id, run_at) VALUES (?, ?, ?)",
        [id, projectId, options.now],
      );
    }
    setMeta(db, replacedKey(projectId), String(options.now));
    return ids.length;
  });
}

export function restoreImports(db: Db): number {
  return withWrite(db, () => {
    const restored = db.run(
      `UPDATE memories SET status = 'active'
        WHERE status = 'archived' AND id IN (SELECT memory_id FROM history_replacements)`,
    ).changes;
    db.run("DELETE FROM history_replacements");
    db.run("DELETE FROM meta WHERE key LIKE 'history.replaced.%'");
    return restored;
  });
}
