import type { Db } from "../store/db.ts";
import { searchTokens } from "../util/words.ts";

/**
 * The full-text index's own list of terms, with how many memories hold each one. A table
 * of the connection's temporary schema, declared on first use: nothing is added to the
 * database, so its schema version, and the binaries that can open it, are unchanged.
 * Reading a term's count walks that term's list of memories without scoring any of them.
 */
const VOCAB =
  "CREATE VIRTUAL TABLE IF NOT EXISTS temp.memories_vocab USING fts5vocab(main, memories_fts, 'row')";

/**
 * How many memories of the whole index, every project and every status, hold each word,
 * keyed by the word as given; a word of more than one token is left out. A word is looked
 * up the way the index folds it.
 */
export function documentCounts(db: Db, words: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  const folded = new Map<string, string>();
  for (const word of words) {
    const tokens = searchTokens(word);
    if (tokens.length === 1) folded.set(word, tokens[0] as string);
  }
  if (folded.size === 0) return counts;
  db.run(VOCAB);
  const terms = [...new Set(folded.values())];
  const found = new Map(
    db
      .query<{ term: string; doc: number }, string[]>(
        `SELECT term, doc FROM temp.memories_vocab WHERE term IN (${terms.map(() => "?").join(", ")})`,
      )
      .all(...terms)
      .map((row) => [row.term, row.doc]),
  );
  for (const [word, term] of folded) counts.set(word, found.get(term) ?? 0);
  return counts;
}
