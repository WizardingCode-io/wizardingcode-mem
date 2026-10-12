import type { ProjectRef } from "../core/project.ts";
import { redact } from "../core/redact.ts";
import { MEMORY_KINDS, type MemoryKind } from "../core/types.ts";
import type { Model } from "../embed/model.ts";
import { refreshMemoryVector } from "../embed/vectors.ts";
import { explicitMatch } from "../retrieve/query.ts";
import { fuseRanks, SEMANTIC_POOL, semanticCandidates } from "../retrieve/semantic.ts";
import { hookLatency } from "../status/report.ts";
import { type Db, withWrite } from "../store/db.ts";
import {
  decideLink,
  type Link,
  type LinkKind,
  linkProjects,
  parseSignals,
  unlinkProjects,
  visibleProjects,
} from "../store/links.ts";
import { inProjects } from "../util/words.ts";

// What the viewer reads and the little it may change, as plain functions over the
// database. The server turns these into HTTP; nothing here knows about requests.

export interface ProjectSummary {
  id: number;
  name: string;
  key: string;
  active: number;
  archived: number;
  superseded: number;
  stale: number;
  lastActivity: number | null;
}

export function listProjects(db: Db): ProjectSummary[] {
  return db
    .query<ProjectSummary, []>(
      `SELECT p.id, p.name, p.key,
              (SELECT count(*) FROM memories m WHERE m.project_id = p.id AND m.status = 'active') AS active,
              (SELECT count(*) FROM memories m WHERE m.project_id = p.id AND m.status = 'archived') AS archived,
              (SELECT count(*) FROM memories m WHERE m.project_id = p.id AND m.status = 'superseded') AS superseded,
              (SELECT count(*) FROM memories m WHERE m.project_id = p.id AND m.status = 'active' AND m.stale = 1) AS stale,
              (SELECT max(x) FROM (SELECT max(last_seen_at) AS x FROM sessions s WHERE s.project_id = p.id
                                   UNION ALL SELECT max(updated_at) FROM memories m WHERE m.project_id = p.id)) AS lastActivity
         FROM projects p
        ORDER BY lastActivity DESC NULLS LAST, p.id`,
    )
    .all();
}

export interface MemoryItem {
  id: number;
  projectId: number;
  kind: MemoryKind;
  title: string;
  importance: number;
  status: string;
  stale: number;
  judge: string;
  origin: string;
  branch: string | null;
  useCount: number;
  createdAt: number;
  updatedAt: number;
  files: string[];
}

export interface MemoryDetail extends MemoryItem {
  body: string;
  judgeVersion: string;
  evidenceCount: number;
  supersededBy: number | null;
  fileRoles: { path: string; role: string }[];
  source: { turnId: number; agent: string; prompt: string; startedAt: number } | null;
}

const ITEM_COLUMNS = `m.id, m.project_id AS projectId, m.kind, m.title, m.importance, m.status, m.stale, m.judge, m.origin, m.branch,
  m.use_count AS useCount, m.created_at AS createdAt, m.updated_at AS updatedAt`;
const STATUSES = new Set(["active", "archived", "superseded", "all"]);
const MAX_LIMIT = 200;
/** How many memories found by words a list search fuses with those found by meaning. */
const LIST_FUSION_WORDS = 500;

type Row = Omit<MemoryItem, "files">;

function attachFiles(db: Db, rows: Row[]): MemoryItem[] {
  const files = db.query<{ path: string }, [number]>(
    "SELECT path FROM memory_files WHERE memory_id = ? AND role = 'changed' ORDER BY path",
  );
  return rows.map((row) => ({ ...row, files: files.all(row.id).map((f) => f.path) }));
}

export interface ListOptions {
  projectId: number;
  /** `linked`: the project and the projects it sees through confirmed links. */
  scope?: string;
  q?: string;
  kind?: string;
  status?: string;
  /** Only memories at least this important (1–5). */
  minImportance?: number;
  limit?: number;
  offset?: number;
}

/** A project alone, or with the projects it sees through confirmed links. */
function groupOf(db: Db, projectId: number, linked: boolean): number[] {
  return linked ? [projectId, ...visibleProjects(db, projectId).map((v) => v.id)] : [projectId];
}

/**
 * A project's memories, newest first, or by relevance when there is a query: by words, and by
 * meaning too when the model is loaded and the list is of active memories.
 */
export function listMemories(
  db: Db,
  options: ListOptions,
  model: Model | null = null,
): { total: number; items: MemoryItem[] } {
  const status =
    options.status !== undefined && STATUSES.has(options.status) ? options.status : "active";
  const kind: string | null =
    options.kind !== undefined && (MEMORY_KINDS as readonly string[]).includes(options.kind)
      ? options.kind
      : null;
  const limit = Math.min(MAX_LIMIT, Math.max(1, options.limit ?? 50));
  const offset = Math.max(0, options.offset ?? 0);
  const floor = Math.min(5, Math.max(1, Math.trunc(options.minImportance ?? 1)));
  const projects = groupOf(db, options.projectId, options.scope === "linked");
  const where = `m.project_id IN (${projects.map(() => "?").join(", ")}) AND (? = 'all' OR m.status = ?) AND (? IS NULL OR m.kind = ?) AND m.importance >= ?`;
  const params: (string | number | null)[] = [...projects, status, status, kind, kind, floor];

  const q = (options.q ?? "").trim();
  if (q !== "") {
    const words = explicitMatch(q);
    // Only active memories have a semantic side.
    const meaning =
      status === "active"
        ? semanticCandidates(db, model, q, {
            projectId: null,
            projectIds: projects,
            kind,
            limit: SEMANTIC_POOL,
          })
        : [];
    if (meaning.length > 0) {
      // The best LIST_FUSION_WORDS by words are enough to fuse with: a page beyond them is
      // never reached by a person scrolling a search.
      const lexical =
        words === null
          ? []
          : db
              .query<{ id: number }, (string | number | null)[]>(
                `SELECT m.id FROM memories_fts CROSS JOIN memories m ON m.id = memories_fts.rowid
                  WHERE memories_fts MATCH ? AND ${where}
                  ORDER BY bm25(memories_fts, 4.0, 1.0, 2.0, 0.0) LIMIT ?`,
              )
              .all(inProjects(words, projects), ...params, LIST_FUSION_WORDS)
              .map((row) => row.id);
      // Found by meaning but outside the list's filters (importance) is dropped.
      const ids = meaning.map((hit) => hit.id);
      const allowed = new Set(
        db
          .query<{ id: number }, (string | number | null)[]>(
            `SELECT m.id FROM memories m
              WHERE m.id IN (${ids.map(() => "?").join(", ")}) AND ${where}`,
          )
          .all(...ids, ...params)
          .map((row) => row.id),
      );
      const fused = fuseRanks([lexical, ids.filter((id) => allowed.has(id))]);
      const page = fused.slice(offset, offset + limit);
      const getRow = db.query<Row, [number]>(
        `SELECT ${ITEM_COLUMNS} FROM memories m WHERE m.id = ?`,
      );
      const rows = page.map((id) => getRow.get(id)).filter((row): row is Row => row !== null);
      return { total: fused.length, items: attachFiles(db, rows) };
    }
    if (words === null) return { total: 0, items: [] };
    const match = inProjects(words, projects);
    const total =
      db
        .query<{ n: number }, (string | number | null)[]>(
          `SELECT count(*) AS n FROM memories_fts CROSS JOIN memories m ON m.id = memories_fts.rowid
            WHERE memories_fts MATCH ? AND ${where}`,
        )
        .get(match, ...params)?.n ?? 0;
    const rows = db
      .query<Row, (string | number | null)[]>(
        `SELECT ${ITEM_COLUMNS} FROM memories_fts CROSS JOIN memories m ON m.id = memories_fts.rowid
          WHERE memories_fts MATCH ? AND ${where}
          ORDER BY bm25(memories_fts, 4.0, 1.0, 2.0, 0.0) LIMIT ? OFFSET ?`,
      )
      .all(match, ...params, limit, offset);
    return { total, items: attachFiles(db, rows) };
  }

  const total =
    db
      .query<{ n: number }, (string | number | null)[]>(
        `SELECT count(*) AS n FROM memories m WHERE ${where}`,
      )
      .get(...params)?.n ?? 0;
  const rows = db
    .query<Row, (string | number | null)[]>(
      `SELECT ${ITEM_COLUMNS} FROM memories m WHERE ${where}
        ORDER BY m.updated_at DESC, m.id DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset);
  return { total, items: attachFiles(db, rows) };
}

export function getMemory(db: Db, id: number): MemoryDetail | null {
  const row = db
    .query<
      Row & {
        body: string;
        judgeVersion: string;
        evidenceCount: number;
        supersededBy: number | null;
        sourceTurnId: number | null;
      },
      [number]
    >(
      `SELECT ${ITEM_COLUMNS}, m.body, m.judge_version AS judgeVersion, m.evidence_count AS evidenceCount,
              m.superseded_by AS supersededBy, m.source_turn_id AS sourceTurnId
         FROM memories m WHERE m.id = ?`,
    )
    .get(id);
  if (row === null) return null;
  const fileRoles = db
    .query<{ path: string; role: string }, [number]>(
      "SELECT path, role FROM memory_files WHERE memory_id = ? ORDER BY role, path",
    )
    .all(id);
  const source =
    row.sourceTurnId === null
      ? null
      : db
          .query<{ turnId: number; agent: string; prompt: string; startedAt: number }, [number]>(
            `SELECT t.id AS turnId, s.agent, substr(t.prompt, 1, 2000) AS prompt, t.started_at AS startedAt
               FROM turns t JOIN sessions s ON s.id = t.session_id WHERE t.id = ?`,
          )
          .get(row.sourceTurnId);
  const { sourceTurnId: _turn, ...rest } = row;
  return {
    ...rest,
    files: fileRoles.filter((f) => f.role === "changed").map((f) => f.path),
    fileRoles,
    source,
  };
}

/** The one change the viewer may make: put a memory away, or bring it back. */
export function setMemoryStatus(
  db: Db,
  id: number,
  status: string,
  now: number,
): "ok" | "not-found" | "invalid" {
  if (status !== "active" && status !== "archived") return "invalid";
  let outcome: "ok" | "not-found" | "invalid" = "not-found";
  withWrite(db, () => {
    const current = db
      .query<{ status: string }, [number]>("SELECT status FROM memories WHERE id = ?")
      .get(id);
    if (current === null) return;
    // A superseded memory has a successor; it is history, not something to bring back.
    if (current.status === "superseded") {
      outcome = "invalid";
      return;
    }
    db.run("UPDATE memories SET status = ?, updated_at = ? WHERE id = ?", [status, now, id]);
    outcome = "ok";
  });
  return outcome;
}

export interface MemoryChanges {
  title?: string;
  body?: string;
  kind?: string;
  importance?: number;
}

/**
 * The user's own correction of a memory. Title, body, kind and importance may change;
 * the memory is then the user's, not a judge's. A superseded memory is history and stays.
 */
export function updateMemory(
  db: Db,
  id: number,
  changes: MemoryChanges,
  now: number,
  /** The semantic model, when loaded: a new text gets a new vector. */
  model: Model | null = null,
): "ok" | "not-found" | "invalid" {
  const allowed = new Set(["title", "body", "kind", "importance"]);
  const keys = Object.keys(changes);
  if (keys.length === 0 || keys.some((key) => !allowed.has(key))) return "invalid";
  if (
    changes.title !== undefined &&
    (typeof changes.title !== "string" || changes.title.trim() === "")
  )
    return "invalid";
  if (changes.body !== undefined && typeof changes.body !== "string") return "invalid";
  if (changes.kind !== undefined && !(MEMORY_KINDS as readonly string[]).includes(changes.kind))
    return "invalid";
  if (
    changes.importance !== undefined &&
    (!Number.isInteger(changes.importance) || changes.importance < 1 || changes.importance > 5)
  )
    return "invalid";
  let outcome: "ok" | "not-found" | "invalid" = "not-found";
  withWrite(db, () => {
    const current = db
      .query<{ status: string }, [number]>("SELECT status FROM memories WHERE id = ?")
      .get(id);
    if (current === null) return;
    if (current.status === "superseded") {
      outcome = "invalid";
      return;
    }
    const sets: string[] = [];
    const params: (string | number)[] = [];
    if (changes.title !== undefined) {
      sets.push("title = ?");
      params.push(redact(changes.title.trim(), { env: process.env }).replace(/\s+/g, " "));
    }
    if (changes.body !== undefined) {
      sets.push("body = ?");
      params.push(redact(changes.body.trim(), { env: process.env }));
    }
    if (changes.kind !== undefined) {
      sets.push("kind = ?");
      params.push(changes.kind);
    }
    if (changes.importance !== undefined) {
      sets.push("importance = ?");
      params.push(changes.importance);
    }
    sets.push("judge = 'user'", "judge_version = '1'", "updated_at = ?");
    params.push(now, id);
    db.run(`UPDATE memories SET ${sets.join(", ")} WHERE id = ?`, params);
    if (changes.title !== undefined || changes.body !== undefined) {
      refreshMemoryVector(db, model, id);
    }
    outcome = "ok";
  });
  return outcome;
}

export interface TurnItem {
  id: number;
  agent: string;
  state: string;
  completeness: string;
  prompt: string;
  startedAt: number;
  endedAt: number | null;
  lastError: string | null;
  /** The memories distilled from this turn. */
  memoryIds: number[];
}

export function recentTurns(db: Db, projectId: number, limit = 50): TurnItem[] {
  return db
    .query<Omit<TurnItem, "memoryIds"> & { memoryIds: string | null }, [number, number]>(
      `SELECT t.id, s.agent, t.state, t.completeness, substr(t.prompt, 1, 1500) AS prompt,
              t.started_at AS startedAt, t.ended_at AS endedAt, t.last_error AS lastError,
              (SELECT group_concat(m.id) FROM memories m WHERE m.source_turn_id = t.id) AS memoryIds
         FROM turns t JOIN sessions s ON s.id = t.session_id
        WHERE t.project_id = ? ORDER BY t.started_at DESC, t.id DESC LIMIT ?`,
    )
    .all(projectId, Math.min(MAX_LIMIT, Math.max(1, limit)))
    .map((row) => ({
      ...row,
      memoryIds: row.memoryIds === null ? [] : row.memoryIds.split(",").map(Number),
    }));
}

export interface TurnDetail extends Omit<TurnItem, "memoryIds"> {
  finalText: string | null;
  filesRead: string[];
  filesChanged: string[];
  commands: string[];
  errors: string[];
  memories: { id: number; title: string; kind: MemoryKind }[];
}

const list = (json: string): string[] => {
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
};

export function getTurn(db: Db, id: number): TurnDetail | null {
  const row = db
    .query<
      Omit<TurnDetail, "filesRead" | "filesChanged" | "commands" | "errors" | "memories"> & {
        filesRead: string;
        filesChanged: string;
        commands: string;
        errors: string;
      },
      [number]
    >(
      `SELECT t.id, s.agent, t.state, t.completeness, t.prompt, t.final_text AS finalText,
              t.files_read AS filesRead, t.files_changed AS filesChanged, t.commands, t.errors,
              t.started_at AS startedAt, t.ended_at AS endedAt, t.last_error AS lastError
         FROM turns t JOIN sessions s ON s.id = t.session_id WHERE t.id = ?`,
    )
    .get(id);
  if (row === null) return null;
  const memories = db
    .query<{ id: number; title: string; kind: MemoryKind }, [number]>(
      "SELECT id, title, kind FROM memories WHERE source_turn_id = ? ORDER BY id",
    )
    .all(id);
  return {
    ...row,
    filesRead: list(row.filesRead),
    filesChanged: list(row.filesChanged),
    commands: list(row.commands),
    errors: list(row.errors),
    memories,
  };
}

export interface ProjectStats {
  byKind: Record<MemoryKind, number>;
  byStatus: { active: number; archived: number; superseded: number };
  stale: number;
  byImportance: Record<"1" | "2" | "3" | "4" | "5", number>;
  byJudge: Record<string, number>;
  turns: Record<string, number>;
  /** The last eight weeks, oldest first: memories kept (created, still active) and turns started. */
  weekly: { weekStart: number; memories: number; turns: number }[];
  hooks: { event: string; p50: number; p95: number; runs: number }[];
}

const WEEK_MS = 7 * 86_400_000;

export function projectStats(db: Db, projectId: number, now: number): ProjectStats | null {
  if (db.query("SELECT 1 FROM projects WHERE id = ?").get(projectId) === null) return null;
  const count = <K extends string>(sql: string, keys: readonly K[]): Record<K, number> => {
    const out = Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
    for (const row of db.query<{ k: K | number; n: number }, [number]>(sql).all(projectId)) {
      out[String(row.k) as K] = row.n;
    }
    return out;
  };
  const byKind = count(
    "SELECT kind AS k, count(*) AS n FROM memories WHERE project_id = ? AND status = 'active' GROUP BY kind",
    MEMORY_KINDS,
  );
  const byStatus = count(
    "SELECT status AS k, count(*) AS n FROM memories WHERE project_id = ? GROUP BY status",
    ["active", "archived", "superseded"] as const,
  );
  const byImportance = count(
    "SELECT importance AS k, count(*) AS n FROM memories WHERE project_id = ? AND status = 'active' GROUP BY importance",
    ["1", "2", "3", "4", "5"] as const,
  );
  const byJudge: Record<string, number> = {};
  for (const row of db
    .query<{ k: string; n: number }, [number]>(
      "SELECT judge AS k, count(*) AS n FROM memories WHERE project_id = ? AND status = 'active' GROUP BY judge ORDER BY n DESC",
    )
    .all(projectId)) {
    byJudge[row.k] = row.n;
  }
  const turns: Record<string, number> = {};
  for (const row of db
    .query<{ k: string; n: number }, [number]>(
      "SELECT state AS k, count(*) AS n FROM turns WHERE project_id = ? GROUP BY state",
    )
    .all(projectId)) {
    turns[row.k] = row.n;
  }
  const stale =
    db
      .query<{ n: number }, [number]>(
        "SELECT count(*) AS n FROM memories WHERE project_id = ? AND status = 'active' AND stale = 1",
      )
      .get(projectId)?.n ?? 0;
  const weekly: ProjectStats["weekly"] = [];
  for (let i = 7; i >= 0; i--) {
    const end = now - i * WEEK_MS;
    const start = end - WEEK_MS;
    weekly.push({
      weekStart: start,
      memories:
        db
          .query<{ n: number }, [number, number, number]>(
            "SELECT count(*) AS n FROM memories WHERE project_id = ? AND status = 'active' AND created_at > ? AND created_at <= ?",
          )
          .get(projectId, start, end)?.n ?? 0,
      turns:
        db
          .query<{ n: number }, [number, number, number]>(
            "SELECT count(*) AS n FROM turns WHERE project_id = ? AND started_at > ? AND started_at <= ?",
          )
          .get(projectId, start, end)?.n ?? 0,
    });
  }
  return {
    byKind,
    byStatus,
    stale,
    byImportance,
    byJudge,
    turns,
    weekly,
    hooks: hookLatency(db).latency,
  };
}

export interface SearchHit {
  id: number;
  projectId: number;
  projectName: string;
  title: string;
  kind: MemoryKind;
  importance: number;
}

const HIT_COLUMNS =
  "m.id, m.project_id AS projectId, p.name AS projectName, m.title, m.kind, m.importance";

/**
 * Active memories of every project matching a query, best first; for the command palette.
 * With the model, those that mean what was typed are fused in.
 */
export function searchAll(
  db: Db,
  q: string,
  limit = 20,
  model: Model | null = null,
  projectId: number | null = null,
): SearchHit[] {
  const query = q.trim();
  const match = explicitMatch(query);
  const max = Math.min(MAX_LIMIT, Math.max(1, limit));
  // With a project: that project and the projects it sees; without, every project.
  const projects = projectId === null ? null : groupOf(db, projectId, true);
  const meaning = semanticCandidates(db, model, query, {
    projectId: null,
    ...(projects === null ? {} : { projectIds: projects }),
    limit: Math.max(max, SEMANTIC_POOL),
  });
  if (match === null && meaning.length === 0) return [];
  const lexical =
    match === null
      ? []
      : db
          .query<SearchHit, [string, number]>(
            `SELECT ${HIT_COLUMNS}
               FROM memories_fts CROSS JOIN memories m ON m.id = memories_fts.rowid
               JOIN projects p ON p.id = m.project_id
              WHERE memories_fts MATCH ? AND m.status = 'active'
              ORDER BY bm25(memories_fts, 4.0, 1.0, 2.0, 0.0) LIMIT ?`,
          )
          .all(
            projects === null ? `{title body terms} : (${match})` : inProjects(match, projects),
            meaning.length === 0 ? max : Math.max(max, SEMANTIC_POOL),
          );
  if (meaning.length === 0) return lexical;
  const hits = new Map(lexical.map((hit) => [hit.id, hit]));
  const getHit = db.query<SearchHit, [number]>(
    `SELECT ${HIT_COLUMNS} FROM memories m JOIN projects p ON p.id = m.project_id
      WHERE m.id = ? AND m.status = 'active'`,
  );
  const out: SearchHit[] = [];
  for (const id of fuseRanks([lexical.map((hit) => hit.id), meaning.map((hit) => hit.id)])) {
    const hit = hits.get(id) ?? getHit.get(id);
    if (hit !== null && hit !== undefined) out.push(hit);
    if (out.length === max) break;
  }
  return out;
}

/** A project as the status report wants it; the viewer has no working tree to inspect. */
export function projectRef(db: Db, id: number): ProjectRef | null {
  const row = db
    .query<{ id: number; key: string; name: string; disabled: number }, [number]>(
      "SELECT id, key, name, disabled FROM projects WHERE id = ?",
    )
    .get(id);
  if (row === null) return null;
  const root =
    db
      .query<{ alias: string }, [number]>(
        "SELECT alias FROM project_aliases WHERE project_id = ? AND alias LIKE 'path:%' LIMIT 1",
      )
      .get(id)
      ?.alias.slice("path:".length) ?? "";
  return { ...row, root, branch: null, commit: null, disabled: row.disabled === 1 };
}

export interface LinkView extends Link {
  fromName: string;
  toName: string;
}

/** Every link, with its projects' names, and the suggestions waiting for a decision. */
export function listLinks(db: Db): {
  links: LinkView[];
  pending: { total: number; byProject: Record<string, number> };
} {
  const links = db
    .query<
      {
        id: number;
        from: number;
        fromName: string;
        to: number;
        toName: string;
        kind: LinkKind;
        status: Link["status"];
        origin: Link["origin"];
        signals: string;
        createdAt: number;
        decidedAt: number | null;
      },
      []
    >(
      `SELECT l.id, l.from_project AS "from", f.name AS fromName, l.to_project AS "to", t.name AS toName,
              l.kind, l.status, l.origin, l.signals, l.created_at AS createdAt, l.decided_at AS decidedAt
         FROM project_links l JOIN projects f ON f.id = l.from_project JOIN projects t ON t.id = l.to_project
        ORDER BY l.id`,
    )
    .all()
    .map((row) => ({ ...row, signals: parseSignals(row.signals) }));
  const byProject: Record<string, number> = {};
  let total = 0;
  for (const link of links) {
    if (link.status !== "suggested") continue;
    total++;
    for (const id of [link.from, link.to]) byProject[id] = (byProject[id] ?? 0) + 1;
  }
  return { links, pending: { total, byProject } };
}

function linkView(db: Db, id: number): LinkView | null {
  return listLinks(db).links.find((link) => link.id === id) ?? null;
}

/** A link made in the viewer: confirmed at once. A string is the reason it was refused. */
export function addLink(db: Db, body: Record<string, unknown>, now: number): LinkView | string {
  const { from, to, kind } = body;
  if (!Number.isInteger(from) || !Number.isInteger(to)) return "from and to must be project ids";
  if (kind !== "product" && kind !== "uses") return "kind must be product or uses";
  if (from === to) return "a project cannot be linked to itself";
  try {
    return linkView(db, linkProjects(db, from as number, to as number, kind, now).id) as LinkView;
  } catch {
    return "no such project";
  }
}

/**
 * Confirm or reject a suggestion, or end a confirmed link. Only a suggestion can be decided,
 * only a confirmed link unlinked: linking a rejected pair again goes through addLink.
 */
export function changeLink(
  db: Db,
  id: number,
  change: "confirm" | "reject" | "unlink",
  now: number,
): LinkView | "not-found" | "conflict" {
  const link = linkView(db, id);
  if (link === null) return "not-found";
  if (change === "unlink") {
    if (link.status !== "confirmed") return "conflict";
    unlinkProjects(db, id, now);
  } else {
    if (link.status !== "suggested") return "conflict";
    decideLink(db, id, change === "confirm" ? "confirmed" : "rejected", now);
  }
  return linkView(db, id) as LinkView;
}
