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
 * Or: the prompt names at least this part of the title's own words (a short title, such as
 * a glossary term or "PostgreSQL, not MongoDB", is about one or two words).
 */
const TITLE_COVERAGE = 0.5;

/** Title words that carry no subject of their own, besides the usual stop words. */
const PLAIN = new Set(["never", "always", "only"]);

/** The stems of a title's own words: not short, not generic, not stop words. */
function titleWords(title: string): string[] {
  const words = searchTokens(title).filter(
    (token) => token.length >= 3 && !STOPWORDS.has(token) && !PLAIN.has(token) && !isGeneric(token),
  );
  return [...new Set(words.map((word) => stem(word)))];
}

/**
 * Whether the entry shares enough with the prompt: a name the prompt gives in code form
 * (`formatMoney`, `src/orders.ts`) found in it; or shared words weighing at least the floor,
 * at least one of them not generic; or the prompt covering half of the title's own words.
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
  if (own.length === 0) return false;
  const covered = own.filter((word) => asked.has(word)).length;
  return covered / own.length >= TITLE_COVERAGE;
}
