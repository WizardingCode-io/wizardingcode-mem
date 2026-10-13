import type { Query } from "../../retrieve/query.ts";
import { isGeneric, searchTokens, stem } from "../../util/words.ts";
import type { KnowledgeEntry } from "./files.ts";

// Whether an entry deserves a place beside a prompt. bm25 only ranks: its scores depend on
// how many entries the folder has (with one or two they are close to zero), so no fixed
// score can be a floor that holds for a folder of 2 and one of 500. The floor is the
// evidence the entry and the prompt share, counted in distinct words, which means the same
// in a folder of any size.
//
// One shared word is never enough, wherever it is: a short title ("Order lifecycle",
// "Caching") or a name in one ("API versioning", "We use PostgreSQL, not MongoDB") shares
// its word with many prompts that only mention it in passing. Names get no exemption: API,
// JSON, GitHub or MongoDB are as common in prompts as "order". Calibrated on a realistic
// folder, short titles, acronyms and names, and the review's probe (see the tests).

/** Distinct telling words (not generic) shared with the entry that are enough on their own. */
export const MIN_SHARED = 3;
/**
 * Or two of the title's or tags' own words, with one more shared word of any kind ("which
 * feature flags can we remove?" for "Feature flags"): the prompt names what the entry is
 * about and says something about it.
 */
const MIN_IN_TITLE = 2;

/**
 * Whether the entry shares enough with the prompt: a name the prompt gives in code form
 * (`formatMoney`, `src/orders.ts`, ORDER_NOT_FOUND) found in it; or at least three distinct
 * telling words, anywhere in it; or two of its title's or tags' words and a third word, which
 * may be a generic one ("remove", "change"). Words are compared by stem ("orders" meets
 * "order"); generic words ("fix", "test", "run") never count as telling.
 */
export function isRelevant(entry: KnowledgeEntry, query: Query): boolean {
  const headTokens = searchTokens(`${entry.title} ${entry.tags.join(" ")}`);
  const bodyTokens = searchTokens(entry.body);
  const joined = ` ${[...headTokens, ...bodyTokens].join(" ")} `;
  for (const identifier of query.identifiers) {
    const parts = searchTokens(identifier);
    if (parts.length > 0 && joined.includes(` ${parts.join(" ")} `)) return true;
  }

  const inHead = new Set(headTokens.map((token) => stem(token)));
  const inBody = new Set(bodyTokens.map((token) => stem(token)));
  // Each stem once, judged by the word as asked.
  const asked = new Map(query.words.map((word) => [stem(searchTokens(word)[0] ?? word), word]));
  let telling = 0;
  let tellingInHead = 0;
  let shared = 0;
  for (const [key, word] of asked) {
    const head = inHead.has(key);
    if (!head && !inBody.has(key)) continue;
    shared++;
    if (isGeneric(word)) continue;
    telling++;
    if (head) tellingInHead++;
  }
  if (telling >= MIN_SHARED) return true;
  return tellingInHead >= MIN_IN_TITLE && shared > MIN_IN_TITLE;
}
