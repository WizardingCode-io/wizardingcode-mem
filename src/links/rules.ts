/**
 * The author's own rules (B2): conventions and decisions that repeat across projects not linked
 * to each other, or that the author said hold everywhere, are proposed; the author accepts or
 * rejects. Exact rules in code; the judge only answers whether a rule is personal. Runs in the
 * background drain, never on a hook path. Ruling P1: a user rule is an active memory with a
 * `user_memories` row.
 */

import type { Redacted } from "../core/redact.ts";
import type { MemoryKind } from "../core/types.ts";
import { DUPLICATE, NOT_PERSONAL, SAME_MEANING } from "../distill/policy.ts";
import type { Model } from "../embed/model.ts";
import { vectorText } from "../embed/vectors.ts";
import { heuristicJudge } from "../judge/heuristic.ts";
import type { Judge } from "../judge/types.ts";
import { semanticCandidates } from "../retrieve/semantic.ts";
import { type Db, withWrite } from "../store/db.ts";
import { findNeighbours, insertMemory, supersede } from "../store/memories.ts";
import { getMeta, setMeta } from "../store/meta.ts";
import { logError } from "../util/log.ts";
import { searchTerms } from "../util/words.ts";

/** A prompt that says the rule holds everywhere. */
export const SAID_ALWAYS =
  /\b(sempre|em todos os projetos|always|every project|in every repo|in all projects)\b/i;

const RULE_KINDS = "('convention', 'decision')";
const NEIGHBOURS = 8;
const MAX_MS = 5000;
const MAX_PROJECTS = 50;
/** Groups a judge said belong to their project, so that it is not asked again every drain. */
const NOT_PERSONAL_KEY = "rules.not-personal";
const MAX_REMEMBERED = 1000;

interface Candidate {
  id: number;
  projectId: number;
  kind: MemoryKind;
  title: string;
  body: string;
  importance: number;
  updatedAt: number;
  prompt: string | null;
}

/** Active conventions and decisions, not one of the author's rules, in no proposal yet. */
const ELIGIBLE = `m.status = 'active' AND m.kind IN ${RULE_KINDS}
  AND NOT EXISTS (SELECT 1 FROM user_memories u WHERE u.memory_id = m.id)
  AND m.id NOT IN (SELECT j.value FROM rule_proposals r, json_each(r.memory_ids) j)`;

const COLUMNS = `m.id AS id, m.project_id AS projectId, m.kind AS kind, m.title AS title,
  m.body AS body, m.importance AS importance, m.updated_at AS updatedAt`;

function pairKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function confirmedPairs(db: Db): Set<string> {
  const pairs = new Set<string>();
  for (const row of db
    .query<{ f: number; t: number }, []>(
      "SELECT from_project AS f, to_project AS t FROM project_links WHERE status = 'confirmed'",
    )
    .all()) {
    pairs.add(pairKey(row.f, row.t));
  }
  return pairs;
}

function rememberedNotPersonal(db: Db): string[] {
  try {
    const value: unknown = JSON.parse(getMeta(db, NOT_PERSONAL_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Proposes the author's rules from the newest `maxMemories` eligible memories. Only proposes:
 * nothing is accepted, superseded or deleted here. A set proposed once (whatever became of it)
 * is never proposed again.
 */
export async function proposeRules(
  db: Db,
  deps: {
    judge: Judge;
    now: number;
    maxMemories?: number;
    model?: Model | null;
    /** Time for the grouping pass; memories not reached wait for the next drain. */
    maxMs?: number;
    /** How many projects are searched for copies, the most recently active first. */
    maxProjects?: number;
  },
): Promise<{ proposed: number }> {
  const deadline = performance.now() + (deps.maxMs ?? MAX_MS);
  const candidates = db
    .query<Candidate, [number]>(
      `SELECT ${COLUMNS}, t.prompt AS prompt
         FROM memories m LEFT JOIN turns t ON t.id = m.source_turn_id
        WHERE ${ELIGIBLE}
        ORDER BY m.updated_at DESC, m.id DESC LIMIT ?`,
    )
    .all(deps.maxMemories ?? 300);
  if (candidates.length === 0) return { proposed: 0 };

  const eligible = db.query<Candidate, [number]>(
    `SELECT ${COLUMNS}, NULL AS prompt FROM memories m WHERE m.id = ? AND ${ELIGIBLE}`,
  );
  const known = new Map<number, Candidate>(candidates.map((c) => [c.id, c]));
  const lookup = (id: number): Candidate | null => {
    const found = known.get(id);
    if (found) return found;
    const row = eligible.get(id);
    if (row) known.set(id, row);
    return row;
  };
  const projects = db
    .query<{ id: number }, [number]>(
      `SELECT m.project_id AS id FROM memories m JOIN projects p ON p.id = m.project_id
        WHERE p.disabled = 0 AND m.status = 'active' AND m.kind IN ${RULE_KINDS}
        GROUP BY m.project_id ORDER BY MAX(m.updated_at) DESC, m.project_id DESC LIMIT ?`,
    )
    .all(deps.maxProjects ?? MAX_PROJECTS)
    .map((row) => row.id);
  const linked = confirmedPairs(db);
  const unlinked = (a: number, b: number) => a !== b && !linked.has(pairKey(a, b));

  // Union-find over memories that state the same rule in projects not linked to each other.
  const parent = new Map<number, number>();
  const root = (id: number): number => {
    let r = id;
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r) as number;
    parent.set(id, r);
    return r;
  };
  const join = (a: number, b: number) => {
    const ra = root(a);
    const rb = root(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  for (const memory of candidates) {
    if (performance.now() > deadline) break;
    const others = projects.filter((p) => unlinked(memory.projectId, p));
    if (others.length === 0) continue;
    const text = `${memory.title} ${memory.body}`;
    // The text rule consolidation uses, with no file anchors: paths of different projects are
    // relative to different roots and say nothing about whether two rules are the same.
    const neighbours = findNeighbours(db, others, text, NEIGHBOURS)
      .filter((n) => lookup(n.id) !== null)
      .map((n) => ({ ...n, files: [] }));
    if (neighbours.length > 0) {
      const verdict = await heuristicJudge.consolidate({
        draft: { title: memory.title, body: memory.body as Redacted, kind: memory.kind, files: [] },
        neighbours,
      });
      for (const answer of verdict.perNeighbour) {
        if (
          answer.relationScore >= DUPLICATE.minRelationScore &&
          answer.contradicts < DUPLICATE.maxContradiction
        ) {
          join(memory.id, answer.id);
        }
      }
    }
    if (deps.model) {
      const hits = semanticCandidates(db, deps.model, vectorText(memory.title, memory.body), {
        projectId: null,
        projectIds: others,
        limit: NEIGHBOURS,
        floor: SAME_MEANING,
      });
      for (const hit of hits) if (lookup(hit.id) !== null) join(memory.id, hit.id);
    }
  }

  const groups = new Map<number, Candidate[]>();
  for (const id of parent.keys()) {
    const memory = lookup(id);
    if (memory === null) continue;
    const r = root(id);
    groups.set(r, [...(groups.get(r) ?? []), memory]);
  }
  const proposals: { members: Candidate[]; reason: "repeated" | "said-always" }[] = [];
  const grouped = new Set<number>();
  for (const members of groups.values()) {
    const projectIds = [...new Set(members.map((m) => m.projectId))];
    if (projectIds.length < 2) continue;
    // Chained through a third project, two members may still be linked: then no proposal.
    const allUnlinked = projectIds.every((p, i) =>
      projectIds.slice(i + 1).every((q) => unlinked(p, q)),
    );
    if (!allUnlinked) continue;
    for (const m of members) grouped.add(m.id);
    proposals.push({ members, reason: "repeated" });
  }
  for (const memory of candidates) {
    if (grouped.has(memory.id) || memory.prompt === null) continue;
    if (SAID_ALWAYS.test(memory.prompt))
      proposals.push({ members: [memory], reason: "said-always" });
  }

  const notPersonal = rememberedNotPersonal(db);
  const names = new Map(
    db
      .query<{ id: number; name: string }, []>("SELECT id, name FROM projects")
      .all()
      .map((row) => [row.id, row.name]),
  );
  const exists = db.query("SELECT 1 FROM rule_proposals WHERE memory_ids = ?");
  let proposed = 0;
  for (const { members, reason } of proposals) {
    const key = JSON.stringify(members.map((m) => m.id).sort((a, b) => a - b));
    if (exists.get(key) !== null || notPersonal.includes(key)) continue;
    // Each question is a request: past the budget, the groups left wait for the next drain.
    if (deps.judge.personal && performance.now() > deadline) break;
    // The proposal's text is one memory's own, the most important (consolidation never writes text).
    const lead = [...members].sort(
      (a, b) => b.importance - a.importance || b.updatedAt - a.updatedAt || a.id - b.id,
    )[0] as Candidate;
    if (deps.judge.personal) {
      try {
        const verdict = await deps.judge.personal({
          title: lead.title,
          body: lead.body,
          projects: [...new Set(members.map((m) => names.get(m.projectId) ?? "?"))].sort(),
        });
        if (!verdict.personal && verdict.confidence >= NOT_PERSONAL.minConfidence) {
          notPersonal.push(key);
          setMeta(db, NOT_PERSONAL_KEY, JSON.stringify(notPersonal.slice(-MAX_REMEMBERED)));
          continue;
        }
      } catch (error) {
        // No verdict: the proposal stands and the author decides.
        logError("rules.personal", error);
      }
    }
    const changes = db.run(
      `INSERT OR IGNORE INTO rule_proposals (memory_ids, title, body, reason, status, created_at)
       VALUES (?, ?, ?, ?, 'proposed', ?)`,
      [key, lead.title, lead.body, reason, deps.now],
    ).changes;
    proposed += changes;
  }
  return { proposed };
}

/** Never throws: a failure here must not change the drain's outcome. */
export async function proposeRulesSafely(
  db: Db,
  deps: { judge: Judge; now: number; model?: Model | null },
): Promise<number> {
  try {
    return (await proposeRules(db, deps)).proposed;
  } catch (error) {
    logError("rules.propose", error);
    return 0;
  }
}

interface Proposal {
  id: number;
  memory_ids: string;
  title: string;
  body: string;
  reason: "repeated" | "said-always";
  status: "proposed" | "accepted" | "rejected";
}

function sourceIds(proposal: Proposal): number[] {
  try {
    const value: unknown = JSON.parse(proposal.memory_ids);
    return Array.isArray(value) ? value.filter((v): v is number => typeof v === "number") : [];
  } catch {
    return [];
  }
}

/**
 * Makes a proposal one of the author's rules: a new memory (origin `manual`, the proposal's
 * text, the group's highest importance) that supersedes every copy still active. With the
 * semantic model it gets its vector at once; without, the drain's heal writes it later.
 */
export function acceptProposal(
  db: Db,
  id: number,
  now: number,
  model: Model | null = null,
): { userMemoryId: number } | { refused: string } {
  return withWrite(db, () => {
    const proposal = db
      .query<Proposal, [number]>(
        "SELECT id, memory_ids, title, body, reason, status FROM rule_proposals WHERE id = ?",
      )
      .get(id);
    if (proposal === null) return { refused: `No proposal #${id}.` };
    if (proposal.status !== "proposed")
      return { refused: `Proposal #${id} is ${proposal.status}.` };
    const ids = sourceIds(proposal);
    // Sources as they are now: one replaced, archived or turned into another kind no longer
    // counts, and the text is re-read from the most important source that still qualifies.
    const active = db
      .query<
        {
          id: number;
          projectId: number;
          kind: MemoryKind;
          importance: number;
          title: string;
          body: string;
        },
        []
      >(
        `SELECT id, project_id AS projectId, kind, importance, title, body FROM memories
          WHERE status = 'active' AND kind IN ${RULE_KINDS}
            AND id IN (${ids.map((n) => Math.trunc(n)).join(", ") || "NULL"})
          ORDER BY importance DESC, updated_at DESC, id`,
      )
      .all();
    const needed = proposal.reason === "repeated" ? 2 : 1;
    if (active.length < needed) {
      return {
        refused: `Only ${active.length} of the memories behind proposal #${id} still state a convention or decision.`,
      };
    }
    const lead = active[0] as (typeof active)[number];
    const userMemoryId = insertMemory(
      db,
      {
        projectId: lead.projectId,
        kind: lead.kind,
        title: lead.title,
        body: lead.body as Redacted,
        terms: searchTerms(lead.title, lead.body, []),
        importance: lead.importance,
        branch: null,
        commit: null,
        origin: "manual",
        judge: "user",
        judgeVersion: "1",
        sourceTurnId: null,
        files: [],
        now,
      },
      model,
    );
    db.run("INSERT INTO user_memories (memory_id, proposal_id, created_at) VALUES (?, ?, ?)", [
      userMemoryId,
      id,
      now,
    ]);
    for (const source of active) supersede(db, source.id, userMemoryId, now);
    db.run(
      "UPDATE rule_proposals SET status = 'accepted', user_memory_id = ?, decided_at = ? WHERE id = ?",
      [userMemoryId, now, id],
    );
    return { userMemoryId };
  });
}

/** True when the proposal was open and is now rejected; a rejected set is never proposed again. */
export function rejectProposal(db: Db, id: number, now: number): boolean {
  return (
    db.run(
      "UPDATE rule_proposals SET status = 'rejected', decided_at = ? WHERE id = ? AND status = 'proposed'",
      [now, id],
    ).changes > 0
  );
}

/**
 * Takes back one of the author's rules: the memory is archived (never deleted), the project
 * copies it replaced are active again, and its proposal counts as rejected so it does not return.
 */
export function undoUserRule(db: Db, userMemoryId: number, now: number): boolean {
  return withWrite(db, () => {
    const marker = db
      .query<{ proposalId: number | null }, [number]>(
        `SELECT u.proposal_id AS proposalId FROM user_memories u JOIN memories m ON m.id = u.memory_id
          WHERE u.memory_id = ? AND m.status = 'active'`,
      )
      .get(userMemoryId);
    if (marker === null) return false;
    db.run(
      "UPDATE memories SET status = 'archived', updated_at = MAX(updated_at, ?) WHERE id = ?",
      [now, userMemoryId],
    );
    db.run(
      `UPDATE memories SET status = 'active', superseded_by = NULL, updated_at = MAX(updated_at, ?)
        WHERE superseded_by = ? AND status = 'superseded'`,
      [now, userMemoryId],
    );
    if (marker.proposalId !== null) {
      db.run("UPDATE rule_proposals SET status = 'rejected', decided_at = ? WHERE id = ?", [
        now,
        marker.proposalId,
      ]);
    }
    return true;
  });
}
