/**
 * The author's own rules (B2): conventions and decisions that repeat across projects not linked
 * to each other, or that the author said hold everywhere, are proposed; the author accepts or
 * rejects. Exact rules in code; the judge only answers whether a rule is personal. Runs in the
 * background drain, never on a hook path. Ruling P1: a user rule is an active memory with a
 * `user_memories` row.
 */

import { isFromTheHost } from "../core/host-prompt.ts";
import type { Redacted } from "../core/redact.ts";
import type { MemoryKind } from "../core/types.ts";
import { DUPLICATE, NOT_PERSONAL, PERSONAL, SAME_MEANING } from "../distill/policy.ts";
import type { Model } from "../embed/model.ts";
import { vectorText } from "../embed/vectors.ts";
import { heuristicJudge } from "../judge/heuristic.ts";
import type { Judge } from "../judge/types.ts";
import { semanticCandidates } from "../retrieve/semantic.ts";
import { type Db, withWrite } from "../store/db.ts";
import { findNeighbours, insertMemory, supersede } from "../store/memories.ts";
import { claimLease, getMeta, releaseLease, setMeta } from "../store/meta.ts";
import { logError } from "../util/log.ts";
import { isGeneric, STOPWORDS, searchTerms, searchTokens, stem } from "../util/words.ts";

// --- Said always --------------------------------------------------------------------
// A rule the author said holds everywhere. Exact rules, tested on the shapes the proof found:
// only what the author typed counts (no host messages, code, quotes or pasted lines), a long
// prompt is a task and not a rule, and the rule phrase must share a short sentence with at
// least two of the memory title's own words. In Portuguese the bare "sempre" is ordinary
// speech: only its rule forms count.

/** The rule phrases, English and Portuguese. */
const RULE_PHRASE = new RegExp(
  [
    String.raw`\balways\b`,
    String.raw`\bfrom now on\b`,
    String.raw`\b(?:in|for|across) (?:every|all|any) (?:project|repo|repositor)`,
    String.raw`\bevery (?:project|repo)`,
    String.raw`\bsempre (?:que|em)\b`,
    // An imperative or infinitive next to "sempre": "usa sempre", "corre sempre", "sempre usar".
    String.raw`\b\p{L}+(?:a|e|ar|er|ir)\s+sempre\b`,
    String.raw`\bsempre\s+\p{L}+(?:ar|er|ir)\b`,
    String.raw`\bem (?:todos os|qualquer) (?:projeto|repo)`,
    String.raw`\bde agora em diante\b`,
    String.raw`\ba partir de agora\b`,
    String.raw`\bdaqui (?:para|pra) a frente\b`,
  ].join("|"),
  "iu",
);

/** The trigger's own words, which say nothing about which rule. */
const TRIGGER_WORDS = new Set(
  "always every all any from now project projects repo repos repository repositories sempre todos qualquer projeto projetos agora partir diante daqui frente"
    .split(" ")
    .map(stem),
);

const MAX_TYPED = 600;
const MAX_LINE = 300;
const MAX_SENTENCE = 240;
const MIN_SHARED = 2;

/** What the author typed: no fenced code, no `<tag>…</tag>` blocks, no quoted or pasted lines. */
export function typedText(prompt: string): string {
  return prompt
    .replace(/```[\s\S]*?(?:```|$)/g, "")
    .replace(/<([a-z][\w-]*)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith(">") && line.length <= MAX_LINE)
    .join("\n")
    .trim();
}

function ruleWords(text: string): Set<string> {
  return new Set(
    searchTokens(text)
      .filter((token) => token.length >= 3 && !STOPWORDS.has(token))
      .map(stem)
      .filter((word) => !TRIGGER_WORDS.has(word)),
  );
}

/**
 * How many of the title's own words share a sentence with a rule phrase in what the author
 * typed; 0 when the prompt does not say the rule holds everywhere. Generic words (test, run)
 * count only beside at least one telling word.
 */
export function saidAlways(prompt: string, title: string): number {
  if (isFromTheHost(prompt)) return 0;
  const typed = typedText(prompt);
  if (typed.length > MAX_TYPED) return 0;
  const wanted = ruleWords(title);
  let best = 0;
  for (const sentence of typed.split(/[.!?;](?=\s|$)|\n/)) {
    if (sentence.length > MAX_SENTENCE || !RULE_PHRASE.test(sentence)) continue;
    const shared = [...ruleWords(sentence)].filter((word) => wanted.has(word));
    if (shared.length >= MIN_SHARED && shared.some((word) => !isGeneric(word))) {
      best = Math.max(best, shared.length);
    }
  }
  return best;
}

const RULE_KINDS = "('convention', 'decision')";
const NEIGHBOURS = 8;
const MAX_MS = 5000;
const MAX_PROJECTS = 50;
/** On the first run, how far back the backlog reaches: the newest this many. */
const WINDOW = 300;
/** Groups a judge said belong to their project, so that it is not asked again every drain. */
const NOT_PERSONAL_KEY = "rules.not-personal";
const MAX_REMEMBERED = 1000;
/** Where the last run stopped: memories at or before it were already looked at. */
const CURSOR_KEY = "rules.cursor";
/** One proposing process at a time: two distills must not do the same work twice. */
export const RULES_LEASE = "rules.lease";

interface Candidate {
  id: number;
  projectId: number;
  kind: MemoryKind;
  title: string;
  body: string;
  importance: number;
  updatedAt: number;
  prompt: string | null;
  turnId: number | null;
}

interface Cursor {
  updatedAt: number;
  id: number;
  /** The semantic model the run had: a new model looks at the window again, by meaning. */
  model: string | null;
}

/** Active conventions and decisions, in a project with memory on, not one of the author's rules, in no proposal yet. */
const ELIGIBLE = `m.status = 'active' AND m.kind IN ${RULE_KINDS}
  AND m.project_id IN (SELECT id FROM projects WHERE disabled = 0)
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

function readCursor(db: Db): Cursor | null {
  try {
    const value = JSON.parse(getMeta(db, CURSOR_KEY) ?? "null") as Partial<Cursor> | null;
    return value && typeof value.updatedAt === "number" && typeof value.id === "number"
      ? { updatedAt: value.updatedAt, id: value.id, model: value.model ?? null }
      : null;
  } catch {
    return null;
  }
}

const after = (a: Cursor, b: Cursor) =>
  a.updatedAt > b.updatedAt || (a.updatedAt === b.updatedAt && a.id > b.id);

/** Compare-and-set: the cursor only moves forward, unless the model changed. */
function advanceCursor(db: Db, next: Cursor): void {
  withWrite(db, () => {
    const stored = readCursor(db);
    if (stored === null || stored.model !== next.model || after(next, stored)) {
      setMeta(db, CURSOR_KEY, JSON.stringify(next));
    }
  });
}

/**
 * Proposes the author's rules from the conventions and decisions written or reinforced since the
 * last run (the first run starts at the newest `maxMemories`). Only proposes: nothing is
 * accepted, superseded or deleted here. A set proposed once (whatever became of it) is never
 * proposed again. With nothing new, one query and out.
 */
export async function proposeRules(
  db: Db,
  deps: {
    judge: Judge;
    now: number;
    /** How far back the first run reaches. */
    maxMemories?: number;
    /** How many new memories one run takes at most. */
    batch?: number;
    model?: Model | null;
    /** Time for the grouping pass; memories not reached wait for the next drain. */
    maxMs?: number;
    /** How many projects are searched for copies, the most recently active first. */
    maxProjects?: number;
    /** Who holds the lease while this runs. */
    owner?: string;
  },
): Promise<{ proposed: number; scanned: number }> {
  const none = { proposed: 0, scanned: 0 };
  const model = deps.model?.id ?? null;
  const stored = readCursor(db);
  const cursor = stored !== null && stored.model === model ? stored : null;
  // The quiet drain: nothing written or reinforced since the cursor. Read from the ranking
  // index (a few ms on a store of 90k memories); a tie on the cursor's millisecond is looked up
  // by id.
  if (cursor !== null) {
    const top = db
      .query<{ u: number | null }, []>(
        "SELECT max(updated_at) AS u FROM memories WHERE status = 'active'",
      )
      .get()?.u;
    if (top === null || top === undefined || top < cursor.updatedAt) return none;
    if (
      top === cursor.updatedAt &&
      db
        .query(
          `SELECT 1 FROM memories m WHERE m.id > ? AND m.updated_at = ? AND m.status = 'active'
            AND m.kind IN ${RULE_KINDS} LIMIT 1`,
        )
        .get(cursor.id, cursor.updatedAt) === null
    ) {
      return none;
    }
  }
  const maxMs = deps.maxMs ?? MAX_MS;
  const owner = deps.owner ?? `${process.pid}-${crypto.randomUUID()}`;
  if (!claimLease(db, RULES_LEASE, owner, Date.now(), maxMs + 60_000)) return none;
  try {
    return await propose(db, deps, cursor ?? start(db, deps.maxMemories ?? WINDOW, model), maxMs);
  } finally {
    releaseLease(db, RULES_LEASE, owner);
  }
}

/** The first run's cursor: just before the newest `window` eligible memories. */
function start(db: Db, window: number, model: string | null): Cursor {
  const edge = db
    .query<{ updatedAt: number; id: number }, [number]>(
      `SELECT m.updated_at AS updatedAt, m.id AS id FROM memories m WHERE ${ELIGIBLE}
        ORDER BY m.updated_at DESC, m.id DESC LIMIT 1 OFFSET ?`,
    )
    .get(Math.max(0, window - 1));
  return edge === null
    ? { updatedAt: Number.MIN_SAFE_INTEGER, id: 0, model }
    : { updatedAt: edge.updatedAt, id: edge.id - 1, model };
}

async function propose(
  db: Db,
  deps: Parameters<typeof proposeRules>[1],
  from: Cursor,
  maxMs: number,
): Promise<{ proposed: number; scanned: number }> {
  const deadline = performance.now() + maxMs;
  const model = from.model;
  const batch = deps.batch ?? WINDOW;
  // One snapshot: the newest active memory, of any kind, and the candidates after the cursor.
  // Once every candidate is reached, the cursor may move to that newest memory, so that the
  // memories that are not candidates (a fix, a rule already proposed) do not keep the quiet
  // drain busy.
  const [newest, candidates] = db.transaction(
    () =>
      [
        db
          .query<{ updatedAt: number; id: number }, []>(
            `SELECT updated_at AS updatedAt, id FROM memories WHERE status = 'active'
              ORDER BY updated_at DESC, id DESC LIMIT 1`,
          )
          .get(),
        db
          .query<Candidate, [number, number, number]>(
            `SELECT ${COLUMNS}, t.prompt AS prompt, m.source_turn_id AS turnId
               FROM memories m LEFT JOIN turns t ON t.id = m.source_turn_id
              WHERE ${ELIGIBLE} AND (m.updated_at, m.id) > (?, ?)
              ORDER BY m.updated_at ASC, m.id ASC LIMIT ?`,
          )
          .all(from.updatedAt, from.id, batch),
      ] as const,
  )();
  const furthest = (cursor: Cursor): Cursor =>
    newest && after({ ...newest, model }, cursor) ? { ...newest, model } : cursor;
  if (candidates.length === 0) {
    advanceCursor(db, furthest(from));
    return { proposed: 0, scanned: 0 };
  }

  const eligible = db.query<Candidate, [number]>(
    `SELECT ${COLUMNS}, NULL AS prompt, NULL AS turnId FROM memories m WHERE m.id = ? AND ${ELIGIBLE}`,
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

  // Grouping is symmetric: a new memory's search reaches every older one in the other
  // projects, so what is behind the cursor never needs looking at again.
  let reached = 0;
  for (const memory of candidates) {
    if (performance.now() > deadline) break;
    const others = projects.filter((p) => unlinked(memory.projectId, p));
    if (others.length > 0) {
      const text = `${memory.title} ${memory.body}`;
      // The text rule consolidation uses, with no file anchors: paths of different projects are
      // relative to different roots and say nothing about whether two rules are the same.
      const neighbours = findNeighbours(db, others, text, NEIGHBOURS)
        .filter((n) => lookup(n.id) !== null)
        .map((n) => ({ ...n, files: [] }));
      if (neighbours.length > 0) {
        const verdict = await heuristicJudge.consolidate({
          draft: {
            title: memory.title,
            body: memory.body as Redacted,
            kind: memory.kind,
            files: [],
          },
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
    reached++;
  }
  const scanned = candidates.slice(0, reached);

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
  // Said always: at most one per turn, the memory whose title the sentence names best.
  const byTurn = new Map<number, { memory: Candidate; shared: number }>();
  for (const memory of scanned) {
    if (grouped.has(memory.id) || memory.prompt === null || memory.turnId === null) continue;
    const shared = saidAlways(memory.prompt, memory.title);
    if (shared === 0) continue;
    const best = byTurn.get(memory.turnId);
    if (
      best === undefined ||
      shared > best.shared ||
      (shared === best.shared &&
        (memory.importance > best.memory.importance ||
          (memory.importance === best.memory.importance &&
            (memory.updatedAt > best.memory.updatedAt ||
              (memory.updatedAt === best.memory.updatedAt && memory.id > best.memory.id)))))
    ) {
      byTurn.set(memory.turnId, { memory, shared });
    }
  }
  for (const { memory } of byTurn.values()) {
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
  const position = new Map(candidates.map((c, i) => [c.id, i]));
  // Where the cursor may move to: the last memory reached, held back before any group the
  // judge had no time for, so the next run finds it again.
  let until = reached - 1;
  let proposed = 0;
  for (const [index, { members, reason }] of proposals.entries()) {
    const key = JSON.stringify(members.map((m) => m.id).sort((a, b) => a - b));
    if (exists.get(key) !== null || notPersonal.includes(key)) continue;
    // Each question is a request: past the budget, the groups left wait for the next drain.
    if (deps.judge.personal && performance.now() > deadline) {
      for (const rest of proposals.slice(index)) {
        for (const m of rest.members) {
          const at = position.get(m.id);
          if (at !== undefined) until = Math.min(until, at - 1);
        }
      }
      break;
    }
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
        // A repeated rule stands unless the judge is sure it is not personal; a rule only
        // said once needs the judge to be sure it is.
        const drop =
          reason === "said-always"
            ? !(verdict.personal && verdict.confidence >= PERSONAL.minConfidence)
            : !verdict.personal && verdict.confidence >= NOT_PERSONAL.minConfidence;
        if (drop) {
          notPersonal.push(key);
          setMeta(db, NOT_PERSONAL_KEY, JSON.stringify(notPersonal.slice(-MAX_REMEMBERED)));
          continue;
        }
      } catch (error) {
        logError("rules.personal", error);
        // No verdict: a repeated rule stands and the author decides; a rule said once does not.
        if (reason === "said-always") continue;
      }
    }
    const changes = db.run(
      `INSERT OR IGNORE INTO rule_proposals (memory_ids, title, body, reason, status, created_at)
       VALUES (?, ?, ?, ?, 'proposed', ?)`,
      [key, lead.title, lead.body, reason, deps.now],
    ).changes;
    proposed += changes;
  }
  const last = until >= 0 ? (candidates[until] as Candidate) : null;
  const reachedAll = until === candidates.length - 1 && candidates.length < batch;
  const next = last ? { updatedAt: last.updatedAt, id: last.id, model } : from;
  advanceCursor(db, reachedAll ? furthest(next) : next);
  return { proposed, scanned: reached };
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
    // Memory off for a project means its content goes nowhere: not into every project's brief.
    const off = db
      .query<{ name: string }, []>(
        `SELECT DISTINCT p.name AS name FROM memories m JOIN projects p ON p.id = m.project_id
          WHERE p.disabled = 1 AND m.id IN (${ids.map((n) => Math.trunc(n)).join(", ") || "NULL"})`,
      )
      .all();
    if (off.length > 0) {
      return {
        refused: `Memory is off for ${off.map((row) => row.name).join(", ")}: proposal #${id} cannot become your rule.`,
      };
    }
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
