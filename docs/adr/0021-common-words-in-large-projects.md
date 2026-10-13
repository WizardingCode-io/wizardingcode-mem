# ADR 0021 — Common words in large projects

Date: 2026-10-13 · Status: accepted; measured on a synthetic project and on a copy of the author's store (see [The proof](#the-proof)).

## Context

The prompt hook's budget is 80 ms at p95 (ADR 0002). It was measured against a project of 5,000 memories. On the author's store (90,000 memories, 68,000 active; one project with 28,700 active) the hook took 200–450 ms in real sessions on that project. In process, `retrieveForPrompt` was 14 ms at p50 but 96 ms at p95 there.

A timing of every statement over that project's 80 latest real prompts showed two causes:

- **The candidate search** (`memories_fts MATCH … ORDER BY bm25 LIMIT 20`), 72% of the time. The prompt's words are OR'd together, and FTS5 computes bm25 for every memory that holds any one of them before the limit applies. A long prompt is full of words that thousands of memories hold, so it ranks thousands of rows against 30 to 60 terms.
- **The rarity check** of `hasEvidence`, 25%. A word is rare when at most 5% of the project's active memories hold it. That took one count query per word, for every telling word of every candidate (686 queries for 80 prompts).

## Decision

### Document counts from the index itself, in a temporary table

`src/retrieve/vocab.ts` reads how many memories hold each term from an `fts5vocab` table over `memories_fts`. The table is declared in the connection's **temporary** schema (`CREATE VIRTUAL TABLE IF NOT EXISTS temp.memories_vocab USING fts5vocab(main, memories_fts, 'row')`), not by a migration. It is only a view over the existing index, so a schema object would add nothing. Leaving it out of the schema keeps the version at 7, and binaries that refuse a newer schema can still open the database after an upgrade and a downgrade. It also works on read-only connections. A lookup walks the term's list of memories without scoring them: 0.1–0.7 ms for one term on the author's store, about 1.3 ms for a whole prompt. If the lookup fails, the prompt searches as before (fail open, logged once).

The counts cover the whole index: every project, every status. `fts5vocab` cannot count one project, because the project is a column of the same rows.

### Rarity: the same rule, asked less and proved cheaply

The meaning is unchanged. Rare still means held by at most 5% of the project's active memories, counted exactly. Two things make it cheap:

- **Asked only when it matters.** A telling word weighs 1, or 1.5 if rare, and 3 is needed. Rarity is looked up only while the outcome is still open. When the weight already reaches 3, or cannot reach it even if every remaining word were rare, the lookup is skipped.
- **Proved from the index when it can be.** The project's memories are a subset of the index's. So when the word and its stem together are held by no more index memories than the project's limit, the word is rare in the project, with no count. Only the undecided words are still counted in the project, as before.

A word the term list does not find is left unknown, never read as held by none, and it is counted in the project as before. The lookup folds a word the way `searchTokens` does, which strips every accent, but the index (`unicode61 remove_diacritics 2`) strips only Latin ones. A Cyrillic or Greek word with a diacritic ("йогурт", "άλφα") is stored in a form the lookup does not ask for. Reading it as held by none would make it rare. The proof from the index therefore applies only to words it finds, and the rule stays exact.

On the 80 real prompts this alone gives identical notes, in the same order, for every prompt. The count queries drop from 686 to 51. p95 falls only from about 105 ms to about 92 ms: the candidate search is the real cost.

### The candidate search: leave out the commonest words of a long prompt

Once the one-word terms of a prompt are held, together, by more than `POSTINGS_BUDGET` (20,000) memories of the index, its commonest words are left out of the candidate search, commonest first, until the rest fit. Only words held by more than `COMMON_SHARE` (2%) of the index, and by more than `COMMON_FLOOR` (1,000) memories, can be left out. Identifiers are never left out: each is kept whole, as written. Its camelCase parts (`openDb` gives `open` and `db`) join the prompt's ordinary words, and like them they can be left out. If every term would go, the three rarest are kept.

A word left out still counts as evidence in the memories the other terms find, and it still weighs in the rarity rule. What changes is which 20 memories become candidates. A memory that shared only common words with a long prompt is no longer found.

The budget is in postings and not a plain share of the index, because a share alone changed too much. Dropping every word above 2% changed the notes of 26 of the 80 real prompts. Many of them were short prompts (of the kind "merge the release branch into staging") whose only telling words are common in that project, and they lost the notes that answered them. With the budget, a store of no more memories than the budget and a prompt of rare words search exactly as before, and most short prompts do too. A short prompt is not exempt as such. A word and its stem are counted apart, so in a large store two to four words held by thousands of memories each can pass the budget and be narrowed.

| Postings budget | In-process p95 (ms) | Prompts with a different note set (of 80) |
|---|---|---|
| none (before) | 98–105 | 0 |
| 80,000 | 75 | 0 |
| 40,000 | 57 | 9 |
| **20,000** | **33–36** | **15** |
| 10,000 | 28–30 | 20 |
| share only, no budget | 24 | 26 |

## The proof

- **Golden set** (`tests/golden/retrieval.test.ts`): unchanged, recall 19/24, false injections 0/23. Every hook and tool snapshot is byte-identical.
- **Synthetic** (`tests/perf/large-project.test.ts`): 30,000 memories of real length in one project and 30,000 in another, with a Zipf vocabulary of 8,000 words, and 40 prompts made mostly of the 150 commonest words. In process, p95 went from 140–152 ms to 31–33 ms. The budget is 50 ms; starting the binary and recording the turn take the rest of the hook's 80.
- **The author's store**, a copy, project of 28,700 active memories, its 80 latest real prompts:
  - In process: p95 from 103–105 ms to 33–34 ms; p50 unchanged at about 16 ms.
  - Whole compiled hook, after one unmeasured pass over the same prompts: p95 from 127–131 ms to 57–58 ms; p50 37 ms before and after. With only three warm-up runs on a freshly copied store, the first dozen runs are slow for both binaries (up to 400–700 ms, whatever the prompt). That puts both p95s above 80 ms (156 before, 125 after), and it comes from the cold store, not from the search.
  - Notes: 65 of the 80 prompts get the same note set as before, 9 of them in a different order. In the other 15, 22 notes left and 23 came in. The number of prompts given nothing is unchanged (11). Read by eye, most changes swap one loosely related note for another of the same session. Two prompts lost a fitting note to a weaker one: one was made of an identifier and a path, the other a short request about git branches. Two others gained a note that fits better than the one it replaced. One long prompt went from five loose notes to two.

## Consequences

- A long prompt in a large project finds its candidates through its rarer words. A memory that shares only the project's everyday vocabulary with it is no longer found. On the evidence above, such memories were rarely the right note.
- The constants are calibrated on one store. If the hook regresses on a larger one, `POSTINGS_BUDGET` is the knob: cost is close to linear in it.
- Identifier phrases are never left out. A prompt with many paths made of common path segments still costs more than the others (the slowest real prompt is about 41 ms in process).
