# ADR 0018 — Linked projects and your own rules

Date: 2026-10-12 · Status: accepted; built and measured on a copy of real data (see [The proof](#the-proof)). Roadmap items B1 (links between workspaces) and B2 (memory of the user), the first of wave 3. Design: `docs/superpowers/specs/2026-10-12-workspace-links-design.md`; plan: `docs/superpowers/plans/2026-10-12-workspace-links.md`.

## Context

Every session saw only its own project: the brief and the prompt notes filtered on one `project_id`. Three situations cost the author: repositories of one product (an API, a web app, a mobile app), shared libraries (what was learned in the library should be known where it is used, not the reverse), and the author as a person (rules that hold in every project and every agent, which each agent keeps in its own instructions file). Clones, forks and worktrees of one repository are out of scope.

## Decisions

| Topic | Decision |
|---|---|
| Where links live | In the mem database (`project_links`, migration 7), not in a file in each repository (kept for team memory, C2), and not by merging projects (it cannot express a one-way link and lets one project drown another). |
| Who links | The mem suggests from exact signals in code, never a model; the author confirms. Nothing in retrieval changes until a link is confirmed. |
| By hand | The MCP tool `project_links` (`list`, `link {project, kind}`, `unlink {project}`, `confirm {id}`, `reject {id}`) and the viewer's **Across projects** view. No `link`/`unlink` commands. |
| Kinds | `product` (one row per unordered pair, read both ways) and `uses` (one row per ordered pair: the consumer sees the library, never the reverse). |
| No chaining | A–B and B–C confirmed: A does not see C. The visible set from P is P, its confirmed `product` partners (either direction) and the projects P confirmed it `uses`. |
| Never again | A pair with a confirmed or rejected row, in either direction and of either kind, is never suggested again. Deciding one row of a pair (confirm or reject a suggestion, link by hand, unlink) rejects the pair's other pending suggestions in the same transaction, so a `product` sibling can never undo a one-way `uses`. Unlinking turns a confirmed link into a rejected one; linking by hand confirms a rejected pair (the author's explicit act wins). A pair confirmed as both kinds reads as `product`. A rejected rule proposal (the same set of memories) is never proposed again. |
| Search | `memory_search`, the viewer's list and palette: by default P and the visible projects, each result named with its project; the `project` filter narrows; `--global` is unchanged. |
| Your rules | Proposed in the background, never assumed: a `convention` or `decision` that repeats across projects not linked to each other, or that the author said holds everywhere (see [Said always](#said-always)). It becomes the author's only on a yes; the project copies are superseded, never deleted; Undo archives the rule and brings the copies back. |
| Disabled projects | A project with memory off feeds no other project: it is never in `visibleProjects`, a user rule kept in it is not read by the brief, the prompt notes or `memory_search`, its memories are never rule candidates, and accepting a proposal with a source in it is refused. |
| Judge | With a TypeSafe key the `Judge` answers whether a proposed rule is personal. A "repeated" proposal stands unless the judge is sure (0.7) it is not personal; a "said always" one needs the judge to be sure (0.7) it is. Verdicts that drop a proposal are remembered so the same set is not asked again. Without a key, the heuristic stands and the author decides. |
| Nothing leaves | Except a TypeSafe judgement when a key is set, as before. |

### Rulings made during the build

- **P1 — a marker table, not a scope value.** The spec said a user rule is a memory with `scope = 'user'`. Changing the `scope` CHECK means rebuilding `memories` (about 90,000 rows on the author's store, an external-content FTS5 index with its triggers, five tables with foreign keys to it) inside a migration that older processes race. A user rule is instead an active memory with a row in `user_memories(memory_id PRIMARY KEY REFERENCES memories ON DELETE CASCADE, proposal_id, created_at)`: the same behaviour from a plain `CREATE TABLE`. The memory keeps the `project_id` it came from, as provenance. Cost if wrong: a later migration moves the marker into the column.
- **R-a — the tool names projects, the store takes ids.** `project_links unlink {project}` resolves the confirmed link(s) between the current project and the one named, and unlinks each by id; the store API stays id-based for the viewer.
- **R-b — vectors follow every write.** Accepting a proposal writes the user rule through `insertMemory` with the model when it is loaded (ADR 0017); without it, the drain's heal fills the vector later.
- **OpenCode's tool bridge** serves `project_links` too: it is OpenCode's transport to the agent (the internal `tool` subcommand), not a user-facing link command, and the author wants linking through the agent in every agent.
- **Rules are never superseded by consolidation.** A project's own consolidation must not supersede a user rule: the rule would silently stop being the author's. User rules are excluded as supersede targets.
- **Accept reads the sources as they are now.** A source re-distilled into another kind or text after the proposal is not superseded by the rule.

## The signals

Computed by the background drain after distilling, never on a hook path, only for projects the mem already knows (at most 200, each needing a recorded root that still exists).

1. **Same owner and a shared name stem → `product`.** Both remotes have the same host and owner and the repository names share a stem of 3 or more characters once split on `-`, `_` and `.`.
2. **A declared dependency → `A uses B`.** A's `package.json`, `composer.json`, `go.mod` or `Cargo.toml` names B by package name (B's own manifest), by a `file:`/`link:`/`path` reference that resolves to B's root, or by B's git remote. Manifests over 256 KiB are not read.
3. **One workspace → `product`.** Projects under one root whose `pnpm-workspace.yaml` or `package.json` `workspaces` cover both, the nearest such root winning; negated (`!x`) and catch-all (`**`) globs never match, the walk stops below the home directory and at 6 levels, and a workspace pairs at most 30 members.

Each suggestion stores the signal that produced it, shown by the viewer.

**Why the owner alone never suggests.** An agency or a company account holds dozens of repositories for different clients under one owner. Linking them would put one client's decisions in another client's sessions, the worst failure this feature can have. So the owner must come with a shared name stem, and the stem must say something: the owner's own name (and its parts) never counts, and neither does a generic word every such repository carries:

`api`, `web`, `app`, `ui`, `frontend`, `backend`, `server`, `client`, `core`, `service`, `lib`, `mobile`, `admin`, `site`, `website`, `theme`, `docs`, `doc`, `infra`, `config`, `gateway`, `cms`, `dashboard`, `portal`, `landing`, `plugin`, `sdk`, `cli`, `tools`, `test`, `tests`, `e2e`, `deploy`, `ops`, `data`, `assets`, `static`, `www`, `wp`, `wordpress`, `laravel`, `react`, `vue`, `next`, `nuxt`, `node`.

The plan's first twelve were a floor; the list grew in review (the spec's binding goal is that one owner's unrelated client repositories are never suggested together). Cost if it is too long: a real same-product pair is linked by hand.

## Said always

The first build proposed any eligible memory whose turn's prompt contained "sempre", "always" or "every project" anywhere: 29 proposals on the author's store, none of them a personal rule (pasted reports, and "sempre" in ordinary Portuguese). The signal is now exact rules in code (`saidAlways`, `src/links/rules.ts`):

1. **Only what the author typed.** A prompt the host wrote (`<task-notification>`, `<agent-message>`) never counts. Fenced code, `<tag>…</tag>` blocks, lines starting with `>` and any line over 300 characters are dropped; if more than 600 characters remain, the prompt is a task, not a rule.
2. **A rule phrase.** English: "always", "from now on", "in every/all/any project or repo". Portuguese, where the bare "sempre" is ordinary speech: its rule forms only ("sempre que", "sempre em", an imperative or infinitive beside it such as "usa sempre" or "sempre usar"), "em todos os projetos", "em qualquer projeto", "de agora em diante", "a partir de agora", "daqui para a frente".
3. **The phrase and the rule share a sentence.** One sentence of at most 240 characters holds the phrase and at least two of the memory title's own words (search tokens of 3 or more characters, stemmed, without stopwords or the phrase's own words), at least one of them not a generic word of talk about code.
4. **One per turn.** Several memories distilled from one turn give at most one proposal: the one whose title shares the most words, then the most important, then the newest.
5. **With a judge, a sure yes.** See the Judge row above.

A memory with no source turn (imports, edits) is never "said always". The rule phrase in the memory's own language matters: a Portuguese sentence and an English title share few words, so such a rule is found only when it also repeats across projects.

## The shares

The brief's budget is unchanged at 4,200 characters:

- **Your rules:** up to 15%, most important first, labelled "(you)".
- **Linked projects:** up to 15%, only memories of importance 4 or more, labelled "(from <project>)".
- **The current project:** the rest, including whatever the other two leave unused. Its notes come first, so the top of the brief reads as it always has; a rule the share leaves out stays among its project's notes.

Prompt notes: the lexical search runs over P and the visible projects; at most **1** note from a linked project per prompt, and only when it outranks P's best note (or P has none), labelled with its origin. The linked matches are read newest first from a bounded scan (500 rows, the best 50 kept), so a prompt's cost does not grow with the size of the projects it is linked to. User rules compete like P's own memories.

With no confirmed links and no user rules, `sessionBrief` and `retrieveForPrompt` return byte for byte what they returned before (snapshots pinned from `main` before any code changed: `tests/unit/brief-links.test.ts`, `tests/unit/prompt-links.test.ts`), and the golden retrieval test is unchanged. Any error in links or rules (a missing table, a failed query) falls back to the current project alone; hooks exit 0.

## Migration 7 and older binaries

Migration 7 creates `project_links`, `rule_proposals` and `user_memories`, after the backup every migration takes. **0.5.0 binaries refuse a v7 database**, as older binaries refuse any newer schema: they stop with "database schema version 7 is newer than this wizardingcode-mem supports (6); upgrade wizardingcode-mem", and `doctor` reports the same as a failed check. Every agent's binary has to move together.

## Background steps

`wizardingcode-mem distill`, after the drain, in order, each in its own guard so a failure never changes the drain's outcome: the vector heal (ADR 0017), the link suggestions (`suggestLinksSafely`), the rule proposals (`proposeRulesSafely`: the 50 most recently active projects and a 5 s budget). The 5 s was set in Task 5 from a measured synthetic worst case of 5.6 s.

The proposal pass keeps a meta cursor, `rules.cursor = {updatedAt, id, model}`, and takes only the eligible memories after it, oldest first, at most 300 a run. The first run starts at the 300th newest eligible memory, so the backlog is bounded without walking the store's whole history. After each memory whose search finished the cursor may move past it; groups the judge had no time for hold it back so the next run finds them again; once every candidate is reached it moves to the newest active memory, so newer memories that are not candidates do not keep the next drain busy. Grouping is symmetric (a new memory's search reaches every older one in the other projects), so what is behind the cursor never needs scanning again, and a reinforced memory, whose `updated_at` moves, is looked at again. A new semantic model starts the window over, by meaning. A drain with nothing new reads `max(updated_at)` from the covering ranking index (a tie on the cursor's millisecond is looked up by id) and stops. The cursor only moves forward (compare-and-set in one write), and a `rules.lease` lease keeps two distill processes from proposing at once.

Measured in the build, on synthetic stores (`tests/perf`, the compiled binary): with the project linked to ten projects of 2,000 memories each and twenty user rules, prompt p95 45 ms (budget 80) and session start p95 22 ms (budget 150).

## The proof

`scripts/proof/links.sh <work dir> [--runs n] [--prompts n] [--hand-links n] [--seed-rules n] [--unbounded]` copies the live database with `sqlite3 -readonly … ".backup"` into a fresh data directory, with TypeSafe's variables unset and distillation, the viewer, the migration and the browser off. `scripts/proof/links.ts` migrates the copy, runs the link suggestions twice (first, then steady), writes `--seed-rules` synthetic rules "said always" (default 3: a short typed prompt and the memory it gave, never the author's text) to measure recall, runs the proposal pass drain after drain until its cursor reaches the backlog, then 20 quiet drains, counts what they produce, and measures `sessionBrief` and `retrieveForPrompt` in process before and after. The suggestion pass reads manifests from the project roots the copy records (only read). It writes an anonymous report and a separate one with names and rule text that is never committed.

Run three times on 2026-10-12, each on a fresh copy, Apple M4 Max, the pinned Bun 1.4.2. The store: 90 projects, of which 25 have a recorded root and 7 a git remote (most came from the claude-mem import, which records no root); 67,988 active memories, 4,566 of them conventions or decisions. Numbers are the median of the three runs, with their range where it matters.

**Background steps**

| Step | First run | Steady run |
|---|---|---|
| Link suggestions | 2–7 ms, 0 suggested | 1 ms, 0 refreshed |
| Rule proposals (heuristic judge, no model) | the 300-memory backlog in 6 drains each run: five of about 5.0–5.1 s (35–91 memories each) and a last of 1.4–2.3 s | a drain with nothing new: p50 2.6 ms, p95 2.9 ms (2.9–5.1 over the runs; n = 20 per run) |

Before the cursor, every drain spent the whole 5 s on the same newest window and never reached memories past about the 50th. Now the backlog is a one-off of about 27 s of background time spread over six drains, and a quiet drain costs one index read.

**Suggestions: none, so none mixes two clients.** Of the 7 projects with a remote, the pairs under one owner share only the owner's own name, which never counts. One same-product pair (a repository and its renamed successor) would have matched on a shared stem, but the old name's root no longer exists on disk. No two known roots sit in one declared workspace, and no manifest names another known project.

**Proposals: 1 from the author's data in each run (the same one), plus the 3 seeded; 0 "repeated".** The narrowed signal took the 29 "said always" proposals of the first build down to 1. Judged by eye on the full report, that 1 is not a personal rule: a memory whose title copies a short complaint that used a rule form of "sempre". So: at most 1 false proposal, against 29. All 3 seeded rules (one in English, two in Portuguese, each a short typed sentence naming the rule) were proposed in every run: recall 3 of 3 on the seeds. The grouping found no rule repeated across unlinked projects at the `DUPLICATE` threshold.

**Brief and prompt, in process, ms, p50 / p95, median of three runs** (10 projects: the most recently active, since none had a suggestion; 100 of their own recent prompts; 10 timed rounds after a warm one in each run)

| Phase | Brief | Prompt | Brief chars (mean) | Brief notes linked / you | Prompts with notes | Prompt notes linked / you |
|---|---|---|---|---|---|---|
| Before | 0.93 / 9.51 | 0.76 / 9.55 | 3,362 | 0 / 0 | 43/100 | 0 / 0 |
| Every suggestion confirmed (0) | 0.98 / 9.52 | 0.76 / 9.54 | 3,362 | 0 / 0 | 43/100 | 0 / 0 |
| + 30 links by hand to the 3 biggest projects (stress) | 2.07 / 10.36 | 5.06 / 16.94 | 3,597 | 40 / 0 | 47/100 | 19 / 0 |
| + every proposal accepted (4 rules, 3 of them seeded) | 1.77 / 10.62 | 4.99 / 17.01 | 3,773 | 40 / 40 | 47/100 | 19 / 3 |

Within each phase the three runs' p95s differ by under 1 ms. With no confirmed link the numbers and the notes are unchanged. The stress (each project linked to the three projects with the most important memories) raises the prompt's p95 to about 17 ms and the brief's by about 1 ms, inside the hook budgets with room to spare; the linked share is used (40 brief notes, at most one linked note in 19 of 100 prompts). Accepting the 4 proposals adds one "(you)" note per rule to each brief (40) and 3 prompt notes.

## What the proof leaves open

- **The repeated signal is unproven on real data:** zero groups at `DUPLICATE` across unlinked projects. Whether a looser text threshold, or the model's `SAME_MEANING` (0.8, not calibrated), finds real repeats without false ones is a later measurement.
- **Recall of "said always" across languages:** the seeds measure rules stated in the title's language. A rule typed in Portuguese whose memory was distilled with an English title shares few words with it and is not proposed as "said always".

## What is not done

- **Team links** (a links file in the repository, shareable through git): with team memory (C2).
- **Clones, forks and worktrees** of one repository; a renamed repository whose old root is gone is not suggested with its successor, and neither is a pair of successive versions of one product that share no signal (no owner and stem, no manifest, no workspace): link them by hand.
- **SAME_MEANING calibration** for grouping rules by meaning (0.8, set without a measurement).
- **An SSH host alias is compared as written:** `git@gh-work:acme/x` parses (a dotless alias is a host), but it is not resolved to its `HostName`, so `gh-work` and `github.com` remotes of one owner are not compared with each other.
- **A project turned back on** after memory was off is not rescanned for rules until its conventions and decisions change.
- **Deferred minors worth naming:** the suggestion pass re-reads every manifest on each drain and compares pairs in O(n²) (200 projects at most); search outside the default scope does not include the author's rules; a linked project's user rule left out by the share loses its "from" label; a memory once in any proposal, even a rejected one, is never a candidate again; and the viewer keeps a client-side copy of the visible-projects logic.
