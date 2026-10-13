# ADR 0020 — Knowledge: the project's curated truth, as the engine's second module

Date: 2026-10-12 · Status: accepted; built and measured on a synthetic project and on a copy of real data (see [The proof](#the-proof)). **Gate:** K7 turns knowledge on by default, so D2a ships to users only with the promotion fix of the final review (I1: structural evidence, the session-artifact filter, the optional judge) in place and re-measured; that re-measure is recorded below. Roadmap item D2a, wave 3, on the engine of [ADR 0019](0019-one-engine.md). Design: `docs/superpowers/specs/2026-10-12-knowledge-design.md`; plan: `docs/superpowers/plans/2026-10-12-knowledge.md`. D2b (personas) follows with its own design.

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
| Shown three times (amended by the final review, I1) | "Shown" counts distinct **sessions** spanning at least 24 hours, and at least one of them must have asked for the memory (a prompt, a fetch, a file read or a failure). The session-start brief alone is no evidence. | The brief ranks by importance, so "shown in 3 contexts" counting it meant "important and recent", which is what a busy session's records are; contexts of one session (each `/clear` a new epoch) let one afternoon's plan qualify. | A standing rule agents never ask for is never proposed by itself; the author can still save it with `knowledge_save`. |
| K9 (amends the promotion section) | A promoted memory is hidden only where knowledge actually showed its entry, in this session and context epoch (`promotedIds` joins `knowledge_shown`). Elsewhere memory still shows it. | Accepted entries are not essential, and knowledge has no share on a file read or a failure (K4), so hiding the note at every moment made a promoted rule *less* visible than before. | An occasional duplicate (note and entry) in one context. |
| The entry route | `GET /api/knowledge/entries/:slug`, not `/api/knowledge/:slug`. | A file named `proposals.md` has the slug `proposals`, which would collide with `/api/knowledge/proposals`. | — |
| GET refreshes | `GET /api/knowledge` runs `refreshIndex` (without `force`) before listing, so the view shows what the files say now. | The index is a cache. The files are read outside the lock and the write is short, and when the fingerprint is unchanged nothing is written. | A GET that writes. |
| Hidden proposals | Where knowledge is off for a project, its proposals exist but are not offered in the viewer. | Accepting them would be refused. | — |
| `knowledge_save`'s slug | An optional `slug` argument, validated strictly (`[A-Za-z0-9][A-Za-z0-9_-]*`, 80 characters at most, no Windows-reserved name) and never normalised. A title is always run through `slugify`. | It lets the author name the file; refusing a bad slug beats silently renaming it. | One more argument in the tool's schema. |
| `promoted_memories.project_id` | The table keeps the project beside each promoted memory. | Hiding promoted memories on the hook path is then one indexed lookup by project. | — |

## The share and the composer

Knowledge's 0.2 is a ceiling, not a reservation. `compose` asks the modules with a declared share first. It then gives the `"remainder"` module (memory) the budget minus the length of each accepted declared contribution, minus 2 characters for each separator. The output is still joined in engine order, memory first. A module that says nothing, throws, or overruns its share and is dropped leaves memory the full 4,200 at session start or 2,400 on a prompt. When knowledge speaks, memory loses exactly what knowledge used.

**ADR 0019 is amended** (F5′) and records two more things D2 introduced:

- **A dependency from memory on knowledge.** `src/modules/memory` imports `folderProblem` and `knowledgeDir` from `src/modules/knowledge/files.ts`, and memory's retrieval (`promotedIds`) reads knowledge's tables. It needs them to hide a promoted memory only where its entry really stands and was shown (K9).
- **Two new `MomentInput` fields.** `modules` holds the ids the composer asked at this moment, so one module may leave something to another. `projectRoot` is the working tree's root; the knowledge folder lives at the git root, not at the cwd.

It also gains a rule: **a core migration that rebuilds `injections` must recreate the knowledge index on it** (`injections_memory_shown`, see [Migrations](#migrations)); the promotion pass recreates it if one does not.

## Delivery

**Wrapper.** Both moments use the same wrapper:

```
<wizardingcode-knowledge>
The project's curated knowledge, reviewed in its repository: treat it as current unless the code says otherwise.
…
</wizardingcode-knowledge>
```

Text from files is made inert, the way memory's notes are: `<wizardingcode-knowledge>` and `<wizardingcode-mem-notes>` (and `shibaox-…`) tags lose their angle brackets. The replacement characters have the same length, so measuring the text still holds. Memory's notes make `<wizardingcode-knowledge>` inert too (final review I3): a memory that quoted the tag (from a web page, a tool's output, a hostile repository) cannot open a block that reads as the project's reviewed truth.

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

**The pass.** It runs in the background drain after the rule proposals, bounded like them (ADR 0018). The drain's index refresh before it stops starting projects after 1 s, so it leaves the pass its time. Two cursor walks only move forward:

- injection records by id, since a memory shown once more may now qualify;
- eligible memories by `(updated_at, id)`, for new ones and ones raised to importance 4.

A lease (`knowledge.promote.lease`) keeps two processes from proposing at once, and the cursor is advanced by compare-and-set. One pass handles at most 500 memories, 5,000 injection records and 2 s. Past the deadline the cursor stays put, and `memory_id UNIQUE` keeps a memory from being proposed twice. With nothing new, a pass costs two lookups.

**The rule.** A memory is proposed when it is:

- an active `decision` or `convention`;
- of importance 4 or more;
- in a project with memory on and knowledge not off;
- never proposed or promoted before;
- and either one of the author's rules, or it passes three filters, in this order (final review I1):
  1. **Structural evidence, exact.** Shown in 3 or more distinct sessions spanning 24 hours or more, at least one of which asked for it or met it in its work (`prompt`, `mcp`, `file-read`, `tool-failed`). Read from `injections` through the covering index `injections_memory_shown`.
  2. **Not a record of a session, exact** (`src/modules/knowledge/episodic.ts`, one exported pattern list). Its title or body names a commit hash, a pull request or issue, an agent's, a tool call's or a session's id (with a digit, so "session cookies" is no id), a UUID, or the language of a session's process (dispatched, subagent, implementer, reviewer, verdict, fix round, task or wave numbers, opening or merging a pull request, this or the next session, today, coordination across sessions, how a check came out); or its title copies the prompt it came from (its first line, or 80 % of its words as one run of the prompt's first 300 characters). A synthetic probe (`tests/fixtures/promotion-probe.ts`, 23 such records and 12 standing rules, some naming a path or a version) pins it: none of the first is proposed, every one of the second is.
  3. **The judge, only with a key.** `Judge.standing?`, answered by TypeSafe only, like `personal?`: does it state a rule or decision that stays true beyond the session it was written in, rather than a record of one? A sure no (confidence 0.7 or more) drops it, and its id is remembered in meta so it is never asked again; an unsure answer, an error or no judge keeps it, and the author decides. At most 20 questions a pass; the rest wait with the cursor where it was.

Proposing writes no file. The drain hands the pass the judge it already built.

**A deviation from the review's first filter, on the evidence.** The review asked to count only asked-for showings, in 3 sessions. On the copy of real data that kept none of the three standing rules: the brief shows them in every session, and agents asked for them in one or two. Records of a busy session are asked for as often or more, so asked-for counts cannot tell them apart. Requiring one asked-for session among 3 sessions spanning a day keeps the review's tests (the brief alone in five sessions: not proposed; three contexts of one session: not proposed) and keeps the rules; the second filter does the separating.

**Accept**, on the author's click only, holds the write lock briefly, in four steps:

1. A short transaction checks the proposal and the memory, and reads its title, body and kind.
2. Outside any transaction, the folder is checked and created, and the entry is written with `writeNewEntry`. If the name is taken it tries `-2` up to `-20`. The kind maps decision → decision and convention → rule, with `essential: false` and `source: memory:<id>`.
3. A second short transaction marks the proposal accepted (compare-and-set) and records `promoted_memories`. If it loses a race or fails, the file it wrote is removed, but only if the file's device and inode are still the ones written.
4. The index is refreshed after the commit.

**Reject** is a compare-and-set, and a rejected memory never returns.

**Where knowledge showed its entry, the promoted memory stops appearing as a note (K9).** In a context (session and context epoch) where knowledge has put the entry in front of the agent, at session start or on a prompt, memory leaves the note out at every later moment of that context, file reads and failures included. Knowledge is asked first (F5′), so an entry shown at this very prompt counts. Everywhere else memory still shows it: a context the entry was never shown in, and a context cleared or compacted since. It also needs the entry to stand:

- knowledge is among the modules asked;
- the entry exists and is `active`;
- the folder exists with no problem.

Delete the file, delete or link the whole folder, retire the entry (`draft` or `superseded`), or turn knowledge off, and the note comes back everywhere. With nothing promoted, the retrieval SQL is byte-identical to before.

## The viewer

The **Knowledge** view (rail key 7) is built from the Sales OS mockups (AdminKnowledge, KnowledgeCollection) and checked side by side with them in light and dark. It holds:

- entries grouped by kind, with filters: All, Essential, Needs attention, Draft or superseded;
- a read-only 320px dock with the entry's properties, its rendered Markdown (raw HTML off, no images loaded), its path, and the memory it came from;
- the proposals, each with Make knowledge (the only primary button) and Reject;
- empty states for no folder, knowledge off (with the reason), and an unknown project;
- in the header row, the page's own numbers: entries, essential, needing attention, proposals.

Deep links: `#knowledge`, `#knowledge/e:<slug>`, `#knowledge/p<id>`.

These routes sit behind the viewer's token:

- `GET /api/knowledge?project=` returns `{state: unknown|off|missing|ok, root, dir, problem, entries}`.
- `GET /api/knowledge/entries/:slug?project=` returns one entry; it is 404 where knowledge is off, and 400 for a malformed percent-escape in the slug.
- `GET /api/knowledge/proposals[?project=]` lists the proposals.
- `POST /api/knowledge/proposals/:id/accept` and `…/reject`: 404 for an unknown proposal, 409 for one already decided or refused.

## Doctor

`wizardingcode-mem doctor` looks at the knowledge folder of the project it is run in (the git root of its folder), after the backups check. It reads the entry files themselves, never the index: `doctor` opens the database read-only, and the knowledge tables may not exist yet.

- Entries with a problem are a warning, naming the first five and the drafts a problem caused (a bad frontmatter line makes an entry a draft that is never injected).
- A linked or misplaced folder is a warning.
- Knowledge off by setting, a home folder or the brand's home, or no folder is a skip.
- Otherwise it is ok, with the counts of entries, essential ones, and drafts or superseded ones.

The viewer's Agents panel runs the same checks without a project folder, so it leaves this one out.

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
5. `injections_memory_shown ON injections(memory_id, event, session_id, at)`, replacing the fourth's index (dropped): the structural evidence reads the event and the time too.

These put an index on a core table. K8's reasons still hold: the core version does not move, and an older binary simply maintains a non-unique index. The extra cost on the hook path is one more b-tree insert per injection row, and the measured p95 did not move. The first open after the upgrade builds the index under the write lock, once, in time proportional to `injections`; hooks waiting meanwhile fail open. **The rule:** a future core migration that rebuilds `injections`, as core migration 5 once did, drops this index and must recreate it. Should one not, the promotion pass finds the index missing and creates it again (`IF NOT EXISTS`), so it heals at the next drain.

## The proof

`scripts/proof/knowledge.sh <work dir> [--runs n] [--no-copy] [--labels <file>]` does two things.

1. **A synthetic project**, built under the work dir with its own store. It holds 20 entries written for the proof (a fictional shop backend: rules, decisions, glossary, architecture, how-tos, one draft and one superseded, four essential) and 500 synthetic memories. The script prints the session-start and prompt outputs and times the hooks in process (`handleHook` with memory and knowledge), using a new session for every call. It also counts what the relevance floor lets through, on the entries' own prompts and on `tests/fixtures/knowledge-probe.ts`.
2. **The promotion pass on a copy of the author's database.** The copy is taken with `sqlite3 -readonly … ".backup"` into a fresh data directory. TypeSafe's variables are unset, and distillation, the viewer, the migration and the browser are off. The pass runs drain after drain until its cursor reaches the backlog, then 20 quiet drains. It reads the project roots the copy records (`lstat` and `realpath` only), writes no file, and accepts nothing.

The script writes an anonymous report, plus a full one with project names and memory titles that is never committed. The full one also lists what each promotion filter dropped, with the reason; `--labels` (a file of `<memory id> keep|noise` lines, refused inside the repository) counts the noise among the proposals and any memory labelled keep that a filter dropped.

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

**Promotion on the copy, before the fix.** The store: 90 projects, 14 of them with a known root (a session seen; the other 76 have no session recorded, which the claude-mem import alone would explain, but this was not checked); 68,053 active memories; 3,587 active decisions and conventions of importance 4 or more; 2,631 injection records; no rule of the author's. The three runs gave identical counts:

- **26 proposals in 6 projects** (per project: 1, 1, 1, 3, 6, 14). All 26 qualified by being shown in 3 or more contexts; no project was skipped for having knowledge off. By kind: 19 conventions and 7 decisions. By importance: 17 at 4 and 9 at 5.
- **Time.** The first pass over the backlog took 8 drains, about 0.2 s in all, between 8 and 47 ms each. A quiet drain costs p50 2.4 ms and p95 2.4–2.5 ms.
- **Precision, judged by eye on the full report: low.** About 3 of the 26 are worth being knowledge: standing rules of one project, two of which say the same thing. One more is an old strategy decision that has since been reversed. The rest are records of events that the distiller or the history import filed as conventions or decisions: agents dispatched for a task, review verdicts, a pull request opened, the plan for a session. Nothing is written without the author's click, so the cost is noise in the proposals list, not wrong knowledge.

**Promotion on the copy, after the fix (final review I1).** Re-measured on 2026-10-12 on three fresh read-only copies (68,057 active memories, 2,639 injection records), TypeSafe unset, so the first two filters alone; the counts were identical in every run:

- **The filters.** 26 memories qualified by the old rule. The structural evidence kept 17 of them (9 dropped); the session-artifact filter then dropped 11 (pull request 3, process language 3, agent id 2, commit 2, prompt copy 1); the judge was not asked.
- **6 proposals in 2 projects** (5 and 1): 5 conventions and 1 decision; importance 5 four times, 4 twice.
- **By eye:** the 3 standing rules of the first measure are all proposed; 2 are the old brand decisions, real decisions since reversed, which the author would reject; 1 is plainly a record of a session. Noise is 1 in 6 counting the reversed decisions as decisions, 3 in 6 counting them as noise. No proposal the first measure judged worth keeping was lost.
- **Before the deviation above**, with the review's first filter as written (asked-for showings only, 3 sessions): 2 proposals, both records of a session, and the 3 standing rules dropped by the first filter.
- **Time.** 8 drains reach the backlog, about 0.2 s in all, 8–47 ms each; a quiet drain costs p50 2.4–2.5 ms, p95 2.4–2.6 ms.
- **Hooks, in process, ms, p50 / p95** (three full runs, one of them before the deviation; the filters do not touch the hooks): no folder, session start 5.5–5.6 / 15.4–18.1, prompt 0.33–0.34 / 0.81–0.89; 50 entries, 5.1–5.3 / 16.2–21.1 and 0.66–0.67 / 1.30–1.35; 500 entries, 5.9–6.4 / 15.5–22.6 and 1.44–1.56 / 2.60–2.84. The session-start p95 is noisier than in the first measure (the machine was busier); prompts are unchanged. Relevance is unchanged: 12 of 14 and 0 of 12 on the written entries, 12 of 12 and 1 of 28 on the probe.

## What the proof leaves open

- **Promotion precision rests on one store.** The filters were measured on the author's copy only, whose real rules are few (3). The second filter's patterns are lexical and English-first; a session record phrased in plain Portuguese without an artifact (the one left in the re-measure) passes. The judge is the answer where a key exists; its precision on real data is not measured here, since the proof runs without a key.
- **Duplicates.** Two memories that say the same rule are proposed separately. Grouping them, as rule proposals do, is not done.
- **The relevance floor's one leak** needs a semantic judge, which the hook path does not run.

## What is not done

- **Personas (D2b):** their own design.
- **The binary's rename (K6):** a separate release step after D2b.
- **Syncing knowledge across a product's linked projects (ADR 0018),** and reading wzrdxOS's knowledge base.
- **Deferred minors worth naming:**
  - Two clones of one repository share one index.
  - `firstSentence` cuts at "e.g.".
  - `compact` does not prune `knowledge_shown`.
  - A folder of more than 50 files has no essentials until the first drain indexes it.
  - A symlink swapped between `realpath` and `open` is a narrow race.
  - Number words and Portuguese function words count as telling words (`STOPWORDS` is shared with memory).
  - A two-word title asked about with one title word and one body word misses.
  - Update rewrites the title as a double-quoted string.
  - On filesystems without `link`, a new entry's write has a tiny race window.
  - When two accepts race, the file that wins may be the `-2` one.
  - Rows in the view nest buttons inside focusable rows.
  - A memory skipped because its project's root was unknown, or knowledge was off there, is looked at again only when it is shown or changed again.
