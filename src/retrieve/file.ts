import { MOMENT_BUDGET } from "../engine/compose.ts";
import type { Db } from "../store/db.ts";
import { MEMORY_COLUMNS, type MemoryRow, prior, toNote } from "./notes.ts";
import { notYetShown } from "./prompt.ts";
import { type Note, renderNotes } from "./render.ts";

const MAX_NOTES = 2;
/** Kinds that warn or explain; a summary of a change is not worth interrupting a read. */
const KINDS = "('gotcha', 'fix', 'convention', 'decision')";

/**
 * What earlier sessions learned about one file, for the moment an agent reads it:
 * a few of the most useful notes, none that this context has already been given.
 * `path` is project-relative with forward slashes.
 */
export function notesForFile(
  db: Db,
  input: {
    projectId: number;
    sessionId: number;
    epoch: number;
    path: string;
    branch: string | null;
    now: number;
    /** Default 1,200 characters. */
    budgetChars?: number;
    /** The intro the notes will be shown with, which counts against the budget. */
    intro?: string;
  },
): Note[] {
  const budgetChars = input.budgetChars ?? MOMENT_BUDGET["file-read"];
  const rows = db
    .query<MemoryRow & { role: string }, [number, string]>(
      `SELECT ${MEMORY_COLUMNS}, MIN(f.role) AS role
         FROM memories m JOIN memory_files f ON f.memory_id = m.id
        WHERE m.project_id = ? AND f.path = ? AND m.status = 'active' AND m.kind IN ${KINDS}
          AND ${notYetShown(db, input.sessionId, input.epoch)}
        GROUP BY m.id`,
    )
    .all(input.projectId, input.path);
  const context = { branch: input.branch, now: input.now };
  // 'changed' sorts before 'read'.
  rows.sort(
    (a, b) => a.role.localeCompare(b.role) || prior(b, context) - prior(a, context) || a.id - b.id,
  );
  const chosen: Note[] = [];
  for (const row of rows) {
    // All candidates are walked, so that a long note does not hide a short one after it.
    if (chosen.length === MAX_NOTES) break;
    const next = [...chosen, toNote(db, row)];
    // `continue`, as on the prompt path: skip what does not fit and try the next.
    if (renderNotes(next, input.intro).length > budgetChars) continue;
    chosen.push(next[next.length - 1] as Note);
  }
  return chosen;
}
