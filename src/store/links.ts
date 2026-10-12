import { logError } from "../util/log.ts";
import { type Db, withWrite } from "./db.ts";

export type LinkKind = "product" | "uses";
export type LinkStatus = "suggested" | "confirmed" | "rejected";
export interface Link {
  id: number;
  from: number;
  to: number;
  kind: LinkKind;
  status: LinkStatus;
  origin: "suggested" | "manual";
  signals: string[];
  createdAt: number;
  decidedAt: number | null;
}
export interface Visible {
  id: number;
  name: string;
  relation: "product" | "uses";
}

interface Row {
  id: number;
  from_project: number;
  to_project: number;
  kind: LinkKind;
  status: LinkStatus;
  origin: "suggested" | "manual";
  signals: string;
  created_at: number;
  decided_at: number | null;
}

const COLUMNS =
  "id, from_project, to_project, kind, status, origin, signals, created_at, decided_at";

export function parseSignals(text: string): string[] {
  try {
    const value: unknown = JSON.parse(text);
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function toLink(row: Row): Link {
  return {
    id: row.id,
    from: row.from_project,
    to: row.to_project,
    kind: row.kind,
    status: row.status,
    origin: row.origin,
    signals: parseSignals(row.signals),
    createdAt: row.created_at,
    decidedAt: row.decided_at,
  };
}

/** `product` is stored once per unordered pair, the smaller id first; `uses` keeps its order. */
function normalise(from: number, to: number, kind: LinkKind): [number, number] {
  return kind === "product" && to < from ? [to, from] : [from, to];
}

function find(db: Db, from: number, to: number, kind: LinkKind): Row | null {
  const [f, t] = normalise(from, to, kind);
  return db
    .query<Row, [number, number, LinkKind]>(
      `SELECT ${COLUMNS} FROM project_links WHERE from_project = ? AND to_project = ? AND kind = ?`,
    )
    .get(f, t, kind);
}

export function linkById(db: Db, id: number): Link | null {
  const row = db.query<Row, [number]>(`SELECT ${COLUMNS} FROM project_links WHERE id = ?`).get(id);
  return row ? toLink(row) : null;
}

let logged = false;

/**
 * Projects the current one may read besides itself: confirmed 'product' either way, confirmed
 * 'uses' from it. No chaining. A pair with both reads as 'product'. [] on any error.
 */
export function visibleProjects(db: Db, projectId: number): Visible[] {
  try {
    const rows = db
      .query<{ id: number; name: string; relation: "product" | "uses" }, [number]>(
        `SELECT p.id AS id, p.name AS name,
                CASE WHEN MAX(l.kind = 'product') = 1 THEN 'product' ELSE 'uses' END AS relation
           FROM project_links l
           JOIN projects p ON p.id = CASE WHEN l.from_project = ?1 THEN l.to_project ELSE l.from_project END
          WHERE l.status = 'confirmed' AND p.disabled = 0
            AND ((l.kind = 'product' AND (l.from_project = ?1 OR l.to_project = ?1))
              OR (l.kind = 'uses' AND l.from_project = ?1))
          GROUP BY p.id
          ORDER BY p.name, p.id`,
      )
      .all(projectId);
    return rows;
  } catch (error) {
    if (!logged) {
      logged = true;
      logError("links.visible", error);
    }
    return [];
  }
}

/** Inserts or refreshes a suggestion; never touches a pair that is confirmed or rejected. Returns the link id or null when skipped. */
export function suggestLink(
  db: Db,
  from: number,
  to: number,
  kind: LinkKind,
  signals: string[],
  now: number,
): number | null {
  if (from === to) return null;
  // A pair someone decided on (either direction, any kind) is never suggested again.
  const decided = db
    .query(
      `SELECT 1 FROM project_links
        WHERE status IN ('confirmed', 'rejected')
          AND ((from_project = ?1 AND to_project = ?2) OR (from_project = ?2 AND to_project = ?1))
        LIMIT 1`,
    )
    .get(from, to);
  if (decided) return null;
  const existing = find(db, from, to, kind);
  const json = JSON.stringify(signals);
  if (existing) {
    if (existing.status !== "suggested") return null;
    db.run("UPDATE project_links SET signals = ? WHERE id = ?", [json, existing.id]);
    return existing.id;
  }
  const [f, t] = normalise(from, to, kind);
  try {
    db.run(
      `INSERT INTO project_links (from_project, to_project, kind, status, origin, signals, created_at)
       VALUES (?, ?, ?, 'suggested', 'suggested', ?, ?)`,
      [f, t, kind, json, now],
    );
  } catch {
    return null; // an unknown project
  }
  return find(db, f, t, kind)?.id ?? null;
}

/**
 * Once a row of a pair is decided, the pair is decided: its other suggestions (either direction,
 * any kind) are rejected, so a second kind can never undo the first (a 'product' sibling
 * confirmed after a one-way 'uses' would let the library see the app).
 */
function rejectSiblings(db: Db, keep: number, now: number): void {
  db.run(
    `UPDATE project_links SET status = 'rejected', decided_at = ?1
      WHERE status = 'suggested' AND id <> ?2
        AND EXISTS (SELECT 1 FROM project_links k WHERE k.id = ?2
          AND ((project_links.from_project = k.from_project AND project_links.to_project = k.to_project)
            OR (project_links.from_project = k.to_project AND project_links.to_project = k.from_project)))`,
    [now, keep],
  );
}

/** A link made by hand: confirmed at once (a rejected row for the pair becomes confirmed). Throws on from === to or unknown projects. */
export function linkProjects(db: Db, from: number, to: number, kind: LinkKind, now: number): Link {
  if (from === to) throw new Error("A project cannot be linked to itself");
  return withWrite(db, () => {
    const [f, t] = normalise(from, to, kind);
    const existing = find(db, f, t, kind);
    if (existing) {
      if (existing.status !== "confirmed") {
        db.run(
          "UPDATE project_links SET status = 'confirmed', origin = 'manual', decided_at = ? WHERE id = ?",
          [now, existing.id],
        );
      }
      rejectSiblings(db, existing.id, now);
      return linkById(db, existing.id) as Link;
    }
    for (const id of [f, t]) {
      if (!db.query("SELECT 1 FROM projects WHERE id = ?").get(id)) {
        throw new Error(`Unknown project ${id}`);
      }
    }
    db.run(
      `INSERT INTO project_links (from_project, to_project, kind, status, origin, signals, created_at, decided_at)
       VALUES (?, ?, ?, 'confirmed', 'manual', '[]', ?, ?)`,
      [f, t, kind, now, now],
    );
    const link = toLink(find(db, f, t, kind) as Row);
    rejectSiblings(db, link.id, now);
    return link;
  });
}

/** Decides one row, and with it the pair's other suggestions (rejected). */
export function decideLink(
  db: Db,
  id: number,
  decision: "confirmed" | "rejected",
  now: number,
): Link | null {
  return withWrite(db, () => {
    db.run("UPDATE project_links SET status = ?, decided_at = ? WHERE id = ?", [decision, now, id]);
    rejectSiblings(db, id, now);
    return linkById(db, id);
  });
}

/** A confirmed link goes back to rejected (so it is not suggested again). */
export function unlinkProjects(db: Db, id: number, now: number): Link | null {
  return withWrite(db, () => {
    const link = linkById(db, id);
    if (!link) return null;
    if (link.status === "confirmed") return decideLink(db, id, "rejected", now);
    return link;
  });
}

export function linksOf(db: Db, projectId: number): Link[] {
  return db
    .query<Row, [number, number]>(
      `SELECT ${COLUMNS} FROM project_links WHERE from_project = ? OR to_project = ? ORDER BY id`,
    )
    .all(projectId, projectId)
    .map(toLink);
}

export function isUserMemory(db: Db, memoryId: number): boolean {
  return db.query("SELECT 1 FROM user_memories WHERE memory_id = ?").get(memoryId) !== null;
}
