import type { Database } from "bun:sqlite";
import { searchTerms } from "../../util/words.ts";

/**
 * Until 0.4.4, a turn opened by a host notification (a background task finishing, a
 * subagent reporting back) kept the notification as its memory's `Context:` line: ids
 * and temporary paths that read as noise and matched searches they had nothing to do
 * with. The line goes; the memory and its other facts stay, and its search terms are
 * worked out again without it.
 */
const HOST_CONTEXT = /^Context: <(?:task-notification|agent-message)[\s>].*$\n?/gm;

export function dropHostContext(db: Database): void {
  const rows = db
    .query<{ id: number; title: string; body: string }, []>(
      `SELECT id, title, body FROM memories
        WHERE body LIKE '%Context: <task-notification%' OR body LIKE '%Context: <agent-message%'`,
    )
    .all();
  const files = db.query<{ path: string }, [number]>(
    "SELECT path FROM memory_files WHERE memory_id = ? ORDER BY path",
  );
  const update = db.query<unknown, [string, string, number]>(
    "UPDATE memories SET body = ?, terms = ? WHERE id = ?",
  );
  for (const row of rows) {
    const body = row.body.replace(HOST_CONTEXT, "").trimEnd();
    if (body === row.body) continue;
    const paths = files.all(row.id).map((file) => file.path);
    update.run(body, searchTerms(row.title, body, paths), row.id);
  }
}
