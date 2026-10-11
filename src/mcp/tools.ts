import { realpathSync } from "node:fs";
import { type Redacted, redact } from "../core/redact.ts";
import type { MemoryKind } from "../core/types.ts";
import { consolidate } from "../distill/consolidate.ts";
import { TITLE_MAX_CHARS } from "../distill/policy.ts";
import { splitSentences } from "../distill/segment.ts";
import type { Model } from "../embed/model.ts";
import type { Judge } from "../judge/types.ts";
import { MEMORY_COLUMNS, type MemoryRow, prior, ranks, toNote } from "../retrieve/notes.ts";
import { explicitMatch } from "../retrieve/query.ts";
import { renderHeading, renderNote } from "../retrieve/render.ts";
import { type Db, withWrite } from "../store/db.ts";
import { insertMemory, supersede } from "../store/memories.ts";
import { clip } from "../util/text.ts";
import { inProject, searchTerms } from "../util/words.ts";

// What the three MCP tools do, as plain functions over a database. The server in
// server.ts only adapts them to the protocol.

export interface ToolContext {
  db: Db;
  judge: Judge;
  /** null: every project (Claude Desktop's chat, which has no project folder). */
  projectId: number | null;
  /** The project's working tree: file paths are stored relative to it. */
  root: string;
  branch: string | null;
  now: number;
  /** The semantic model, when loaded: a saved memory gets its vector. */
  model?: Model | null;
}

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;
const SEARCH_POOL = 50;
const MAX_IDS = 20;
const BODY_MAX_CHARS = 2000;
const MAX_FILES = 10;
const RRF_K = 60;

/**
 * Finds memories by words, symbols or file names and answers with one heading per
 * memory. Unlike injection, an explicit search asks for no evidence: one word is enough.
 */
export function searchMemories(
  context: ToolContext,
  args: { query: string; kind?: MemoryKind; limit?: number },
): string {
  const { db, projectId } = context;
  const limit = Math.min(MAX_LIMIT, Math.max(1, Math.trunc(args.limit ?? DEFAULT_LIMIT)));
  const kind = args.kind ?? null;

  let rows: (MemoryRow & { projectId: number })[];
  if (args.query.trim() === "") {
    rows = db
      .query<
        MemoryRow & { projectId: number },
        [number | null, number | null, string | null, string | null, number]
      >(
        `SELECT ${MEMORY_COLUMNS}, m.project_id AS projectId FROM memories m
          WHERE (? IS NULL OR m.project_id = ?) AND m.status = 'active' AND (? IS NULL OR m.kind = ?)
          ORDER BY m.importance DESC, m.updated_at DESC LIMIT ?`,
      )
      .all(projectId, projectId, kind, kind, SEARCH_POOL)
      .sort((a, b) => prior(b, context) - prior(a, context) || b.id - a.id);
  } else {
    const match = explicitMatch(args.query);
    if (match === null) return "No memories match.";
    const found = db
      .query<
        MemoryRow & { projectId: number; bm25: number },
        [string, number | null, number | null, string | null, string | null, number]
      >(
        `SELECT ${MEMORY_COLUMNS}, m.project_id AS projectId, bm25(memories_fts, 4.0, 1.0, 2.0, 0.0) AS bm25
           FROM memories_fts CROSS JOIN memories m ON m.id = memories_fts.rowid
          WHERE memories_fts MATCH ? AND (? IS NULL OR m.project_id = ?) AND m.status = 'active'
            AND (? IS NULL OR m.kind = ?)
          ORDER BY bm25 LIMIT ?`,
      )
      .all(
        projectId === null ? `{title body terms} : (${match})` : inProject(match, projectId),
        projectId,
        projectId,
        kind,
        kind,
        SEARCH_POOL,
      );
    const byText = ranks(found, (row) => -row.bm25);
    const byPrior = ranks(found, (row) => prior(row, context));
    const fused = (row: MemoryRow & { projectId: number; bm25: number }) =>
      1 / (RRF_K + (byText.get(row) ?? 0)) + 1 / (RRF_K + (byPrior.get(row) ?? 0));
    rows = found.sort((a, b) => fused(b) - fused(a) || b.id - a.id);
  }

  if (rows.length === 0) return "No memories match.";
  const shown = rows.slice(0, limit);
  if (projectId !== null) {
    recordReads(
      db,
      projectId,
      shown.map((row) => row.id),
      context.now,
    );
    return shown.map((row) => renderHeading(toNote(db, row))).join("\n");
  }
  // Across projects, each heading says whose it is.
  const names = projectNames(db);
  return shown
    .map((row) => `[${names.get(row.projectId) ?? "?"}] ${renderHeading(toNote(db, row))}`)
    .join("\n");
}

/**
 * Remembers that these memories were read, so that the agent repeating them is not
 * learned back. The server does not know which session asked; it knows the project and
 * the moment, and a tool call happens inside a turn, so the sessions of this project with
 * a turn open right now are the ones that saw them.
 */
function recordReads(db: Db, projectId: number, ids: number[], now: number): void {
  if (ids.length === 0) return;
  withWrite(db, () => {
    for (const id of ids) {
      db.run(
        `INSERT INTO injections (session_id, context_epoch, memory_id, event, tokens, at)
         SELECT s.id, s.context_epoch, ?, 'mcp', 0, ? FROM sessions s
          WHERE s.project_id = ?
            AND EXISTS (SELECT 1 FROM turns t WHERE t.session_id = s.id AND t.state = 'open')`,
        [id, now, projectId],
      );
    }
  });
}

/** Returns memories in full. Being asked for by id is the one reliable sign a memory was useful. */
export function getMemories(context: ToolContext, args: { ids: number[] }): string {
  const { db, projectId, now } = context;
  const ids = [...new Set(args.ids)].slice(0, MAX_IDS);
  const find = db.query<
    MemoryRow & { supersededBy: number | null; projectId: number },
    [number, number | null, number | null]
  >(
    `SELECT ${MEMORY_COLUMNS}, m.superseded_by AS supersededBy, m.project_id AS projectId
       FROM memories m WHERE m.id = ? AND (? IS NULL OR m.project_id = ?)`,
  );
  const names = projectId === null ? projectNames(db) : null;

  const parts: string[] = [];
  const missing: number[] = [];
  for (const id of ids) {
    const row = find.get(id, projectId, projectId);
    if (row === null) {
      missing.push(id);
      continue;
    }
    db.run("UPDATE memories SET use_count = use_count + 1, last_used_at = ? WHERE id = ?", [
      now,
      id,
    ]);
    const note =
      (names ? `[${names.get(row.projectId) ?? "?"}] ` : "") + renderNote(toNote(db, row));
    parts.push(row.supersededBy === null ? note : `${note}\n  (replaced by #${row.supersededBy})`);
  }
  if (missing.length > 0) {
    parts.push(
      `Not found${projectId === null ? "" : " in this project"}: ${missing.map((id) => `#${id}`).join(", ")}`,
    );
  }
  if (projectId !== null) {
    recordReads(
      db,
      projectId,
      ids.filter((id) => !missing.includes(id)),
      now,
    );
  }
  return parts.join("\n");
}

const MAX_PATH_CHARS = 300;

/**
 * File paths as given by an agent, made relative to the project. Agents pass absolute
 * paths; anchors are relative. What lies outside the project, is too long to be a path
 * or carries a secret is dropped.
 */
function projectPaths(root: string, files: string[]): string[] {
  const roots = [...new Set([root, realpath(root)])].map((dir) =>
    dir.replaceAll("\\", "/").replace(/\/+$/, ""),
  );
  const paths = new Set<string>();
  for (const raw of files) {
    let path = raw.trim().replaceAll("\\", "/");
    if (path === "" || path.length > MAX_PATH_CHARS || redact(path) !== path) continue;
    const inside = roots.find((dir) => path.startsWith(`${dir}/`));
    if (inside !== undefined) path = path.slice(inside.length + 1);
    else if (path.startsWith("/") || /^[A-Za-z]:\//.test(path)) continue;
    path = path.replace(/^(?:\.\/)+/, "");
    if (path !== "" && !path.startsWith("../")) paths.add(path);
  }
  return [...paths].slice(0, MAX_FILES);
}

/** Every project's name, by id. */
export function projectNames(db: Db): Map<number, string> {
  return new Map(
    db
      .query<{ id: number; name: string }, []>("SELECT id, name FROM projects")
      .all()
      .map((p) => [p.id, p.name]),
  );
}

function realpath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/**
 * Stores what the agent was told to remember. The text is the agent's own; it is
 * redacted, split into a title and the rest, and consolidated like any other memory.
 */
export async function saveMemory(
  context: ToolContext,
  args: { text: string; kind: MemoryKind; files?: string[]; importance?: number },
): Promise<string> {
  const { db, projectId, now } = context;
  if (projectId === null) throw new Error("saveMemory needs a project");
  const text = redact(args.text.replace(/\s+/g, " ").trim());
  if (text === "") return "Nothing to save: the text is empty.";

  const [first = text, ...rest] = splitSentences(text);
  const draft = {
    kind: args.kind,
    title: clip(first.trim(), TITLE_MAX_CHARS, "…"),
    body: clip(
      rest
        .map((sentence) => sentence.trim())
        .filter((sentence) => sentence !== "")
        .join("\n"),
      BODY_MAX_CHARS,
      "…",
    ) as Redacted,
    importance: Math.min(5, Math.max(1, Math.trunc(args.importance ?? 3))),
    files: projectPaths(context.root, args.files ?? []).map((path) => ({
      path,
      role: "changed" as const,
    })),
  };

  const action = await consolidate({ db, judge: context.judge }, projectId, draft);
  if (action.type === "duplicate") {
    db.run("UPDATE memories SET evidence_count = evidence_count + 1, updated_at = ? WHERE id = ?", [
      now,
      action.targetId,
    ]);
    return `Already known as #${action.targetId}; counted as further evidence.`;
  }

  const id = withWrite(db, () => {
    const created = insertMemory(
      db,
      {
        projectId,
        kind: draft.kind,
        title: draft.title,
        body: draft.body,
        terms: searchTerms(
          draft.title,
          draft.body,
          draft.files.map((file) => file.path),
        ),
        importance: draft.importance,
        branch: context.branch,
        commit: null,
        origin: "manual",
        judge: "agent",
        judgeVersion: "1",
        sourceTurnId: null,
        files: draft.files,
        now,
      },
      context.model ?? null,
    );
    for (const oldId of action.supersedes) supersede(db, oldId, created, now);
    return created;
  });
  return action.supersedes.length === 0
    ? `Saved as #${id}.`
    : `Saved as #${id}, replacing ${action.supersedes.map((old) => `#${old}`).join(", ")}.`;
}
