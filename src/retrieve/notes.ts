import type { MemoryKind } from "../core/types.ts";
import type { Db } from "../store/db.ts";
import { logError } from "../util/log.ts";
import type { Note } from "./render.ts";

export interface MemoryRow {
  id: number;
  kind: MemoryKind;
  title: string;
  body: string;
  terms: string;
  importance: number;
  createdAt: number;
  updatedAt: number;
  useCount: number;
  branch: string | null;
  stale: number;
}

export const MEMORY_COLUMNS = `m.id, m.kind, m.title, m.body, m.terms, m.importance, m.created_at AS createdAt,
  m.updated_at AS updatedAt, m.use_count AS useCount, m.branch, m.stale`;

const DAY_MS = 86_400_000;
const HALF_LIFE_DAYS = 60;
/** Age lowers a memory's rank but never removes it. */
const DECAY_FLOOR = 0.25;

/**
 * How much a memory deserves attention before any query is considered: importance,
 * faded by age, raised by having been looked up and by belonging to the current branch,
 * halved when its files are gone.
 */
export function prior(row: MemoryRow, context: { branch: string | null; now: number }): number {
  const ageDays = Math.max(0, context.now - row.updatedAt) / DAY_MS;
  const decay = Math.max(DECAY_FLOOR, 0.5 ** (ageDays / HALF_LIFE_DAYS));
  const used = 1 + Math.log1p(row.useCount);
  const sameBranch = row.branch !== null && row.branch === context.branch ? 1.2 : 1;
  return row.importance * decay * used * sameBranch * (row.stale === 1 ? 0.5 : 1);
}

export function filesOf(db: Db, memoryId: number): string[] {
  return db
    .query<{ path: string }, [number]>(
      "SELECT path FROM memory_files WHERE memory_id = ? ORDER BY role, path",
    )
    .all(memoryId)
    .map((row) => row.path);
}

export function toNote(db: Db, row: MemoryRow, origin?: string): Note {
  const note: Note = {
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    createdAt: row.createdAt,
    files: filesOf(db, row.id),
    stale: row.stale === 1,
  };
  if (origin !== undefined) note.origin = origin;
  return note;
}

let promotedFailed = false;

/**
 * The project's memories made knowledge whose entry is still in the project's knowledge
 * index: the entry says them now, so memory leaves them out. One indexed lookup; when the
 * entry is gone (its file deleted, the index refreshed) the memory's notes come back. On
 * any error, none: memory then shows everything, as it did before knowledge.
 */
export function promotedIds(db: Db, projectId: number): number[] {
  try {
    return db
      .query<{ id: number }, [number]>(
        `SELECT p.memory_id AS id FROM promoted_memories p
           JOIN knowledge_entries e ON e.project_id = p.project_id AND e.slug = p.slug
          WHERE p.project_id = ?`,
      )
      .all(projectId)
      .map((row) => row.id);
  } catch (error) {
    if (!promotedFailed) {
      promotedFailed = true;
      logError("knowledge.promoted", error);
    }
    return [];
  }
}

/** ` AND m.id NOT IN (…)` for those ids, or nothing at all: the query is then as it was. */
export function exceptIds(ids: readonly number[]): string {
  return ids.length === 0 ? "" : ` AND m.id NOT IN (${ids.map((n) => Math.trunc(n)).join(", ")})`;
}

/**
 * Records what was shown, which is also what stops it being shown again in this context.
 * Returns the notes this call actually recorded: one already recorded by another call is not new.
 */
export function recordInjections(
  db: Db,
  input: {
    sessionId: number;
    epoch: number;
    event: "session-start" | "prompt" | "file-read" | "tool-failed";
    notes: Note[];
    now: number;
  },
): Note[] {
  const recorded: Note[] = [];
  for (const note of input.notes) {
    const result = db.run(
      `INSERT OR IGNORE INTO injections (session_id, context_epoch, memory_id, event, tokens, at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        input.sessionId,
        input.epoch,
        note.id,
        input.event,
        Math.ceil((note.title.length + note.body.length) / 3.5),
        input.now,
      ],
    );
    if (result.changes > 0) recorded.push(note);
  }
  return recorded;
}

/** Ranks by `score`, best first. Equal scores share a rank, so that ties decide nothing. */
export function ranks<T>(items: T[], score: (item: T) => number): Map<T, number> {
  const sorted = [...items].sort((a, b) => score(b) - score(a));
  const result = new Map<T, number>();
  let rank = 0;
  let previous: number | undefined;
  for (const item of sorted) {
    const value = score(item);
    if (
      previous === undefined ||
      Math.abs(value - previous) > 1e-6 * Math.max(1, Math.abs(value))
    ) {
      rank++;
    }
    previous = value;
    result.set(item, rank);
  }
  return result;
}
