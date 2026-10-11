import type { MemoryKind } from "../core/types.ts";
import type { Model } from "../embed/model.ts";
import type { Judge } from "../judge/types.ts";
import type { Db } from "../store/db.ts";
import { getMemories, saveMemory, searchMemories, type ToolContext } from "./tools.ts";

// The tools for Claude Desktop's chat, which has no project folder: they work across every
// project, say which project each memory belongs to, and save into a project named by
// the model. What is decided in the chat about a project reaches the agents working in
// that project's repository, and the other way round.

interface ProjectRow {
  id: number;
  name: string;
  key: string;
  memories: number;
  lastActivity: number | null;
}

function projects(db: Db): ProjectRow[] {
  return db
    .query<ProjectRow, []>(
      `SELECT p.id, p.name, p.key,
              (SELECT count(*) FROM memories m WHERE m.project_id = p.id AND m.status = 'active') AS memories,
              (SELECT max(x) FROM (SELECT max(last_seen_at) AS x FROM sessions s WHERE s.project_id = p.id
                                   UNION ALL SELECT max(updated_at) FROM memories m WHERE m.project_id = p.id)) AS lastActivity
         FROM projects p WHERE p.disabled = 0
        ORDER BY lastActivity DESC NULLS LAST, p.name`,
    )
    .all();
}

/** A project by its name or key, ignoring case; the key may be given without its prefix. */
function findProject(db: Db, wanted: string): ProjectRow | null {
  const w = wanted.trim().toLowerCase();
  const all = projects(db);
  return (
    all.find((p) => p.name.toLowerCase() === w) ??
    all.find(
      (p) => p.key.toLowerCase() === w || p.key.toLowerCase().replace(/^[a-z]+:/, "") === w,
    ) ??
    null
  );
}

const context = (
  db: Db,
  judge: Judge | null,
  now: number,
  projectId: number | null,
): ToolContext => ({
  db,
  judge: judge as Judge,
  projectId,
  root: "",
  branch: null,
  now,
});

const unknown = (db: Db, wanted: string) =>
  `No project called “${wanted}”. Projects: ${projects(db)
    .slice(0, 12)
    .map((p) => p.name)
    .join(", ")}.`;

export function globalSearch(
  db: Db,
  now: number,
  args: { query: string; kind?: MemoryKind; limit?: number; project?: string },
  model: Model | null = null,
): string {
  if (args.project) {
    const project = findProject(db, args.project);
    if (!project) return unknown(db, args.project);
    return searchMemories({ ...context(db, null, now, project.id), model }, args);
  }
  return searchMemories({ ...context(db, null, now, null), model }, args);
}

export function globalGet(db: Db, now: number, args: { ids: number[] }): string {
  return getMemories(context(db, null, now, null), args);
}

export async function globalSave(
  db: Db,
  judge: Judge,
  now: number,
  args: { text: string; kind: MemoryKind; files?: string[]; importance?: number; project?: string },
  model: Model | null = null,
): Promise<string> {
  if (!args.project?.trim()) {
    return `Nothing saved. Say which project this belongs to (the project argument). Recent projects: ${listNames(db)}.`;
  }
  const project = findProject(db, args.project);
  if (!project) return `Nothing saved. ${unknown(db, args.project)}`;
  const saved = await saveMemory(
    { ...context(db, judge, now, project.id), model },
    { ...args, files: [] },
  );
  return saved
    .replace(/^(Saved as #\d+)/, `$1 in ${project.name}`)
    .replace(/^(Already known as #\d+)/, `$1 in ${project.name}`);
}

const listNames = (db: Db) =>
  projects(db)
    .slice(0, 12)
    .map((p) => p.name)
    .join(", ");

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The projects, most recently active first, so the model can pick one to save into. */
export function listProjects(db: Db, _now: number, args: { limit?: number }): string {
  const rows = projects(db).slice(0, Math.min(50, Math.max(1, args.limit ?? 20)));
  if (rows.length === 0) return "No projects yet.";
  return rows
    .map(
      (p) =>
        `${p.name} · ${p.memories} memor${p.memories === 1 ? "y" : "ies"}${p.lastActivity ? ` · last active ${day(p.lastActivity)}` : ""}`,
    )
    .join("\n");
}
