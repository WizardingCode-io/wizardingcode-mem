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
import { RRF_K, SEMANTIC_FLOOR, semanticCandidates } from "../retrieve/semantic.ts";
import { type Db, withWrite } from "../store/db.ts";
import { visibleProjects } from "../store/links.ts";
import { insertMemory, supersede } from "../store/memories.ts";
import { logError } from "../util/log.ts";
import { clip } from "../util/text.ts";
import { inProjects, searchTerms } from "../util/words.ts";

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
  /** This project alone, without its linked projects (a project named in --global). */
  alone?: boolean;
}

/** The projects a search or a get reads: null for every project. */
interface Scope {
  ids: number[] | null;
  /** The author's rules (active, from projects outside `ids`), found alongside them. */
  rules?: { ids: number[]; projects: number[] };
}

let rulesFailed = false;

/** The author's active rules kept in projects outside `ids`. None on any error (fail open). */
function userRules(db: Db, ids: number[]): Scope["rules"] {
  try {
    const rows = db
      .query<{ id: number; projectId: number }, []>(
        `SELECT m.id AS id, m.project_id AS projectId FROM user_memories u
           JOIN memories m ON m.id = u.memory_id WHERE m.status = 'active'`,
      )
      .all()
      .filter((row) => !ids.includes(row.projectId));
    if (rows.length === 0) return undefined;
    return {
      ids: rows.map((row) => row.id),
      projects: [...new Set(rows.map((row) => row.projectId))],
    };
  } catch (error) {
    if (!rulesFailed) {
      rulesFailed = true;
      logError("search.rules", error);
    }
    return undefined;
  }
}

/**
 * What a search covers: the project and the projects it sees through confirmed links, or
 * one of them when `project` names it; a name outside the group is refused with the group.
 */
export function searchScope(context: ToolContext, project?: string): Scope | string {
  const { db, projectId } = context;
  if (projectId === null) return { ids: null };
  if (context.alone) return { ids: [projectId] };
  const visible = visibleProjects(db, projectId);
  const wanted = project?.trim() ?? "";
  if (wanted === "") {
    const ids = [projectId, ...visible.map((v) => v.id)];
    const rules = userRules(db, ids);
    return rules === undefined ? { ids } : { ids, rules };
  }
  const own =
    db.query<{ name: string }, [number]>("SELECT name FROM projects WHERE id = ?").get(projectId)
      ?.name ?? "";
  const group = [{ id: projectId, name: own }, ...visible];
  const found =
    group.find((p) => p.name === wanted) ??
    group.find((p) => p.name.toLowerCase() === wanted.toLowerCase());
  if (found === undefined) {
    return `No project called “${wanted}” here. This project and its linked ones: ${group.map((p) => p.name).join(", ")}.`;
  }
  return { ids: [found.id] };
}

/** Whether results are named with their project: across projects, or from another one. */
const labelled = (context: ToolContext, scope: Scope) =>
  scope.ids === null || scope.ids.some((id) => id !== context.projectId);

/** The SQL condition for a scope; ids come from the database, so they are inlined. */
function inScope(scope: Scope): string {
  if (scope.ids === null) return "1";
  const projects = `m.project_id IN (${scope.ids.map((id) => Math.trunc(id)).join(", ")})`;
  if (scope.rules === undefined) return projects;
  return `(${projects} OR m.id IN (${scope.rules.ids.map((id) => Math.trunc(id)).join(", ")}))`;
}

/** The projects a scope's rows come from, the author's rules' included. */
const scopeProjects = (scope: Scope): number[] | null =>
  scope.ids === null ? null : [...scope.ids, ...(scope.rules?.projects ?? [])];

/** One heading, named for its origin: the author's, another project's, or none. */
function heading(db: Db, row: Ranked, scope: Scope, names: Map<number, string> | null): string {
  if (scope.rules?.ids.includes(row.id)) {
    return renderHeading({ ...toNote(db, row), origin: "you" });
  }
  const note = renderHeading(toNote(db, row));
  return names === null ? note : `[${names.get(row.projectId) ?? "?"}] ${note}`;
}

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;
const SEARCH_POOL = 50;
const MAX_IDS = 20;
const BODY_MAX_CHARS = 2000;
const MAX_FILES = 10;

/**
 * Finds memories by words, symbols or file names and answers with one heading per
 * memory. Unlike injection, an explicit search asks for no evidence: one word is enough.
 * With the semantic model, memories that mean what was asked are fused in as well.
 */
export function searchMemories(
  context: ToolContext,
  args: { query: string; kind?: MemoryKind; limit?: number; project?: string },
): string {
  const { db, projectId } = context;
  const limit = Math.min(MAX_LIMIT, Math.max(1, Math.trunc(args.limit ?? DEFAULT_LIMIT)));
  const scope = searchScope(context, args.project);
  if (typeof scope === "string") return scope;
  const rows = rankMemories(context, args, SEMANTIC_FLOOR, scope);
  if (rows.length === 0) return "No memories match.";
  const shown = rows.slice(0, limit);
  if (projectId !== null) {
    recordReads(
      db,
      projectId,
      shown.map((row) => row.id),
      context.now,
    );
  }
  // Across projects, each heading says whose it is; the author's rules say they are theirs.
  const names = labelled(context, scope) ? projectNames(db) : null;
  return shown.map((row) => heading(db, row, scope, names)).join("\n");
}

type Ranked = MemoryRow & { projectId: number };

/**
 * The memories a search answers with, best first, before the limit. Without a model, or when
 * nothing passes the floor, this is the lexical ranking alone, unchanged. `floor` is for
 * calibration (scripts/embed/search-floor.ts).
 */
export function rankMemories(
  context: ToolContext,
  args: { query: string; kind?: MemoryKind; project?: string },
  floor: number = SEMANTIC_FLOOR,
  given?: Scope,
): Ranked[] {
  const { db } = context;
  const scope = given ?? searchScope(context, args.project);
  if (typeof scope === "string") return [];
  const where = inScope(scope);
  const kind = args.kind ?? null;
  const model = context.model ?? null;

  if (args.query.trim() === "") {
    return db
      .query<Ranked, [string | null, string | null, number]>(
        `SELECT ${MEMORY_COLUMNS}, m.project_id AS projectId FROM memories m
          WHERE ${where} AND m.status = 'active' AND (? IS NULL OR m.kind = ?)
          ORDER BY m.importance DESC, m.updated_at DESC LIMIT ?`,
      )
      .all(kind, kind, SEARCH_POOL)
      .sort((a, b) => prior(b, context) - prior(a, context) || b.id - a.id);
  }
  const projects = scopeProjects(scope);
  const meaning = semanticCandidates(db, model, args.query, {
    projectId: null,
    ...(projects === null ? {} : { projectIds: projects }),
    kind,
    limit: SEARCH_POOL,
    floor,
  });
  const match = explicitMatch(args.query);
  const found =
    match === null
      ? []
      : db
          .query<Ranked & { bm25: number }, [string, string | null, string | null, number]>(
            `SELECT ${MEMORY_COLUMNS}, m.project_id AS projectId, bm25(memories_fts, 4.0, 1.0, 2.0, 0.0) AS bm25
               FROM memories_fts CROSS JOIN memories m ON m.id = memories_fts.rowid
              WHERE memories_fts MATCH ? AND ${where} AND m.status = 'active'
                AND (? IS NULL OR m.kind = ?)
              ORDER BY bm25 LIMIT ?`,
          )
          .all(
            projects === null ? `{title body terms} : (${match})` : inProjects(match, projects),
            kind,
            kind,
            SEARCH_POOL,
          );
  const byText = ranks(found, (row) => -row.bm25);
  if (meaning.length === 0) {
    // Words alone: exactly the ranking explicit search always had.
    const byPrior = ranks(found, (row) => prior(row, context));
    const fused = (row: Ranked & { bm25: number }) =>
      1 / (RRF_K + (byText.get(row) ?? 0)) + 1 / (RRF_K + (byPrior.get(row) ?? 0));
    return found.sort((a, b) => fused(b) - fused(a) || b.id - a.id);
  }

  // Words and meaning: memories found only by meaning join the pool, and each ranking that
  // found a memory adds to its score; the prior ranks the whole pool.
  const lexical = new Map(found.map((row) => [row.id, row]));
  const getRow = db.query<Ranked, [number]>(
    `SELECT ${MEMORY_COLUMNS}, m.project_id AS projectId FROM memories m
      WHERE m.id = ? AND m.status = 'active' AND ${where}`,
  );
  const pool: Ranked[] = [...found];
  for (const hit of meaning) {
    if (lexical.has(hit.id)) continue;
    const row = getRow.get(hit.id);
    if (row !== null) pool.push(row);
  }
  const score = new Map(meaning.map((hit) => [hit.id, hit.score]));
  const byMeaning = ranks(
    pool.filter((row) => score.has(row.id)),
    (row) => score.get(row.id) ?? 0,
  );
  const byPrior = ranks(pool, (row) => prior(row, context));
  const textRank = new Map(found.map((row) => [row.id, byText.get(row) ?? 0]));
  const term = (rank: number | undefined) => (rank === undefined ? 0 : 1 / (RRF_K + rank));
  const fused = (row: Ranked) =>
    term(textRank.get(row.id)) + term(byMeaning.get(row)) + term(byPrior.get(row));
  return pool.sort((a, b) => fused(b) - fused(a) || b.id - a.id);
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
  // Ids from a search: this project's and its linked projects'.
  const scope = searchScope(context) as Scope;
  const find = db.query<MemoryRow & { supersededBy: number | null; projectId: number }, [number]>(
    `SELECT ${MEMORY_COLUMNS}, m.superseded_by AS supersededBy, m.project_id AS projectId
       FROM memories m WHERE m.id = ? AND ${inScope(scope)}`,
  );
  const names = labelled(context, scope) ? projectNames(db) : null;

  const parts: string[] = [];
  const missing: number[] = [];
  for (const id of ids) {
    const row = find.get(id);
    if (row === null) {
      missing.push(id);
      continue;
    }
    db.run("UPDATE memories SET use_count = use_count + 1, last_used_at = ? WHERE id = ?", [
      now,
      id,
    ]);
    const yours = scope.rules?.ids.includes(row.id) ?? false;
    const named = !yours && names !== null && (projectId === null || row.projectId !== projectId);
    const note =
      (named ? `[${names.get(row.projectId) ?? "?"}] ` : "") +
      renderNote(yours ? { ...toNote(db, row), origin: "you" } : toNote(db, row));
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
