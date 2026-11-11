import type { Redacted } from "../core/redact.ts";
import type { MemoryKind } from "../core/types.ts";
import type { Model } from "../embed/model.ts";
import { refreshMemoryVector, writeMemoryVector } from "../embed/vectors.ts";
import { anyOf, inProject, inProjects, tokens } from "../util/words.ts";
import type { Db } from "./db.ts";

export interface NewMemory {
  projectId: number;
  kind: MemoryKind;
  title: string;
  body: Redacted;
  /** Search-only words: file paths and the parts of identifiers. */
  terms: string;
  importance: number;
  branch: string | null;
  commit: string | null;
  origin: "distilled" | "manual" | "imported";
  judge: string;
  judgeVersion: string;
  sourceTurnId: number | null;
  files: { path: string; role: "changed" | "read" }[];
  now: number;
}

function insertFiles(db: Db, memoryId: number, files: NewMemory["files"]): void {
  for (const file of files) {
    // A file both read and changed is recorded once, as changed.
    db.run(
      `INSERT INTO memory_files (memory_id, path, role) VALUES (?, ?, ?)
       ON CONFLICT (memory_id, path) DO UPDATE SET role = 'changed' WHERE excluded.role = 'changed'`,
      [memoryId, file.path, file.role],
    );
  }
}

/**
 * Stores a memory with its file anchors. Storing the memory of a turn that already
 * has one updates that memory and returns its id: a turn yields one memory, its latest.
 * With the semantic model, the memory's vector is written in the same transaction.
 */
export function insertMemory(db: Db, memory: NewMemory, model: Model | null = null): number {
  const inserted = db
    .query<{ id: number }, (string | number | null)[]>(
      `INSERT INTO memories (project_id, kind, title, body, terms, importance, branch, commit_sha,
                             origin, judge, judge_version, source_turn_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (source_turn_id, source_ordinal) DO NOTHING
       RETURNING id`,
    )
    .get(
      memory.projectId,
      memory.kind,
      memory.title,
      memory.body,
      memory.terms,
      memory.importance,
      memory.branch,
      memory.commit,
      memory.origin,
      memory.judge,
      memory.judgeVersion,
      memory.sourceTurnId,
      memory.now,
      memory.now,
    );
  if (inserted === null) {
    const existing = db
      .query<{ id: number }, [number | null]>(
        "SELECT id FROM memories WHERE source_turn_id = ? AND source_ordinal = 0",
      )
      .get(memory.sourceTurnId);
    if (existing === null) throw new Error("memory insert returned no row");
    // The turn was distilled before. What it yields now replaces what it yielded then.
    db.run(
      "UPDATE memories SET kind = ?, title = ?, body = ?, terms = ?, importance = ?, updated_at = ? WHERE id = ?",
      [
        memory.kind,
        memory.title,
        memory.body,
        memory.terms,
        memory.importance,
        memory.now,
        existing.id,
      ],
    );
    db.run("DELETE FROM memory_files WHERE memory_id = ?", [existing.id]);
    insertFiles(db, existing.id, memory.files);
    refreshMemoryVector(db, model, existing.id);
    return existing.id;
  }

  insertFiles(db, inserted.id, memory.files);
  writeMemoryVector(db, model, inserted.id, memory.title, memory.body);
  if (memory.sourceTurnId !== null) {
    db.run("INSERT INTO memory_sources (memory_id, turn_id, relation) VALUES (?, ?, 'origin')", [
      inserted.id,
      memory.sourceTurnId,
    ]);
  }
  return inserted.id;
}

/** Another turn taught the same thing. Counted once per turn, however often it is replayed. */
export function reinforce(db: Db, memoryId: number, turnId: number, now: number): void {
  const added = db.run(
    "INSERT OR IGNORE INTO memory_sources (memory_id, turn_id, relation) VALUES (?, ?, 'duplicate')",
    [memoryId, turnId],
  ).changes;
  if (added > 0) {
    db.run(
      "UPDATE memories SET evidence_count = evidence_count + 1, updated_at = MAX(updated_at, ?) WHERE id = ?",
      [now, memoryId],
    );
  }
}

/** Keeps the old memory, for history, but takes it out of circulation. */
export function supersede(db: Db, oldId: number, newId: number, now: number): void {
  db.run(
    "UPDATE memories SET status = 'superseded', superseded_by = ?, updated_at = MAX(updated_at, ?) WHERE id = ? AND status = 'active'",
    [newId, now, oldId],
  );
}

export interface Neighbour {
  id: number;
  title: string;
  body: Redacted;
  files: string[];
}

const NEIGHBOUR_QUERY_TERMS = 24;

/** Active memories of the project (or of any of the projects) that share words with `text`, nearest first. */
export function findNeighbours(
  db: Db,
  projectId: number | readonly number[],
  text: string,
  limit: number,
  /** A turn being distilled again must not be compared with its own earlier memory. */
  exceptTurnId: number | null = null,
): Neighbour[] {
  const ids = typeof projectId === "number" ? [projectId] : [...projectId];
  const terms = [...tokens(text)].slice(0, NEIGHBOUR_QUERY_TERMS);
  if (terms.length === 0 || ids.length === 0) return [];
  const inIds = ids.length === 1 ? "= ?" : `IN (${ids.map((id) => Math.trunc(id)).join(", ")})`;
  const rows = db
    .query<{ id: number; title: string; body: string }, (string | number | null)[]>(
      `SELECT m.id, m.title, m.body
         FROM memories_fts CROSS JOIN memories m ON m.id = memories_fts.rowid
        WHERE memories_fts MATCH ? AND m.project_id ${inIds} AND m.status = 'active'
          AND (m.source_turn_id IS NULL OR m.source_turn_id IS NOT ?)
        ORDER BY bm25(memories_fts, 4.0, 1.0, 2.0, 0.0)
        LIMIT ?`,
    )
    .all(
      ...(ids.length === 1
        ? [inProject(anyOf(terms), ids[0] as number), ids[0] as number]
        : [inProjects(anyOf(terms), ids)]),
      exceptTurnId,
      limit,
    );
  const files = db.query<{ path: string }, [number]>(
    "SELECT path FROM memory_files WHERE memory_id = ? ORDER BY path",
  );
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    body: row.body as Redacted,
    files: files.all(row.id).map((file) => file.path),
  }));
}

/** What a teammate's memory carries beside a `NewMemory`: the status and the date as sent. */
export interface ReceivedFields {
  status: "active" | "superseded" | "archived";
  createdAt: number;
}

/**
 * Inserts a received memory (ADR 0027): `insertMemory` as for any memory, then the status and
 * the creation date the server sent, which the insert does not take. The vector is written
 * by the insert when a model is given, else healed later.
 */
export function insertReceivedMemory(
  db: Db,
  memory: NewMemory,
  received: ReceivedFields,
  model: Model | null = null,
): number {
  const id = insertMemory(db, memory, model);
  db.run("UPDATE memories SET status = ?, created_at = ? WHERE id = ?", [
    received.status,
    received.createdAt,
    id,
  ]);
  return id;
}

/**
 * A later revision of a received memory: the row's text, its sent fields and the sender's
 * creation date replaced, and the vector refreshed as `insertMemory`'s update path refreshes
 * it (rewritten with a model, dropped without one), so that a search never matches the old text.
 */
export function updateReceivedMemory(
  db: Db,
  memoryId: number,
  fields: Pick<NewMemory, "kind" | "title" | "body" | "importance" | "now"> & ReceivedFields,
  model: Model | null = null,
): void {
  db.run(
    `UPDATE memories SET title = ?, body = ?, kind = ?, importance = ?, status = ?, created_at = ?,
            updated_at = ?
      WHERE id = ?`,
    [
      fields.title,
      fields.body,
      fields.kind,
      fields.importance,
      fields.status,
      fields.createdAt,
      fields.now,
      memoryId,
    ],
  );
  refreshMemoryVector(db, model, memoryId);
}

/**
 * Deletes a received memory (ADR 0027): a copy of a teammate's, the one exception to
 * "memories are never deleted". Every memory whose `superseded_by` pointed at it is set back
 * to `superseded_by` null and status `active` first, so a row id SQLite reuses inherits
 * nothing; then the tables keyed by memory id that carry no cascade (the provenance row, its
 * `received` ledger row) go, and the row itself, which cascades the rest (`memory_files`,
 * `memory_sources`, `injections`, `memory_vectors`, `user_memories`, `turn_memories`). Plain
 * statements, inside the caller's transaction.
 */
export function deleteReceivedMemory(db: Db, memoryId: number): void {
  db.run("UPDATE memories SET superseded_by = NULL, status = 'active' WHERE superseded_by = ?", [
    memoryId,
  ]);
  const hasProvenance =
    db
      .query<unknown, []>("SELECT 1 FROM sqlite_master WHERE name = 'sharing_received_memories'")
      .get() !== null;
  if (hasProvenance) {
    const provenance = db
      .query<{ server_id: string; remote_uid: string }, [number]>(
        "SELECT server_id, remote_uid FROM sharing_received_memories WHERE memory_id = ?",
      )
      .get(memoryId);
    if (provenance !== null) {
      db.run(
        `DELETE FROM sharing_ledger WHERE destination = ? AND item_kind = 'memory'
            AND item_uid = ? AND direction = 'received'`,
        [provenance.server_id, provenance.remote_uid],
      );
      db.run("DELETE FROM sharing_received_memories WHERE memory_id = ?", [memoryId]);
    }
  }
  db.run("DELETE FROM memories WHERE id = ?", [memoryId]);
}
