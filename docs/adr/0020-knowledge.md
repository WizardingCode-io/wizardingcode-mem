# ADR 0020 — Knowledge: the project's curated truth, as the engine's second module

Date: 2026-10-12 · Status: accepted; built and measured on a synthetic project and on a copy of real data (see [The proof](#the-proof)). Roadmap item D2a, wave 3, on the engine of [ADR 0019](0019-one-engine.md). Design: `docs/superpowers/specs/2026-10-12-knowledge-design.md`; plan: `docs/superpowers/plans/2026-10-12-knowledge.md`. D2b (personas) follows with its own design.

## Context

Memory records what happened: observed, distilled, decaying, and never authoritative ("background, not instructions"). A project also holds things that are simply true: decisions taken, business rules, its glossary, how its architecture fits together. Every agent should treat those as current. Today they live, if anywhere, in one agent's own instructions file (`CLAUDE.md`, `AGENTS.md`), which the other agents never read.

## Decision

The author made three choices:

- **The project's knowledge lives in the repository.** It is a folder of Markdown files with frontmatter, versioned by git and reviewed in pull requests. It is independent of wzrdxOS's knowledge base.
- **A little is injected, the rest is on demand.** Essential entries appear at session start and highly relevant ones beside a prompt, within a small share of the budget. The agent looks up the rest with MCP tools. Knowledge is labelled as knowledge and carries authority, unlike memory's notes.
- **Two ways in.** The agent writes an entry when the author asks ("save this as knowledge"). The mem also proposes memories worth promoting, and the author accepts them in the viewer. The files stay plain Markdown, so hand edits work too, and the index follows them.

Knowledge is the engine's second module (`src/modules/knowledge/`). With the default settings it is on, and a project without a knowledge folder sees exactly what it saw before: every memory snapshot is unchanged.

### The entry

One file per entry, `.wizardingcode/knowledge/<slug>.md` at the project root (the git root, or the folder itself outside git):

```markdown
---
title: Orders are never deleted, only cancelled
kind: rule            # decision | rule | glossary | architecture | howto
essential: true       # shown at session start
status: active        # active | draft | superseded
tags: [orders, billing]
updated: 2026-10-12
source: memory:1234   # optional: what it was promoted from
---
Body in Markdown: the why, the consequences, links to code.
```

The frontmatter is read by a small YAML subset written for this module; no YAML dependency was added. The subset covers plain, quoted and double-quoted scalars, flow and block lists, comments, CRLF line endings and a BOM.

Unknown keys are kept and ignored. Problems are recorded on the entry, never thrown, and the viewer shows them:

- **No frontmatter:** the entry is indexed by its file name and body. It stays `active`, because nothing in it was misread.
- **Frontmatter never closed, or a line that is not `key: value`:** the entry becomes a `draft`, since a `status: draft` the parser missed must not become injectable. A block scalar (`|`, `>`) counts as such a line.
- **A bad field value:** the default is used and the field is flagged. A bad `kind` becomes `decision`, an unknown `status` becomes `draft`, and a bad `essential` becomes false. `essential` is matched against a `Map`, so `constructor` or `__proto__` cannot read as true.
- **Not UTF-8:** the bad bytes are replaced and the entry is flagged.

`draft` and `superseded` entries can be searched, but they are never injected.

## Rulings

| Ruling | Decision | Why | Cost if wrong |
|---|---|---|---|
| K1 | The files live in `.wizardingcode/knowledge/` at the project root, one per entry. | It belongs to the brand and to no one agent, so every agent reads the same files and none of them owns the folder. | Moving a folder, and a fallback read. |
| K2 | The files are the truth; the database is only an index. | The index can be deleted and rebuilt from the files at any time. It sits in the main database but carries no truth, so backups need nothing special. | None: backups simply copy a rebuildable cache. |
| K3 | Modules own tables through a per-module migration list. | ADR 0019's F2 put this off until a real case existed, and knowledge is that case. Personas will add tables the same way. Memory's migrations are untouched. | A redesign once a third module needs something else. |
| K4 | Knowledge declares a share of 0.2 at session start (840 characters) and on a prompt (480). It takes nothing on file read or tool failure. | Knowledge is meant to be little and labelled. Memory still gets most of the context. | The share can be retuned once real folders are in use. |
| K5 | A hook never pays for indexing a large folder. | A hook compares a fingerprint of the folder (file count, total size, newest file time, the folder's own time). If it changed and the folder holds 50 files or fewer, the hook re-indexes inline. Otherwise the hook uses the index it has, and the background drain refreshes up to 10 projects with a session in the last 24 hours. The knowledge tools and the viewer refresh first too. | A large folder edited while nothing is queued stays stale until the next turn's drain, or until a tool or the viewer reads it. |
| K6 | The binary keeps its name (ADR 0019's F1) until after D2b. | The rename is its own release step. | — |
| K7 | The default `WIZARDINGCODE_MODULES` is `memory,knowledge`. | With no folder the module costs one `stat` and says nothing. Enabling it by default changes nothing for projects without knowledge, and a project that adds the folder gets it without a setting. | Anyone who wants it off sets the list to `memory`. |
| K8 | Module migrations are an optional `migrations` list on `EngineModule`. They are applied after the core migrations and tracked in `module_migrations(module, version, name, applied_at)`. The core schema version does not move for module tables. | An older binary ignores tables it does not know, so module tables never force every agent to upgrade together. Every built-in module's tables are created whether it is on or not, so turning a module on later never migrates on a hook. | A later core migration may need to take them over. |
| F5′ (amends ADR 0019's F5) | Memory gets the budget minus what the other modules actually wrote, plus 2 characters for each separator. Their declared shares no longer come off the top. | With knowledge on by default, the declared-share version would have cut memory's session start to about 3,358 characters and its prompt to about 1,918 in every project, even with no knowledge folder. A silent, failing or overrunning module now leaves memory the whole budget, to the character. | The order and cost of composing change; the total still never exceeds the budget (tested). |
| The index | `knowledge_fts` is a self-contained FTS5 table that keeps its own copy of the text. Triggers maintain it, and every delete is confined to its project. | With a composite key (`project_id, slug`) the entries have no stable rowid, and `VACUUM` can renumber implicit rowids. An external-content index could then point at the wrong rows. | Twice the space for a small corpus. |
| Home and brand home | Knowledge is off for a project whose root is the home folder, or whose root is or contains the brand home (`WIZARDINGCODE_HOME`). Off means no reads, no injection, no tools and no proposals. | Otherwise an agent run in `~` outside git would write into `~/.wizardingcode/knowledge`, inside the brand's data home. | Knowledge is unavailable for a project rooted at `~`. |
| User rules | A memory "covered by a user rule" is read as a memory that *is* one of the author's rules (a `user_memories` row). | The memories behind an accepted rule proposal are already superseded, so they are never active candidates. | A few fewer proposals. |
| Shown three times | "Shown" counts distinct contexts (`session_id:context_epoch`), not injection rows. | A heading at start, the note on a prompt and three tool fetches in one context are one showing. | — |
| The entry route | `GET /api/knowledge/entries/:slug`, not `/api/knowledge/:slug`. | A file named `proposals.md` has the slug `proposals`, which would collide with `/api/knowledge/proposals`. | — |
| GET refreshes | `GET /api/knowledge` runs `refreshIndex` (without `force`) before listing, so the view shows what the files say now. | The index is a cache. The files are read outside the lock and the write is short, and when the fingerprint is unchanged nothing is written. | A GET that writes. |
| Hidden proposals | Where knowledge is off for a project, its proposals exist but are not offered in the viewer. | Accepting them would be refused. | — |
| `knowledge_save`'s slug | An optional `slug` argument, validated strictly (`[A-Za-z0-9][A-Za-z0-9_-]*`, 80 characters at most, no Windows-reserved name) and never normalised. A title is always run through `slugify`. | It lets the author name the file; refusing a bad slug beats silently renaming it. | One more argument in the tool's schema. |
| `promoted_memories.project_id` | The table keeps the project beside each promoted memory. | Hiding promoted memories on the hook path is then one indexed lookup by project. | — |

## The share and the composer

Knowledge's 0.2 is a ceiling, not a reservation. `compose` asks the modules with a declared share first. It then gives the `"remainder"` module (memory) the budget minus the length of each accepted declared contribution, minus 2 characters for each separator. The output is still joined in engine order, memory first. A module that says nothing, throws, or overruns its share and is dropped leaves memory the full 4,200 at session start or 2,400 on a prompt. When knowledge speaks, memory loses exactly what knowledge used.

**ADR 0019 is amended** (F5′) and records two more things D2 introduced:

- **A dependency from memory on knowledge.** `src/modules/memory` imports `folderProblem` and `knowledgeDir` from `src/modules/knowledge/files.ts`. It needs them to hide a promoted memory only while its entry really stands.
- **Two new `MomentInput` fields.** `modules` holds the ids the composer asked at this moment, so one module may leave something to another. `projectRoot` is the working tree's root; the knowledge folder lives at the git root, not at the cwd.

It also gains a rule: **a core migration that rebuilds `injections` must recreate the knowledge index on it** (`injections_memory_contexts`, see [Migrations](#migrations)).

## Delivery

**Wrapper.** Both moments use the same wrapper:

```
<wizardingcode-knowledge>
The project's curated knowledge, reviewed in its repository: treat it as current unless the code says otherwise.
…
</wizardingcode-knowledge>
```

Text from files is made inert, the way memory's notes are: `<wizardingcode-knowledge>` and `<wizardingcode-mem-notes>` (and `shibaox-…`) tags lose their angle brackets. The replacement characters have the same length, so measuring the text still holds.

**Session start.** Essential, active entries, newest first, one line each: `- Title (kind): first sentence.` Lines are added greedily within the 840 characters; one that does not fit is skipped and the next is tried.

**Prompt.** The steps:

1. Skip host prompts, and prompts in which `buildQuery` finds too little.
2. Take the FTS5 search's best 10, ranked by bm25 (title 4, tags 2, body 1).
3. Keep `active` entries not yet shown in this context, and apply the relevance floor.
4. Show at most 2, each as `- Title (kind, .wizardingcode/knowledge/<slug>.md)` and an indented summary of its body, sharing the 480 characters.

**No repeats in a context.** An entry shown at start or on a prompt is not shown again until the context is cleared or compacted (`knowledge_shown`, keyed by session and context epoch). Only what is actually in the text counts as shown (ADR 0019's F6).

## The relevance floor

bm25 only ranks. Its scores scale with the size of the corpus (about 10⁻⁶ with one or two entries), so no fixed bm25 threshold can serve both a 5-file folder and a 500-file one. The floor (`src/modules/knowledge/relevance.ts`) counts shared evidence instead, in distinct words compared by stem.

**The rule.** An entry is relevant to a prompt when any of these holds:

1. **A code name.** An identifier from the prompt (`formatMoney`, `ORDER_NOT_FOUND`, `config.toml`, a path) appears in the entry as a token sequence.
2. **Three telling words.** At least 3 distinct non-generic words (`MIN_SHARED = 3`) are shared with the entry, anywhere in it.
3. **Two in the title, plus one.** At least 2 of the shared telling words are the title's or tags' own, and at least one more word is shared, which may be generic. For example, "which feature flags can we **remove** now?" matches "Feature flags".

One shared word never passes, whether it is a name or not.

**How it got there.** Two earlier versions failed, each on a probe built to break it:

| Version | Rule | Result | Why it failed |
|---|---|---|---|
| 1 (`6aef3b8`) | Weighted words (title or tags 2, body 1, generic 0.5) with a floor of 3, **or** a prompt naming at least half of the title's own words | Its own 8-entry fixture was clean: 9 of 9 relevant and 0 of 12 unrelated | A short title is a back door. One common shared word covers half of "Order lifecycle" or "User roles", so 11 of 12 unrelated prompts injected an entry with a short title |
| 2 (`7b43128`) | Version 1, with title coverage needing 2 covered words, **or** 1 written as a name ("MongoDB", "SQS", "OAuth2") | Its own sets: 17 of 17 relevant, 0 unrelated, including 128 runs with one short title per folder | The name exemption is a second back door. On the reviewer's probe (`tests/fixtures/knowledge-probe.ts`: 18 entries with acronym, brand and Portuguese titles), 15 of 28 unrelated prompts injected, 12 of them through one acronym or brand ("we don't use MongoDB here…", "open a GitHub issue…") |
| 3 (`1b164dd`, final) | The rule above | Probe: 12 of 12 relevant, 1 of 28 unrelated | — |

**The one probe leak left.** "The user cannot see their projects list after login" brings "User roles". It shares `user` from the title and `see` and `projects` from the body ("members see only their own projects"). Lexically it has the same shape as the relevant "what can admins see that members cannot?". Telling them apart needs a semantic judge, which the hook path does not run. The case is pinned in a test.

**The cost.** A short question about an entry now needs a second word in common with it. "Should this new service use MongoDB?" no longer brings "We use PostgreSQL, not MongoDB" unless the body talks about services or data. The agent still finds such entries with `knowledge_search`, whose search matches word forms and prefixes: `order` finds "orders", `policy` finds "policies".

## Tools

These are offered inside a project only (`--global` lists none) and through the OpenCode bridge:

- **`knowledge_search { query, limit }`** returns one heading per entry: slug, title, kind, status and essential. Drafts and superseded entries are included and labelled. An empty query lists the entries.
- **`knowledge_get { slugs }`** returns each entry whole: its facts, file path, problem and body.
- **`knowledge_save { title, kind, body, essential?, tags?, slug? }`** writes a new file with `status: active` and today's `updated`. It never overwrites: an existing slug, matched case-insensitively, is refused and the answer points to `knowledge_update`.
- **`knowledge_update { slug, title?, kind?, body?, essential?, status?, tags? }`** replaces only the fields given. Comments, unknown keys, the file's mode and its CRLF line endings are kept. A frontmatter that is never closed is refused rather than garbled.

Search and get refresh the index first, which does nothing when the fingerprint is unchanged. Save and update re-index right after writing. Tools load lazily, so a hook never pays for zod.

## Promotion from memory

**The pass.** It runs in the background drain after the rule proposals, bounded like them (ADR 0018). Two cursor walks only move forward:

- injection records by id, since a memory shown once more may now qualify;
- eligible memories by `(updated_at, id)`, for new ones and ones raised to importance 4.

A lease (`knowledge.promote.lease`) keeps two processes from proposing at once, and the cursor is advanced by compare-and-set. One pass handles at most 500 memories, 5,000 injection records and 2 s. Past the deadline the cursor stays put, and `memory_id UNIQUE` keeps a memory from being proposed twice. With nothing new, a pass costs two lookups.

**The rule, exact, with no judge.** A memory is proposed when it is:

- an active `decision` or `convention`;
- of importance 4 or more;
- in a project with memory on and knowledge not off;
- never proposed or promoted before;
- and either shown in 3 or more distinct contexts, or one of the author's rules.

Proposing writes no file.

**Accept**, on the author's click only, holds the write lock briefly, in four steps:

1. A short transaction checks the proposal and the memory, and reads its title, body and kind.
2. Outside any transaction, the folder is checked and created, and the entry is written with `writeNewEntry`. If the name is taken it tries `-2` up to `-20`. The kind maps decision → decision and convention → rule, with `essential: false` and `source: memory:<id>`.
3. A second short transaction marks the proposal accepted (compare-and-set) and records `promoted_memories`. If it loses a race or fails, the file it wrote is removed, but only if the file's device and inode are still the ones written.
4. The index is refreshed after the commit.

**Reject** is a compare-and-set, and a rejected memory never returns.

**While its entry stands, the promoted memory stops appearing as a note.** This holds in the brief, on a prompt, on a file read and after a failure. "Stands" means:

- knowledge is among the modules asked;
- the entry exists and is `active`;
- the folder exists with no problem.

Delete the file, delete or link the whole folder, retire the entry (`draft` or `superseded`), or turn knowledge off, and the note comes back. With nothing promoted, the retrieval SQL is byte-identical to before.

## The viewer

The **Knowledge** view (rail key 7) is built from the Sales OS mockups (AdminKnowledge, KnowledgeCollection) and checked side by side with them in light and dark. It holds:

- entries grouped by kind, with filters: All, Essential, Needs attention, Draft or superseded;
- a read-only 320px dock with the entry's properties, its rendered Markdown (raw HTML off, no images loaded), its path, and the memory it came from;
- the proposals, each with Make knowledge (the only primary button) and Reject;
- empty states for no folder, knowledge off (with the reason), and an unknown project.

Deep links: `#knowledge`, `#knowledge/e:<slug>`, `#knowledge/p<id>`.

These routes sit behind the viewer's token:

- `GET /api/knowledge?project=` returns `{state: unknown|off|missing|ok, root, dir, problem, entries}`.
- `GET /api/knowledge/entries/:slug?project=` returns one entry; it is 404 where knowledge is off.
- `GET /api/knowledge/proposals[?project=]` lists the proposals.
- `POST /api/knowledge/proposals/:id/accept` and `…/reject`: 404 for an unknown proposal, 409 for one already decided or refused.

## Safety

- **Linked folders.** `folderProblem` `lstat`s `.wizardingcode` and `.wizardingcode/knowledge` and refuses either one if it is a link or not a folder. It then requires the knowledge folder's real path to be inside the project root's. This applies to every read (hook, drain, tools, viewer) and every write.
- **Writes.** `prepareFolder` creates one level at a time without recursion and re-checks after each level. Every write re-checks just before its link or rename.
- **Files read.** A symlinked entry that points outside the folder is listed as a draft with a problem and never read. Only regular files are opened (`O_NONBLOCK | O_NOFOLLOW`, then `fstat`), so a FIFO named `x.md` cannot hang a hook. Files over 256 KiB are not read, and at most 2,000 files are listed. Hidden files are skipped, which covers write temp files.
- **Home and brand home.** Knowledge is off, as ruled above.
- **Atomic writes.** Each write goes to a hidden temp file (`wx`, fsynced) in the folder. A new entry is linked into place, and `link` cannot replace an existing file; where links are unsupported, the code checks again and renames. An existing entry is renamed over. The temp file is always removed. A folder that cannot be written gets a clear refusal, and nothing is half-written.
- **Accept** holds the write lock briefly, as described above.
- **Fail-open.** Any knowledge error means knowledge contributes nothing. Memory still injects and hooks exit 0.

## Migrations

These are the knowledge module's migrations (`src/modules/knowledge/migrations/`), tracked in `module_migrations`:

1. `knowledge_entries`, `knowledge_fts` and `knowledge_state` (the fingerprint).
2. `knowledge_shown`: what each context has been shown.
3. `knowledge_proposals` and `promoted_memories`.
4. `injections_memory_contexts ON injections(memory_id, session_id, context_epoch)`: a covering index for the "shown in 3 contexts" count, which was a full scan of `injections` with two temporary B-trees.

The fourth migration puts an index on a core table. K8's reasons still hold: the core version does not move, and an older binary simply maintains a non-unique index. The extra cost on the hook path is one more b-tree insert per injection row, and the measured p95 did not move. **The rule:** a future core migration that rebuilds `injections`, as core migration 5 once did, drops this index and must recreate it. `IF NOT EXISTS` keeps module migration 4 harmless after that.

## The proof

`scripts/proof/knowledge.sh <work dir> [--runs n] [--no-copy]` does two things.

1. **A synthetic project**, built under the work dir with its own store. It holds 20 entries written for the proof (a fictional shop backend: rules, decisions, glossary, architecture, how-tos, one draft and one superseded, four essential) and 500 synthetic memories. The script prints the session-start and prompt outputs and times the hooks in process (`handleHook` with memory and knowledge), using a new session for every call. It also counts what the relevance floor lets through, on the entries' own prompts and on `tests/fixtures/knowledge-probe.ts`.
2. **The promotion pass on a copy of the author's database.** The copy is taken with `sqlite3 -readonly … ".backup"` into a fresh data directory. TypeSafe's variables are unset, and distillation, the viewer, the migration and the browser are off. The pass runs drain after drain until its cursor reaches the backlog, then 20 quiet drains. It reads the project roots the copy records (`lstat` and `realpath` only), writes no file, and accepts nothing.

The script writes an anonymous report, plus a full one with project names and memory titles that is never committed.

The proof ran three times on 2026-10-12, each on a fresh copy, on an Apple M4 Max with the pinned Bun 1.4.2.

**What the agent sees** (synthetic project). Session start gets the four essential rules in 4 lines, inside the share. "Should we add Elasticsearch for the product search?" brings the search decision with its path and the start of its body. "The navbar overlaps the logo on mobile" brings nothing.

**Hooks in process, ms, p50 / p95** (26 prompts, 30 timed rounds after a warm one; the three runs agree within about 0.2 ms at p95 for prompts):

| Folder | Session start | Prompt | Prompts that got knowledge |
|---|---|---|---|
| None (0 entries) | 4.3–4.5 / 7.2–20.0 | 0.29–0.30 / 0.81–0.82 | 0 / 26 |
| 50 entries | 4.0–4.1 / 7.1–10.5 | 0.60–0.63 / 1.27–1.32 | 12 / 26 |
| 500 entries | 4.8–5.2 / 8.0–10.0 | 1.44–1.55 / 2.65–2.88 | 12 / 26 |

At 500 entries knowledge adds about 1.2 ms to a prompt's median and 2 ms to its p95. The session-start p95 spread comes from the store's own work (the 20 ms outlier was in the no-folder case).

The compiled binary, measured by `tests/perf/budgets.test.ts` over 5,000 memories (budgets: prompt 80 ms, session start 150 ms):

| Case | Prompt p95 | Session start p95 |
|---|---|---|
| No folder | 30.0 | 15.8 |
| 50 entries | 34.2 | 24.3 |
| 500 entries | 35.0 | 19.0 |

A prompt after an edit, which re-indexes inline at 50 entries and only compares the fingerprint at 500, had a p95 of 39.3 ms at 50 and 32.3 ms at 500.

**Relevance through the prompt hook:**

| Set | Relevant prompts that bring their entry | Unrelated prompts that inject |
|---|---|---|
| The 20 written entries (14 relevant, 12 unrelated) | 12 / 14, each first | 0 / 12 |
| The probe (18 entries, 12 relevant, 28 unrelated) | 12 / 12, each first | 1 / 28 (the pinned case above) |

The two misses are the floor's known cost. Each prompt shares only two telling words with its entry: "can I delete a test order from the admin?" (`delete`, `order`) and "the migration is wrong, can I edit it and rerun it?" (`migration`, `edit`). The first entry is essential, so it is already at session start.

**Promotion on the copy.** The store: 90 projects, 14 of them with a known root (a session seen; most came from the claude-mem import, which records none); 68,053 active memories; 3,587 active decisions and conventions of importance 4 or more; 2,631 injection records; no rule of the author's. The three runs gave identical counts:

- **26 proposals in 6 projects** (per project: 1, 1, 1, 3, 6, 14). All 26 qualified by being shown in 3 or more contexts; no project was skipped for having knowledge off. By kind: 19 conventions and 7 decisions. By importance: 17 at 4 and 9 at 5.
- **Time.** The first pass over the backlog took 8 drains, about 0.2 s in all, between 8 and 47 ms each. A quiet drain costs p50 2.4 ms and p95 2.4–2.5 ms.
- **Precision, judged by eye on the full report: low.** About 3 of the 26 are worth being knowledge: standing rules of one project, two of which say the same thing. One more is an old strategy decision that has since been reversed. The rest are records of events that the distiller or the history import filed as conventions or decisions: agents dispatched for a task, review verdicts, a pull request opened, the plan for a session. Nothing is written without the author's click, so the cost is noise in the proposals list, not wrong knowledge.

## What the proof leaves open

- **The promotion rule is too loose on real data.** On this store, "an important convention or decision shown in three contexts" mostly picks out episodic records, because the distiller's kinds are not reliable enough to stand in for "worth being knowledge". Two candidate fixes, in this order:
  - ask the `Judge` (TypeSafe opt-in, heuristic fallback) whether a memory states a standing rule or decision, the way rule proposals ask whether a rule is personal;
  - drop memories whose title is a copy of the prompt, or that name a session's own artifacts (agent ids, commit hashes, PR numbers).
- **Duplicates.** Two memories that say the same rule are proposed separately. Grouping them, as rule proposals do, is not done.
- **The relevance floor's one leak** needs a semantic judge, which the hook path does not run.

## What is not done

- **Personas (D2b):** their own design.
- **The binary's rename (K6):** a separate release step after D2b.
- **`doctor` does not report knowledge problems.** The design said invalid entries would be flagged in `doctor` and the viewer; only the viewer shows them.
- **Syncing knowledge across a product's linked projects (ADR 0018),** and reading wzrdxOS's knowledge base.
- **Deferred minors worth naming:**
  - The drain's refresh has no time limit, and two clones of one repository share one index.
  - `firstSentence` cuts at "e.g.".
  - `compact` does not prune `knowledge_shown`.
  - A folder of more than 50 files has no essentials until the first drain indexes it.
  - A symlink swapped between `realpath` and `open` is a narrow race.
  - Number words and Portuguese function words count as telling words (`STOPWORDS` is shared with memory).
  - A two-word title asked about with one title word and one body word misses.
  - Update rewrites the title as a double-quoted string.
  - On filesystems without `link`, a new entry's write has a tiny race window.
  - When two accepts race, the file that wins may be the `-2` one.
  - The module migration 4 guard is a SQL comment and this ADR, not a test.
  - A bad percent-escape in an entry route answers 500 instead of 400.
  - The Knowledge tab's breadcrumb still shows memory's counts.
  - Rows in the view nest buttons inside focusable rows.
  - A memory skipped because its project's root was unknown, or knowledge was off there, is looked at again only when it is shown or changed again.
