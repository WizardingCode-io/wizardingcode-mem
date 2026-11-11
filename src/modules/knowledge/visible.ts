// Which repositories a project sees. The one place that decides it: the hooks, the tools and
// the judge's neighbours all ask here, and a later part narrows it here alone.
import type { Db } from "../../store/db.ts";

export type VisibleRepo = { id: number; scope: "workspace" | "project" | "shared" };

/**
 * The repositories a project sees: the workspace's, the shared one, and the project's own
 * when there is a project. One indexed query over `knowledge_repos`; nothing on the disk is
 * looked at, so a hook can ask it.
 */
export function visibleRepos(db: Db, projectId: number | null): VisibleRepo[] {
  return db
    .query<VisibleRepo, [number | null]>(
      `SELECT id, scope FROM knowledge_repos WHERE ${VISIBLE} ORDER BY id`,
    )
    .all(projectId);
}

/** The one rule, as SQL: the roots, and the project's own repository. */
const VISIBLE = `(scope IN ('workspace', 'shared') AND project_id = 0)
           OR (scope = 'project' AND project_id = ?)`;

/**
 * The same, with whether any active received entry exists (ADR 0027), in the one query a hook
 * runs: a project with no repository of its own still gets received hits, and one with
 * neither stays silent at the same cost as before. The received table is knowledge v8's,
 * which the caller has checked the schema for.
 */
export function visibleWithReceived(
  db: Db,
  projectId: number | null,
): { repos: VisibleRepo[]; received: boolean } {
  const rows = db
    .query<VisibleRepo | { id: 0; scope: "received" }, [number | null]>(
      `SELECT id, scope FROM knowledge_repos WHERE ${VISIBLE}
       UNION ALL
       SELECT 0 AS id, 'received' AS scope
        WHERE EXISTS (SELECT 1 FROM knowledge_received WHERE status = 'active')
       ORDER BY id`,
    )
    .all(projectId);
  return {
    repos: rows.filter((row): row is VisibleRepo => row.scope !== "received"),
    received: rows.some((row) => row.scope === "received"),
  };
}
