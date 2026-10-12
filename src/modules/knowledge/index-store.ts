import { explicitMatch } from "../../retrieve/query.ts";
import { type Db, withWrite } from "../../store/db.ts";
import {
  fingerprint,
  type KnowledgeEntry,
  type KnowledgeKind,
  type KnowledgeStatus,
  readEntries,
} from "./files.ts";

// The knowledge index (K2): each project's entries copied from its folder into the
// database, so hooks and tools can search them without reading files. It carries no truth:
// delete it and the next refresh rebuilds it from the files.

interface EntryRow {
  slug: string;
  path: string;
  title: string;
  kind: string;
  essential: number;
  status: string;
  tags: string;
  updated: string | null;
  source: string | null;
  body: string;
  problem: string | null;
}

const COLUMNS =
  "e.slug, e.path, e.title, e.kind, e.essential, e.status, e.tags, e.updated, e.source, e.body, e.problem";

function toEntry(row: EntryRow): KnowledgeEntry {
  let tags: string[] = [];
  try {
    const parsed: unknown = JSON.parse(row.tags);
    if (Array.isArray(parsed)) tags = parsed.filter((tag) => typeof tag === "string");
  } catch {
    // Written by this code only; an unreadable value means no tags.
  }
  return {
    slug: row.slug,
    path: row.path,
    title: row.title,
    kind: row.kind as KnowledgeKind,
    essential: row.essential === 1,
    status: row.status as KnowledgeStatus,
    tags,
    updated: row.updated,
    source: row.source,
    body: row.body,
    problem: row.problem,
  };
}

/** Everything the index stores of an entry; equal hashes mean nothing to rewrite. */
function hashOf(entry: KnowledgeEntry): string {
  return Bun.hash(JSON.stringify(entry)).toString(16);
}

/**
 * Brings the project's index in line with its folder. Skipped (no files read, nothing
 * written) when the folder's fingerprint is the one recorded at the last refresh, unless
 * `force`. Otherwise the files are read outside any lock, then new and changed entries are
 * written and entries whose file is gone are removed, in one transaction. A folder that is
 * gone empties the project's index. `indexed` counts the entries written (new or changed).
 */
export function refreshIndex(
  db: Db,
  projectId: number,
  dir: string,
  options: { force?: boolean } = {},
): { indexed: number; skipped: boolean } {
  const current = fingerprint(dir);
  const state = db
    .query<{ fingerprint: string | null }, [number]>(
      "SELECT fingerprint FROM knowledge_state WHERE project_id = ?",
    )
    .get(projectId);
  // No record and no folder: nothing was ever indexed, and nothing is written.
  if (options.force !== true && (state?.fingerprint ?? null) === current) {
    return { indexed: 0, skipped: true };
  }
  const entries = current === null ? [] : readEntries(dir);
  return withWrite(db, () => {
    const known = new Map(
      db
        .query<{ slug: string; hash: string }, [number]>(
          "SELECT slug, hash FROM knowledge_entries WHERE project_id = ?",
        )
        .all(projectId)
        .map((row) => [row.slug, row.hash]),
    );
    const upsert = db.query(
      `INSERT INTO knowledge_entries
         (project_id, slug, path, title, kind, essential, status, tags, updated, source, body, problem, hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (project_id, slug) DO UPDATE SET
         path = excluded.path, title = excluded.title, kind = excluded.kind,
         essential = excluded.essential, status = excluded.status, tags = excluded.tags,
         updated = excluded.updated, source = excluded.source, body = excluded.body,
         problem = excluded.problem, hash = excluded.hash`,
    );
    let indexed = 0;
    for (const entry of entries) {
      const hash = hashOf(entry);
      const before = known.get(entry.slug);
      known.delete(entry.slug);
      if (before === hash) continue;
      upsert.run(
        projectId,
        entry.slug,
        entry.path,
        entry.title,
        entry.kind,
        entry.essential ? 1 : 0,
        entry.status,
        JSON.stringify(entry.tags),
        entry.updated,
        entry.source,
        entry.body,
        entry.problem,
        hash,
      );
      indexed++;
    }
    const remove = db.query("DELETE FROM knowledge_entries WHERE project_id = ? AND slug = ?");
    for (const slug of known.keys()) remove.run(projectId, slug);
    db.query(
      `INSERT INTO knowledge_state (project_id, fingerprint, indexed_at) VALUES (?, ?, ?)
       ON CONFLICT (project_id) DO UPDATE SET fingerprint = excluded.fingerprint, indexed_at = excluded.indexed_at`,
    ).run(projectId, current, Date.now());
    return { indexed, skipped: false };
  });
}

/**
 * The project's entries matching the query (title, tags and body, title weighed most),
 * best first, every status included: the caller decides what may be shown. `score` is
 * the negated bm25, so higher is better. Empty when the query has nothing searchable.
 */
export function searchKnowledge(
  db: Db,
  projectId: number,
  query: string,
  limit: number,
): (KnowledgeEntry & { score: number })[] {
  const match = explicitMatch(query);
  if (match === null || limit <= 0) return [];
  return db
    .query<EntryRow & { bm25: number }, [string, number, number]>(
      `SELECT ${COLUMNS}, f.bm25
         FROM (SELECT slug, bm25(knowledge_fts, 4.0, 2.0, 1.0, 0.0, 0.0) AS bm25
                 FROM knowledge_fts WHERE knowledge_fts MATCH ?) f
         JOIN knowledge_entries e ON e.project_id = ? AND e.slug = f.slug
        ORDER BY f.bm25, e.slug LIMIT ?`,
    )
    .all(`{title tags body} : (${match}) AND project_id : "${projectId}"`, projectId, limit)
    .map(({ bm25, ...row }) => ({ ...toEntry(row), score: -bm25 }));
}

/** The project's essential, active entries, most recently updated first (undated last). */
export function essentialEntries(db: Db, projectId: number): KnowledgeEntry[] {
  return db
    .query<EntryRow, [number]>(
      `SELECT ${COLUMNS} FROM knowledge_entries e
        WHERE e.project_id = ? AND e.essential = 1 AND e.status = 'active'
        ORDER BY e.updated IS NULL, e.updated DESC, e.slug`,
    )
    .all(projectId)
    .map(toEntry);
}
