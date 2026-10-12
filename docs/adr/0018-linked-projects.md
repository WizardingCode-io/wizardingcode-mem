# ADR 0018 — Linked projects and your own rules

Date: 2026-10-12 · Status: accepted; built and measured on a copy of real data. The proof found the rule proposals' "said always" signal too loose on the author's data (see [The proof](#the-proof)); it needs narrowing before it is offered by default. Roadmap items B1 (links between workspaces) and B2 (memory of the user), the first of wave 3. Design: `docs/superpowers/specs/2026-10-12-workspace-links-design.md`; plan: `docs/superpowers/plans/2026-10-12-workspace-links.md`.

## Context

Every session saw only its own project: the brief and the prompt notes filtered on one `project_id`. Three situations cost the author: repositories of one product (an API, a web app, a mobile app), shared libraries (what was learned in the library should be known where it is used, not the reverse), and the author as a person (rules that hold in every project and every agent, which each agent keeps in its own instructions file). Clones, forks and worktrees of one repository are out of scope.

## Decisions

| Topic | Decision |
|---|---|
| Where links live | In the mem database (`project_links`, migration 7), not in a file in each repository (kept for team memory, C2), and not by merging projects (it cannot express a one-way link and lets one project drown another). |
| Who links | The mem suggests from exact signals in code, never a model; the author confirms. Nothing in retrieval changes until a link is confirmed. |
| By hand | The MCP tool `project_links` (`list`, `link {project, kind}`, `unlink {project}`, `confirm {id}`, `reject {id}`) and the viewer's **Projects** view. No `link`/`unlink` commands. |
| Kinds | `product` (one row per unordered pair, read both ways) and `uses` (one row per ordered pair: the consumer sees the library, never the reverse). |
| No chaining | A–B and B–C confirmed: A does not see C. The visible set from P is P, its confirmed `product` partners (either direction) and the projects P confirmed it `uses`. |
| Never again | A pair with a confirmed or rejected row, in either direction and of either kind, is never suggested again; a rejected rule proposal (the same set of memories) is never proposed again. Unlinking turns a confirmed link into a rejected one. |
| Search | `memory_search`, the viewer's list and palette: by default P and the visible projects, each result named with its project; the `project` filter narrows; `--global` is unchanged. |
| Your rules | Proposed in the background, never assumed: a `convention` or `decision` that repeats across projects not linked to each other, or that the author said holds "always". It becomes the author's only on a yes; the project copies are superseded, never deleted; Undo archives the rule and brings the copies back. |
| Judge | With a TypeSafe key the `Judge` answers whether a proposed rule is personal (a "not personal" verdict is remembered so the same group is not asked again); without one, the heuristic stands and the author decides. |
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

`wizardingcode-mem distill`, after the drain, in order, each in its own guard so a failure never changes the drain's outcome: the vector heal (ADR 0017), the link suggestions (`suggestLinksSafely`), the rule proposals (`proposeRulesSafely`, at most the newest 300 eligible memories, the 50 most recently active projects, and a 5 s budget; groups not reached wait for the next drain). The 5 s was set in Task 5 from a measured synthetic worst case of 5.6 s.

Measured in the build, on synthetic stores (`tests/perf`, the compiled binary): with the project linked to ten projects of 2,000 memories each and twenty user rules, prompt p95 45 ms (budget 80) and session start p95 22 ms (budget 150).

## The proof

`scripts/proof/links.sh <work dir> [--runs n] [--prompts n] [--hand-links n] [--unbounded]` copies the live database with `sqlite3 -readonly … ".backup"` into a fresh data directory, with TypeSafe's variables unset and distillation, the viewer, the migration and the browser off; `scripts/proof/links.ts` migrates the copy, runs both background steps twice (first, then steady), counts what they produce, and measures `sessionBrief` and `retrieveForPrompt` in process before and after. The suggestion pass reads manifests from the project roots the copy records (only read). It writes an anonymous report and a separate one with names and rule text that is never committed.

Run on 2026-10-12, Apple M4 Max, the pinned Bun 1.4.2. The store: 90 projects, of which 25 have a recorded root and 7 a git remote (most came from the claude-mem import, which records no root); 67,973 active memories, 4,562 of them conventions or decisions.

**Background steps**

| Step | First run | Steady run |
|---|---|---|
| Link suggestions | 4 ms, 0 suggested | 1 ms, 0 refreshed |
| Rule proposals (heuristic judge, no model) | 5,064 ms, 29 proposed | 5,048 ms, 0 proposed |
| Rule proposals, no time budget (`--unbounded`) | 29,288 ms, 0 more | |

**Suggestions: none, so none mixes two clients.** Of the 7 projects with a remote, the pairs under one owner share only the owner's own name, which never counts. One same-product pair (a repository and its renamed successor) would have matched on a shared stem, but the old name's root no longer exists on disk. One remote uses an SSH host alias (a host with no dot) and does not parse. No two known roots sit in one declared workspace, and no manifest names another known project.

**Proposals: 29, all "said always", each of one memory; 0 "repeated".** Judged by eye on the full report: **none of the 29 is a personal rule.** They are task verdicts, review results and project-specific behaviour, proposed because the turn's prompt contained the phrase somewhere: "sempre" 19 times, "always" 9, "every project" once. 26 of the 29 prompts are longer than 1,000 characters (median 3,578, several at the 8,192 cap), mostly pasted reports in which the word is incidental; the three short ones use "sempre" in passing, about something else. With no time budget, the grouping over the 300 newest candidates took about 98 ms each and found no rule repeated across unlinked projects at the `DUPLICATE` threshold. Within the 5 s budget only the first ~50 candidates are reached, and the same newest window is scanned again on every drain, so the steady cost is the full 5 s per drain.

**Brief and prompt, in process, ms, p50 / p95** (10 projects: the most recently active, since none had a suggestion; 100 of their own recent prompts; 10 timed rounds after a warm one)

| Phase | Brief | Prompt | Brief chars (mean) | Brief notes linked / you | Prompts with notes | Prompt notes linked / you |
|---|---|---|---|---|---|---|
| Before | 1.44 / 8.77 | 0.00 / 7.20 | 3,324 | 0 / 0 | 38/100 | 0 / 0 |
| Every suggestion confirmed (0) | 1.02 / 8.73 | 0.00 / 6.86 | 3,324 | 0 / 0 | 38/100 | 0 / 0 |
| + 30 links by hand to the 3 biggest projects (stress) | 1.67 / 9.81 | 0.00 / 16.48 | 3,566 | 40 / 0 | 42/100 | 18 / 0 |
| + every proposal accepted (29 rules) | 4.82 / 10.57 | 0.00 / 19.23 | 3,829 | 40 / 52 | 42/100 | 12 / 16 |

At least half of the real prompts end before searching (text the host wrote, or no searchable words), hence the zero medians. With no confirmed link the numbers and the notes are unchanged. The stress (each project linked to the three projects with the most important memories, about 51,000 active memories behind the links, 31,000 of them of importance 4 or more) doubles the prompt's p95 to about 16 ms and adds about 1 ms to the brief's, inside the hook budgets with room to spare; the linked share is used (40 brief notes, at most one linked note in 18 of 100 prompts). Accepting the 29 proposals shows what accepting wrong rules would do: 52 "(you)" notes in the briefs and 16 in the prompts, every one of them noise. The proposals are what must be fixed, not the retrieval.

## What the proof asks for

- **Narrow "said always" before proposals are offered by default.** The phrase anywhere in a prompt is not evidence: in Portuguese "sempre" is ordinary, and prompts carry pasted reports. Candidates to measure on this proof: the phrase only in the sentence the memory was distilled from, or in a short prompt the author typed (not pasted), or the TypeSafe `personal` verdict required rather than optional. Until then the viewer's proposals need the author's no 29 times on this store.
- **A watermark for the grouping pass,** so a drain scans only what is new instead of the same 300 every time, and the 5 s goes back to zero on a quiet drain.
- **The repeated signal is unproven on real data:** zero groups at `DUPLICATE` across unlinked projects. Whether a looser text threshold, or the model's `SAME_MEANING` (0.8, not calibrated), finds real repeats without false ones is a later measurement.

## What is not done

- **Team links** (a links file in the repository, shareable through git): with team memory (C2).
- **Clones, forks and worktrees** of one repository; a renamed repository whose old root is gone is not suggested with its successor (link it by hand).
- **SAME_MEANING calibration** for grouping rules by meaning (0.8, set without a measurement).
- **Deferred minors worth naming:** a GitLab subgroup remote and an SSH host alias parse as no remote; the suggestion pass re-reads every manifest on each drain and compares pairs in O(n²) (200 projects at most); two distill processes can propose at once; a pair with both a `product` and a `uses` link reports one relation arbitrarily; candidates from disabled projects are not excluded from proposals; search outside the default scope does not include the author's rules; a linked project's user rule left out by the share loses its "from" label; and the viewer keeps a client-side copy of the visible-projects logic.
