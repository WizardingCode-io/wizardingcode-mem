import { readGitInfo } from "../../core/git.ts";
import type { Db } from "../../store/db.ts";
import { logError } from "../../util/log.ts";
import { fingerprint, folderProblem, knowledgeDir } from "./files.ts";
import { refreshIndex } from "./index-store.ts";

// Keeping the index in line with the files (K5) without making a hook wait for it. A hook
// compares the folder's fingerprint with the one recorded and re-indexes inline only a
// small folder; a larger one is left to the background drain, which refreshes the projects
// agents worked in lately.

/** A folder with more entry files than this is not re-indexed by a hook. */
export const INLINE_MAX_FILES = 50;
/** The drain refreshes projects with a session seen within this window. */
const ACTIVE_WITHIN_MS = 24 * 3_600_000;
/** And at most this many of them, the most recent first. */
const MAX_PROJECTS = 10;

/**
 * Brings the index up to date if that is cheap, for a hook: false when the project has no
 * knowledge folder (one `stat`, nothing read from the database) or knowledge is off there
 * (`folderProblem`: a linked folder, the home folder), true otherwise. A changed
 * folder of more than `INLINE_MAX_FILES` files keeps its current index until the drain.
 */
export function freshenForHook(
  db: Db,
  projectId: number,
  projectRoot: string,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const dir = knowledgeDir(projectRoot);
  const current = fingerprint(dir);
  if (current === null) return false;
  // A folder that is there but not the project's own (a link, the home folder) is never read.
  if (folderProblem(projectRoot, env) !== null) return false;
  const recorded = db
    .query<{ fingerprint: string | null }, [number]>(
      "SELECT fingerprint FROM knowledge_state WHERE project_id = ?",
    )
    .get(projectId);
  if (recorded?.fingerprint === current) return true;
  const files = Number.parseInt(current, 10);
  if (files <= INLINE_MAX_FILES) refreshIndex(db, projectId, dir);
  return true;
}

/**
 * For the background drain: refreshes the index of each project with a session seen
 * lately, most recent first, at most `maxProjects`. The project's folder is found from the
 * session's working directory. Never throws; a project that fails is logged and skipped.
 * `refreshed` counts the projects whose index was rebuilt (not skipped as current).
 */
export function refreshActiveProjects(
  db: Db,
  now: number,
  options: { maxProjects?: number; withinMs?: number } = {},
): { refreshed: number } {
  const maxProjects = options.maxProjects ?? MAX_PROJECTS;
  if (maxProjects <= 0) return { refreshed: 0 };
  let refreshed = 0;
  try {
    // The latest session's directory for each project (SQLite takes the bare column from
    // the row that holds the max).
    const active = db
      .query<{ project_id: number; cwd: string; seen: number }, [number, number]>(
        `SELECT s.project_id, s.cwd, max(s.last_seen_at) AS seen
           FROM sessions s JOIN projects p ON p.id = s.project_id AND p.disabled = 0
          WHERE s.last_seen_at >= ?
          GROUP BY s.project_id ORDER BY seen DESC LIMIT ?`,
      )
      .all(now - (options.withinMs ?? ACTIVE_WITHIN_MS), maxProjects);
    for (const { project_id: projectId, cwd } of active) {
      try {
        const root = readGitInfo(cwd)?.root ?? cwd;
        if (folderProblem(root) !== null) continue;
        if (!refreshIndex(db, projectId, knowledgeDir(root)).skipped) refreshed++;
      } catch (error) {
        logError("knowledge", error);
      }
    }
  } catch (error) {
    logError("knowledge", error);
  }
  return { refreshed };
}
