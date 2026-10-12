import type { Db } from "../store/db.ts";
import { visibleProjects } from "../store/links.ts";
import { logError } from "../util/log.ts";
import { MEMORY_COLUMNS, type MemoryRow, prior, toNote } from "./notes.ts";
import { type LastTurn, type Note, renderBrief, renderHeading } from "./render.ts";

/** About 1,200 tokens, and well under the size at which hosts stop showing hook output. */
const BUDGET_CHARS = 4200;
const POOL = 200;
/** The share of the brief the author's own rules may take. */
export const USER_SHARE = 0.15;
/** The share of the brief linked projects may take. */
export const LINKED_SHARE = 0.15;
/** Only what matters most crosses into another project's brief. */
export const LINKED_MIN_IMPORTANCE = 4;
/** At most this many prompt notes come from linked projects. */
export const MAX_LINKED_NOTES = 1;
/** Linked memories read before ranking, whatever the size of the linked projects. */
export const LINKED_POOL = 50;

/**
 * What a session is told when it starts: where the last one stopped, and the headings
 * of what is known, most important first. Deterministic; no model is involved.
 */
export function sessionBrief(
  db: Db,
  input: { projectId: number; branch: string | null; now: number },
): { text: string; notes: Note[] } {
  const last = db
    .query<LastTurn, [number]>(
      `SELECT prompt, final_text AS finalText, COALESCE(ended_at, started_at) AS endedAt, branch
         FROM turns
        WHERE project_id = ? AND final_text IS NOT NULL AND final_text <> ''
        ORDER BY COALESCE(ended_at, started_at) DESC, id DESC LIMIT 1`,
    )
    .get(input.projectId);

  const rank = (rows: MemoryRow[]) =>
    rows.sort((a, b) => prior(b, input) - prior(a, input) || b.id - a.id);
  const extra = extraPools(db, input.projectId);
  const rules = new Set(extra.user.map((row) => row.id));

  // Memories whose files are gone are left out here: unprompted, they are more likely
  // to mislead than to help.
  const ranked = rank(
    db
      .query<MemoryRow, [number, number]>(
        `SELECT ${MEMORY_COLUMNS} FROM memories m
          WHERE m.project_id = ? AND m.status = 'active' AND m.stale = 0
          ORDER BY m.importance DESC, m.updated_at DESC LIMIT ?`,
      )
      .all(input.projectId, POOL),
  );

  // The author's rules and the linked projects' notes come after the project's own, so
  // the top of the brief reads as it always has; each takes at most its share.
  const own: Note[] = [];
  const linked: Note[] = [];
  const user: Note[] = [];
  const render = () => renderBrief(last, [...own, ...linked, ...user]);
  let text = render();
  const fill = (into: Note[], candidates: { row: MemoryRow; origin?: string }[], share: number) => {
    let used = 0;
    for (const { row, origin } of candidates) {
      const note = toNote(db, row, origin);
      const cost = `- ${renderHeading(note)}`.length + 1;
      if (used + cost > share) continue;
      into.push(note);
      const next = render();
      // One note that does not fit must not keep out the smaller ones after it.
      if (next.length > BUDGET_CHARS) {
        into.pop();
        continue;
      }
      used += cost;
      text = next;
    }
  };
  fill(
    user,
    rank(extra.user).map((row) => ({ row, origin: "you" })),
    USER_SHARE * BUDGET_CHARS,
  );
  // Only the rules shown in their share are left out of the other parts: a rule the share
  // had no room for is still one of its project's memories, labelled as the author's.
  const shown = new Set(user.map((note) => note.id));
  const label = (row: MemoryRow, origin?: string) => (rules.has(row.id) ? "you" : origin);
  fill(
    linked,
    rank(extra.linked.filter((row) => !shown.has(row.id))).map((row) => ({
      row,
      origin: label(row, `from ${extra.names.get(row.id)}`),
    })),
    LINKED_SHARE * BUDGET_CHARS,
  );
  fill(
    own,
    ranked.filter((row) => !shown.has(row.id)).map((row) => ({ row, origin: label(row) })),
    BUDGET_CHARS,
  );
  return { text, notes: [...own, ...linked, ...user] };
}

interface ExtraPools {
  user: MemoryRow[];
  linked: MemoryRow[];
  /** The project each linked memory comes from, by memory id. */
  names: Map<number, string>;
}

const NONE: ExtraPools = { user: [], linked: [], names: new Map() };
let failed = false;

/**
 * The author's rules (any project) and the important memories of the projects linked to
 * this one, each read up to a fixed count. Nothing at all on any error: the brief is then
 * the current project's alone, as it was before links existed.
 */
function extraPools(db: Db, projectId: number): ExtraPools {
  try {
    const user = db
      .query<MemoryRow, [number]>(
        `SELECT ${MEMORY_COLUMNS} FROM user_memories u CROSS JOIN memories m ON m.id = u.memory_id
          WHERE m.status = 'active' AND m.stale = 0
          ORDER BY m.importance DESC, m.updated_at DESC LIMIT ?`,
      )
      .all(POOL);
    const names = new Map<number, string>();
    const top = db.query<MemoryRow, [number, number, number]>(
      `SELECT ${MEMORY_COLUMNS} FROM memories m
        WHERE m.project_id = ? AND m.status = 'active' AND m.importance >= ? AND m.stale = 0
        ORDER BY m.importance DESC, m.updated_at DESC LIMIT ?`,
    );
    // Project by project, each an index range read that stops at the pool's size.
    const linked = visibleProjects(db, projectId)
      .flatMap((project) => {
        const rows = top.all(project.id, LINKED_MIN_IMPORTANCE, LINKED_POOL);
        for (const row of rows) names.set(row.id, project.name);
        return rows;
      })
      .sort((a, b) => b.importance - a.importance || b.updatedAt - a.updatedAt || b.id - a.id)
      .slice(0, LINKED_POOL);
    return { user, linked, names };
  } catch (error) {
    if (!failed) {
      failed = true;
      logError("brief.links", error);
    }
    return NONE;
  }
}
