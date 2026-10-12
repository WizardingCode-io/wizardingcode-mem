import type { Query } from "../../retrieve/query.ts";
import { isGeneric, STOPWORDS, searchTokens, stem } from "../../util/words.ts";
import type { KnowledgeEntry } from "./files.ts";

// Whether an entry deserves a place beside a prompt. bm25 only ranks: its scores depend on
// how many entries the folder has (with one or two they are close to zero), so no fixed
// score can be a floor that holds for a folder of 2 and one of 500. The floor is the
// evidence the entry and the prompt share, counted in distinct words, which means the same
// in a folder of any size. Calibrated on a realistic folder and prompts (see the module's
// tests): the right entry for each relevant prompt, nothing for unrelated ones.

/** A shared word in the title or tags: what the entry is about. */
const TITLE_WEIGHT = 2;
/** A shared word in the body only. */
const BODY_WEIGHT = 1;
/** A word any talk about code has ("fix", "test", "run"): little evidence on its own. */
const GENERIC_WEIGHT = 0.5;
/** The floor: e.g. one title word and one body word, or three body words. */
export const RELEVANCE_FLOOR = 3;
/**
 * Or: the prompt names at least this part of the title's own words, and at least two of
 * them. A title of one or two words ("Order lifecycle", "Caching") shares its one word with
 * many unrelated prompts, so one covered word is not enough, unless the title spells it as
 * a name ("MongoDB", "PostgreSQL", "SQS", "OAuth2"): a product or a code name says what the
 * entry is about where an ordinary word does not.
 */
const TITLE_COVERAGE = 0.5;
const MIN_COVERED = 2;

/** A word written as a name: a capital inside it, a run of capitals, or digits with letters. */
const isName = (word: string) =>
  /\p{L}/u.test(word) && (/\p{Ll}\p{Lu}/u.test(word) || /\p{Lu}{2}/u.test(word) || /\d/.test(word));

/** Title words that carry no subject of their own, besides the usual stop words. */
const PLAIN = new Set(["never", "always", "only"]);

/** A title's own words (not short, not generic, not stop words), by stem, each marked when written as a name. */
function titleWords(title: string): Map<string, boolean> {
  const own = new Map<string, boolean>();
  for (const word of title.match(/[\p{L}\p{N}]+/gu) ?? []) {
    const token = searchTokens(word)[0];
    if (token === undefined || token.length < 3) continue;
    if (STOPWORDS.has(token) || PLAIN.has(token) || isGeneric(token)) continue;
    const key = stem(token);
    own.set(key, (own.get(key) ?? false) || isName(word));
  }
  return own;
}

/**
 * Whether the entry shares enough with the prompt: a name the prompt gives in code form
 * (`formatMoney`, `src/orders.ts`) found in it; or shared words weighing at least the floor,
 * at least one of them not generic; or the prompt covering half of the title's own words,
 * two of them at least, or one written as a name.
 */
export function isRelevant(entry: KnowledgeEntry, query: Query): boolean {
  const head = `${entry.title} ${entry.tags.join(" ")}`;
  const headTokens = searchTokens(head);
  const bodyTokens = searchTokens(entry.body);
  const joined = ` ${[...headTokens, ...bodyTokens].join(" ")} `;
  for (const identifier of query.identifiers) {
    const parts = searchTokens(identifier);
    if (parts.length > 0 && joined.includes(` ${parts.join(" ")} `)) return true;
  }

  const inHead = new Set(headTokens.map((token) => stem(token)));
  const inBody = new Set(bodyTokens.map((token) => stem(token)));
  // Compared by stem ("orders" meets "order"), each stem once, judged by the word asked.
  const asked = new Map(query.words.map((word) => [stem(searchTokens(word)[0] ?? word), word]));
  let weight = 0;
  let telling = 0;
  for (const [key, word] of asked) {
    const where = inHead.has(key) ? TITLE_WEIGHT : inBody.has(key) ? BODY_WEIGHT : 0;
    if (where === 0) continue;
    if (isGeneric(word)) {
      weight += GENERIC_WEIGHT;
    } else {
      telling++;
      weight += where;
    }
  }
  if (telling === 0) return false;
  if (weight >= RELEVANCE_FLOOR) return true;

  const own = titleWords(entry.title);
  const covered = [...own].filter(([key]) => asked.has(key));
  if (covered.length === 0 || covered.length / own.size < TITLE_COVERAGE) return false;
  return covered.length >= MIN_COVERED || covered.some(([, name]) => name);
}
