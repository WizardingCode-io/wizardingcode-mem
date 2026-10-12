import { readGitInfo } from "../../core/git.ts";
import type { MemoryKind } from "../../core/types.ts";
import { type Db, withWrite } from "../../store/db.ts";
import { claimLease, getMeta, releaseLease, setMeta } from "../../store/meta.ts";
import { logError } from "../../util/log.ts";
import { folderProblem, type KnowledgeKind, knowledgeDir, slugify } from "./files.ts";
import { refreshIndex } from "./index-store.ts";
import { checkSlug, prepareFolder, renderEntry, today, writeNewEntry } from "./write.ts";

// Memories worth keeping, proposed as knowledge (spec "Promotion from memory"). In the
// background drain, bounded like the rule proposals (ADR 0018): a cursor, a lease and a
// compare-and-set, so that a quiet drain costs two lookups. Exact rules, no judge: an
// active decision or convention of importance 4 or more that agents were shown at least 3
// times, or that is one of the author's own rules. Proposing writes nothing to a
// repository; only accepting does, on the author's click, and only where knowledge is on.

const KINDS = "('decision', 'convention')";
const MIN_IMPORTANCE = 4;
const MIN_SHOWN = 3;
/** Memories (new or changed) one pass looks at, at most. */
const BATCH = 500;
/** Injection records one pass reads, at most. */
const INJECTION_BATCH = 5000;
const MAX_MS = 2000;
const CURSOR_KEY = "knowledge.promote.cursor";
/** One proposing process at a time. */
export const PROMOTE_LEASE = "knowledge.promote.lease";

/** A memory's kind as an entry's: a decision stays one, a convention is a rule. */
const ENTRY_KIND: Record<string, KnowledgeKind> = { decision: "decision", convention: "rule" };

/**
 * Two walks, each only forward: the injection records by id (a memory shown once more may now
 * qualify) and the memories by `(updated_at, id)` (new ones, and ones raised in importance,
 * re-kinded or brought back).
 */
interface Cursor {
  injectionId: number;
  updatedAt: number;
  id: number;
}

const START: Cursor = { injectionId: 0, updatedAt: Number.MIN_SAFE_INTEGER, id: 0 };

function readCursor(db: Db): Cursor {
  try {
    const value = JSON.parse(getMeta(db, CURSOR_KEY) ?? "null") as Partial<Cursor> | null;
    return value &&
      typeof value.injectionId === "number" &&
      typeof value.updatedAt === "number" &&
      typeof value.id === "number"
      ? { injectionId: value.injectionId, updatedAt: value.updatedAt, id: value.id }
      : START;
  } catch {
    return START;
  }
}

const later = (a: { updatedAt: number; id: number }, b: { updatedAt: number; id: number }) =>
  a.updatedAt > b.updatedAt || (a.updatedAt === b.updatedAt && a.id > b.id);

/** Compare-and-set: each walk only moves forward, whoever wrote last. */
function advanceCursor(db: Db, next: Cursor): void {
  withWrite(db, () => {
    const stored = readCursor(db);
    const merged: Cursor = {
      injectionId: Math.max(stored.injectionId, next.injectionId),
      ...(later(next, stored)
        ? { updatedAt: next.updatedAt, id: next.id }
        : { updatedAt: stored.updatedAt, id: stored.id }),
    };
    setMeta(db, CURSOR_KEY, JSON.stringify(merged));
  });
}

/**
 * The project's working tree, from the folder its latest session ran in (the git root, or
 * the folder itself outside git); null when no session is known.
 */
export function projectRoot(db: Db, projectId: number): string | null {
  const cwd = db
    .query<{ cwd: string }, [number]>(
      "SELECT cwd FROM sessions WHERE project_id = ? ORDER BY last_seen_at DESC, id DESC LIMIT 1",
    )
    .get(projectId)?.cwd;
  if (cwd === undefined) return null;
  try {
    return readGitInfo(cwd)?.root ?? cwd;
  } catch {
    return cwd;
  }
}

/** The basic rule, on one memory row `m`: what a candidate must be whatever it was shown. */
const ELIGIBLE = `m.status = 'active' AND m.kind IN ${KINDS} AND m.importance >= ${MIN_IMPORTANCE}`;

/**
 * Proposes the memories that qualify among those shown or changed since the last pass. Only
 * proposes: no file is written, nothing in memory changes. With nothing new, two lookups
 * and out; past `maxMs` the pass stops and the cursor stays, so a later pass does the rest
 * (a memory already proposed is not proposed twice).
 */
export function proposePromotions(
  db: Db,
  deps: {
    now: number;
    /** Where the home folder and the brand's home are; the process's environment by default. */
    env?: Record<string, string | undefined>;
    batch?: number;
    injectionBatch?: number;
    maxMs?: number;
    owner?: string;
  },
): { proposed: number; scanned: number } {
  const none = { proposed: 0, scanned: 0 };
  const cursor = readCursor(db);
  const maxInjection =
    db.query<{ n: number | null }, []>("SELECT max(id) AS n FROM injections").get()?.n ?? 0;
  const newest = db
    .query<{ updatedAt: number; id: number }, []>(
      "SELECT updated_at AS updatedAt, id FROM memories ORDER BY updated_at DESC, id DESC LIMIT 1",
    )
    .get();
  if (maxInjection <= cursor.injectionId && (newest === null || !later(newest, cursor))) {
    return none;
  }
  const maxMs = deps.maxMs ?? MAX_MS;
  const owner = deps.owner ?? `${process.pid}-${crypto.randomUUID()}`;
  if (!claimLease(db, PROMOTE_LEASE, owner, Date.now(), maxMs + 60_000)) return none;
  try {
    return propose(db, deps, cursor, maxMs);
  } finally {
    releaseLease(db, PROMOTE_LEASE, owner);
  }
}

interface Qualified {
  id: number;
  projectId: number;
  title: string;
}

function propose(
  db: Db,
  deps: Parameters<typeof proposePromotions>[1],
  from: Cursor,
  maxMs: number,
): { proposed: number; scanned: number } {
  const deadline = performance.now() + maxMs;
  const batch = deps.batch ?? BATCH;
  const injectionBatch = deps.injectionBatch ?? INJECTION_BATCH;
  // One snapshot of both walks.
  const [shown, changed, maxInjection, newest] = db.transaction(() => {
    const shownRows = db
      .query<{ id: number; memoryId: number }, [number, number]>(
        "SELECT id, memory_id AS memoryId FROM injections WHERE id > ? ORDER BY id LIMIT ?",
      )
      .all(from.injectionId, injectionBatch);
    const changedRows = db
      .query<{ id: number; updatedAt: number }, [number, number, number]>(
        `SELECT m.id AS id, m.updated_at AS updatedAt FROM memories m
          WHERE (m.updated_at, m.id) > (?, ?) AND ${ELIGIBLE}
          ORDER BY m.updated_at, m.id LIMIT ?`,
      )
      .all(from.updatedAt, from.id, batch);
    const top =
      db.query<{ n: number | null }, []>("SELECT max(id) AS n FROM injections").get()?.n ?? 0;
    const latest = db
      .query<{ updatedAt: number; id: number }, []>(
        "SELECT updated_at AS updatedAt, id FROM memories ORDER BY updated_at DESC, id DESC LIMIT 1",
      )
      .get();
    return [shownRows, changedRows, top, latest] as const;
  })();

  const touched = [...new Set([...shown.map((row) => row.memoryId), ...changed.map((r) => r.id)])];
  let proposed = 0;
  if (touched.length > 0) {
    const ids = touched.map((n) => Math.trunc(n)).join(", ");
    // The basic rule, in a project with memory on, never proposed before.
    const candidates = db
      .query<Qualified & { rule: number }, []>(
        `SELECT m.id AS id, m.project_id AS projectId, m.title AS title,
                EXISTS (SELECT 1 FROM user_memories u WHERE u.memory_id = m.id) AS rule
           FROM memories m JOIN projects p ON p.id = m.project_id AND p.disabled = 0
          WHERE m.id IN (${ids}) AND ${ELIGIBLE}
            AND NOT EXISTS (SELECT 1 FROM knowledge_proposals k WHERE k.memory_id = m.id)
            AND NOT EXISTS (SELECT 1 FROM promoted_memories pm WHERE pm.memory_id = m.id)
          ORDER BY m.id`,
      )
      .all();
    // How often each was shown, in one pass over the record (only for those that need it).
    const counted = candidates.filter((c) => c.rule === 0).map((c) => c.id);
    const times = new Map<number, number>();
    if (counted.length > 0) {
      for (const row of db
        .query<{ id: number; n: number }, []>(
          `SELECT memory_id AS id, count(*) AS n FROM injections
            WHERE memory_id IN (${counted.join(", ")}) GROUP BY memory_id`,
        )
        .all()) {
        times.set(row.id, row.n);
      }
    }
    const roots = new Map<number, string | null>();
    const rootOf = (projectId: number): string | null => {
      if (!roots.has(projectId)) {
        const root = projectRoot(db, projectId);
        // Where knowledge is off (the home folder, a linked folder) nothing could be accepted.
        roots.set(
          projectId,
          root !== null && folderProblem(root, deps.env ?? process.env) === null ? root : null,
        );
      }
      return roots.get(projectId) ?? null;
    };
    const insert = db.query(
      `INSERT OR IGNORE INTO knowledge_proposals (project_id, memory_id, slug, status, created_at)
       VALUES (?, ?, ?, 'proposed', ?)`,
    );
    for (const candidate of candidates) {
      // Out of time: the cursor stays where it was, and a later pass looks again.
      if (performance.now() > deadline) return { proposed, scanned: 0 };
      if (candidate.rule === 0 && (times.get(candidate.id) ?? 0) < MIN_SHOWN) continue;
      if (rootOf(candidate.projectId) === null) continue;
      proposed += insert.run(
        candidate.projectId,
        candidate.id,
        slugify(candidate.title),
        deps.now,
      ).changes;
    }
  }

  // Each walk moves past what it read; one that read less than its batch reached the end.
  const lastShown = shown.at(-1);
  const lastChanged = changed.at(-1);
  advanceCursor(db, {
    injectionId:
      shown.length < injectionBatch
        ? Math.max(from.injectionId, maxInjection)
        : (lastShown?.id ?? from.injectionId),
    ...(changed.length < batch && newest !== null && later(newest, from)
      ? newest
      : lastChanged !== undefined
        ? { updatedAt: lastChanged.updatedAt, id: lastChanged.id }
        : { updatedAt: from.updatedAt, id: from.id }),
  });
  return { proposed, scanned: touched.length };
}

/** Never throws: a failure here must not change the drain's outcome. */
export function proposePromotionsSafely(db: Db, now: number): number {
  try {
    return proposePromotions(db, { now }).proposed;
  } catch (error) {
    logError("knowledge.promote", error);
    return 0;
  }
}

export interface Promotion {
  id: number;
  projectId: number;
  memoryId: number;
  slug: string;
  title: string;
  body: string;
  kind: MemoryKind;
  createdAt: number;
}

/** The open proposals, newest first; of one project when given. */
export function listPromotions(db: Db, projectId?: number): Promotion[] {
  return db
    .query<Promotion, [number | null]>(
      `SELECT k.id AS id, k.project_id AS projectId, k.memory_id AS memoryId, k.slug AS slug,
              m.title AS title, m.body AS body, m.kind AS kind, k.created_at AS createdAt
         FROM knowledge_proposals k JOIN memories m ON m.id = k.memory_id
        WHERE k.status = 'proposed' AND (?1 IS NULL OR k.project_id = ?1)
        ORDER BY k.created_at DESC, k.id DESC`,
    )
    .all(projectId ?? null);
}

/** Tried after the proposal's own name when a file already has it. */
const MAX_TRIES = 20;

function nameFor(slug: string, n: number): string | null {
  if (n === 1) return slug;
  const suffix = `-${n}`;
  const name = `${slug.slice(0, 80 - suffix.length).replace(/-+$/, "")}${suffix}`;
  return "slug" in checkSlug(name) ? name : null;
}

/**
 * Makes a proposal knowledge, on the author's click: writes the entry file (the memory's
 * title and body as they are now, decision→decision, convention→rule, `source:
 * memory:<id>`) under a name no file has, indexes it, and marks the memory promoted, so
 * memory leaves its notes to the entry while the entry exists. Refused, with nothing
 * written, where knowledge is off (the home folder, the brand's home, a linked folder),
 * where memory is off, or when the memory is no longer an active decision or convention.
 */
export function acceptPromotion(
  db: Db,
  id: number,
  options: {
    now: number;
    env?: Record<string, string | undefined>;
    /** The project's working tree; found from its latest session when left out. */
    root?: string;
  },
): { slug: string; path: string } | { refused: string } {
  const env = options.env ?? process.env;
  // One decision at a time: a second click waits, then finds the proposal decided.
  return withWrite(db, () => {
    const proposal = db
      .query<{ projectId: number; memoryId: number; slug: string; status: string }, [number]>(
        `SELECT project_id AS projectId, memory_id AS memoryId, slug, status
           FROM knowledge_proposals WHERE id = ?`,
      )
      .get(id);
    if (proposal === null) return { refused: `No proposal #${id}.` };
    if (proposal.status !== "proposed") {
      return { refused: `Proposal #${id} is already ${proposal.status}.` };
    }
    const memory = db
      .query<
        { title: string; body: string; kind: string; status: string; disabled: number },
        [number]
      >(
        `SELECT m.title, m.body, m.kind, m.status, p.disabled
           FROM memories m JOIN projects p ON p.id = m.project_id WHERE m.id = ?`,
      )
      .get(proposal.memoryId);
    if (memory === null) return { refused: `The memory behind proposal #${id} is gone.` };
    if (memory.disabled === 1) {
      return { refused: "Memory is off for this project; nothing was written." };
    }
    const kind = ENTRY_KIND[memory.kind];
    if (memory.status !== "active" || kind === undefined) {
      return {
        refused: `The memory behind proposal #${id} is no longer an active decision or convention; nothing was written.`,
      };
    }
    const root = options.root ?? projectRoot(db, proposal.projectId);
    if (root === null) {
      return { refused: "Where this project lives is not known yet; nothing was written." };
    }
    const problem = folderProblem(root, env);
    if (problem !== null) return { refused: `${problem} Nothing was written.` };
    const prepared = prepareFolder(root, env);
    if ("refused" in prepared) return prepared;
    const { dir } = prepared;
    const text = renderEntry(
      {
        title: memory.title,
        kind,
        essential: false,
        status: "active",
        updated: today(options.now),
        source: `memory:${proposal.memoryId}`,
      },
      memory.body,
    );
    let written: { slug: string; path: string } | null = null;
    for (let n = 1; n <= MAX_TRIES && written === null; n++) {
      const slug = nameFor(proposal.slug, n);
      if (slug === null) continue;
      const result = writeNewEntry(dir, slug, text, () => folderProblem(root, env));
      if ("refused" in result) return result;
      if ("path" in result) written = { slug, path: result.path };
    }
    if (written === null) {
      return { refused: `No free name for "${proposal.slug}" in ${dir}; nothing was written.` };
    }
    refreshIndex(db, proposal.projectId, knowledgeDir(root), { force: true });
    db.run(
      `INSERT OR REPLACE INTO promoted_memories (memory_id, project_id, slug, promoted_at)
       VALUES (?, ?, ?, ?)`,
      [proposal.memoryId, proposal.projectId, written.slug, options.now],
    );
    db.run(
      "UPDATE knowledge_proposals SET status = 'accepted', slug = ?, decided_at = ? WHERE id = ?",
      [written.slug, options.now, id],
    );
    return written;
  });
}

/** True when the proposal was open and is now rejected; its memory is never proposed again. */
export function rejectPromotion(db: Db, id: number, now: number): boolean {
  return (
    db.run(
      "UPDATE knowledge_proposals SET status = 'rejected', decided_at = ? WHERE id = ? AND status = 'proposed'",
      [now, id],
    ).changes > 0
  );
}
