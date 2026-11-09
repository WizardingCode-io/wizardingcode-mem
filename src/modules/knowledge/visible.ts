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
      `SELECT id, scope FROM knowledge_repos
        WHERE (scope IN ('workspace', 'shared') AND project_id = 0)
           OR (scope = 'project' AND project_id = ?)
        ORDER BY id`,
    )
    .all(projectId);
}
