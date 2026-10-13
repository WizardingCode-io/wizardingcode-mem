import { clip } from "../util/text.ts";
import { anyOf, identifierParts, STOPWORDS, searchTokens, stem } from "../util/words.ts";

export { searchTokens } from "../util/words.ts";

export interface Query {
  /** Meaningful plain words, lower case, in order of appearance. */
  words: string[];
  /** Exact things named in the prompt: symbols, paths, file names. */
  identifiers: string[];
  /** FTS5 expression matching any of them. */
  match: string;
}

const MAX_TERMS = 32;
const MAX_IDENTIFIER_CHARS = 80;

const MAX_PROMPT_CHARS = 4000;

// One pass, leftmost match first, so a path is taken whole before its file name is seen.
// Every repetition is bounded and every alternative can only start at the beginning of
// a run: an unanchored `[\w.-]+` is quadratic on a long run of hex or base64, and a
// prompt may be exactly that.
const IDENTIFIER = new RegExp(
  [
    "`([^`\\n]{1,200})`", // a code span
    "(?<![\\w./-])[\\w.-]{1,80}(?:/[\\w.-]{1,80}){1,20}", // a path
    "(?<![\\w-])[\\w-]{1,80}\\.(?:tsx?|jsx?|json|md|sql|py|go|rs|toml|ya?ml|sh|css|html|php|rb|java|kt|swift|cpp|c|h)\\b", // a file name
    "\\b[A-Za-z][A-Za-z0-9]{0,80}(?:_[A-Za-z0-9]{1,80}){1,20}\\b", // snake_case
    "\\b[A-Za-z][a-z0-9]{1,80}[A-Z][A-Za-z0-9]{0,80}\\b", // camelCase
  ].join("|"),
  "g",
);

/**
 * Whether naming this is, by itself, evidence of what the prompt is about. `parseUser`,
 * `busy_timeout`, `src/db.ts` and `Promise.race` are; `value` in backticks and
 * "TypeScript" are ordinary words that happen to look like code.
 */
function isSpecific(identifier: string): boolean {
  return (
    /[\s/_]/.test(identifier) || // a phrase, a path, snake_case
    /[\w)\]]\.[A-Za-z]\w*$/.test(identifier) || // member access, or a file name
    /^[a-z][a-z0-9]*[A-Z]/.test(identifier) || // lowerCamelCase
    (/\d/.test(identifier) && /[A-Za-z]/.test(identifier)) // letters with digits: sha256
  );
}

/**
 * What to search for, given a prompt. The prompt is never used as it stands: common
 * words would match everything. Null when the prompt names too little to search for,
 * in which case nothing is injected.
 */
export function buildQuery(prompt: string): Query | null {
  const identifiers: string[] = [];
  // What a prompt is about is said at its start; the rest of a long one is material.
  const prose = clip(prompt, MAX_PROMPT_CHARS).replace(
    IDENTIFIER,
    (match: string, span?: string) => {
      const identifier = (span ?? match).trim().replace(/\.+$/, "");
      // Left in the prose, it is searched for as the ordinary word it is.
      if (!isSpecific(identifier)) return ` ${identifier} `;
      if (/[\p{L}\p{N}]/u.test(identifier) && identifier.length <= MAX_IDENTIFIER_CHARS) {
        if (!identifiers.includes(identifier)) identifiers.push(identifier);
      }
      return " ";
    },
  );

  const words: string[] = [];
  const candidates = [
    ...(prose.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []),
    ...identifierParts(identifiers.join(" ")).split(" "),
  ];
  for (const word of candidates) {
    if (word.length >= 3 && !STOPWORDS.has(word) && !/^\d+$/.test(word) && !words.includes(word)) {
      words.push(word);
    }
  }

  if (identifiers.length === 0 && words.length < 2) return null;
  const kept = identifiers.slice(0, MAX_TERMS);
  const keptWords = words.slice(0, MAX_TERMS - kept.length);
  // Stems go into the search only: they find the other forms of a word.
  const stems = keptWords.map((word) => stem(searchTokens(word)[0] ?? word));
  return {
    words: keptWords,
    identifiers: kept,
    match: anyOf(new Set([...kept, ...keptWords, ...stems])),
  };
}

/** The terms an FTS expression made by `anyOf` is made of, unquoted. */
export function matchTerms(match: string): string[] {
  return [...match.matchAll(/"((?:[^"]|"")*)"/g)].map((found) =>
    (found[1] as string).replaceAll('""', '"'),
  );
}

/**
 * The FTS match for a query typed on purpose (a tool call, the viewer's search box): the
 * prompt query when it finds enough to go on, otherwise any of the words or their stems.
 * Null when there is nothing searchable in it.
 */
export function explicitMatch(query: string): string | null {
  const terms = searchTokens(query).filter((token) => token.length >= 2);
  return (
    buildQuery(query)?.match ??
    (terms.length > 0 ? anyOf(new Set(terms.flatMap((term) => [term, stem(term)]))) : null)
  );
}
