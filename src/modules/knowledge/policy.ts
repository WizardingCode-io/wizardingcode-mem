// What the knowledge module shows an agent, in numbers, and the rule a prompt's candidate
// has to pass before a hook shows it. A leaf: the hooks, the refresh and the tests read it.
import type { Query } from "../../retrieve/query.ts";
import { isGeneric, searchTokens, stem } from "../../util/words.ts";

/** Knowledge's part of each moment's budget: 840 characters at session start, 480 on a prompt. */
export const KNOWLEDGE_SHARE = 0.2;
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
