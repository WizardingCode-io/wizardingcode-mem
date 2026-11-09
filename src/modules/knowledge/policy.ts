// What the knowledge module shows an agent, in numbers, and the rule a prompt's candidate
// has to pass before a hook shows it. A leaf: the hooks, the refresh and the tests read it.
import { MOMENT_BUDGET } from "../../engine/budget.ts";
import type { Query } from "../../retrieve/query.ts";
import { isGeneric, searchTokens, stem } from "../../util/words.ts";

/** Knowledge's part of each moment's budget: 840 characters at session start, 480 on a prompt. */
export const KNOWLEDGE_SHARE = 0.2;
/**
 * Knowledge's characters at session start, worked out as the composer works out a share:
 * what the pinned lines must fit in, wrapper and intro included, and what `doctor` measures.
 */
export const SESSION_START_SHARE = Math.floor(KNOWLEDGE_SHARE * MOMENT_BUDGET["session-start"]);
/** Entries a prompt shows at most, whatever room is left. */
export const MAX_PER_PROMPT = 2;
/** The search's best candidates, in bm25 order, that the floor is run over. */
export const CANDIDATES = 10;
/** An entry's first paragraph on a prompt, clipped to this many characters. */
export const PARAGRAPH_MAX = 80;
/** Distinct words a prompt shares with an entry before the entry counts as relevant. */
export const MIN_SHARED = 3;
/** The title's own words that, with one more shared word, make an entry relevant. */
export const MIN_TITLE = 2;
/** bm25's weights for the search table's text columns: title, area, context, subject, body. */
export const BM25_WEIGHTS = [4, 2, 2, 2, 1] as const;
/** Repositories one drain rebuilds at most, each in its own transaction. */
export const REFRESH_PER_DRAIN = 3;

// The tools.
/** References one `knowledge_get` reads at most. */
export const GET_MAX_REFS = 10;
/** An entry's body in a `knowledge_get` answer is cut past this many characters. */
export const GET_BODY_MAX = 8000;
/** A `knowledge_get` answer renders no further block past this many characters. */
export const GET_ANSWER_MAX = 32000;
export const SEARCH_DEFAULT_LIMIT = 10;
export const SEARCH_MAX_LIMIT = 25;
/** `knowledge_propose` calls per agent id per hour, whatever their result. */
export const PROPOSALS_PER_HOUR = 20;
/** Entries a draft is compared with by the configured judge: one request, 16 questions. */
export const NEIGHBOURS = 8;
/** Distinct non-generic tokens of a draft's body that join its title's in the neighbour search. */
export const NEIGHBOUR_BODY_TOKENS = 40;
/** Each body the judge reads, the draft's included, is clipped to this many characters. */
export const JUDGE_BODY_MAX = 2000;

/** The fields the floor reads. The area is not one: every entry of an area shares its word. */
export interface FloorEntry {
  title: string;
  context: string;
  subject: string;
  body: string;
}

/** Which rule let an entry through: a code name, the title's words, or shared words. */
export type Evidence = "code" | "title" | "words";

/** The form a word is compared in: its index token, stemmed, so `query` and `queries` meet. */
const stemOf = (word: string) => stem(searchTokens(word)[0] ?? word);

const stemsOf = (text: string) => new Set(searchTokens(text).map(stem));

/** Whether `needle` appears in `haystack` as consecutive tokens. */
function containsRun(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0) return false;
  for (let i = 0; i + needle.length <= haystack.length; i++) {
    if (needle.every((token, j) => haystack[i + j] === token)) return true;
  }
  return false;
}

/**
 * Whether a prompt's query is evidence for an entry, and by which rule: ADR 0020's rule
 * with no tags. The rules are tested in this order, the first that holds is the answer:
 *
 * 1. `code`: a code name of the prompt appears in one of the entry's fields as a token run.
 * 2. `title`: at least `MIN_TITLE` shared non-generic words are the title's own, and at
 *    least `MIN_SHARED` words are shared in all, generic ones included.
 * 3. `words`: at least `MIN_SHARED` shared non-generic words, anywhere in the entry.
 *
 * Words are distinct and compared by stem. A stopword never counts: `buildQuery` leaves
 * them out of the query's words. Null when no rule holds.
 */
export function knowledgeEvidence(query: Query, entry: FloorEntry): Evidence | null {
  const fields = [entry.title, entry.context, entry.subject, entry.body];
  const fieldTokens = fields.map(searchTokens);
  for (const identifier of query.identifiers) {
    const run = searchTokens(identifier);
    if (fieldTokens.some((tokens) => containsRun(tokens, run))) return "code";
  }

  const entryStems = new Set(fieldTokens.flat().map(stem));
  const titleStems = stemsOf(entry.title);
  // One word of each shared stem: `isGeneric` stems what it is given, so any word of the
  // stem gives the same answer.
  const shared = new Map<string, string>();
  for (const word of query.words) {
    const key = stemOf(word);
    if (entryStems.has(key) && !shared.has(key)) shared.set(key, word);
  }
  const telling = [...shared].filter(([, word]) => !isGeneric(word)).map(([key]) => key);
  const inTitle = telling.filter((key) => titleStems.has(key));
  if (inTitle.length >= MIN_TITLE && shared.size >= MIN_SHARED) return "title";
  if (telling.length >= MIN_SHARED) return "words";
  return null;
}
