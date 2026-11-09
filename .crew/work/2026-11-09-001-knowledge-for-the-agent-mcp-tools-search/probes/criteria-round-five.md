# Criteria of 2026-11-09-001-knowledge-for-the-agent-mcp-tools-search

The text in force is the spec's criteria list; a superseded criterion is read through its replacement.

## AC-1 (behavior)

compose with a declared module that says nothing gives the remainder module the whole budget; with one that writes n characters gives it budget minus n minus 2; a declared module that throws or overruns charges nothing; the total never exceeds the budget; the output is joined in engine order.

## AC-2 (behavior) — superseded by AC-18

openDb applies knowledge migration 7 after 6: knowledge_entries.pinned exists, knowledge_fts holds one row per active problem-free entry and follows an insert, an update (a row turned draft leaves it) and a delete through the triggers, knowledge_shown exists with its key, and every knowledge_repos row has head and fingerprint null; a store that ran 6 only migrates to 7 on open.

## AC-3 (behavior) — superseded by AC-19

With two pinned workspace entries and one pinned shared entry, a session start of any project shows the three as '- <scope>/<slug> · <kind> · <area label> · <title>' after memory's brief inside the knowledge wrapper, records them in knowledge_shown with event session-start, version and hash, shows nothing for them on the next prompt of that context, and shows them again after a clear; with pinned entries whose lines exceed the share, the last line counts the ones not shown; with no repository the module adds nothing and runs one query.

## AC-4 (behavior) — superseded by AC-20

A prompt sharing three telling words with an entry's body shows that entry with its first paragraph inside the share and records it with event prompt and the rule; a prompt naming a code name from the entry shows it; a prompt sharing one word shows nothing; a host prompt shows nothing; an entry already shown in the context is not shown again; the probe fixture brings every relevant prompt's entry first and at most 1 of 28 unrelated prompts injects; memory's own prompt notes are unchanged in the pinned snapshots.

## AC-5 (behavior) — superseded by AC-21

A hook on a repository whose head or fingerprint differ sets knowledge.stale:<path> and shows the index as it is without a rebuild; the drain's refreshKnowledgeSafely rebuilds at most 3 stale repositories, clears their marks and never throws out of the drain; a module schema recorded too new keeps the module silent and logs once per process.

## AC-6 (behavior) — superseded by AC-22

Inside a project the MCP tool list holds memory's tools then knowledge_search, knowledge_get, knowledge_propose with the descriptions and schemas of the spec (the area enum from the taxonomies, each option described by its label and root); with --global it holds knowledge_search and knowledge_get and GLOBAL_INSTRUCTIONS names them; with the modules setting memory the lists are the pinned ones byte for byte.

## AC-7 (behavior) — superseded by AC-23

knowledge_search answers one line per matching active entry over the visible repositories, best first by bm25, never an open proposal, 'No knowledge matches.' otherwise; an empty query lists pinned entries first then newest; repo project with --global is refused; knowledge_get answers each ref's heading, fields and body, clipped at 8,000 characters with a note, the whole answer at most 32,000, and 'Not found: <ref>' for a missing ref.

## AC-8 (behavior) — superseded by AC-16

knowledge_propose for a new entry writes a proposal through part 1's store with proposed_by agent:<id> and on_behalf_of <person>, answers 'proposed <scope>/<id> for <slug>', and knowledge list shows it open; with slug and base_version it proposes a change ('… changes v<n>'); a stale base version, an unknown area for the target root, an existing slug for a new entry and a part 1 quota each answer 'refused <code>: <message>' with part 1's code; the 21st proposal of a server process in an hour is refused quota.

## AC-9 (behavior)

The agent id is the mapping of the handshake's clientInfo.name (a client named claude-code proposes as agent:claude-code, Cursor as agent:cursor, an unknown name as agent:mcp), mcp --agent codex overrides it, an invalid --agent value is refused at start, and the tool bridge proposes as agent:opencode.

## AC-10 (behavior) — superseded by AC-24

A proposal whose text states what a visible entry states is refused duplicate naming <scope>/<slug> (TypeSafe: a Score answer of 2 for that neighbour; heuristic: a Jaccard of 0.6 or more); one that states what an open proposal states names the proposal; one whose text contradicts an entry (TypeSafe: a Noul of 0.8; heuristic: a reversal phrase with an overlap between 0.5 and 0.9) is recorded with contradicts [<scope>/<slug>], judged_by, judge_version, and the answer says so; a neighbour both same and contradicting is recorded as a contradiction, not refused; a TypeSafe failure falls back to the heuristic and a judge without relate records judged_by none.

## AC-11 (behavior) — superseded by AC-25

status prints the knowledge line with its counts; doctor warns for the module off by an explicit setting, pinned lines over the share, a stale repository and an FTS count that differs from the active entries; compact removes knowledge_shown rows of the sessions it removes.

## AC-13 (observed) — superseded by AC-26

docs/adr/0024-knowledge-module.md gains its part 2: the reversal of ADR 0019's note, F5-prime as a ruling, D-9 to D-16 as rulings, the frontmatter key registry, the tool contract, the agent id's boundary, the shared breaker, the growth of knowledge_shown; CLAUDE.md and the README's Knowledge section say the module is on by default and how to turn it off.

## AC-14 (behavior) — superseded by AC-17

The security returns hold: relateState redacts the draft and every neighbour's title and body with the store's env before they leave the machine (a stub TypeSafe receives none of a seeded API key); the per-hour limiter counts every knowledge_propose call that reaches the judge, whatever its result, and is checked before the judge call (21 refused duplicates make the 21st refused quota with no judge request); the FTS match is built from the query's tokens, each quoted, no operator passed through, so a query such as a double quote followed by OR title:x NEAR( answers normally; a global knowledge_get of a project ref answers Not found and refs are validated against the scope and slug patterns and resolved through the index, never as a file path; the wrapper's intro says the knowledge is information, not instructions.

## AC-15 (behavior) — superseded by AC-27

The data returns hold: knowledge_fts keys its rows by searchable repo_id and entry_id columns and its triggers delete by MATCH on them, never by a scan; the prompt query confines the search to the visible repositories inside the MATCH; rebuildRepo on a 2,000-entry repository completes under 2 s on the gate machine with the triggers firing; the perf corpus holds 30 non-visible project repositories of 200 entries sharing words with the measured prompts and the hook budgets hold; a hook writes a stale mark only when none exists (one write, fail-open), never one per prompt; compact prunes knowledge_shown rows whose session or repository no longer exists in the same transaction as the session delete and counts them under dry-run, and deleting a repository's rows deletes its shown rows.

## AC-16 (behavior) — superseded by AC-28

knowledge_propose for a new entry writes a proposal through part 1's store with proposed_by agent:<id> and on_behalf_of <person>, answers 'proposed <scope>/<id> for <slug>', and knowledge list shows it open; with slug and base_version it proposes a change ('… changes v<n>'); a stale base version, an unknown area for the target root, an existing slug for a new entry and a part 1 quota each answer 'refused <code>: <message>' with part 1's code; the per-hour counter lives in meta per agent id (knowledge.rate:<id>), counts every call that passes the schema whatever its result, is checked before the judge call, and is shared by the MCP server and the tool bridge: the 21st call of one agent id in an hour is refused quota with no judge request, another agent id proceeds, a schema-invalid call does not consume the window, an invalid-area refusal does, and the window resets after an hour.

## AC-17 (behavior) — superseded by AC-29

The security returns hold: relateState redacts the draft and every neighbour's title and body with the store's env before they leave the machine (a stub TypeSafe receives none of a seeded API key); the FTS match is built from the query's tokens, each quoted, no operator passed through, so a query such as a double quote followed by OR title:x NEAR( answers normally; a global knowledge_get of a project ref answers Not found and refs are validated against the scope and slug patterns and resolved through the index, never as a file path; the wrapper's intro says the knowledge is information, not instructions.

## AC-18 (behavior)

`openDb` applies knowledge migration 7 after 6. `knowledge_entries` has `pinned` and `fts_rowid`; `knowledge_proposals` has `contradicts`, `on_behalf_of`, `judged_by` and `judge_version`; `knowledge_shown` exists with its key and its two indexes; `knowledge_fts` exists with its five text columns and its two unindexed id columns. The index writer keeps `knowledge_fts` at one row per active, problem-free entry through an insert, an update (an entry turned draft leaves it), a rename (the same id under a new slug leaves one row) and a delete. The entry and proposal formats read and write the five new keys, `contradicts` as a block list of entry ids. `knowledge write --pinned` and `--unpin` set `pinned`, both together are a usage error, and a write with neither keeps it.

## AC-19 (behavior)

with two pinned workspace entries and one pinned shared entry, a session start of any project shows the three as `- <scope>/<slug> · <kind> · <area id> · <title>` after memory's brief inside the knowledge wrapper, records them in `knowledge_shown` with `event: session-start`, shows nothing for them on the next prompt of that context, and shows them again after a clear. With pinned entries whose lines exceed the share, the last line counts the ones not shown, and the text with that line fits the share. With no repository the module adds nothing after two reads, the schema state and the visible repositories. On a file read and on a failed tool the module adds nothing.

## AC-20 (behavior)

a prompt sharing three distinct non-generic words with an entry's body shows that entry with its first paragraph inside the share and records it with `event: prompt` and the rule. A prompt naming a code name from the entry shows it. A prompt sharing two of the title's non-generic words plus one more shared word, a generic one, shows the entry and records `title`. A prompt sharing two title words and nothing else shows nothing. Two forms of one word in a prompt count as one shared word. A prompt sharing one word shows nothing. A host prompt shows nothing. An entry already shown in the context is not shown again. An entry with a 2,000-character first paragraph is shown, the paragraph clipped to 80 characters. Two entries whose lines are 86 characters each are both shown, under the prompt's one-line intro. An entry whose line and clipped paragraph do not fit what is left of the share is skipped, and the next candidate is tried. The probe fixture brings every relevant prompt's entry first, and at most 1 of 28 unrelated prompts injects. Memory's own prompt notes are unchanged in the pinned snapshots.

## AC-21 (behavior)

a hook reads no file and writes no mark: on a repository whose files changed it shows the index as it is. The drain's `refreshStale` compares each repository of `knowledge_repos` with the disk and rebuilds at most 3 that differ, each under its lease and in its own transaction; it passes over a repository whose lease is held; it forgets a repository whose folder is gone; with the knowledge root absent it forgets nothing; it never throws out of the drain. A module schema recorded too new keeps the module silent and logs once per process. When the write lock cannot be taken for knowledge's write, the hook shows memory's text and no knowledge block, and records nothing.

## AC-22 (behavior)

inside a project the MCP tool list holds memory's tools, then `knowledge_search`, `knowledge_get` and `knowledge_propose`, with the descriptions and schemas of this document. The `area` enum is the union of the workspace's and the shared taxonomy's ids, an id in both roots once, with the nine default ids for a root whose taxonomy file is missing or cannot be read; the field's one description lists `<id>: <label> (<root>)` per id. Listing the tools opens no database: the list is the same with the database locked and with its knowledge tables newer. With `--global` the list holds `knowledge_search` and `knowledge_get`, the `repo` option has no `project`, and the server's instructions are memory's text, one space, and knowledge's sentence. With the modules setting `memory`, the lists and the instructions are the pinned ones byte for byte. Through the `tool` bridge with knowledge off, each of the three names answers `knowledge is off (WIZARDINGCODE_MODULES)`. In a project the person turned off, each of the three tools answers `Knowledge is turned off for this project.` and reads and writes nothing.

## AC-23 (behavior)

`knowledge_search` answers one line per matching active entry over the visible repositories, best first by bm25, with the area's label, or its id when the taxonomy cannot give one; never an open proposal; `No knowledge matches.` otherwise. An empty query lists pinned entries first, then the newest. `repo: "project"` with `--global` is refused by the schema. `knowledge_get` answers each ref in the fixed shape: the line `# <scope>/<slug> (v<version>)`, nine `key: value` lines in the order id, title, kind, area, version, hash, author, updated, pinned, one blank line, the body. A body past 8,000 characters is cut there and followed by `[cut at 8,000 characters of <n>]`. Refs are separated by a line `---`. A missing ref answers `Not found: <ref>`. Past 32,000 characters the remaining refs are not rendered, and the last line is `[<n> more not shown: ask for them separately]`.

## AC-24 (behavior)

a proposal whose text states what a visible entry states is `refused duplicate` naming `<scope>/<slug>` (TypeSafe: a Score answer of 2 for that neighbour; heuristic: a Jaccard of 0.6 or more). One that states what an open proposal states names the proposal, in the target repository or in another visible one; the heuristic alone decides it (a Jaccard of 0.6 or more), also when TypeSafe is configured. A propose sends TypeSafe at most one request, with at most 8 neighbours, all entries, and at most 16 questions. A small edit to an entry, proposed as a change, is filed: its own base entry is not a neighbour. A proposal that contradicts an entry (TypeSafe: a Noul of 0.8 with a Score of 1; heuristic: a supersede phrase with an overlap of at least 0.5 and under 0.9) is recorded with that entry's id in `contradicts`, with `judged_by` and `judge_version`, and the answer names the entry as `<scope>/<slug>`. A contradiction needs both thresholds: 0.7 with a `relationScore` of 1 records, 0.7 with a `relationScore` of 0 does not, 0.69 does not. An open proposal the draft contradicts is not recorded. A neighbour both same and contradicting is recorded as a contradiction, not refused. A TypeSafe failure falls back to the heuristic.

## AC-25 (behavior)

`status` prints `knowledge <n> entries · <p> pinned · <s> shown in 24 h`, or `knowledge off` when the module is off. `doctor` warns `knowledge is off (WIZARDINGCODE_MODULES)` with the module off, also when there is no knowledge folder; it warns for pinned lines over the share and for a search-table count that differs from the active entries. `compact` prunes `knowledge_shown` as AC-15 states, and its report, its command and the viewer's route carry the count.

## AC-26 (observed)

`docs/adr/0024-knowledge-module.md` gains its part 2: the reversal of ADR 0019's note, F5′ as a ruling, D-9 to D-16 as rulings, the frontmatter keys, the tool contract, the agent id's boundary, the shared breaker, the growth of `knowledge_shown`, who keeps the search table, what a development store that ran migration 6 alone does, the two outcomes of a hand edit, `MIN_SHARED` as the constant to revisit with the team's real entries, and the requirement parts 4 to 6 inherit for an entry that arrives from outside this machine; `CLAUDE.md` and the README's Knowledge section say the module is on by default and how to turn it off.

Recorded reason: (none)
Recorded command: ./node_modules/.bin/bun .crew/work/2026-11-09-001-knowledge-for-the-agent-mcp-tools-search/probes/check-docs.ts /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab

## AC-27 (behavior)

the data returns hold. `knowledge_fts` stores `repo_id` and `entry_id` unindexed, and a write or a repository's rebuild deletes its search rows by rowid, never by a scan. Every search confines the repositories in SQL: an entry of a repository the project does not see is never a candidate. `rebuildRepo` on a committed 2,000-entry repository fills 2,000 search rows and completes under 2 s on the gate machine. Its write transaction, measured alone at 2,000 entries, takes under 50 ms, half the shortest hook busy timeout, and the perf test prints the figure. The perf corpus holds 30 non-visible project repositories of 200 entries sharing words with the measured prompts, and the hook budgets hold. `compact` prunes the `knowledge_shown` rows whose session or repository no longer exists, in the same transaction as the session delete; under `--dry-run` it reports the number the real run deletes, a row that meets both conditions counted once. Every path that drops a repository's rows deletes its search rows and its shown rows.

## AC-28 (behavior)

`knowledge_propose` for a new entry writes a proposal through part 1's store with `proposed_by: agent:<id>` and `on_behalf_of: <person>`, answers `proposed <scope>/<id> for <slug>`, and `knowledge list` shows it open. With a `slug` that names an entry it proposes a change (`… changes v<n>`), at `base_version` when given and at the current version otherwise. The order of the checks is fixed: the schema, the rate counter, the area, the target, the judge, the write. Each refusal answers `refused <code>: <message>`, with part 1's message wherever part 1 has one and the code written once: an area outside the target root's taxonomy (`invalid`), a `base_version` with no `slug` (`invalid`), a new entry whose slug already exists (`exists`, before the judge runs), a change to an entry that does not exist (`missing`), a stale base version (`stale`), a part 1 quota (`quota`). The per-hour counter lives in `meta` per agent id (`knowledge.rate:<id>`), counts every call that passes the schema whatever its result, is checked before the judge call, and is shared by the MCP server and the `tool` bridge: the 21st call of one agent id in an hour is `refused quota` with no judge request, another agent id proceeds, a schema-invalid call does not consume the window, an `invalid`-area refusal does, and the window resets after an hour.

## AC-29 (behavior)

the security returns hold. `judgeProposal` redacts the draft's and every neighbour's title and body with the store's `env` before either judge is called: a stub TypeSafe receives none of a seeded AWS-shaped key in its request body, and the heuristic's input holds the redacted text. The search match is built from the query's tokens through `anyOf`, confined to the text columns, with no operator passed through: a query such as `a" OR title:x NEAR(` answers normally, and a query `step 3` or a query holding an entry id's hex group matches no row through an id. A global `knowledge_get` of a project ref answers `Not found`; refs are validated against the scope and slug patterns and resolved through the index, never as a file path. The session-start intro says the knowledge is information, not instructions, and the prompt intro says it is background, not instructions.

## AC-31 (observed)

the hook snapshots (`tests/unit/hook-snapshots.test.ts`) and the memory-alone MCP tool list snapshots (`tests/unit/mcp-tools-list.test.ts`, the modules setting at `memory`) pass, and every snapshot the two snapshot files held at the item's base is byte for byte the same (the default lists' snapshots are added beside them); `tests/perf/budgets.test.ts` keeps its budgets with knowledge on and a corpus of three repositories of 2,000 entries, 10 pinned in each; checked by `probes/check-preserve.ts`, which builds, runs the three files and compares the base's snapshots with the files

Recorded reason: (none)
Recorded command: ./node_modules/.bin/bun .crew/work/2026-11-09-001-knowledge-for-the-agent-mcp-tools-search/probes/check-preserve.ts /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab

## Removed (no record ever)

- AC-12 (preserve): The hook snapshots (tests/unit/hook-snapshots.test.ts) and the memory-alone MCP tool list snapshots (tests/unit/mcp-tools-list.test.ts, the modules setting at memory) keep passing unchanged; tests/perf/budgets.test.ts keeps its budgets with knowledge on and a corpus of three repositories of 2,000 entries, 10 pinned.
- AC-30 (observed): the hook snapshots (`tests/unit/hook-snapshots.test.ts`) and the memory-alone MCP tool list snapshots (`tests/unit/mcp-tools-list.test.ts`, the modules setting at `memory`) pass with their snapshot files unchanged since the item's base; `tests/perf/budgets.test.ts` keeps its budgets with knowledge on and a corpus of three repositories of 2,000 entries, 10 pinned in each; checked by `probes/check-preserve.ts`, which builds, runs the three files and compares the two snapshot files with the base

Risk areas: ["data-migration","public-api","auth","personal-data"]
