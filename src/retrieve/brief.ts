import type { Db } from "../store/db.ts";
import { MEMORY_COLUMNS, type MemoryRow, prior, toNote } from "./notes.ts";
import { type LastTurn, type Note, renderBrief } from "./render.ts";

/** About 1,200 tokens, and well under the size at which hosts stop showing hook output. */
const BUDGET_CHARS = 4200;
const POOL = 200;

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

  // Memories whose files are gone are left out here: unprompted, they are more likely
  // to mislead than to help.
  const ranked = db
    .query<MemoryRow, [number, number]>(
      `SELECT ${MEMORY_COLUMNS} FROM memories m
        WHERE m.project_id = ? AND m.status = 'active' AND m.stale = 0
        ORDER BY m.importance DESC, m.updated_at DESC LIMIT ?`,
    )
    .all(input.projectId, POOL)
    .sort((a, b) => prior(b, input) - prior(a, input) || b.id - a.id);

  const notes: Note[] = [];
  let text = renderBrief(last, notes);
  for (const row of ranked) {
    const next = renderBrief(last, [...notes, toNote(db, row)]);
    // One note that does not fit must not keep out the smaller ones after it.
    if (next.length > BUDGET_CHARS) continue;
    notes.push(toNote(db, row));
    text = next;
  }
  return { text, notes };
}
