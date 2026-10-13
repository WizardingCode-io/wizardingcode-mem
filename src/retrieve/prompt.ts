import { isFromTheHost } from "../core/host-prompt.ts";
import type { MemoryKind } from "../core/types.ts";
import { MOMENT_BUDGET } from "../engine/budget.ts";
import type { Db } from "../store/db.ts";
import { visibleProjects } from "../store/links.ts";
import { logError } from "../util/log.ts";
import { anyOf, inProject, isGeneric, stem } from "../util/words.ts";
import { LINKED_POOL, MAX_LINKED_NOTES } from "./brief.ts";
import { MEMORY_COLUMNS, type MemoryRow, prior, ranks, toNote } from "./notes.ts";
import { buildQuery, matchTerms, type Query, searchTokens } from "./query.ts";
import { type Note, renderNote, renderNotes } from "./render.ts";
import { documentCounts } from "./vocab.ts";

export { recordInjections } from "./notes.ts";

const CANDIDATES_PER_CHANNEL = 20;
const MAX_NOTES = 5;
const RRF_K = 60;
/** Three ordinary shared words, or two rare ones. */
const EVIDENCE_WEIGHT = 3;
const RECENT_TURNS = 5;
const MAX_SESSION_FILES = 50;

/**
 * Reciprocal rank fusion over three orderings: how well the text matches, how many of the
 * session's files it is about, and how much it matters regardless of the query.
 */
function fusion(candidates: Candidate[], context: Context): (candidate: Candidate) => number {
  const byText = ranks(
    candidates.filter((candidate) => candidate.bm25 !== undefined),
    (candidate) => -(candidate.bm25 as number),
  );
  const byFiles = ranks(
    candidates.filter((candidate) => candidate.overlap > 0),
    (candidate) => candidate.overlap,
  );
  const byPrior = ranks(candidates, (candidate) => prior(candidate.row, context));
  return (candidate) =>
    [byText, byFiles, byPrior].reduce((sum, ranking) => {
      const rank = ranking.get(candidate);
      return rank === undefined ? sum : sum + 1 / (RRF_K + rank);
    }, 0);
}

interface Extra {
  /** The author's rules outside the project's own candidates, not yet scored for text. */
  rules: MemoryRow[];
  /** Matches in the linked projects, kept apart from the project's own. */
  linked: Candidate[];
  /** The label of each note from outside the project, or of the author's, by id. */
  origins: Map<number, string>;
}

const NO_EXTRA: Extra = { rules: [], linked: [], origins: new Map() };
/** The author's rules scored for text on one prompt: each is a full-text lookup of its own. */
const MAX_RULE_LOOKUPS = 5;
/**
 * The linked matches read, newest first, before the best LINKED_POOL of them are kept: the
 * cost of a prompt must not grow with the size of the projects it is linked to.
 */
const LINKED_SCAN = 10 * LINKED_POOL;
let extraFailed = false;

function failOpen(error: unknown): void {
  if (!extraFailed) {
    extraFailed = true;
    logError("prompt.links", error);
  }
}

const FTS_MATCH = (match: string) => `{title body terms} : (${match})`;

/**
 * The author's rules and the prompt's matches in the projects linked to this one, each
 * read up to a fixed count. Nothing at all on any error, so the notes are the project's own.
 */
function extraCandidates(
  db: Db,
  input: {
    projectId: number;
    query: Query;
    unseen: string;
    kindFilter: string;
    known: Map<number, Candidate>;
  },
): Extra {
  try {
    const origins = new Map<number, string>();
    const rules = db
      .query<MemoryRow, [number]>(
        `SELECT ${MEMORY_COLUMNS} FROM user_memories u CROSS JOIN memories m ON m.id = u.memory_id
           JOIN projects p ON p.id = m.project_id
          WHERE m.status = 'active' AND p.disabled = 0 AND ${input.unseen} AND ${input.kindFilter}
          ORDER BY m.importance DESC, m.updated_at DESC LIMIT ?`,
      )
      .all(LINKED_POOL);
    // Labelled wherever they are found, the project's own candidates included.
    for (const { id } of db
      .query<{ id: number }, []>("SELECT memory_id AS id FROM user_memories")
      .all()) {
      origins.set(id, "you");
    }

    const linked: Candidate[] = [];
    const visible = visibleProjects(db, input.projectId);
    // Searched for the prompt's telling words only: the words found in any talk about
    // code would match most of the linked projects, and ranking them all costs the budget.
    const telling = [
      ...input.query.identifiers,
      ...input.query.words.filter((word) => !isGeneric(word)),
    ];
    if (visible.length > 0 && telling.length > 0) {
      const names = new Map(visible.map((project) => [project.id, project.name]));
      const match = anyOf(
        new Set([...telling, ...telling.map((word) => stem(searchTokens(word)[0] ?? word))]),
      );
      const projects = visible.map((project) => `"${project.id}"`).join(" OR ");
      const rows = db
        .query<MemoryRow & { bm25: number; projectId: number }, [string, number, number]>(
          `SELECT ${MEMORY_COLUMNS}, m.project_id AS projectId, f.bm25
             FROM (SELECT rowid AS id, bm25(memories_fts, 4.0, 1.0, 2.0, 0.0) AS bm25
                     FROM memories_fts WHERE memories_fts MATCH ? ORDER BY rowid DESC LIMIT ?) f
             CROSS JOIN memories m ON m.id = f.id
            WHERE m.status = 'active' AND ${input.unseen} AND ${input.kindFilter}
            ORDER BY f.bm25 LIMIT ?`,
        )
        .all(`${FTS_MATCH(match)} AND project_id : (${projects})`, LINKED_SCAN, LINKED_POOL);
      for (const { bm25, projectId, ...row } of rows) {
        if (origins.has(row.id)) continue; // one of the author's rules, weighed as such
        origins.set(row.id, `from ${names.get(projectId)}`);
        linked.push({ row, bm25, overlap: 0 });
      }
    }
    return { rules: rules.filter((row) => !input.known.has(row.id)), linked, origins };
  } catch (error) {
    failOpen(error);
    return NO_EXTRA;
  }
}

/**
 * The author's rules that share enough with the prompt, scored for text like the project's
 * own candidates. The score is the same bm25 the project's search gives: a term the rule
 * does not contain adds nothing to it, so only the terms it contains are looked up.
 */
function scoredRules(db: Db, rules: Candidate[], query: Query, context: Context): Candidate[] {
  if (rules.length === 0) return [];
  try {
    const terms = matchTerms(query.match);
    const lookup = db.query<{ bm25: number }, [string, number]>(
      `SELECT bm25(memories_fts, 4.0, 1.0, 2.0, 0.0) AS bm25 FROM memories_fts
        WHERE memories_fts MATCH ? AND rowid = ?`,
    );
    return [...rules]
      .sort((a, b) => prior(b.row, context) - prior(a.row, context) || b.row.id - a.row.id)
      .slice(0, MAX_RULE_LOOKUPS)
      .map((candidate) => {
        const { row } = candidate;
        const tokens = new Set(searchTokens(`${row.title} ${row.body} ${row.terms}`));
        const own = terms.filter((term) => searchTokens(term).every((token) => tokens.has(token)));
        const bm25 = own.length === 0 ? undefined : lookup.get(FTS_MATCH(anyOf(own)), row.id)?.bm25;
        return bm25 === undefined ? candidate : { ...candidate, bm25 };
      });
  } catch (error) {
    failOpen(error);
    return [];
  }
}

let vocabFailed = false;

/** How many memories of the index hold each one-word term; none known if it cannot tell. */
function termCounts(db: Db, terms: string[]): Map<string, number> {
  try {
    return documentCounts(db, terms);
  } catch (error) {
    if (!vocabFailed) {
      vocabFailed = true;
      logError("prompt.vocab", error);
    }
    return new Map();
  }
}

type Context = { branch: string | null; now: number };

interface Candidate {
  row: MemoryRow;
  /** Lower is a better match; undefined when the full-text search did not return it. */
  bm25?: number;
  /** How many of its files were touched in this session. */
  overlap: number;
}

/**
 * A condition that leaves out the notes this context has already been given.
 *
 * A note is owed in full once per context. The session brief only names notes, so one
 * it named still counts as unseen, unless its title is all there is to it. A note given
 * on a prompt, a file read or a failure was given in full. Also what the lookups for a
 * file and for a failure share, so none of them repeats another. The ids are
 * looked up first and inlined: a subquery here would be re-run for every candidate row.
 */
export function notYetShown(db: Db, sessionId: number, epoch: number): string {
  const shown = db
    .query<{ id: number }, [number, number]>(
      `SELECT DISTINCT i.memory_id AS id FROM injections i JOIN memories m ON m.id = i.memory_id
        WHERE i.session_id = ? AND i.context_epoch = ?
          AND (i.event IN ('prompt', 'file-read', 'tool-failed') OR (i.event = 'session-start' AND m.body = ''))`,
    )
    .all(sessionId, epoch);
  return shown.length === 0 ? "1" : `m.id NOT IN (${shown.map((row) => row.id).join(", ")})`;
}

function sessionFiles(db: Db, sessionId: number): string[] {
  const files = new Set<string>();
  const turns = db
    .query<{ files_changed: string; files_read: string }, [number, number]>(
      // By time: history read back later can hold older turns of the same session.
      `SELECT files_changed, files_read FROM turns WHERE session_id = ?
        ORDER BY COALESCE(ended_at, started_at) DESC, id DESC LIMIT ?`,
    )
    .all(sessionId, RECENT_TURNS);
  for (const turn of turns) {
    for (const json of [turn.files_changed, turn.files_read]) {
      try {
        for (const path of JSON.parse(json) as unknown[]) {
          if (typeof path === "string" && files.size < MAX_SESSION_FILES) files.add(path);
        }
      } catch {
        // A malformed row contributes nothing.
      }
    }
  }
  return [...files];
}

/**
 * Whether a memory has enough in common with the prompt to be worth the model's
 * attention. Sharing one ordinary word is not enough; in doubt, nothing is injected.
 */
function hasEvidence(candidate: Candidate, query: Query, isRare: (word: string) => boolean) {
  const { row } = candidate;
  const tokens = searchTokens(`${row.title} ${row.body} ${row.terms}`);
  const stems = new Set(tokens.map(stem));
  const joined = ` ${tokens.join(" ")} `;

  const identifiers = query.identifiers.filter((identifier) =>
    joined.includes(` ${searchTokens(identifier).join(" ")} `),
  ).length;
  if (identifiers > 0) return true;

  // Compared by stem, so that "query" in the prompt meets "queries" in the memory.
  const matched = query.words.filter((word) => stems.has(stem(searchTokens(word)[0] ?? "")));
  // Shared words are weighed, not counted: a word few memories have says most, an
  // ordinary one less, and one found in any talk about code ("fix", "test") least.
  const telling = matched.filter((word) => !isGeneric(word));
  if (telling.length === 0) return false;
  if (candidate.overlap > 0) return true;
  // Each telling word weighs one, and half again if it is rare. Whether it is rare costs a
  // lookup, so it is asked only while the answer could still change the outcome.
  let weight = (matched.length - telling.length) * 0.5 + telling.length;
  let unknown = telling.length;
  for (const word of telling) {
    if (weight >= EVIDENCE_WEIGHT) return true;
    if (weight + unknown * 0.5 < EVIDENCE_WEIGHT) return false;
    unknown--;
    if (isRare(word)) weight += 0.5;
  }
  return weight >= EVIDENCE_WEIGHT;
}

/**
 * The memories worth showing for this prompt: at most five, best first, none that this
 * context has already seen, within the size budget. Often none at all.
 */
export function retrieveForPrompt(
  db: Db,
  input: {
    projectId: number;
    sessionId: number;
    epoch: number;
    prompt: string;
    branch: string | null;
    now: number;
    /** Only memories of these kinds; default all. */
    kinds?: readonly MemoryKind[];
    /** Default 5. */
    maxNotes?: number;
    /** Default 2,400 characters. */
    budgetChars?: number;
  },
): Note[] {
  const maxNotes = input.maxNotes ?? MAX_NOTES;
  const budgetChars = input.budgetChars ?? MOMENT_BUDGET.prompt;
  const kindFilter =
    input.kinds === undefined
      ? "1"
      : input.kinds.length === 0
        ? "0"
        : `m.kind IN (${input.kinds.map((kind) => `'${kind.replaceAll("'", "''")}'`).join(", ")})`;
  // Its ids and paths only make for a slow search.
  if (isFromTheHost(input.prompt)) return [];
  const query = buildQuery(input.prompt);
  if (query === null) return [];

  const unseen = notYetShown(db, input.sessionId, input.epoch);
  const counts = termCounts(db, matchTerms(query.match));
  const candidates = new Map<number, Candidate>();
  const matched = db
    .query<MemoryRow & { bm25: number }, [string, number, number]>(
      `SELECT ${MEMORY_COLUMNS}, bm25(memories_fts, 4.0, 1.0, 2.0, 0.0) AS bm25
         FROM memories_fts CROSS JOIN memories m ON m.id = memories_fts.rowid
        WHERE memories_fts MATCH ? AND m.project_id = ? AND m.status = 'active' AND ${unseen} AND ${kindFilter}
        ORDER BY bm25 LIMIT ?`,
    )
    .all(inProject(query.match, input.projectId), input.projectId, CANDIDATES_PER_CHANNEL);
  for (const { bm25, ...row } of matched) candidates.set(row.id, { row, bm25, overlap: 0 });

  const files = sessionFiles(db, input.sessionId);
  if (files.length > 0) {
    const touched = db
      .query<MemoryRow & { overlap: number }, (string | number)[]>(
        `SELECT ${MEMORY_COLUMNS}, count(*) AS overlap
           FROM memory_files f JOIN memories m ON m.id = f.memory_id
          WHERE f.path IN (${files.map(() => "?").join(", ")})
            AND m.project_id = ? AND m.status = 'active' AND ${unseen} AND ${kindFilter}
          GROUP BY m.id ORDER BY overlap DESC LIMIT ?`,
      )
      .all(...files, input.projectId, CANDIDATES_PER_CHANNEL);
    for (const { overlap, ...row } of touched) {
      const known = candidates.get(row.id);
      if (known === undefined) candidates.set(row.id, { row, overlap });
      else known.overlap = overlap;
    }
  }
  // The author's rules join the project's candidates; linked projects' are kept apart and
  // must earn their place. Any error here leaves the project's own candidates, as before.
  const extra = extraCandidates(db, {
    projectId: input.projectId,
    query,
    unseen,
    kindFilter,
    known: candidates,
  });
  if (candidates.size === 0 && extra.rules.length === 0 && extra.linked.length === 0) return [];

  // A word is rare when few of the project's memories contain it. CROSS JOIN, here and
  // in every full-text query, pins the join order: left to itself the planner may walk
  // the memories and probe the index once per row, which is a hundred times slower.
  const total =
    db
      .query<{ n: number }, [number]>(
        "SELECT count(*) AS n FROM memories WHERE project_id = ? AND status = 'active'",
      )
      .get(input.projectId)?.n ?? 0;
  // Never below one: in a small project, a word two memories share is not rare.
  const rareLimit = Math.max(1, Math.ceil(total * 0.05));
  // Counted only as far as the limit: past it the word is common, however common.
  const frequency = db.query<{ n: number }, [string, number, number]>(
    `SELECT count(*) AS n FROM (
       SELECT 1 FROM memories_fts CROSS JOIN memories m ON m.id = memories_fts.rowid
        WHERE memories_fts MATCH ? AND m.project_id = ? AND m.status = 'active' LIMIT ?)`,
  );
  const known = new Map<string, boolean>();
  const isRare = (word: string) => {
    let rare = known.get(word);
    if (rare === undefined) {
      const forms = new Set([word, stem(searchTokens(word)[0] ?? word)]);
      // The project's memories are some of the index's: a word that few memories of the
      // whole index hold is rare in the project too, and needs no counting there.
      const atMost = [...forms].reduce((sum, form) => sum + (counts.get(form) ?? Infinity), 0);
      rare =
        atMost <= rareLimit ||
        (frequency.get(inProject(anyOf(forms), input.projectId), input.projectId, rareLimit + 1)
          ?.n ?? 0) <= rareLimit;
      known.set(word, rare);
    }
    return rare;
  };

  const evident = (candidate: Candidate) => hasEvidence(candidate, query, isRare);
  const eligible = [
    ...[...candidates.values()].filter(evident),
    ...scoredRules(
      db,
      extra.rules.map((row) => ({ row, overlap: 0 })).filter(evident),
      query,
      input,
    ),
  ];
  const linked = extra.linked.filter(evident);

  const fused = fusion(eligible, input);
  const ordered = eligible.sort((a, b) => fused(b) - fused(a) || b.row.id - a.row.id);
  if (linked.length > 0) {
    // A linked note is weighed against the project's own on the same scale, and shown
    // only when it is better than the best of them.
    const all = fusion([...eligible, ...linked], input);
    const best = eligible.reduce((top, candidate) => Math.max(top, all(candidate)), 0);
    const better = linked
      .filter((candidate) => eligible.length === 0 || all(candidate) > best)
      .sort((a, b) => all(b) - all(a) || b.row.id - a.row.id)
      .slice(0, MAX_LINKED_NOTES);
    ordered.unshift(...better);
  }

  const notes: Note[] = [];
  let size = renderNotes([]).length;
  const overhead = renderNotes([
    { id: 0, kind: "fix", title: "", body: "", createdAt: 0, files: [], stale: false },
  ]).length;
  for (const candidate of ordered) {
    if (notes.length === maxNotes) break;
    const note = toNote(db, candidate.row, extra.origins.get(candidate.row.id));
    const cost = renderNote(note).length + 1 + (notes.length === 0 ? overhead : 0);
    if (size + cost > budgetChars) continue;
    notes.push(note);
    size += cost;
  }
  return notes;
}
