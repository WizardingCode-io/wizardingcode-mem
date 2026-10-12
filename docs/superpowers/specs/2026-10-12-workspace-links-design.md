# Linked projects and your own rules — design

Date: 2026-10-12. Status: approved by the author; built (plan `docs/superpowers/plans/2026-10-12-workspace-links.md`, with Ruling P1: a `user_memories` marker instead of `scope = 'user'`) and measured on a copy of real data: ADR 0018. Roadmap items B1 (links between workspaces) and B2 (memory of the user), the first of wave 3.

## Why

Every session sees only its own project: the session brief and the prompt notes filter on one `project_id` (`src/retrieve/brief.ts`, `src/retrieve/prompt.ts`). Only `mcp --global` (Claude Desktop) searches every project. Three situations cost the author today:

1. **Repositories of one product** (an API, a web app, a mobile app): a decision taken in one should be known in the others.
2. **Shared libraries** (an internal package, a design system): what was learned in the library should be known where it is used, not the other way round.
3. **The author as a person**: rules and preferences ("answer in Portuguese", "never do X") that hold in every project and every agent. Each agent has its own global instructions file, and they do not talk to each other.

Clones, forks and worktrees of one repository are out of scope.

## Decisions

- **Links live in the mem database** (approach 1 of 3). A file of links inside each repository (shareable through git) is kept for team memory (C2); merging linked projects into one was rejected because it cannot express a one-way link and would let one project drown another.
- **The mem suggests, the author confirms.** Suggestions come from exact signals, in code, never from a model. Nothing changes in retrieval until a link is confirmed. A rejected suggestion is never suggested again.
- **Linking by hand goes through the agent and the viewer, not the terminal.** The agent gets an MCP tool; there are no `link`/`unlink` commands.
- **Little, and labelled.** Linked projects take a small, fixed share of the brief and at most one note per prompt, always labelled with their origin. Search covers the whole group.
- **Your rules are proposed, never assumed.** A rule that repeats across unrelated projects, or that the author says holds "always", is proposed; it becomes the author's only with a yes.
- **Nothing leaves the machine**, except to TypeSafe when a key is set (as today).

## Data (migration 7)

### `project_links`

| Column | Meaning |
|---|---|
| `id` | primary key |
| `from_project`, `to_project` | `projects(id)`, `ON DELETE CASCADE`; never equal |
| `kind` | `'product'` (same product: stored once, read both ways) or `'uses'` (`from` uses `to`: one way) |
| `status` | `'suggested'`, `'confirmed'` or `'rejected'` |
| `signals` | JSON: the reasons for a suggestion, shown by the viewer; `[]` for a link made by hand |
| `origin` | `'suggested'` or `'manual'` |
| `created_at`, `decided_at` | epoch ms; `decided_at` null while suggested |

One row per unordered pair for `product` (the smaller id in `from_project`), one per ordered pair for `uses`. A unique index on `(from_project, to_project, kind)`. A `rejected` row is kept so the suggestion never returns. Links do not chain: if A is linked to B and B to C, A does not see C.

### Memories with `scope = 'user'`

The `scope` check on `memories` gains `'user'` (a table rebuild inside the migration, with the backup every migration takes). A user-scoped memory keeps the `project_id` it came from, as provenance. Only `convention` and `decision` memories may become the author's.

### `rule_proposals`

| Column | Meaning |
|---|---|
| `id` | primary key |
| `memory_ids` | JSON array of the project memories that say the same rule |
| `title`, `body` | the proposed rule (the text of the most important of them; consolidation never writes text) |
| `reason` | `'repeated'` (2+ unrelated projects) or `'said-always'` |
| `status` | `'proposed'`, `'accepted'` or `'rejected'` |
| `user_memory_id` | the user-scoped memory created on accept |
| `created_at`, `decided_at` | epoch ms |

A rejected proposal is kept; the same set of memories is never proposed again.

## Suggesting links

Computed by the background drain after distilling (never on the hook path), only for projects the mem already knows, bounded per run.

1. **Same owner and a shared name stem → `product`.** Two projects whose git remotes have the same host and owner (`github.com/acme/*`) and whose repository names share a stem of at least 3 characters once split on `-`, `_` and `.` (`shop-api`, `shop-web`). The owner alone never suggests: an organisation holding forty client repositories must not become one group.
2. **A declared dependency → `A uses B`.** A's `package.json`, `composer.json`, `go.mod` or `Cargo.toml` names B by package name (B's own manifest), by `file:`/`link:`/`path` reference, or by B's git remote.
3. **One monorepo → `product`.** Projects under one root that declares workspaces (`pnpm-workspace.yaml`, `workspaces` in `package.json`).

Each suggestion stores the signal that produced it. A pair with a `confirmed` or `rejected` row is never suggested again; a `suggested` row is only refreshed.

## Linking by hand: the agent and the viewer

- **MCP tool `project_links`**: `list` (the current project's links and pending suggestions), `link` (`project`, `kind: product | uses`), `unlink`, `confirm`, `reject` (a suggestion by id). The project is named as `memory_projects` names it. The host asks the author's permission for the call, as for any MCP tool.
- **Viewer**: the same actions (below).

## Retrieval

**Visible projects** from the current project P: P, the projects linked to P as `product` and confirmed (either direction), and the projects P `uses`, confirmed. A project that uses P is not visible from P.

**Session brief** (budget unchanged, 4,200 characters):
- the author's rules (`scope = 'user'`): up to 15% of the budget, most important first, labelled "(you)";
- linked projects: up to 15%, only memories of importance 4 or more, labelled "(from <name>)";
- the current project: the rest, including whatever the other two leave unused.

With no user rules and no confirmed links the brief is byte for byte what it is today.

**Prompt notes**: the lexical search runs over P and the visible projects. A note from a linked project enters only if its score beats P's best note, or if P has none; at most one per prompt, labelled with its origin. User rules compete like P's own memories.

**Search** (`memory_search`, the viewer's list and palette): by default P and the visible projects, each result named with its project; the `project` filter still narrows. `--global` is unchanged.

**Cost**: the visible set is one small indexed read. The hook budgets hold (prompt ≤ 80 ms p95, session start ≤ 150 ms) and are proven in `tests/perf`.

## Proposing your rules

In the background, after the drain, bounded per run:

- **Repeated**: active `convention` or `decision` memories in 2 or more projects that are not linked to each other, grouped by the neighbour rule consolidation already uses (`findNeighbours` with the `DUPLICATE` threshold), and by meaning when the model is present.
- **Said always**: a prompt that says the rule holds everywhere ("sempre", "em todos os projetos", "always", "every project", "in every repo"); the memory distilled from that turn is proposed alone.
- With a TypeSafe key, the `Judge` confirms the rule is personal rather than specific to its project; without one, the heuristic stands and the author decides.
- **Accept**: a new memory with `scope = 'user'` (origin `manual`, the text of the proposal) supersedes the project copies, which are never deleted.
- **Undo** (in the viewer): the user memory is archived and the copies return to `active`.

## Viewer

Built from the rendered Sales OS mockups and compared side by side in light and dark.

- **A "Projects" view** in the rail: the projects as a grouped list. For each, its confirmed links, its suggestions with their signals and Link / Reject buttons, and the kind (same product, uses).
- **A "You" section**: proposed rules (text, the projects they came from, Make mine / Reject) and accepted ones (Undo).
- **A quiet banner** when there are new suggestions or proposals, like the history banner.
- **The memory list** gains a filter "this project / with linked" and an origin label on rows from other projects.

## Errors

- Hooks never fail because of this: if `project_links` is missing or a query fails, retrieval falls back to the current project only (fail open, exit 0).
- Migration 7 takes the usual backup first. 0.5.0 binaries refuse the migrated database, as older binaries already do; the ADR and `doctor` say so.
- A suggestion whose projects have been deleted disappears with them (`ON DELETE CASCADE`).

## Testing

TDD, every test seen failing first.

- One-way `uses`: the library does not see its consumer.
- Brief shares: user rules ≤ 15%, linked ≤ 15%, the rest for P; unused shares go to P.
- With no links and no user rules the brief and the prompt notes are byte for byte unchanged (pinned snapshot).
- A rejected link or proposal never returns.
- Two client repositories under one owner with unrelated names are not suggested.
- Each signal (owner + stem, each manifest kind, monorepo) suggests the right kind and direction.
- No chaining: A–B and B–C confirmed, A does not see C.
- At most one linked note per prompt, and only above P's best.
- Accept and undo a rule proposal; the copies are superseded, then restored.
- `project_links` MCP tool: every action, and refusals for unknown projects.
- Hook budgets in `tests/perf` with links and user rules present.

**Proof on a read-only copy of the author's database** (TypeSafe off): the suggestions that would be made (reviewed by eye for mixed clients), how many rules would be proposed (judged by eye in the report, never committed), and brief and prompt latency before and after.

## Not in this design

- Team-shared links (a links file in the repository): with team memory (C2).
- Clones, forks and worktrees of one repository.
- Injecting knowledge or personas: the new product of wave 3 (D2).
