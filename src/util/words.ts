// English and Portuguese words too common to tell two texts apart.
export const STOPWORDS = new Set(
  "the and for are was were not but with that this from have has had its their there which when then than into about over also been being will would should could can may our your you they them these those does did doing done just only very more most some such each any all one two out off too now new use used using get got yet still onto upon within without between while where what who whom whose why how nor both few own same other another again once here uma uns umas dos das nos nas por para com sem sob sobre entre até que não sim mas como mais menos muito pouco também já ainda são ser está estão foi era eram tem têm ter isto isso esse essa este esta aquele aquela ele ela eles elas seu sua seus suas num numa pelo pela pelos pelas aos quando onde porque pois cada todo toda todos todas outro outra outros outras".split(
    " ",
  ),
);

/** The distinct meaningful words of a text, lower-cased. */
export function tokens(text: string): Set<string> {
  const found = text.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [];
  return new Set(found.filter((token) => token.length >= 3 && !STOPWORDS.has(token)));
}

const CAMEL_CASE = /[A-Za-z][A-Za-z0-9]*[a-z0-9][A-Z][A-Za-z0-9]*/g;

/**
 * The parts of camelCase identifiers in `text`, as plain words: "openDb" gives "open db".
 * The full-text tokenizer already splits on punctuation, but not inside such a word.
 */
export function identifierParts(text: string): string {
  const parts = new Set<string>();
  for (const identifier of text.match(CAMEL_CASE) ?? []) {
    const split = identifier
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
      .toLowerCase()
      .split(" ");
    for (const part of split) parts.add(part);
  }
  return [...parts].join(" ");
}

/**
 * Confines a full-text query to one project, inside the index: the text columns are
 * searched for `match`, and the row must carry the project's id. Far cheaper than
 * matching every project's memories and filtering afterwards.
 */
export function inProject(match: string, projectId: number): string {
  return `{title body terms} : (${match}) AND project_id : "${projectId}"`;
}

/** `inProject` over several projects; one project gives exactly what `inProject` gives. */
export function inProjects(match: string, projectIds: readonly number[]): string {
  if (projectIds.length === 1) return inProject(match, projectIds[0] as number);
  return `{title body terms} : (${match}) AND project_id : (${projectIds.map((id) => `"${id}"`).join(" OR ")})`;
}

/** An FTS5 query matching any of the terms. Each term is quoted, so none is read as syntax. */
export function anyOf(terms: Iterable<string>): string {
  return [...terms].map((term) => `"${term.replaceAll('"', '""')}"`).join(" OR ");
}

/**
 * Splits text the way the full-text index does (`unicode61 remove_diacritics`):
 * lower case, accents folded, every run of letters and digits a token.
 */
export function searchTokens(text: string): string[] {
  return (
    text
      .normalize("NFD")
      .replace(/\p{M}+/gu, "")
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? []
  );
}

/**
 * Reduces an index token to a form shared by its plural and its -ed and -ing forms,
 * in English and (plurals only) Portuguese. Deliberately light: it conflates forms of
 * one word and leaves the rest alone. The result is a search key, not a word.
 */
export function stem(token: string): string {
  if (token.length < 5 || /\d/.test(token)) return token;
  let s = token;
  if (s.endsWith("ies")) s = `${s.slice(0, -3)}y`;
  else if (s.endsWith("oes")) s = `${s.slice(0, -3)}ao`;
  else if (/(?:ss|x|z|ch|sh)es$/.test(s)) s = s.slice(0, -2);
  else if (s.endsWith("s") && !/(?:ss|us|is)$/.test(s)) s = s.slice(0, -1);

  let cut = false;
  if (s.length >= 7 && s.endsWith("ing")) {
    s = s.slice(0, -3);
    cut = true;
  } else if (s.length >= 6 && s.endsWith("ed")) {
    s = s.slice(0, -2);
    cut = true;
  }
  // committ(ed) -> commit; "ll" and "ss" are usually part of the word itself.
  if (cut && /([^aeiouls])\1$/.test(s)) s = s.slice(0, -1);
  if (s.length >= 5 && s.endsWith("e")) s = s.slice(0, -1);
  return s;
}

/**
 * The search-only words stored beside a memory: its file paths, the parts of its
 * camelCase identifiers, and the stems of its inflected words. A query adds the stems
 * of its own words, so the two meet whichever form each side used.
 */
export function searchTerms(title: string, body: string, paths: string[]): string {
  const text = `${title} ${body}`;
  const terms = new Set<string>(paths);
  for (const part of identifierParts(`${text} ${paths.join(" ")}`).split(" ")) {
    if (part !== "") terms.add(part);
  }
  for (const token of searchTokens(text)) {
    const reduced = stem(token);
    if (reduced !== token) terms.add(reduced);
  }
  return [...terms].join(" ");
}

// Words that turn up in almost any conversation about code, in English and Portuguese.
// Sharing them with a memory says little about whether the memory is relevant.
const GENERIC = new Set(
  "fix fixed fail failed failing test code file function error bug add change update use make run work issue problem need want look check help create remove write read get set try show tell explain thing way line name value type data new please also corrigir corrige falha falhar teste código ficheiro função erro adicionar adiciona alterar altera mudar muda atualizar atualiza usar usa fazer faz criar cria remover escrever ler ver mostrar mostra explicar explica problema coisa forma linha nome valor tipo dados novo nova"
    .split(" ")
    .map((word) => stem(searchTokens(word)[0] ?? word)),
);

/** True for a word too common in talk about code to count as evidence of relevance. */
export function isGeneric(word: string): boolean {
  return GENERIC.has(stem(searchTokens(word)[0] ?? word));
}
